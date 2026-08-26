import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

async function source(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8');
}

describe('support receipt security boundary', () => {
  it('keeps receipt truth isolated from submitted content and legacy workflow tables', async () => {
    const [migration, persistence, routes] = await Promise.all([
      source('packages/persistence/migrations/0034_run3_1_support_receipts.sql'),
      source('packages/persistence/src/support-receipts.ts'),
      source('apps/api/src/routes/support-receipts.ts'),
    ]);

    expect(migration).not.toMatch(
      /\b(name|email|phone|message|url|attachment|contact|content|description)\s+(text|jsonb|bytea)\b/iu,
    );
    expect(`${migration}\n${persistence}`).not.toMatch(
      /support_cases|feedback_records|privacy_requests|access_intent|outbox_events/iu,
    );
    expect(`${persistence}\n${routes}`).not.toMatch(
      /twilio|stripe|fetch\s*\(|provider\.send|messages\.create/iu,
    );
    expect(routes).toContain("outboundMessage: 'not_sent'");
    expect(routes).toContain("providerAction: 'none'");
  });

  it('keeps every runtime gate default-off in the environment template', async () => {
    const template = await source('.env.example');
    expect(template).toContain('BB_SUPPORT_RECEIPTS_CUSTOMER_ACCESS_ENABLED=false');
    expect(template).toContain('BB_SUPPORT_RECEIPTS_INTAKE_ENABLED=false');
    expect(template).toContain('BB_SUPPORT_RECEIPTS_HQ_QUEUE_ENABLED=false');
  });
});
