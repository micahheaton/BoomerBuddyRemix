import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdtemp, open, realpath, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const backupMagic = Buffer.from('BBR31PGDUMP1\0', 'ascii');
const authenticationTagBytes = 16;
const maximumHeaderBytes = 4_096;
const maximumReceiptBytes = 64 * 1_024;
const receiptVersion = 'run3-1-postgres-portability-v1' as const;
const candidateShaPattern = /^[0-9a-f]{40}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const founderKeyPattern = /^[A-Za-z0-9+/]{43}=$/u;
const migrationManifestEntryPattern = /^[0-9]{4}_[A-Za-z0-9_-]+\.sql:[0-9a-f]{64}$/u;
const safeDatabaseName = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$/u;
const destructiveDatabaseName =
  /^(?:(?:test|restore|drill)(?:[_-][A-Za-z0-9_-]+)*|[A-Za-z0-9_-]+[_-](?:test|restore|drill))$/u;
const repositoryRootFromScript = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const criticalPortabilityTables = [
  'schema_migrations',
  'persons',
  'identities',
  'households',
  'household_memberships',
  'household_administrator_assignments',
  'household_payers',
  'household_billing_authorities',
  'employee_assignments',
  'sessions',
  'provider_session_revocations',
  'production_customer_bootstraps',
  'production_founder_bootstraps',
  'artifacts',
  'analyses',
  'check_shares',
  'public_check_contexts',
  'public_check_results',
  'public_check_conversions',
  'consents',
  'consent_evidence',
  'consent_current_projections',
  'invitations',
  'trusted_circle_relationships',
  'orientation_states',
  'safe_word_verifiers',
  'organizations',
  'commerce_subscriptions',
  'commerce_provider_subscription_records',
  'commerce_sponsorships',
  'commerce_sponsorship_allocations',
  'entitlement_grants',
  'commerce_allowance_allocations',
  'protected_members',
  'commerce_event_inbox',
  'durable_jobs',
  'durable_job_attempts',
  'durable_consumer_receipts',
  'worker_heartbeats',
  'audit_events',
  'outbox_events',
  'automation_budget_caps',
  'automation_budget_windows',
  'automation_budget_reservations',
  'automation_budget_reservation_allocations',
  'automation_budget_events',
  'external_actions',
  'external_action_attempts',
  'privacy_requests',
  'privacy_request_events',
  'founding_household_program_definitions',
  'founding_household_program_definition_revisions',
  'founding_household_founder_authorities',
  'founding_household_operations',
  'founding_household_policy_versions',
  'founding_household_sponsor_backings',
  'founding_household_invitations',
  'founding_household_enrollments',
  'founding_household_allowance_transitions',
  'feedback_records',
  'feedback_payloads',
  'feedback_state_events',
  'feedback_consent_events',
  'feedback_assignment_events',
  'feedback_intake_operations',
  'feedback_processing_jobs',
  'feedback_payload_erasure_events',
  'feedback_authenticated_quota_buckets',
  'feedback_authenticated_quota_charges',
] as const;

export type CriticalPortabilityTable = (typeof criticalPortabilityTables)[number];
export type CriticalTableCounts = Readonly<Record<CriticalPortabilityTable, number>>;

export interface ParsedPostgresUrl {
  readonly host: string;
  readonly port: string;
  readonly database: string;
  readonly username: string;
  readonly password: string;
  readonly sslMode: 'require' | 'verify-ca' | 'verify-full';
}

export interface ProcessInvocation {
  readonly command: 'pg_dump' | 'pg_restore' | 'psql';
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
}

export interface ProcessResult {
  readonly status: number | null;
  readonly stdout: string;
}

export type ProcessRunner = (invocation: ProcessInvocation) => Promise<ProcessResult>;

export interface DatabaseSnapshot {
  readonly criticalTableCounts: CriticalTableCounts;
  readonly migrationCount: number;
  readonly migrationManifestSha256: string;
}

export interface PortabilityReceipt extends DatabaseSnapshot {
  readonly version: typeof receiptVersion;
  readonly evidenceTier: 'local_operator_generated';
  readonly candidateSha: string;
  readonly createdAt: string;
  readonly backupSha256: string;
  readonly backupBytes: number;
  readonly authenticatedMetadataSha256: string;
  readonly encryption: {
    readonly algorithm: 'aes-256-gcm';
    readonly keyCustody: 'founder_held_out_of_band';
  };
}

export interface EncryptedBackupHeader {
  readonly version: typeof receiptVersion;
  readonly algorithm: 'aes-256-gcm';
  readonly candidateSha: string;
  readonly authenticatedMetadataSha256: string;
  readonly ivBase64: string;
}

export interface EncryptedBackupResult {
  readonly header: EncryptedBackupHeader;
  readonly backupSha256: string;
  readonly backupBytes: number;
}

interface SnapshotQueryPayload {
  readonly criticalCounts: unknown;
  readonly migrations: unknown;
}

interface WorkflowOptions {
  readonly databaseUrl: string;
  readonly keyBase64: string;
  readonly candidateSha: string;
  readonly baseEnvironment?: NodeJS.ProcessEnv;
  readonly runner?: ProcessRunner;
  readonly clock?: () => Date;
}

