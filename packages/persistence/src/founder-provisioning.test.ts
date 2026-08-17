import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { founderProvisioningCatalogue, type DomainError } from '@boomerbuddy/domain';

import { createPGliteDatabase, type Database } from './database';
import {
  founderProvisioningDefinitionDigest,
  FounderProvisioningRepository,
} from './founder-provisioning';
import { runMigrations } from './migrations';
import type { IdFactory } from './values';

const founderPersonId = 'person-founder-provisioning';
const internalOrganizationId = 'organization-internal-provisioning';
const sponsorOrganizationId = 'organization-sponsor-provisioning';

function sequentialIds(): IdFactory {
  let value = 0;
  return { next: (prefix) => `${prefix}_${++value}` };
}

function provisioningOperationKey(sequence: number): string {
  return `provisioning:company_git:00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

describe('FounderProvisioningRepository', () => {
  let database: Database;

  beforeEach(async () => {
    database = await createPGliteDatabase();
    await runMigrations(database);
    await database.query(
      `INSERT INTO persons(id, display_name) VALUES
        ($1, 'Configured founder'),
        ('person-other-owner', 'Other owner'),
        ('person-sponsor-owner', 'Sponsor owner'),
        ('person-null-owner', 'Null organization owner'),
        ('person-suspended-owner', 'Suspended owner')`,
      [founderPersonId],
    );
    await database.query(
      `INSERT INTO organizations(id, name, kind, verification_state, created_at) VALUES
        ($1, 'Internal operations', 'internal', 'local_fixture', now()),
        ($2, 'Sponsor organization', 'sponsor', 'local_fixture', now())`,
      [internalOrganizationId, sponsorOrganizationId],
    );
  });

  afterEach(async () => database.close());

  async function assign(input: {
    readonly id: string;
    readonly personId: string;
    readonly organizationId?: string;
    readonly status?: 'active' | 'suspended';
  }): Promise<void> {
    await database.query(
      `INSERT INTO employee_assignments(
         id, person_id, organization_id, role, status, created_at
       ) VALUES ($1,$2,$3,'hq_owner',$4,now())`,
      [input.id, input.personId, input.organizationId ?? null, input.status ?? 'active'],
    );
  }

  function repository(configuredFounder: string | null = founderPersonId) {
    return new FounderProvisioningRepository(
      database,
      configuredFounder ?? undefined,
      sequentialIds(),
    );
  }

  async function currentOccurredAt(workstreamKey = 'company_git'): Promise<Date> {
    const result = await database.query<{ occurred_at: unknown } & Record<string, unknown>>(
      `SELECT occurred_at
       FROM founder_provisioning_status_events
       WHERE workstream_key = $1
       ORDER BY version DESC
       LIMIT 1`,
      [workstreamKey],
    );
    const value = result.rows[0]?.occurred_at;
    const occurredAt = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(occurredAt.getTime())) throw new TypeError('Missing current status time');
    return occurredAt;
  }

  const transitionInput = (personId: string, operationKey: string) => ({
    access: { actorPersonId: personId, correlationId: `correlation:${operationKey}` },
    workstreamKey: 'company_git' as const,
    operationKey,
    toStatus: 'founder_in_progress' as const,
    evidence: {
      tier: 'founder_report' as const,
      kind: 'setup_started' as const,
      result: 'reported' as const,
      observedAt: new Date(),
    },
  });

  it('returns the exact secret-free 23-row baseline and audits before release', async () => {
    await assign({
      id: 'assignment-founder-internal',
      personId: founderPersonId,
      organizationId: internalOrganizationId,
    });

    const register = await repository().register({
      actorPersonId: founderPersonId,
      correlationId: 'correlation:register',
    });
    const serialized = JSON.stringify(register);
    const audit = await database.query<{
      action: string;
      resource_id: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT action, resource_id, metadata
       FROM audit_events
       WHERE actor_person_id = $1 AND action = 'founder.provisioning.read'`,
      [founderPersonId],
    );

    expect(register).toHaveLength(23);
    expect(register.filter(({ status }) => status === 'not_started')).toHaveLength(11);
    expect(register.filter(({ status }) => status === 'founder_in_progress')).toHaveLength(7);
    expect(register.filter(({ status }) => status === 'blocked')).toHaveLength(5);
    expect(register.some(({ status }) => status === 'test_proven')).toBe(false);
    expect(serialized).not.toMatch(/https?:\/\//);
    expect(serialized).not.toMatch(/(?:sk|pk)_(?:test|live)_[A-Za-z0-9]+/);
    expect(serialized).not.toMatch(/postgres(?:ql)?:\/\//);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      action: 'founder.provisioning.read',
      resource_id: 'register',
      metadata: {
        catalogueVersion: 1,
        evidenceBoundary: 'names_digests_enums_only',
        externalActionExecuted: false,
      },
    });

    const definitionRows = await database.query<{
      definition_digest: string;
      workstream_key: string;
    }>(
      `SELECT workstream_key, definition_digest
       FROM founder_provisioning_workstreams
       ORDER BY display_order`,
    );
    expect(definitionRows.rows).toEqual(
      founderProvisioningCatalogue.map((entry) => ({
        definition_digest: founderProvisioningDefinitionDigest(entry),
        workstream_key: entry.key,
      })),
    );
  });

  it('requires configured founder identity even when the actor is an internal owner', async () => {
    await assign({
      id: 'assignment-founder-internal',
      personId: founderPersonId,
      organizationId: internalOrganizationId,
    });
    await assign({
      id: 'assignment-other-internal',
      personId: 'person-other-owner',
      organizationId: internalOrganizationId,
    });

    await expect(
      repository(null).register({
        actorPersonId: founderPersonId,
        correlationId: 'correlation:unconfigured',
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);
    await expect(
      repository().register({
        actorPersonId: 'person-other-owner',
        correlationId: 'correlation:other-owner',
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);
    await expect(
      repository().transition(transitionInput('person-other-owner', provisioningOperationKey(1))),
    ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);
  });

  it.each([
    {
      label: 'sponsor organization',
      personId: 'person-sponsor-owner',
      assignmentId: 'assignment-sponsor-owner',
      organizationId: sponsorOrganizationId,
      status: 'active' as const,
    },
    {
      label: 'NULL organization',
      personId: 'person-null-owner',
      assignmentId: 'assignment-null-owner',
      organizationId: undefined,
      status: 'active' as const,
    },
    {
      label: 'suspended internal assignment',
      personId: 'person-suspended-owner',
      assignmentId: 'assignment-suspended-owner',
      organizationId: internalOrganizationId,
      status: 'suspended' as const,
    },
  ])('denies $label for both register reads and transition mutations', async (fixture) => {
    await assign({
      id: fixture.assignmentId,
      personId: fixture.personId,
      ...(fixture.organizationId === undefined ? {} : { organizationId: fixture.organizationId }),
      status: fixture.status,
    });
    const scoped = repository(fixture.personId);

    await expect(
      scoped.register({
        actorPersonId: fixture.personId,
        correlationId: `correlation:${fixture.assignmentId}`,
      }),
    ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);
    await expect(
      scoped.transition(transitionInput(fixture.personId, provisioningOperationKey(1))),
    ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);
  });

  it('rechecks assignment status, organization linkage, and internal custody after prior access', async () => {
    await assign({
      id: 'assignment-founder-internal',
      personId: founderPersonId,
      organizationId: internalOrganizationId,
    });
    const scoped = repository();
    await expect(
      scoped.register({
        actorPersonId: founderPersonId,
        correlationId: 'correlation:founder-before-authority-change',
      }),
    ).resolves.toHaveLength(23);

    const expectDenied = async (sequence: number, correlationId: string): Promise<void> => {
      await expect(
        scoped.register({ actorPersonId: founderPersonId, correlationId }),
      ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);
      await expect(
        scoped.transition(transitionInput(founderPersonId, provisioningOperationKey(sequence))),
      ).rejects.toMatchObject({ code: 'not_authorized' } satisfies Partial<DomainError>);
    };

    await database.query(
      `UPDATE employee_assignments SET status = 'suspended'
       WHERE id = 'assignment-founder-internal'`,
    );
    await expectDenied(10, 'correlation:founder-after-suspension');

    await database.query(
      `UPDATE employee_assignments SET status = 'active', organization_id = $1
       WHERE id = 'assignment-founder-internal'`,
      [sponsorOrganizationId],
    );
    await expectDenied(11, 'correlation:founder-after-repoint');

    await database.query(
      `UPDATE employee_assignments SET organization_id = $1
       WHERE id = 'assignment-founder-internal'`,
      [internalOrganizationId],
    );
    await database.query(`UPDATE organizations SET kind = 'sponsor' WHERE id = $1`, [
      internalOrganizationId,
    ]);
    await expectDenied(12, 'correlation:founder-after-org-kind-change');

    const operations = await database.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM founder_provisioning_operations
       WHERE workstream_key = 'company_git'`,
    );
    expect(operations.rows[0]?.count).toBe(0);
  });

  it('records an atomic append-only transition and reuses an exact idempotent request', async () => {
    await assign({
      id: 'assignment-founder-internal',
      personId: founderPersonId,
      organizationId: internalOrganizationId,
    });
    const scoped = repository();
    const input = transitionInput(founderPersonId, provisioningOperationKey(1));

    const created = await scoped.transition(input);
    const reused = await scoped.transition(input);
    const evidence = await database.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM founder_provisioning_evidence WHERE workstream_key = 'company_git'`,
    );
    const statuses = await database.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM founder_provisioning_status_events WHERE workstream_key = 'company_git'`,
    );
    const operations = await database.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM founder_provisioning_operations WHERE workstream_key = 'company_git'`,
    );

    expect(created).toMatchObject({
      workstreamKey: 'company_git',
      status: 'founder_in_progress',
      version: 2,
      reused: false,
      externalActionExecuted: false,
    });
    expect(reused).toEqual({ ...created, reused: true });
    expect(evidence.rows[0]?.count).toBe(2);
    expect(statuses.rows[0]?.count).toBe(2);
    expect(operations.rows[0]?.count).toBe(1);
  });

  it('returns a stored exact retry after later gates without re-evaluating stale chronology', async () => {
    await assign({
      id: 'assignment-founder-internal',
      personId: founderPersonId,
      organizationId: internalOrganizationId,
    });
    const scoped = repository();
    const original = transitionInput(founderPersonId, provisioningOperationKey(13));
    const created = await scoped.transition(original);
    const predecessor = await currentOccurredAt();
    await scoped.transition({
      access: { actorPersonId: founderPersonId, correlationId: 'correlation:later-gate' },
      workstreamKey: 'company_git',
      operationKey: provisioningOperationKey(14),
      toStatus: 'ready_for_test',
      evidence: {
        tier: 'repository_review',
        kind: 'configuration_ready',
        result: 'passed',
        manifestDigest: 'G'.repeat(43),
        observedAt: predecessor,
      },
    });

    const reused = await scoped.transition(original);
    expect(reused).toEqual({ ...created, reused: true });
    expect(original.evidence.observedAt.getTime()).toBeLessThan(
      (await currentOccurredAt()).getTime(),
    );
  });

  it('projects the exact retained manifest digest without projecting evidence content', async () => {
    await assign({
      id: 'assignment-founder-internal',
      personId: founderPersonId,
      organizationId: internalOrganizationId,
    });
    const scoped = repository();
    await scoped.transition(transitionInput(founderPersonId, provisioningOperationKey(8)));
    const manifestDigest = 'D'.repeat(43);
    await scoped.transition({
      access: {
        actorPersonId: founderPersonId,
        correlationId: 'correlation:manifest-projection',
      },
      workstreamKey: 'company_git',
      operationKey: provisioningOperationKey(9),
      toStatus: 'ready_for_test',
      evidence: {
        tier: 'repository_review',
        kind: 'configuration_ready',
        result: 'passed',
        manifestDigest,
        observedAt: new Date(),
      },
    });

    const register = await scoped.register({
      actorPersonId: founderPersonId,
      correlationId: 'correlation:manifest-register',
    });
    expect(register.find(({ catalogue }) => catalogue.key === 'company_git')).toMatchObject({
      status: 'ready_for_test',
      version: 3,
      latestEvidence: {
        kind: 'configuration_ready',
        result: 'passed',
        manifestDigest,
      },
    });
  });

  it('rejects payload drift and cross-workstream operation keys without changing history', async () => {
    await assign({
      id: 'assignment-founder-internal',
      personId: founderPersonId,
      organizationId: internalOrganizationId,
    });
    const scoped = repository();
    const input = transitionInput(founderPersonId, provisioningOperationKey(2));
    await scoped.transition(input);

    await expect(
      scoped.transition({
        ...input,
        evidence: {
          ...input.evidence,
          observedAt: new Date(input.evidence.observedAt.getTime() - 1),
        },
      }),
    ).rejects.toMatchObject({ code: 'conflict' } satisfies Partial<DomainError>);
    await assign({
      id: 'assignment-other-internal',
      personId: 'person-other-owner',
      organizationId: internalOrganizationId,
    });
    await expect(
      repository('person-other-owner').transition({
        ...input,
        access: {
          actorPersonId: 'person-other-owner',
          correlationId: 'correlation:replacement-founder-retry',
        },
      }),
    ).rejects.toMatchObject({ code: 'conflict' } satisfies Partial<DomainError>);
    await expect(
      scoped.transition({
        access: input.access,
        workstreamKey: 'replit',
        operationKey: input.operationKey,
        toStatus: 'ready_for_test',
        evidence: {
          tier: 'repository_review',
          kind: 'configuration_ready',
          result: 'passed',
          manifestDigest: 'A'.repeat(43),
          observedAt: input.evidence.observedAt,
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' } satisfies Partial<DomainError>);
    const rows = await database.query<{ evidence_count: number; status_count: number }>(`
      SELECT
        (SELECT count(*)::integer FROM founder_provisioning_evidence
          WHERE workstream_key = 'company_git') AS evidence_count,
        (SELECT count(*)::integer FROM founder_provisioning_status_events
          WHERE workstream_key = 'company_git') AS status_count
    `);
    expect(rows.rows[0]).toEqual({ evidence_count: 2, status_count: 2 });
  });

  it('rolls back invalid or future-dated transitions without orphan operations or evidence', async () => {
    await assign({
      id: 'assignment-founder-internal',
      personId: founderPersonId,
      organizationId: internalOrganizationId,
    });
    const scoped = repository();
    const skipped = transitionInput(founderPersonId, provisioningOperationKey(3));

    const baselineOccurredAt = await currentOccurredAt();
    await expect(
      scoped.transition({
        ...transitionInput(founderPersonId, provisioningOperationKey(15)),
        evidence: {
          ...skipped.evidence,
          observedAt: new Date(baselineOccurredAt.getTime() - 1),
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' } satisfies Partial<DomainError>);

    await expect(
      scoped.transition({
        ...skipped,
        toStatus: 'ready_for_test',
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' } satisfies Partial<DomainError>);
    await expect(
      scoped.transition({
        ...transitionInput(founderPersonId, provisioningOperationKey(4)),
        evidence: {
          ...skipped.evidence,
          observedAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' } satisfies Partial<DomainError>);

    const rows = await database.query<{
      evidence_count: number;
      operation_count: number;
      status_count: number;
    }>(`
      SELECT
        (SELECT count(*)::integer FROM founder_provisioning_evidence
          WHERE workstream_key = 'company_git') AS evidence_count,
        (SELECT count(*)::integer FROM founder_provisioning_operations
          WHERE workstream_key = 'company_git') AS operation_count,
        (SELECT count(*)::integer FROM founder_provisioning_status_events
          WHERE workstream_key = 'company_git') AS status_count
    `);
    expect(rows.rows[0]).toEqual({ evidence_count: 1, operation_count: 0, status_count: 1 });
  });

  it('rejects proof captured before configuration, invalidation, or reconfiguration', async () => {
    await assign({
      id: 'assignment-founder-internal',
      personId: founderPersonId,
      organizationId: internalOrganizationId,
    });
    const scoped = repository();
    await scoped.transition(transitionInput(founderPersonId, provisioningOperationKey(20)));
    const progressOccurredAt = await currentOccurredAt();
    await scoped.transition({
      access: { actorPersonId: founderPersonId, correlationId: 'correlation:config-one' },
      workstreamKey: 'company_git',
      operationKey: provisioningOperationKey(21),
      toStatus: 'ready_for_test',
      evidence: {
        tier: 'repository_review',
        kind: 'configuration_ready',
        result: 'passed',
        manifestDigest: 'H'.repeat(43),
        observedAt: progressOccurredAt,
      },
    });
    const configuredAt = await currentOccurredAt();
    const staleProof = {
      tier: 'deployed_staging' as const,
      kind: 'verification_passed' as const,
      result: 'passed' as const,
      manifestDigest: 'I'.repeat(43),
      observedAt: new Date(configuredAt.getTime() - 1),
    };
    await expect(
      scoped.transition({
        access: { actorPersonId: founderPersonId, correlationId: 'correlation:pre-config-proof' },
        workstreamKey: 'company_git',
        operationKey: provisioningOperationKey(22),
        toStatus: 'test_proven',
        evidence: staleProof,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' } satisfies Partial<DomainError>);

    await scoped.transition({
      access: { actorPersonId: founderPersonId, correlationId: 'correlation:valid-proof' },
      workstreamKey: 'company_git',
      operationKey: provisioningOperationKey(23),
      toStatus: 'test_proven',
      evidence: { ...staleProof, observedAt: configuredAt },
    });
    const provenAt = await currentOccurredAt();
    await scoped.transition({
      access: { actorPersonId: founderPersonId, correlationId: 'correlation:invalidate-proof' },
      workstreamKey: 'company_git',
      operationKey: provisioningOperationKey(24),
      toStatus: 'ready_for_test',
      evidence: {
        tier: 'repository_review',
        kind: 'evidence_invalidated',
        result: 'invalidated',
        observedAt: provenAt,
      },
    });
    const invalidatedAt = await currentOccurredAt();
    await expect(
      scoped.transition({
        access: { actorPersonId: founderPersonId, correlationId: 'correlation:stale-reproof' },
        workstreamKey: 'company_git',
        operationKey: provisioningOperationKey(25),
        toStatus: 'test_proven',
        evidence: { ...staleProof, observedAt: new Date(invalidatedAt.getTime() - 1) },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' } satisfies Partial<DomainError>);

    await scoped.transition({
      access: { actorPersonId: founderPersonId, correlationId: 'correlation:revoke-config' },
      workstreamKey: 'company_git',
      operationKey: provisioningOperationKey(26),
      toStatus: 'founder_in_progress',
      evidence: {
        tier: 'repository_review',
        kind: 'configuration_revoked',
        result: 'invalidated',
        observedAt: invalidatedAt,
      },
    });
    const revokedAt = await currentOccurredAt();
    await scoped.transition({
      access: { actorPersonId: founderPersonId, correlationId: 'correlation:config-two' },
      workstreamKey: 'company_git',
      operationKey: provisioningOperationKey(27),
      toStatus: 'ready_for_test',
      evidence: {
        tier: 'repository_review',
        kind: 'configuration_ready',
        result: 'passed',
        manifestDigest: 'J'.repeat(43),
        observedAt: revokedAt,
      },
    });
    const reconfiguredAt = await currentOccurredAt();
    await expect(
      scoped.transition({
        access: { actorPersonId: founderPersonId, correlationId: 'correlation:pre-reconfig-proof' },
        workstreamKey: 'company_git',
        operationKey: provisioningOperationKey(28),
        toStatus: 'test_proven',
        evidence: { ...staleProof, observedAt: new Date(reconfiguredAt.getTime() - 1) },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' } satisfies Partial<DomainError>);

    const rows = await database.query<{
      evidence_count: number;
      operation_count: number;
      status_count: number;
    }>(`
      SELECT
        (SELECT count(*)::integer FROM founder_provisioning_evidence
          WHERE workstream_key = 'company_git') AS evidence_count,
        (SELECT count(*)::integer FROM founder_provisioning_operations
          WHERE workstream_key = 'company_git') AS operation_count,
        (SELECT count(*)::integer FROM founder_provisioning_status_events
          WHERE workstream_key = 'company_git') AS status_count
    `);
    expect(rows.rows[0]).toEqual({ evidence_count: 7, operation_count: 6, status_count: 7 });
  });

  it('serializes concurrent status changes so only one stale transition can commit', async () => {
    await assign({
      id: 'assignment-founder-internal',
      personId: founderPersonId,
      organizationId: internalOrganizationId,
    });
    const scoped = repository();

    const results = await Promise.allSettled([
      scoped.transition(transitionInput(founderPersonId, provisioningOperationKey(5))),
      scoped.transition(transitionInput(founderPersonId, provisioningOperationKey(6))),
    ]);
    const statuses = await database.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM founder_provisioning_status_events WHERE workstream_key = 'company_git'`,
    );

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(statuses.rows[0]?.count).toBe(2);
  });

  it('converges concurrent exact retries on one immutable operation and status event', async () => {
    await assign({
      id: 'assignment-founder-internal',
      personId: founderPersonId,
      organizationId: internalOrganizationId,
    });
    const scoped = repository();
    const input = transitionInput(founderPersonId, provisioningOperationKey(7));

    const results = await Promise.all([scoped.transition(input), scoped.transition(input)]);
    const rows = await database.query<{
      evidence_count: number;
      operation_count: number;
      status_count: number;
    }>(`
      SELECT
        (SELECT count(*)::integer FROM founder_provisioning_evidence
          WHERE workstream_key = 'company_git') AS evidence_count,
        (SELECT count(*)::integer FROM founder_provisioning_operations
          WHERE workstream_key = 'company_git') AS operation_count,
        (SELECT count(*)::integer FROM founder_provisioning_status_events
          WHERE workstream_key = 'company_git') AS status_count
    `);

    expect(results.map(({ reused }) => reused).sort()).toEqual([false, true]);
    expect(new Set(results.map(({ evidenceId }) => evidenceId)).size).toBe(1);
    expect(rows.rows[0]).toEqual({ evidence_count: 2, operation_count: 1, status_count: 2 });
  });
});
