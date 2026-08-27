import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  authenticatedMetadataSha256,
  assertArtifactPathOutsideRepository,
  assertCustomPostgresDump,
  assertDisposableRestoreTarget,
  assertNoExistingArtifacts,
  buildPgDumpInvocation,
  buildPgRestoreInvocation,
  buildPgRestoreListInvocation,
  buildSnapshotInvocation,
  createPortableBackup,
  criticalPortabilityTables,
  decryptPostgresDump,
  encryptPostgresDump,
  isPathWithin,
  parseDatabaseSnapshotOutput,
  parseFounderBackupKey,
  parsePostgresDatabaseUrl,
  postgresProcessEnvironment,
  readPortabilityReceipt,
  restorePortableBackup,
  validateCandidateSha,
  type CriticalPortabilityTable,
  type CriticalTableCounts,
  type PortabilityReceipt,
  type ProcessInvocation,
  type ProcessRunner,
} from '../../scripts/run3-1-database-portability';

const repositoryRoot = resolve(process.cwd());
const candidateSha = 'a'.repeat(40);
const metadataSha256 = 'b'.repeat(64);
const founderKeyBase64 = Buffer.alloc(32, 29).toString('base64');
const sourceDatabaseUrl =
  'postgresql://backup%2Doperator:source%40secret@db.example.test:5433/boomerbuddy?sslmode=require';
const restoreDatabaseUrl =
  'postgresql://restore%2Doperator:target%40secret@restore.example.test:5432/restore_boomerbuddy?sslmode=verify-full';
const customDumpFixture = Buffer.from(
  'PGDMP\0synthetic-custom-format-dump-without-customer-content',
  'utf8',
);
const temporaryRoots: string[] = [];
const launchCriticalEvidenceTables = [
  'household_billing_authorities',
  'household_billing_authority_events',
  'commerce_product_versions',
  'commerce_plan_versions',
  'commerce_storefront_policies',
  'commerce_checkout_intents',
  'commerce_provider_customers',
  'commerce_reconciliation_runs',
  'commerce_stripe_offer_contracts',
  'commerce_stripe_initiation_controls',
  'commerce_stripe_initiation_control_events',
  'commerce_stripe_eligible_households',
  'commerce_stripe_eligibility_events',
  'commerce_stripe_preflight_records',
  'commerce_stripe_session_operations',
  'commerce_stripe_checkout_completions',
  'commerce_stripe_paid_invoice_evidence',
  'commerce_stripe_failed_invoice_evidence',
  'commerce_stripe_financial_restriction_resolutions',
  'commerce_stripe_inventory_reconciliation_runs',
  'commerce_stripe_inventory_mismatches',
  'commerce_stripe_session_operation_attempts',
  'commerce_stripe_session_retry_repair_events',
  'commerce_stripe_cohort_policies',
  'commerce_stripe_cohort_policy_events',
  'commerce_stripe_invoice_authority_facts',
  'commerce_stripe_dunning_events',
  'commerce_stripe_financial_restriction_events',
  'commerce_stripe_inventory_run_attempts',
  'commerce_stripe_inventory_page_receipts',
  'commerce_stripe_reconciliation_repair_events',
  'commerce_stripe_checkout_dependency_wakes',
  'commerce_stripe_cohort_policy_events_v2',
  'commerce_billing_reverification_mutex',
  'commerce_billing_reverification_bindings',
  'public_check_attribution_aggregates',
  'acquisition_touchpoints',
  'private_beta_access_intent_gate',
  'private_beta_access_intent_receipts',
  'private_beta_access_intent_rate_buckets',
  'private_beta_access_intent_aggregates',
  'commerce_stripe_invoice_recovery_events',
  'support_receipt_gate',
  'support_receipts',
  'support_receipt_operations',
  'support_receipt_events',
  'support_receipt_rate_buckets',
  'protected_self_enrollment_household_gates',
  'protected_self_enrollment_operations',
] as const;

function criticalCounts(offset = 0): CriticalTableCounts {
  return Object.fromEntries(
    criticalPortabilityTables.map((table, index) => [table, index + offset]),
  ) as Record<CriticalPortabilityTable, number>;
}