export interface BackupWorkflowOptions extends WorkflowOptions {
  readonly outputPath: string;
}

export interface RestoreWorkflowOptions extends WorkflowOptions {
  readonly inputPath: string;
  readonly confirmation: string;
}

export interface BackupWorkflowResult {
  readonly backupPath: string;
  readonly receiptPath: string;
  readonly receipt: PortabilityReceipt;
}

export interface RestoreWorkflowResult {
  readonly restoredDatabase: string;
  readonly receipt: PortabilityReceipt;
  readonly postRestoreSnapshot: DatabaseSnapshot;
}

function decodeUrlComponent(value: string, field: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new TypeError(`DATABASE_URL contains an invalid ${field}`);
  }
}

export function parsePostgresDatabaseUrl(value: string): ParsedPostgresUrl {
  if (
    value.length > 4_096 ||
    value !== value.trim() ||
    value.includes('\0') ||
    value.includes('\r') ||
    value.includes('\n')
  ) {
    throw new TypeError('DATABASE_URL must be a bounded PostgreSQL URL');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    url.hostname === '' ||
    url.username === '' ||
    url.hash !== ''
  ) {
    throw new TypeError('DATABASE_URL must identify one PostgreSQL database');
  }
  const parameters = [...url.searchParams.keys()];
  if (
    parameters.some((name) => name !== 'sslmode') ||
    url.searchParams.getAll('sslmode').length > 1
  ) {
    throw new TypeError('DATABASE_URL contains unsupported connection parameters');
  }
  const sslMode = url.searchParams.get('sslmode');
  if (sslMode === null || !['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
    throw new TypeError('DATABASE_URL must require encrypted PostgreSQL transport');
  }
  const database = decodeUrlComponent(url.pathname.slice(1), 'database name');
  const username = decodeUrlComponent(url.username, 'username');
  const password = decodeUrlComponent(url.password, 'password');
  if (
    url.pathname === '/' ||
    database === '' ||
    database.includes('/') ||
    !safeDatabaseName.test(database)
  ) {
    throw new TypeError('DATABASE_URL must contain one bounded database name');
  }
  if (
    username === '' ||
    username.length > 128 ||
    password.length > 1_024 ||
    [username, password].some(
      (component) =>
        component.includes('\0') || component.includes('\r') || component.includes('\n'),
    )
  ) {
    throw new TypeError('DATABASE_URL contains invalid credentials');
  }
  const port = url.port === '' ? '5432' : url.port;
  if (!/^\d{1,5}$/u.test(port) || Number(port) < 1 || Number(port) > 65_535) {
    throw new TypeError('DATABASE_URL contains an invalid port');
  }
  const host =
    url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname;
  if (host.length > 253) throw new TypeError('DATABASE_URL contains an invalid host');
  return {
    host,
    port,
    database,
    username,
    password,
    sslMode: sslMode as ParsedPostgresUrl['sslMode'],
  };
}

export function postgresProcessEnvironment(
  database: ParsedPostgresUrl,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...baseEnvironment };
  for (const key of Object.keys(environment)) {
    const normalizedKey = key.toUpperCase();
    if (
      normalizedKey === 'DATABASE_URL' ||
      normalizedKey === 'BB_RUN3_1_BACKUP_KEY_BASE64' ||
      normalizedKey.startsWith('PG')
    ) {
      delete environment[key];
    }
  }
  return {
    ...environment,
    PGHOST: database.host,
    PGPORT: database.port,
    PGDATABASE: database.database,
    PGUSER: database.username,
    PGPASSWORD: database.password,
    PGSSLMODE: database.sslMode,
    PGAPPNAME: 'boomerbuddy-run3-1-portability',
    PGCONNECT_TIMEOUT: '10',
  };
}

export function parseFounderBackupKey(value: string): Buffer {
  if (!founderKeyPattern.test(value)) {
    throw new TypeError(
      'BB_RUN3_1_BACKUP_KEY_BASE64 must be canonical base64 for exactly 32 bytes',
    );
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.byteLength !== 32 || decoded.toString('base64') !== value) {
    throw new TypeError(
      'BB_RUN3_1_BACKUP_KEY_BASE64 must be canonical base64 for exactly 32 bytes',
    );
  }
  return decoded;
}

export function validateCandidateSha(value: string): string {
  if (!candidateShaPattern.test(value)) {
    throw new TypeError('Candidate SHA must be an exact lowercase 40-character Git commit');
  }
  return value;
}

function validateIsoTimestamp(value: string): string {
  if (Number.isNaN(new Date(value).getTime()) || new Date(value).toISOString() !== value) {
    throw new TypeError('Backup timestamp must be an exact ISO-8601 instant');
  }
  return value;
}

