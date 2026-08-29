import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

async function source(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), 'utf8');
}

describe('weekly rehearsal client boundaries', () => {
  it('binds web and mobile answers to the exact rehearsal occurrence', async () => {
    const [web, mobileScreen, mobileResource] = await Promise.all([
      source('apps/web/src/app/member/orientation/member-learning-client.tsx'),
      source('apps/mobile/src/member-learning-screen.tsx'),
      source('apps/mobile/src/member-learning-resource.ts'),
    ]);

    for (const client of [web, mobileScreen]) {
      expect(client).toContain('rehearsal.occurrenceVersion');
      expect(client).toMatch(
        /JSON\.stringify\(\[\s*rehearsal\.key,\s*rehearsal\.version,\s*rehearsal\.occurrenceVersion,\s*optionKey,?\s*\]\)/u,
      );
    }
    expect(web).toContain('occurrenceVersion: rehearsal.occurrenceVersion');
    expect(mobileResource).toContain('occurrenceVersion: rehearsal.occurrenceVersion');
    expect(mobileResource).toContain("'key' | 'version' | 'occurrenceVersion'");
  });

  it('does not reveal the practice takeaway or offer dismissal before an answer', async () => {
    const [web, mobile] = await Promise.all([
      source('apps/web/src/app/member/orientation/member-learning-client.tsx'),
      source('apps/mobile/src/member-learning-screen.tsx'),
    ]);

    for (const client of [web, mobile]) {
      expect(client).toContain(
        'setRehearsalFeedback(`${response.feedback} Practice note: ${rehearsal.takeaway}`)',
      );
      expect(client).not.toContain('{weeklyRehearsal.takeaway}');
      expect(client).toContain("item.kind !== 'weekly_rehearsal'");
    }
  });

  it('keeps mobile busy state bound to the household and request that started it', async () => {
    const mobile = await source('apps/mobile/src/member-learning-screen.tsx');

    expect(mobile).toContain('type HouseholdBoundBusy');
    expect(mobile).toContain(
      "const busy = busyDraft?.householdId === selectedHouseholdId ? busyDraft.value : '';",
    );
    expect(mobile).toContain('current.requestId === requestId');
    expect(mobile).toContain('clearBusyForRequest(householdId, requestId);');
    expect(mobile).not.toMatch(/selectedHouseholdIdRef\.current === householdId\) setBusy\(''\)/u);
  });
});