function snapshotOutput(offset = 0): string {
  return JSON.stringify({
    criticalCounts: criticalCounts(offset),
    migrations: [
      `0024_run3_1_production_identity.sql:${'1'.repeat(64)}`,
      `0026_run3_1_production_founding_households.sql:${'2'.repeat(64)}`,
      `0027_run3_1_feedback_founding_quota.sql:${'3'.repeat(64)}`,
    ],
  });
}

interface FakeRunner {
  readonly invocations: ProcessInvocation[];
  readonly plaintextPaths: string[];
  readonly runner: ProcessRunner;
}

function createFakeRunner(snapshotOutputs: readonly string[] = [snapshotOutput()]): FakeRunner {
  const invocations: ProcessInvocation[] = [];
  const plaintextPaths: string[] = [];
  const queuedSnapshots = [...snapshotOutputs];
  const runner: ProcessRunner = async (invocation) => {
    invocations.push(invocation);
    if (invocation.command === 'pg_dump') {
      const fileIndex = invocation.args.indexOf('--file');
      const dumpPath = invocation.args[fileIndex + 1];
      if (fileIndex < 0 || dumpPath === undefined) throw new Error('Missing fake dump path');
      plaintextPaths.push(dumpPath);
      await writeFile(dumpPath, customDumpFixture, { mode: 0o600, flag: 'w' });
      return { status: 0, stdout: '' };
    }
    if (invocation.command === 'psql') {
      const output = queuedSnapshots.shift() ?? snapshotOutput();
      return { status: 0, stdout: output };
    }
    const dumpPath = invocation.args.at(-1);
    if (dumpPath === undefined) throw new Error('Missing fake restore path');
    plaintextPaths.push(dumpPath);
    expect(await readFile(dumpPath)).toEqual(customDumpFixture);
    return { status: 0, stdout: '' };
  };
  return { invocations, plaintextPaths, runner };
}

async function outsideRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'boomerbuddy-portability-test-'));
  temporaryRoots.push(root);
  return root;
}

async function expectMissing(path: string): Promise<void> {
  await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
}