export function authenticatedMetadataSha256(input: {
  readonly candidateSha: string;
  readonly createdAt: string;
  readonly snapshot: DatabaseSnapshot;
}): string {
  const candidateSha = validateCandidateSha(input.candidateSha);
  const createdAt = validateIsoTimestamp(input.createdAt);
  const canonical = {
    version: receiptVersion,
    candidateSha,
    createdAt,
    criticalTableCounts: criticalPortabilityTables.map((table) => [
      table,
      input.snapshot.criticalTableCounts[table],
    ]),
    migrationCount: input.snapshot.migrationCount,
    migrationManifestSha256: input.snapshot.migrationManifestSha256,
  };
  parseCriticalCounts(input.snapshot.criticalTableCounts);
  if (
    !Number.isSafeInteger(input.snapshot.migrationCount) ||
    input.snapshot.migrationCount < 1 ||
    !sha256Pattern.test(input.snapshot.migrationManifestSha256)
  ) {
    throw new TypeError('Database snapshot metadata is invalid');
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function isPathWithin(parent: string, candidate: string): boolean {
  const pathFromParent = relative(resolve(parent), resolve(candidate));
  return pathFromParent === '' || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent));
}

export async function assertArtifactPathOutsideRepository(
  artifactPath: string,
  repositoryRoot: string,
  mustExist = false,
): Promise<string> {
  if (!isAbsolute(artifactPath)) {
    throw new TypeError('Backup and receipt paths must be absolute');
  }
  const resolvedArtifact = resolve(artifactPath);
  const resolvedRepository = await realpath(repositoryRoot);
  const resolvedParent = await realpath(dirname(resolvedArtifact));
  if (
    isPathWithin(resolvedRepository, resolvedArtifact) ||
    isPathWithin(resolvedRepository, resolvedParent)
  ) {
    throw new TypeError('PostgreSQL backup artifacts must remain outside the repository');
  }
  if (mustExist) {
    const actualArtifact = await realpath(resolvedArtifact);
    if (isPathWithin(resolvedRepository, actualArtifact)) {
      throw new TypeError('PostgreSQL backup artifacts must remain outside the repository');
    }
    const details = await stat(actualArtifact);
    if (!details.isFile()) throw new TypeError('Backup artifact must be a regular file');
    return actualArtifact;
  }
  return resolvedArtifact;
}

export async function assertNoExistingArtifacts(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    try {
      await lstat(path);
      throw new TypeError('Backup tooling refuses to overwrite an existing artifact');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export function assertDisposableRestoreTarget(databaseName: string, confirmation: string): void {
  if (
    !safeDatabaseName.test(databaseName) ||
    !destructiveDatabaseName.test(databaseName) ||
    /(?:prod(?:uction)?|live)/iu.test(databaseName) ||
    confirmation !== `RESTORE-DISPOSABLE:${databaseName}`
  ) {
    throw new TypeError(
      'Restore requires an explicitly disposable test/restore/drill database and exact confirmation',
    );
  }
}

function invocationEnvironment(
  database: ParsedPostgresUrl,
  baseEnvironment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return postgresProcessEnvironment(database, baseEnvironment);
}

export function buildPgDumpInvocation(input: {
  readonly database: ParsedPostgresUrl;
  readonly dumpPath: string;
  readonly cwd: string;
  readonly baseEnvironment?: NodeJS.ProcessEnv;
}): ProcessInvocation {
  return {
    command: 'pg_dump',
    args: [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--serializable-deferrable',
      '--file',
      input.dumpPath,
    ],
    cwd: input.cwd,
    env: invocationEnvironment(input.database, input.baseEnvironment ?? process.env),
  };
}

export function buildPgRestoreListInvocation(input: {
  readonly database: ParsedPostgresUrl;
  readonly dumpPath: string;
  readonly cwd: string;
  readonly baseEnvironment?: NodeJS.ProcessEnv;
}): ProcessInvocation {
  return {
    command: 'pg_restore',
    args: ['--list', input.dumpPath],
    cwd: input.cwd,
    env: invocationEnvironment(input.database, input.baseEnvironment ?? process.env),
  };
}

export function buildPgRestoreInvocation(input: {
  readonly database: ParsedPostgresUrl;
  readonly dumpPath: string;
  readonly cwd: string;
  readonly baseEnvironment?: NodeJS.ProcessEnv;
}): ProcessInvocation {
  return {
    command: 'pg_restore',
    args: [
      '--exit-on-error',
      '--clean',
      '--if-exists',
      '--single-transaction',
      '--no-owner',
      '--no-privileges',
      '--dbname',
      input.database.database,
      input.dumpPath,
    ],
    cwd: input.cwd,
    env: invocationEnvironment(input.database, input.baseEnvironment ?? process.env),
  };
}

const snapshotSql = `SELECT json_build_object(
  'criticalCounts', json_build_object(
    ${criticalPortabilityTables
      .map((table) => `'${table}', (SELECT count(*)::bigint FROM "public"."${table}")`)
      .join(',\n    ')}
  ),
  'migrations', COALESCE(
    (SELECT json_agg(version || ':' || checksum ORDER BY version) FROM "public"."schema_migrations"),
    '[]'::json
  )
)::text;`;

export function buildSnapshotInvocation(input: {
  readonly database: ParsedPostgresUrl;
  readonly cwd: string;
  readonly baseEnvironment?: NodeJS.ProcessEnv;
}): ProcessInvocation {
  return {
    command: 'psql',
    args: [
      '--no-psqlrc',
      '--quiet',
      '--set',
      'ON_ERROR_STOP=1',
      '--tuples-only',
      '--no-align',
      '--command',
      snapshotSql,
    ],
    cwd: input.cwd,
    env: invocationEnvironment(input.database, input.baseEnvironment ?? process.env),
  };
}

export const defaultProcessRunner: ProcessRunner = async (invocation) => {
  try {
    const result = spawnSync(invocation.command, [...invocation.args], {
      cwd: invocation.cwd,
      env: { ...invocation.env },
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      maxBuffer: 2 * 1_024 * 1_024,
    });
    return { status: result.status, stdout: result.stdout ?? '' };
  } catch {
    return { status: null, stdout: '' };
  }
};

async function runChecked(runner: ProcessRunner, invocation: ProcessInvocation): Promise<string> {
  const result = await runner(invocation);
  if (result.status !== 0) {
    throw new Error(`${invocation.command} failed without exposing connection details`);
  }
  return result.stdout;
}

function parseCriticalCounts(value: unknown): CriticalTableCounts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Database snapshot did not return critical table counts');
  }
  const input = value as Record<string, unknown>;
  const counts = {} as Record<CriticalPortabilityTable, number>;
  for (const table of criticalPortabilityTables) {
    const raw = input[table];
    const parsed = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
      throw new TypeError('Database snapshot returned an invalid table count');
    }
    counts[table] = parsed;
  }
  const expectedTables: ReadonlySet<string> = new Set(criticalPortabilityTables);
  if (Object.keys(input).some((table) => !expectedTables.has(table))) {
    throw new TypeError('Database snapshot returned an unexpected table count');
  }
  return counts;
}

