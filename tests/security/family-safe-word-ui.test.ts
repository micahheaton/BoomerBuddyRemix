import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const source = (path: string): string => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('family safe word customer surfaces', () => {
  it('guards the web subpage and links it from the role-aware Family surfaces', () => {
    const route = source('apps/web/src/app/member/family/safe-word/page.tsx');
    const webFamily = source('apps/web/src/app/member/family/page-client.tsx');
    const mobileFamily = source('apps/mobile/src/screens.tsx');

    expect(route).toContain('await protectProductionMemberResource()');
    for (const family of [webFamily, mobileFamily]) {
      expect(family).toContain("relationship.state === 'active'");
      expect(family).toContain('relationship.trustedPersonId ===');
      expect(family).toContain('member.isProtectedMember');
    }
    expect(webFamily).toContain('href="/member/family/safe-word"');
    expect(mobileFamily).toContain("navigation.navigate('FamilySafeWord')");
  });

  it('derives exact active trusted targets and keeps phrases transient', () => {
    const surfaces = [
      source('apps/web/src/app/member/family/safe-word/page-client.tsx'),
      source('apps/mobile/src/family-safe-word-screen.tsx'),
    ];

    for (const surface of surfaces) {
      expect(surface).toContain("relationship.state !== 'active'");
      expect(surface).toContain('relationship.trustedPersonId !== trustedPersonId');
      expect(surface).toContain("member.status === 'active' && member.isProtectedMember");
      expect(surface).toContain("setLifecyclePhrase('')");
      expect(surface).toContain("setLifecyclePhraseConfirmation('')");
      expect(surface).toContain("setVerificationPhrase('')");
      expect(surface).toContain('lifecyclePhrase !== lifecyclePhraseConfirmation');
      expect(surface).toContain('status === 429');
      expect(surface).toContain('not identity proof');
      expect(surface).not.toContain('localStorage');
      expect(surface).not.toContain('sessionStorage');
      expect(surface).not.toContain('console.');
      expect(surface).not.toContain('analytics');
    }
  });

  it('uses masked inputs and explicit recent-authentication handling on web and mobile', () => {
    const web = source('apps/web/src/app/member/family/safe-word/page-client.tsx');
    const mobile = source('apps/mobile/src/family-safe-word-screen.tsx');
    const app = source('apps/mobile/App.tsx');
    const navigation = source('apps/mobile/src/navigation.ts');

    expect(web.match(/type="password"/gu)).toHaveLength(3);
    expect(web.match(/autoComplete="off"/gu)).toHaveLength(3);
    expect(web).not.toContain('autoComplete="new-password"');
    expect(web).toContain("? 'Status unavailable'");
    expect(web).toContain('setSelfStatusUnavailableState({ householdId, value: true })');
    expect(web).toContain('householdBoundValue(selfStatusUnavailableState, selectedHouseholdId)');
    expect(web).toContain('isRecentAuthenticationError(caught)');
    expect(web).toContain('href={productionSessionRecoveryPath}');
    expect(web).not.toContain('/sign-in?redirect_url=');
    expect(mobile.match(/secureTextEntry/gu)).toHaveLength(3);
    expect(mobile).toContain('requiresRecentAuthentication(caught)');
    expect(mobile).toContain('BoomerBuddy did not make or retry the change');
    expect(mobile).toContain('accessibilityLabel="Loading family verification access"');
    expect(mobile).toContain('title="Try loading family verification again"');
    expect(mobile).toContain('title="Try loading safe word status again"');
    expect(navigation).toContain('FamilySafeWord: undefined;');
    expect(app).toContain('name="FamilySafeWord"');
  });

  it('keeps guided orientation on the canonical lifecycle and recent-authentication boundary', () => {
    const route = source('apps/api/src/routes/orientation.ts');
    const persistence = source('packages/persistence/src/orientation.ts');
    const web = source('apps/web/src/app/member/orientation/page-client.tsx');
    const mobile = source('apps/mobile/src/screens.tsx');

    expect(route).toContain('assertRecentCustomerAuthentication(auth)');
    expect(persistence).toContain('this.familySafeWords.replaceWithin(transaction');
    expect(persistence).toContain('this.familySafeWords.disableWithin(transaction');
    expect(persistence).not.toContain('INSERT INTO safe_word_verifiers');
    expect(persistence).not.toContain('DELETE FROM safe_word_verifiers');

    expect(web).toContain('isRecentAuthenticationError(caught)');
    expect(web).toContain('href={productionSessionRecoveryPath}');
    expect(web).toContain('maxLength={128}');
    expect(web).not.toContain("'/v1/orientation/steps/safe_word'");
    expect(mobile).toContain('requiresRecentAuthentication(caught)');
    expect(mobile).toContain(
      'The phrase was cleared. BoomerBuddy did not make or retry the change.',
    );
    expect(mobile).toContain('title="Return Home to sign out"');
    expect(mobile).toContain('maxLength={128}');
    expect(mobile).not.toContain("'/v1/orientation/steps/safe_word'");
  });
});