function expectNoSecretArguments(
  invocations: readonly ProcessInvocation[],
  secrets: readonly string[],
): void {
  for (const invocation of invocations) {
    const argumentsOnly = JSON.stringify(invocation.args);
    for (const secret of secrets) expect(argumentsOnly).not.toContain(secret);
    expect(invocation.env.DATABASE_URL).toBeUndefined();
    expect(invocation.env.BB_RUN3_1_BACKUP_KEY_BASE64).toBeUndefined();
  }
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    if (root.startsWith(join(tmpdir(), 'boomerbuddy-portability-test-'))) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

describe('Run 3.1 PostgreSQL portability boundaries', () => {
  it('covers the complete Customer #1 check, authority, feedback, and quota truth set', () => {
    expect(criticalPortabilityTables).toEqual(
      expect.arrayContaining([
        'artifacts',
        'analyses',
        'check_shares',
        'public_check_attribution_aggregates',
        'acquisition_touchpoints',
        'entitlement_grants',
        'founding_household_sponsor_backings',
        'founding_household_enrollments',
        'feedback_records',
        'feedback_payloads',
        'feedback_state_events',
        'feedback_processing_jobs',
        'feedback_authenticated_quota_buckets',
        'feedback_authenticated_quota_charges',
      ]),
    );
  });

  it('counts the explicit launch-critical authority, commerce, support, access, and enrollment inventory', () => {
    expect(criticalPortabilityTables).toEqual(
      expect.arrayContaining([...launchCriticalEvidenceTables]),
    );
    expect(new Set(criticalPortabilityTables).size).toBe(criticalPortabilityTables.length);

    const snapshotInvocation = buildSnapshotInvocation({
      database: parsePostgresDatabaseUrl(sourceDatabaseUrl),
      cwd: repositoryRoot,
    });
    const sql = snapshotInvocation.args.at(-1);
    expect(sql).toBeDefined();
    expect(sql).toContain('json_object_agg(table_name, row_count ORDER BY table_name)');
    expect(sql).not.toContain("'criticalCounts', json_build_object(");
    for (const table of launchCriticalEvidenceTables) {
      expect(sql).toContain(
        `SELECT '${table}'::text AS table_name, count(*)::bigint AS row_count FROM "public"."${table}"`,
      );
    }
  });
  it('parses one PostgreSQL URL into a scrubbed process environment without secret argv', () => {
    const database = parsePostgresDatabaseUrl(sourceDatabaseUrl);
    expect(database).toEqual({
      host: 'db.example.test',
      port: '5433',
      database: 'boomerbuddy',
      username: 'backup-operator',
      password: 'source@secret',
      sslMode: 'require',
    });

    const baseEnvironment: NodeJS.ProcessEnv = {
      DATABASE_URL: 'must-not-survive',
      BB_RUN3_1_BACKUP_KEY_BASE64: 'must-not-survive',
      PGOPTIONS: '-c search_path=attacker',
      pgpassword: 'case-insensitive-stale-secret',
      SAFE_UNRELATED_VALUE: 'retained',
    };
    const environment = postgresProcessEnvironment(database, baseEnvironment);
    expect(environment).toMatchObject({
      PGHOST: 'db.example.test',
      PGPORT: '5433',
      PGDATABASE: 'boomerbuddy',
      PGUSER: 'backup-operator',
      PGPASSWORD: 'source@secret',
      PGSSLMODE: 'require',
      SAFE_UNRELATED_VALUE: 'retained',
    });
    expect(environment.DATABASE_URL).toBeUndefined();
    expect(environment.BB_RUN3_1_BACKUP_KEY_BASE64).toBeUndefined();
    expect(environment.PGOPTIONS).toBeUndefined();
    expect(environment.pgpassword).toBeUndefined();

    const dumpPath = join(tmpdir(), 'synthetic.dump');
    const invocations = [
      buildPgDumpInvocation({ database, dumpPath, cwd: repositoryRoot, baseEnvironment }),
      buildPgRestoreListInvocation({
        database,
        dumpPath,
        cwd: repositoryRoot,
        baseEnvironment,
      }),
      buildPgRestoreInvocation({ database, dumpPath, cwd: repositoryRoot, baseEnvironment }),
      buildSnapshotInvocation({ database, cwd: repositoryRoot, baseEnvironment }),
    ];
    expectNoSecretArguments(invocations, [
      sourceDatabaseUrl,
      'source@secret',
      'source%40secret',
      founderKeyBase64,
    ]);
    expect(invocations[2]?.args).toContain('--single-transaction');
    expect(invocations[2]?.args).toContain('boomerbuddy');
  });

  it.each([
    'https://user:password@example.test/boomerbuddy',
    'postgresql:///boomerbuddy',
    'postgresql://user:password@example.test/',
    'postgresql://user:password@example.test/one%2Ftwo',
    'postgresql://user:password@example.test/boomerbuddy?application_name=unsafe',
    'postgresql://user:password@example.test/boomerbuddy?sslmode=require&sslmode=disable',
    'postgresql://user:password@example.test/boomerbuddy',
    'postgresql://user:password@example.test/boomerbuddy?sslmode=disable',
    'postgresql://user:password@example.test/boomerbuddy?sslmode=allow',
    'postgresql://user:password@example.test/boomerbuddy?sslmode=prefer',
    'postgresql://user:password%0Ainjected@example.test/boomerbuddy',
    'postgresql://user:password@example.test/boomerbuddy#fragment',
    ' postgresql://user:password@example.test/boomerbuddy',
  ])('rejects hostile or ambiguous database URL %s', (value) => {
    expect(() => parsePostgresDatabaseUrl(value)).toThrow(TypeError);
  });

  it('requires an exact canonical 32-byte founder-held base64 key and exact candidate SHA', () => {
    const parsed = parseFounderBackupKey(founderKeyBase64);
    expect(parsed).toHaveLength(32);
    parsed.fill(0);
    for (const value of [
      founderKeyBase64.slice(0, -1),
      ` ${founderKeyBase64}`,
      Buffer.alloc(31, 1).toString('base64'),
      Buffer.alloc(33, 1).toString('base64'),
      `${founderKeyBase64.slice(0, -1)}!`,
    ]) {
      expect(() => parseFounderBackupKey(value)).toThrow(TypeError);
    }
    expect(validateCandidateSha(candidateSha)).toBe(candidateSha);
    expect(() => validateCandidateSha('A'.repeat(40))).toThrow(TypeError);
    expect(() => validateCandidateSha('a'.repeat(39))).toThrow(TypeError);
  });

  it('keeps artifacts outside the repository and refuses every overwrite', async () => {
    const externalRoot = await outsideRoot();
    const externalPath = join(externalRoot, 'candidate.bbbackup');
    expect(isPathWithin(repositoryRoot, join(repositoryRoot, 'scripts'))).toBe(true);
    expect(isPathWithin(repositoryRoot, externalPath)).toBe(false);
    await expect(assertArtifactPathOutsideRepository(externalPath, repositoryRoot)).resolves.toBe(
      resolve(externalPath),
    );
    await expect(
      assertArtifactPathOutsideRepository(
        join(repositoryRoot, 'scripts', 'forbidden.bbbackup'),
        repositoryRoot,
      ),
    ).rejects.toThrow(/outside the repository/u);
    await expect(
      assertArtifactPathOutsideRepository('relative.bbbackup', repositoryRoot),
    ).rejects.toThrow(/absolute/u);

    await writeFile(externalPath, 'preserve-me', { flag: 'wx' });
    await expect(assertNoExistingArtifacts([externalPath])).rejects.toThrow(/overwrite/u);
    expect(await readFile(externalPath, 'utf8')).toBe('preserve-me');
  });

  it('requires a disposable database label and its exact destructive confirmation', () => {
    for (const database of ['restore_boomerbuddy', 'boomerbuddy_test', 'drill']) {
      expect(() =>
        assertDisposableRestoreTarget(database, `RESTORE-DISPOSABLE:${database}`),
      ).not.toThrow();
    }
    for (const [database, confirmation] of [
      ['boomerbuddy', 'RESTORE-DISPOSABLE:boomerbuddy'],
      ['production_restore', 'RESTORE-DISPOSABLE:production_restore'],
      ['restore_production', 'RESTORE-DISPOSABLE:restore_production'],
      ['restore_live2', 'RESTORE-DISPOSABLE:restore_live2'],
      ['test_prodclone', 'RESTORE-DISPOSABLE:test_prodclone'],
      ['restore_boomerbuddy', 'yes'],
      ['restore/boomerbuddy', 'RESTORE-DISPOSABLE:restore/boomerbuddy'],
    ]) {
      expect(() => assertDisposableRestoreTarget(database!, confirmation!)).toThrow(TypeError);
    }
  });

  it('rejects malformed or content-bearing snapshot output', () => {
    expect(parseDatabaseSnapshotOutput(snapshotOutput())).toMatchObject({
      criticalTableCounts: criticalCounts(),
      migrationCount: 3,
    });
    expect(() => parseDatabaseSnapshotOutput('{')).toThrow(TypeError);
    expect(() =>
      parseDatabaseSnapshotOutput(
        JSON.stringify({ criticalCounts: criticalCounts(), migrations: [] }),
      ),
    ).toThrow(TypeError);
    expect(() =>
      parseDatabaseSnapshotOutput(
        JSON.stringify({
          criticalCounts: { ...criticalCounts(), customer_email: 'forbidden' },
          migrations: [`0024_identity.sql:${'1'.repeat(64)}`],
        }),
      ),
    ).toThrow(TypeError);
  });

  it('authenticates AES-256-GCM before exposing a complete plaintext and preserves existing files', async () => {
    const root = await outsideRoot();
    const plaintextPath = join(root, 'source.dump');
    const encryptedPath = join(root, 'source.bbbackup');
    const decryptedPath = join(root, 'decrypted.dump');
    const key = parseFounderBackupKey(founderKeyBase64);
    await writeFile(plaintextPath, customDumpFixture, { mode: 0o600, flag: 'wx' });
    await encryptPostgresDump({
      plaintextPath,
      outputPath: encryptedPath,
      key,
      candidateSha,
      authenticatedMetadataSha256: metadataSha256,
    });
    await decryptPostgresDump({
      encryptedPath,
      plaintextPath: decryptedPath,
      key,
      expectedCandidateSha: candidateSha,
    });
    expect(await readFile(decryptedPath)).toEqual(customDumpFixture);

    const preservedPath = join(root, 'must-survive.dump');
    await writeFile(preservedPath, 'must-survive', { flag: 'wx' });
    await expect(
      decryptPostgresDump({
        encryptedPath,
        plaintextPath: preservedPath,
        key,
        expectedCandidateSha: candidateSha,
      }),
    ).rejects.toThrow(/authentication failed/u);
    expect(await readFile(preservedPath, 'utf8')).toBe('must-survive');

    const tamperedBytes = await readFile(encryptedPath);
    const tamperIndex = tamperedBytes.length - 17;
    tamperedBytes[tamperIndex] = tamperedBytes[tamperIndex]! ^ 1;
    const tamperedPath = join(root, 'tampered.bbbackup');
    const rejectedPlaintextPath = join(root, 'rejected.dump');
    await writeFile(tamperedPath, tamperedBytes, { flag: 'wx' });
    await expect(
      decryptPostgresDump({
        encryptedPath: tamperedPath,
        plaintextPath: rejectedPlaintextPath,
        key,
        expectedCandidateSha: candidateSha,
      }),
    ).rejects.toThrow(/authentication failed/u);
    await expectMissing(rejectedPlaintextPath);
    key.fill(0);
  });

  it('accepts only a non-empty PostgreSQL custom-format dump', async () => {
    const root = await outsideRoot();
    const validPath = join(root, 'valid.dump');
    const invalidPath = join(root, 'invalid.dump');
    await writeFile(validPath, customDumpFixture, { flag: 'wx' });
    await writeFile(invalidPath, 'plain SQL is not a custom dump', { flag: 'wx' });
    await expect(assertCustomPostgresDump(validPath)).resolves.toBeUndefined();
    await expect(assertCustomPostgresDump(invalidPath)).rejects.toThrow(/custom format/u);
  });

  it('creates an encrypted, candidate-bound, content-free backup and cleans plaintext', async () => {
    const root = await outsideRoot();
    const outputPath = join(root, 'candidate.bbbackup');
    const fake = createFakeRunner();
    const result = await createPortableBackup({
      databaseUrl: sourceDatabaseUrl,
      keyBase64: founderKeyBase64,
      candidateSha,
      outputPath,
      baseEnvironment: {
        DATABASE_URL: sourceDatabaseUrl,
        BB_RUN3_1_BACKUP_KEY_BASE64: founderKeyBase64,
        PGOPTIONS: '-c search_path=attacker',
      },
      runner: fake.runner,
      clock: () => new Date('2026-08-17T20:00:00.000Z'),
    });

    const encryptedBytes = await readFile(result.backupPath);
    const receiptText = await readFile(result.receiptPath, 'utf8');
    const receipt = await readPortabilityReceipt(result.receiptPath);
    expect(encryptedBytes.includes(customDumpFixture)).toBe(false);
    expect(receipt).toEqual(result.receipt);
    expect(receipt).toMatchObject({
      candidateSha,
      createdAt: '2026-08-17T20:00:00.000Z',
      backupBytes: encryptedBytes.byteLength,
      backupSha256: createHash('sha256').update(encryptedBytes).digest('hex'),
      criticalTableCounts: criticalCounts(),
      migrationCount: 3,
      authenticatedMetadataSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      encryption: {
        algorithm: 'aes-256-gcm',
        keyCustody: 'founder_held_out_of_band',
      },
    });
    for (const secret of [sourceDatabaseUrl, 'source@secret', founderKeyBase64]) {
      expect(receiptText).not.toContain(secret);
    }
    expect(receiptText).not.toContain(customDumpFixture.toString('utf8'));
    expectNoSecretArguments(fake.invocations, [
      sourceDatabaseUrl,
      'source@secret',
      'source%40secret',
      founderKeyBase64,
    ]);
    expect(fake.invocations.map(({ command }) => command)).toEqual(['psql', 'pg_dump', 'psql']);
    for (const plaintextPath of fake.plaintextPaths) await expectMissing(plaintextPath);

    const invocationCount = fake.invocations.length;
    await expect(
      createPortableBackup({
        databaseUrl: sourceDatabaseUrl,
        keyBase64: founderKeyBase64,
        candidateSha,
        outputPath,
        runner: fake.runner,
      }),
    ).rejects.toThrow(/overwrite/u);
    expect(fake.invocations).toHaveLength(invocationCount);

    if (process.platform !== 'win32') {
      expect((await stat(result.backupPath)).mode & 0o777).toBe(0o600);
      expect((await stat(result.receiptPath)).mode & 0o777).toBe(0o600);
    }
  });

  it('preserves a receipt that appears after the no-overwrite preflight', async () => {
    const root = await outsideRoot();
    const outputPath = join(root, 'candidate.bbbackup');
    const receiptPath = `${outputPath}.receipt.json`;
    const fake = createFakeRunner();
    const racingRunner: ProcessRunner = async (invocation) => {
      const result = await fake.runner(invocation);
      if (invocation.command === 'psql') {
        await writeFile(receiptPath, 'preserve-racing-receipt', { flag: 'wx' });
      }
      return result;
    };

    await expect(
      createPortableBackup({
        databaseUrl: sourceDatabaseUrl,
        keyBase64: founderKeyBase64,
        candidateSha,
        outputPath,
        runner: racingRunner,
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(receiptPath, 'utf8')).toBe('preserve-racing-receipt');
    await expectMissing(outputPath);
  });

  it('refuses to publish a receipt when critical state changes during pg_dump', async () => {
    const root = await outsideRoot();
    const outputPath = join(root, 'candidate.bbbackup');
    const fake = createFakeRunner([snapshotOutput(), snapshotOutput(1)]);

    await expect(
      createPortableBackup({
        databaseUrl: sourceDatabaseUrl,
        keyBase64: founderKeyBase64,
        candidateSha,
        outputPath,
        runner: fake.runner,
      }),
    ).rejects.toThrow(/changed while the backup snapshot was created/u);
    expect(fake.invocations.map(({ command }) => command)).toEqual(['psql', 'pg_dump', 'psql']);
    await expectMissing(outputPath);
    await expectMissing(`${outputPath}.receipt.json`);
  });

  it('binds receipt metadata to the authenticated encrypted header', async () => {
    const root = await outsideRoot();
    const outputPath = join(root, 'candidate.bbbackup');
    const backupFake = createFakeRunner();
    const backup = await createPortableBackup({
      databaseUrl: sourceDatabaseUrl,
      keyBase64: founderKeyBase64,
      candidateSha,
      outputPath,
      runner: backupFake.runner,
      clock: () => new Date('2026-08-17T20:00:00.000Z'),
    });
    const changedCounts: CriticalTableCounts = {
      ...backup.receipt.criticalTableCounts,
      artifacts: backup.receipt.criticalTableCounts.artifacts + 1,
    };
    const changedSnapshot = {
      criticalTableCounts: changedCounts,
      migrationCount: backup.receipt.migrationCount,
      migrationManifestSha256: backup.receipt.migrationManifestSha256,
    };
    const forgedReceipt: PortabilityReceipt = {
      ...backup.receipt,
      ...changedSnapshot,
      authenticatedMetadataSha256: authenticatedMetadataSha256({
        candidateSha,
        createdAt: backup.receipt.createdAt,
        snapshot: changedSnapshot,
      }),
    };
    await writeFile(backup.receiptPath, `${JSON.stringify(forgedReceipt, null, 2)}\n`);

    const restoreFake = createFakeRunner();
    await expect(
      restorePortableBackup({
        databaseUrl: restoreDatabaseUrl,
        keyBase64: founderKeyBase64,
        candidateSha,
        inputPath: outputPath,
        confirmation: 'RESTORE-DISPOSABLE:restore_boomerbuddy',
        runner: restoreFake.runner,
      }),
    ).rejects.toThrow(/metadata does not match/u);
    expect(restoreFake.invocations).toHaveLength(0);
  });

  it('fully decrypts and lists before destructive restore, then compares counts and migrations', async () => {
    const root = await outsideRoot();
    const outputPath = join(root, 'candidate.bbbackup');
    const backupFake = createFakeRunner();
    await createPortableBackup({
      databaseUrl: sourceDatabaseUrl,
      keyBase64: founderKeyBase64,
      candidateSha,
      outputPath,
      runner: backupFake.runner,
    });

    const restoreFake = createFakeRunner();
    const result = await restorePortableBackup({
      databaseUrl: restoreDatabaseUrl,
      keyBase64: founderKeyBase64,
      candidateSha,
      inputPath: outputPath,
      confirmation: 'RESTORE-DISPOSABLE:restore_boomerbuddy',
      baseEnvironment: {
        DATABASE_URL: restoreDatabaseUrl,
        BB_RUN3_1_BACKUP_KEY_BASE64: founderKeyBase64,
        PGSERVICE: 'must-be-scrubbed',
      },
      runner: restoreFake.runner,
    });

    expect(result.restoredDatabase).toBe('restore_boomerbuddy');
    expect(result.postRestoreSnapshot.criticalTableCounts).toEqual(criticalCounts());
    expect(restoreFake.invocations.map(({ command }) => command)).toEqual([
      'pg_restore',
      'pg_restore',
      'psql',
    ]);
    expect(restoreFake.invocations[0]?.args).toContain('--list');
    expect(restoreFake.invocations[1]?.args).toContain('--clean');
    expect(restoreFake.invocations[1]?.args).toContain('--single-transaction');
    expectNoSecretArguments(restoreFake.invocations, [
      restoreDatabaseUrl,
      'target@secret',
      'target%40secret',
      founderKeyBase64,
    ]);
    for (const plaintextPath of restoreFake.plaintextPaths) await expectMissing(plaintextPath);
  });

  it('performs no subprocess or destructive restore when authenticated bytes are tampered', async () => {
    const root = await outsideRoot();
    const outputPath = join(root, 'candidate.bbbackup');
    const backupFake = createFakeRunner();
    const backup = await createPortableBackup({
      databaseUrl: sourceDatabaseUrl,
      keyBase64: founderKeyBase64,
      candidateSha,
      outputPath,
      runner: backupFake.runner,
    });
    const tamperedBytes = await readFile(outputPath);
    const tamperIndex = tamperedBytes.length - 17;
    tamperedBytes[tamperIndex] = tamperedBytes[tamperIndex]! ^ 1;
    await writeFile(outputPath, tamperedBytes);
    const receipt = JSON.parse(await readFile(backup.receiptPath, 'utf8')) as PortabilityReceipt;
    const updatedReceipt: PortabilityReceipt = {
      ...receipt,
      backupBytes: tamperedBytes.byteLength,
      backupSha256: createHash('sha256').update(tamperedBytes).digest('hex'),
    };
    await writeFile(backup.receiptPath, `${JSON.stringify(updatedReceipt, null, 2)}\n`);

    const restoreFake = createFakeRunner();
    await expect(
      restorePortableBackup({
        databaseUrl: restoreDatabaseUrl,
        keyBase64: founderKeyBase64,
        candidateSha,
        inputPath: outputPath,
        confirmation: 'RESTORE-DISPOSABLE:restore_boomerbuddy',
        runner: restoreFake.runner,
      }),
    ).rejects.toThrow(/authentication failed/u);
    expect(restoreFake.invocations).toHaveLength(0);
  });

  it('fails closed after a disposable restore when reconciliation differs', async () => {
    const root = await outsideRoot();
    const outputPath = join(root, 'candidate.bbbackup');
    const backupFake = createFakeRunner();
    await createPortableBackup({
      databaseUrl: sourceDatabaseUrl,
      keyBase64: founderKeyBase64,
      candidateSha,
      outputPath,
      runner: backupFake.runner,
    });

    const restoreFake = createFakeRunner([snapshotOutput(1)]);
    await expect(
      restorePortableBackup({
        databaseUrl: restoreDatabaseUrl,
        keyBase64: founderKeyBase64,
        candidateSha,
        inputPath: outputPath,
        confirmation: 'RESTORE-DISPOSABLE:restore_boomerbuddy',
        runner: restoreFake.runner,
      }),
    ).rejects.toThrow(/do not match the receipt/u);
    expect(
      restoreFake.invocations.filter(
        ({ command, args }) => command === 'pg_restore' && args.includes('--clean'),
      ),
    ).toHaveLength(1);
    for (const plaintextPath of restoreFake.plaintextPaths) await expectMissing(plaintextPath);
  });
});