export function parseDatabaseSnapshotOutput(output: string): DatabaseSnapshot {
  let payload: SnapshotQueryPayload;
  try {
    payload = JSON.parse(output.trim()) as SnapshotQueryPayload;
  } catch {
    throw new TypeError('Database snapshot output was not valid JSON');
  }
  const migrations = payload.migrations;
  if (
    !Array.isArray(migrations) ||
    migrations.length < 1 ||
    migrations.some(
      (migration) =>
        typeof migration !== 'string' || !migrationManifestEntryPattern.test(migration),
    )
  ) {
    throw new TypeError('Database snapshot returned an invalid migration manifest');
  }
  const migrationEntries = migrations as string[];
  if (
    migrationEntries.some(
      (migration, index) => index > 0 && migration <= migrationEntries[index - 1]!,
    )
  ) {
    throw new TypeError('Database snapshot returned an invalid migration manifest');
  }
  return {
    criticalTableCounts: parseCriticalCounts(payload.criticalCounts),
    migrationCount: migrationEntries.length,
    migrationManifestSha256: createHash('sha256')
      .update(JSON.stringify(migrationEntries))
      .digest('hex'),
  };
}

async function databaseSnapshot(
  database: ParsedPostgresUrl,
  cwd: string,
  baseEnvironment: NodeJS.ProcessEnv,
  runner: ProcessRunner,
): Promise<DatabaseSnapshot> {
  return parseDatabaseSnapshotOutput(
    await runChecked(runner, buildSnapshotInvocation({ database, cwd, baseEnvironment })),
  );
}

type OpenFileHandle = Awaited<ReturnType<typeof open>>;

async function writeBufferExactly(
  file: OpenFileHandle,
  buffer: Buffer,
  position: number,
): Promise<void> {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const { bytesWritten } = await file.write(
      buffer,
      offset,
      buffer.byteLength - offset,
      position + offset,
    );
    if (bytesWritten < 1) throw new Error('Secure artifact write did not make progress');
    offset += bytesWritten;
  }
}

async function readBufferExactly(
  file: OpenFileHandle,
  buffer: Buffer,
  position: number,
): Promise<void> {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const { bytesRead } = await file.read(
      buffer,
      offset,
      buffer.byteLength - offset,
      position + offset,
    );
    if (bytesRead < 1) throw new TypeError('Encrypted backup is truncated');
    offset += bytesRead;
  }
}

export async function assertCustomPostgresDump(path: string): Promise<void> {
  const dump = await open(path, 'r');
  try {
    const details = await dump.stat();
    const magic = Buffer.alloc(5);
    const { bytesRead } = await dump.read(magic, 0, magic.byteLength, 0);
    if (!details.isFile() || details.size <= magic.byteLength || bytesRead !== magic.byteLength) {
      throw new TypeError('pg_dump did not produce a non-empty custom dump');
    }
    if (!magic.equals(Buffer.from('PGDMP', 'ascii'))) {
      throw new TypeError('pg_dump output is not PostgreSQL custom format');
    }
  } finally {
    await dump.close();
  }
}

function canonicalHeader(header: EncryptedBackupHeader): Buffer {
  return Buffer.from(JSON.stringify(header), 'utf8');
}

