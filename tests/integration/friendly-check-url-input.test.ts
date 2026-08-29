import { decryptField, parseEncryptedField } from '@boomerbuddy/security';
import { afterEach, describe, expect, it } from 'vitest';
import { browserHeaders, createApiHarness, login, type ApiHarness } from './support';

describe('friendly Check website-address input', () => {
  let harness: ApiHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('normalizes scheme-less addresses at both public and signed-in API boundaries', async () => {
    harness = await createApiHarness();

    const publicContext = await harness.app.inject({
      method: 'POST',
      url: '/v1/public/check-contexts',
      payload: { attribution: { source: 'direct', campaign: 'none' } },
    });
    expect(publicContext.statusCode).toBe(201);
    const context = publicContext.json<{
      context: { token: string; continuityProof: string };
    }>().context;
    const publicCheck = await harness.app.inject({
      method: 'POST',
      url: '/v1/public/checks',
      payload: {
        contextToken: context.token,
        continuityProof: context.continuityProof,
        kind: 'url',
        content: '  example.org/public-path  ',
      },
    });
    expect(publicCheck.statusCode).toBe(201);
    expect(publicCheck.body).not.toContain('example.org');
    const publicResultId = String(publicCheck.json().result.id);
    const publicStored = await harness.database.query<
      {
        encrypted_payload: string;
      } & Record<string, unknown>
    >('SELECT encrypted_payload FROM public_check_results WHERE id = $1', [publicResultId]);
    const publicPayload = JSON.parse(
      decryptField(
        parseEncryptedField(publicStored.rows[0]?.encrypted_payload as string),
        Buffer.alloc(32, 7),
        {
          tenantId: 'public-anonymous',
          resourceId: publicResultId,
          field: 'redacted-result',
          schemaVersion: 1,
          keyVersion: 1,
        },
      ).toString('utf8'),
    ) as { redactedContent: string };
    expect(publicPayload.redactedContent).toBe('https://example.org/public-path');

    const alice = await login(harness.app, 'owner-alice');
    const signedInCheck = await harness.app.inject({
      method: 'POST',
      url: '/v1/checks',
      headers: browserHeaders(alice.cookie as string),
      payload: { kind: 'url', content: ' example.com/member-path ' },
    });
    expect(signedInCheck.statusCode).toBe(201);
    expect(signedInCheck.body).not.toContain('example.com');
    const signedInResultId = String(signedInCheck.json().check.id);
    const signedInStored = await harness.database.query<
      {
        artifact_id: string;
        encrypted_content: string;
      } & Record<string, unknown>
    >(
      `SELECT analysis.artifact_id, artifact.encrypted_content
       FROM analyses analysis
       JOIN artifacts artifact
         ON artifact.household_id = analysis.household_id AND artifact.id = analysis.artifact_id
       WHERE analysis.id = $1`,
      [signedInResultId],
    );
    const storedArtifact = signedInStored.rows[0];
    const signedInContent = decryptField(
      parseEncryptedField(storedArtifact?.encrypted_content as string),
      Buffer.alloc(32, 7),
      {
        tenantId: 'household-sunrise',
        resourceId: storedArtifact?.artifact_id as string,
        field: 'content',
        schemaVersion: 1,
        keyVersion: 1,
      },
    ).toString('utf8');
    expect(signedInContent).toBe('https://example.com/member-path');
  }, 15_000);
});
