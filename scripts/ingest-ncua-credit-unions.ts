import { ingestNcuaSnapshot } from '@boomerbuddy/business-os';
import { loadConfig, loadEnvironmentFile } from '@boomerbuddy/config';
import {
  BusinessOsRepository,
  createPGliteDatabase,
  createPostgresDatabase,
  runMigrations,
  type Database,
} from '@boomerbuddy/persistence';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface Arguments {
  readonly archive: string;
  readonly cycleDate: string;
  readonly directory: string;
  readonly downloadedAt: Date;
  readonly sourceUrl: string;
}

function argumentMap(argv: readonly string[]): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === undefined || value === undefined || !key.startsWith('--')) {
      throw new TypeError('Arguments must be --name value pairs.');
    }
    values.set(key.slice(2), value);
  }
  return values;
}

function required(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key);
  if (value === undefined || value.trim() === '') throw new TypeError(`--${key} is required.`);
  return value;
}

function parseArguments(argv: readonly string[]): Arguments {
  const values = argumentMap(argv);
  const cycleDate = required(values, 'cycle-date');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(cycleDate)) {
    throw new TypeError('--cycle-date must be YYYY-MM-DD.');
  }
  const downloadedAt = new Date(required(values, 'downloaded-at'));
  if (Number.isNaN(downloadedAt.getTime()))
    throw new TypeError('--downloaded-at must be ISO 8601.');
  const sourceUrl = new URL(required(values, 'source-url'));
  if (sourceUrl.protocol !== 'https:' || sourceUrl.hostname !== 'ncua.gov') {
    throw new TypeError('--source-url must be an HTTPS ncua.gov URL.');
  }
  return {
    archive: resolve(required(values, 'archive')),
    cycleDate,
    directory: resolve(required(values, 'directory')),
    downloadedAt,
    sourceUrl: sourceUrl.toString(),
  };
}

function callReportCycle(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  if (year === undefined || month === undefined || day === undefined) {
    throw new TypeError('Invalid cycle date.');
  }
  return `${Number(month)}/${Number(day)}/${year}`;
}

async function connect(): Promise<Database> {
  const config = loadConfig();
  return config.database.driver === 'pglite'
    ? createPGliteDatabase(config.database.path)
    : createPostgresDatabase(config.database.url);
}

async function main(): Promise<void> {
  if (existsSync('.env')) loadEnvironmentFile();
  const args = parseArguments(process.argv.slice(2));
  const [archive, foicu, fs220] = await Promise.all([
    readFile(args.archive),
    readFile(resolve(args.directory, 'FOICU.txt'), 'utf8'),
    readFile(resolve(args.directory, 'FS220.txt'), 'utf8'),
  ]);
  const sha256 = createHash('sha256').update(archive).digest('hex');
  const records = ingestNcuaSnapshot(foicu, fs220, callReportCycle(args.cycleDate));
  const database = await connect();
  try {
    await runMigrations(database);
    const now = new Date();
    const result = await new BusinessOsRepository(database).importNcuaSnapshot({
      records,
      provenance: {
        cycleDate: args.cycleDate,
        downloadedAt: args.downloadedAt,
        sha256,
        sourceUrl: args.sourceUrl,
      },
      context: { correlationId: `ncua-${randomUUID()}`, now },
    });
    process.stdout.write(
      `${result.imported ? 'Imported' : 'Already imported'} ${result.organizationCount} federally insured credit unions from ${args.cycleDate}; snapshot ${result.snapshotId}; SHA-256 ${sha256}.\n`,
    );
  } finally {
    await database.close();
  }
}

await main();