export async function encryptPostgresDump(input: {
  readonly plaintextPath: string;
  readonly outputPath: string;
  readonly key: Buffer;
  readonly candidateSha: string;
  readonly authenticatedMetadataSha256: string;
}): Promise<EncryptedBackupResult> {
  if (input.key.byteLength !== 32) throw new TypeError('Backup encryption requires 32 bytes');
  validateCandidateSha(input.candidateSha);
  if (!sha256Pattern.test(input.authenticatedMetadataSha256)) {
    throw new TypeError('Backup metadata digest must be an exact SHA-256 value');
  }
  const iv = randomBytes(12);
  const header: EncryptedBackupHeader = {
    version: receiptVersion,
    algorithm: 'aes-256-gcm',
    candidateSha: input.candidateSha,
    authenticatedMetadataSha256: input.authenticatedMetadataSha256,
    ivBase64: iv.toString('base64'),
  };
  const headerBytes = canonicalHeader(header);
  const prefix = Buffer.alloc(backupMagic.length + 4);
  backupMagic.copy(prefix);
  prefix.writeUInt32BE(headerBytes.byteLength, backupMagic.length);
  const cipher = createCipheriv('aes-256-gcm', input.key, iv);
  cipher.setAAD(headerBytes);
  const output = await open(input.outputPath, 'wx', 0o600);
  let outputClosed = false;
  let completed = false;
  try {
    let position = 0;
    const backupHash = createHash('sha256');
    for (const chunk of [prefix, headerBytes]) {
      await writeBufferExactly(output, chunk, position);
      backupHash.update(chunk);
      position += chunk.byteLength;
    }
    for await (const rawChunk of createReadStream(input.plaintextPath)) {
      const encrypted = cipher.update(rawChunk as Buffer);
      if (encrypted.byteLength > 0) {
        await writeBufferExactly(output, encrypted, position);
        backupHash.update(encrypted);
        position += encrypted.byteLength;
      }
    }
    const final = cipher.final();
    if (final.byteLength > 0) {
      await writeBufferExactly(output, final, position);
      backupHash.update(final);
      position += final.byteLength;
    }
    const tag = cipher.getAuthTag();
    await writeBufferExactly(output, tag, position);
    backupHash.update(tag);
    position += tag.byteLength;
    await output.sync();
    await output.close();
    outputClosed = true;
    await chmod(input.outputPath, 0o600);
    completed = true;
    return {
      header,
      backupSha256: backupHash.digest('hex'),
      backupBytes: position,
    };
  } finally {
    if (!outputClosed) await output.close().catch(() => undefined);
    if (!completed) await unlink(input.outputPath).catch(() => undefined);
  }
}

function parseEncryptedHeader(value: unknown): EncryptedBackupHeader {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Encrypted backup header is invalid');
  }
  const header = value as Record<string, unknown>;
  if (
    header.version !== receiptVersion ||
    header.algorithm !== 'aes-256-gcm' ||
    typeof header.candidateSha !== 'string' ||
    !candidateShaPattern.test(header.candidateSha) ||
    typeof header.authenticatedMetadataSha256 !== 'string' ||
    !sha256Pattern.test(header.authenticatedMetadataSha256) ||
    typeof header.ivBase64 !== 'string'
  ) {
    throw new TypeError('Encrypted backup header is invalid');
  }
  const iv = Buffer.from(header.ivBase64, 'base64');
  if (iv.byteLength !== 12 || iv.toString('base64') !== header.ivBase64) {
    throw new TypeError('Encrypted backup IV is invalid');
  }
  return header as unknown as EncryptedBackupHeader;
}

export async function decryptPostgresDump(input: {
  readonly encryptedPath: string;
  readonly plaintextPath: string;
  readonly key: Buffer;
  readonly expectedCandidateSha: string;
}): Promise<EncryptedBackupResult> {
  if (input.key.byteLength !== 32) throw new TypeError('Backup decryption requires 32 bytes');
  validateCandidateSha(input.expectedCandidateSha);
  const encrypted = await open(input.encryptedPath, 'r');
  let output: Awaited<ReturnType<typeof open>> | undefined;
  let outputCreated = false;
  try {
    const details = await encrypted.stat();
    const fixedLength = backupMagic.length + 4;
    if (!details.isFile() || details.size <= fixedLength + authenticationTagBytes) {
      throw new TypeError('Encrypted backup is truncated');
    }
    const fixed = Buffer.alloc(fixedLength);
    await readBufferExactly(encrypted, fixed, 0);
    if (!fixed.subarray(0, backupMagic.length).equals(backupMagic)) {
      throw new TypeError('Encrypted backup format is invalid');
    }
    const headerLength = fixed.readUInt32BE(backupMagic.length);
    if (headerLength < 1 || headerLength > maximumHeaderBytes) {
      throw new TypeError('Encrypted backup header length is invalid');
    }
    const ciphertextStart = fixedLength + headerLength;
    const tagStart = details.size - authenticationTagBytes;
    if (ciphertextStart >= tagStart) throw new TypeError('Encrypted backup is truncated');
    const headerBytes = Buffer.alloc(headerLength);
    await readBufferExactly(encrypted, headerBytes, fixedLength);
    let rawHeader: unknown;
    try {
      rawHeader = JSON.parse(headerBytes.toString('utf8')) as unknown;
    } catch {
      throw new TypeError('Encrypted backup header is invalid');
    }
    const header = parseEncryptedHeader(rawHeader);
    if (header.candidateSha !== input.expectedCandidateSha) {
      throw new TypeError('Encrypted backup candidate SHA does not match the requested candidate');
    }
    const tag = Buffer.alloc(authenticationTagBytes);
    await readBufferExactly(encrypted, tag, tagStart);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      input.key,
      Buffer.from(header.ivBase64, 'base64'),
    );
    decipher.setAAD(headerBytes);
    decipher.setAuthTag(tag);
    output = await open(input.plaintextPath, 'wx', 0o600);
    outputCreated = true;
    let outputPosition = 0;
    const backupHash = createHash('sha256');
    backupHash.update(fixed);
    backupHash.update(headerBytes);
    for await (const rawChunk of encrypted.createReadStream({
      start: ciphertextStart,
      end: tagStart - 1,
      autoClose: false,
    })) {
      const encryptedChunk = rawChunk as Buffer;
      backupHash.update(encryptedChunk);
      const plaintext = decipher.update(encryptedChunk);
      if (plaintext.byteLength > 0) {
        await writeBufferExactly(output, plaintext, outputPosition);
        outputPosition += plaintext.byteLength;
      }
    }
    const final = decipher.final();
    if (final.byteLength > 0) {
      await writeBufferExactly(output, final, outputPosition);
    }
    backupHash.update(tag);
    await output.sync();
    await output.close();
    output = undefined;
    await chmod(input.plaintextPath, 0o600);
    return {
      header,
      backupSha256: backupHash.digest('hex'),
      backupBytes: details.size,
    };
  } catch (error) {
    await output?.close().catch(() => undefined);
    if (outputCreated) await unlink(input.plaintextPath).catch(() => undefined);
    throw new TypeError('Encrypted backup authentication failed', { cause: error });
  } finally {
    await encrypted.close();
  }
}

function parseReceipt(value: unknown): PortabilityReceipt {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Backup receipt is invalid');
  }
  const receipt = value as Record<string, unknown>;
  if (
    receipt.version !== receiptVersion ||
    receipt.evidenceTier !== 'local_operator_generated' ||
    typeof receipt.candidateSha !== 'string' ||
    !candidateShaPattern.test(receipt.candidateSha) ||
    typeof receipt.createdAt !== 'string' ||
    Number.isNaN(new Date(receipt.createdAt).getTime()) ||
    new Date(receipt.createdAt).toISOString() !== receipt.createdAt ||
    typeof receipt.backupSha256 !== 'string' ||
    !sha256Pattern.test(receipt.backupSha256) ||
    typeof receipt.backupBytes !== 'number' ||
    !Number.isSafeInteger(receipt.backupBytes) ||
    receipt.backupBytes < 1 ||
    typeof receipt.authenticatedMetadataSha256 !== 'string' ||
    !sha256Pattern.test(receipt.authenticatedMetadataSha256) ||
    typeof receipt.migrationCount !== 'number' ||
    !Number.isSafeInteger(receipt.migrationCount) ||
    receipt.migrationCount < 1 ||
    typeof receipt.migrationManifestSha256 !== 'string' ||
    !sha256Pattern.test(receipt.migrationManifestSha256) ||
    typeof receipt.encryption !== 'object' ||
    receipt.encryption === null ||
    (receipt.encryption as Record<string, unknown>).algorithm !== 'aes-256-gcm' ||
    (receipt.encryption as Record<string, unknown>).keyCustody !== 'founder_held_out_of_band'
  ) {
    throw new TypeError('Backup receipt is invalid');
  }
  return {
    version: receiptVersion,
    evidenceTier: 'local_operator_generated',
    candidateSha: receipt.candidateSha,
    createdAt: receipt.createdAt,
    backupSha256: receipt.backupSha256,
    backupBytes: receipt.backupBytes,
    authenticatedMetadataSha256: receipt.authenticatedMetadataSha256,
    encryption: {
      algorithm: 'aes-256-gcm',
      keyCustody: 'founder_held_out_of_band',
    },
    criticalTableCounts: parseCriticalCounts(receipt.criticalTableCounts),
    migrationCount: receipt.migrationCount,
    migrationManifestSha256: receipt.migrationManifestSha256,
  };
}

export async function readPortabilityReceipt(path: string): Promise<PortabilityReceipt> {
  const receiptFile = await open(path, 'r');
  try {
    const details = await receiptFile.stat();
    if (!details.isFile() || details.size < 1 || details.size > maximumReceiptBytes) {
      throw new TypeError('Backup receipt has an invalid size');
    }
    const receiptBytes = Buffer.alloc(details.size);
    await readBufferExactly(receiptFile, receiptBytes, 0);
    return parseReceipt(JSON.parse(receiptBytes.toString('utf8')) as unknown);
  } catch {
    throw new TypeError('Backup receipt is not valid JSON');
  } finally {
    await receiptFile.close();
  }
}

async function writePortabilityReceipt(path: string, receipt: PortabilityReceipt): Promise<void> {
  const output = await open(path, 'wx', 0o600);
  let outputClosed = false;
  let completed = false;
  try {
    await output.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    await output.sync();
    await output.close();
    outputClosed = true;
    await chmod(path, 0o600);
    completed = true;
  } finally {
    if (!outputClosed) await output.close().catch(() => undefined);
    if (!completed) await unlink(path).catch(() => undefined);
  }
}

export function compareSnapshotToReceipt(
  snapshot: DatabaseSnapshot,
  receipt: PortabilityReceipt,
): void {
  if (
    snapshot.migrationCount !== receipt.migrationCount ||
    snapshot.migrationManifestSha256 !== receipt.migrationManifestSha256 ||
    criticalPortabilityTables.some(
      (table) => snapshot.criticalTableCounts[table] !== receipt.criticalTableCounts[table],
    )
  ) {
    throw new Error('Post-restore critical counts or migration manifest do not match the receipt');
  }
}

function databaseSnapshotsMatch(left: DatabaseSnapshot, right: DatabaseSnapshot): boolean {
  return (
    left.migrationCount === right.migrationCount &&
    left.migrationManifestSha256 === right.migrationManifestSha256 &&
    criticalPortabilityTables.every(
      (table) => left.criticalTableCounts[table] === right.criticalTableCounts[table],
    )
  );
}

async function createSecureTemporaryRoot(repositoryRoot: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'boomerbuddy-db-portability-'));
  try {
    const actualRoot = await realpath(root);
    const actualRepository = await realpath(repositoryRoot);
    if (isPathWithin(actualRepository, actualRoot)) {
      throw new TypeError('Plaintext database material must remain outside the repository');
    }
    await chmod(actualRoot, 0o700);
    return actualRoot;
  } catch (error) {
    await removeSecureTemporaryRoot(root);
    throw error;
  }
}

async function removeSecureTemporaryRoot(root: string): Promise<void> {
  let details: Awaited<ReturnType<typeof lstat>>;
  try {
    details = await lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new TypeError('Refusing unsafe portability temporary cleanup');
  }
  const actualRoot = await realpath(root);
  const actualTemporaryDirectory = await realpath(tmpdir());
  if (
    !isPathWithin(actualTemporaryDirectory, actualRoot) ||
    basename(actualRoot).startsWith('boomerbuddy-db-portability-') === false
  ) {
    throw new TypeError('Refusing unsafe portability temporary cleanup');
  }
  await rm(actualRoot, { recursive: true, force: true });
}

export async function createPortableBackup(
  options: BackupWorkflowOptions,
): Promise<BackupWorkflowResult> {
  const repositoryRoot = repositoryRootFromScript;
  const outputPath = await assertArtifactPathOutsideRepository(options.outputPath, repositoryRoot);
  if (!outputPath.endsWith('.bbbackup')) {
    throw new TypeError('Encrypted backup output must use the .bbbackup extension');
  }
  const receiptPath = `${outputPath}.receipt.json`;
  await assertArtifactPathOutsideRepository(receiptPath, repositoryRoot);
  await assertNoExistingArtifacts([outputPath, receiptPath]);
  const candidateSha = validateCandidateSha(options.candidateSha);
  const database = parsePostgresDatabaseUrl(options.databaseUrl);
  const key = parseFounderBackupKey(options.keyBase64);
  const runner = options.runner ?? defaultProcessRunner;
  const baseEnvironment = options.baseEnvironment ?? process.env;
  let temporaryRoot: string | undefined;
  let encryptedCreated = false;
  try {
    temporaryRoot = await createSecureTemporaryRoot(repositoryRoot);
    const plaintextPath = join(temporaryRoot, 'database.dump');
    const privateDump = await open(plaintextPath, 'wx', 0o600);
    await privateDump.close();
    await chmod(plaintextPath, 0o600);
    const preDumpSnapshot = await databaseSnapshot(
      database,
      repositoryRoot,
      baseEnvironment,
      runner,
    );
    await runChecked(
      runner,
      buildPgDumpInvocation({
        database,
        dumpPath: plaintextPath,
        cwd: repositoryRoot,
        baseEnvironment,
      }),
    );
    const dumpDetails = await lstat(plaintextPath);
    if (!dumpDetails.isFile() || dumpDetails.isSymbolicLink()) {
      throw new Error('pg_dump did not produce a regular custom dump');
    }
    await assertCustomPostgresDump(plaintextPath);
    await chmod(plaintextPath, 0o600);
    const postDumpSnapshot = await databaseSnapshot(
      database,
      repositoryRoot,
      baseEnvironment,
      runner,
    );
    if (!databaseSnapshotsMatch(preDumpSnapshot, postDumpSnapshot)) {
      throw new Error('Critical database state changed while the backup snapshot was created');
    }
    const createdAt = validateIsoTimestamp((options.clock ?? (() => new Date()))().toISOString());
    const metadataSha256 = authenticatedMetadataSha256({
      candidateSha,
      createdAt,
      snapshot: postDumpSnapshot,
    });
    const encryptedBackup = await encryptPostgresDump({
      plaintextPath,
      outputPath,
      key,
      candidateSha,
      authenticatedMetadataSha256: metadataSha256,
    });
    encryptedCreated = true;
    const receipt: PortabilityReceipt = {
      version: receiptVersion,
      evidenceTier: 'local_operator_generated',
      candidateSha,
      createdAt,
      backupSha256: encryptedBackup.backupSha256,
      backupBytes: encryptedBackup.backupBytes,
      authenticatedMetadataSha256: metadataSha256,
      encryption: {
        algorithm: 'aes-256-gcm',
        keyCustody: 'founder_held_out_of_band',
      },
      ...postDumpSnapshot,
    };
    await writePortabilityReceipt(receiptPath, receipt);
    return { backupPath: outputPath, receiptPath, receipt };
  } catch (error) {
    if (encryptedCreated) await unlink(outputPath).catch(() => undefined);
    throw error;
  } finally {
    key.fill(0);
    if (temporaryRoot !== undefined) await removeSecureTemporaryRoot(temporaryRoot);
  }
}

export async function restorePortableBackup(
  options: RestoreWorkflowOptions,
): Promise<RestoreWorkflowResult> {
  const repositoryRoot = repositoryRootFromScript;
  const inputPath = await assertArtifactPathOutsideRepository(
    options.inputPath,
    repositoryRoot,
    true,
  );
  if (!inputPath.endsWith('.bbbackup')) {
    throw new TypeError('Encrypted backup input must use the .bbbackup extension');
  }
  const receiptPath = await assertArtifactPathOutsideRepository(
    `${inputPath}.receipt.json`,
    repositoryRoot,
    true,
  );
  const candidateSha = validateCandidateSha(options.candidateSha);
  const database = parsePostgresDatabaseUrl(options.databaseUrl);
  assertDisposableRestoreTarget(database.database, options.confirmation);
  const receipt = await readPortabilityReceipt(receiptPath);
  if (receipt.candidateSha !== candidateSha) {
    throw new TypeError('Backup receipt candidate SHA does not match the requested candidate');
  }
  const runner = options.runner ?? defaultProcessRunner;
  const baseEnvironment = options.baseEnvironment ?? process.env;
  const key = parseFounderBackupKey(options.keyBase64);
  let temporaryRoot: string | undefined;
  try {
    temporaryRoot = await createSecureTemporaryRoot(repositoryRoot);
    const plaintextPath = join(temporaryRoot, 'authenticated-database.dump');
    const authenticatedBackup = await decryptPostgresDump({
      encryptedPath: inputPath,
      plaintextPath,
      key,
      expectedCandidateSha: candidateSha,
    });
    if (
      authenticatedBackup.backupBytes !== receipt.backupBytes ||
      authenticatedBackup.backupSha256 !== receipt.backupSha256
    ) {
      throw new TypeError('Authenticated backup bytes do not match the receipt');
    }
    const receiptMetadataSha256 = authenticatedMetadataSha256({
      candidateSha: receipt.candidateSha,
      createdAt: receipt.createdAt,
      snapshot: receipt,
    });
    if (
      receipt.authenticatedMetadataSha256 !== receiptMetadataSha256 ||
      authenticatedBackup.header.authenticatedMetadataSha256 !== receiptMetadataSha256
    ) {
      throw new TypeError('Authenticated backup metadata does not match the receipt');
    }
    await runChecked(
      runner,
      buildPgRestoreListInvocation({
        database,
        dumpPath: plaintextPath,
        cwd: repositoryRoot,
        baseEnvironment,
      }),
    );
    await runChecked(
      runner,
      buildPgRestoreInvocation({
        database,
        dumpPath: plaintextPath,
        cwd: repositoryRoot,
        baseEnvironment,
      }),
    );
    const postRestoreSnapshot = await databaseSnapshot(
      database,
      repositoryRoot,
      baseEnvironment,
      runner,
    );
    compareSnapshotToReceipt(postRestoreSnapshot, receipt);
    return { restoredDatabase: database.database, receipt, postRestoreSnapshot };
  } finally {
    key.fill(0);
    if (temporaryRoot !== undefined) await removeSecureTemporaryRoot(temporaryRoot);
  }
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new TypeError(`Missing ${name}`);
  return value;
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const databaseUrl = process.env.DATABASE_URL;
  const keyBase64 = process.env.BB_RUN3_1_BACKUP_KEY_BASE64;
  if (databaseUrl === undefined || keyBase64 === undefined) {
    throw new TypeError('DATABASE_URL and BB_RUN3_1_BACKUP_KEY_BASE64 are required');
  }
  if (mode === 'backup') {
    const result = await createPortableBackup({
      databaseUrl,
      keyBase64,
      candidateSha: argument('--candidate-sha'),
      outputPath: argument('--output'),
    });
    process.stdout.write(
      `${JSON.stringify({
        status: 'encrypted_backup_created',
        candidateSha: result.receipt.candidateSha,
        backupSha256: result.receipt.backupSha256,
        backupBytes: result.receipt.backupBytes,
        receiptPath: result.receiptPath,
        evidenceTier: result.receipt.evidenceTier,
      })}\n`,
    );
    return;
  }
  if (mode === 'restore') {
    const result = await restorePortableBackup({
      databaseUrl,
      keyBase64,
      candidateSha: argument('--candidate-sha'),
      inputPath: argument('--input'),
      confirmation: argument('--confirm'),
    });
    process.stdout.write(
      `${JSON.stringify({
        status: 'restore_compared',
        candidateSha: result.receipt.candidateSha,
        restoredDatabase: result.restoredDatabase,
        migrationCount: result.postRestoreSnapshot.migrationCount,
        criticalTableCounts: result.postRestoreSnapshot.criticalTableCounts,
        evidenceTier: 'local_operator_generated',
      })}\n`,
    );
    return;
  }
  throw new TypeError('Usage: run3-1-database-portability.ts backup|restore [options]');
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath === resolve(fileURLToPath(import.meta.url))) await main();
