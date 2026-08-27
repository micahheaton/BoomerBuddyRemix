import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const screens = readFileSync(resolve(repositoryRoot, 'apps/mobile/src/screens.tsx'), 'utf8');

describe('mobile neutral household membership controls', () => {
  it('binds an explicit confirmed deletion to the exact household and request generation', () => {
    expect(screens).toContain('`/v1/family/members/${encodeURIComponent(membershipId)}`');
    expect(screens).toContain("method: 'DELETE'");
    expect(screens).toContain("headers: { 'X-BB-Household-Id': householdId }");
    expect(screens).toContain('signal: controller.signal');
    expect(screens).toContain('membershipMutationIsCurrent(attempt, controller)');
    expect(screens).toContain('householdGenerationRef.current === attempt.householdGeneration');
    expect(screens).toContain('membershipMutationRequestIdRef.current === attempt.requestId');
    expect(screens).toContain('selectedHouseholdIdRef.current === attempt.householdId');
    expect(screens).toContain("title={removingSelf ? 'Leave household' : 'Remove member'}");
    expect(screens).toContain("? 'Yes, leave household'");
    expect(screens).toContain(": 'Yes, remove member'");
    expect(screens).toContain('title="Keep membership"');
  });

  it('offers the control only for a neutral role and leaves final authority enforcement server-side', () => {
    expect(screens).toContain("member.status === 'active'");
    expect(screens).toContain('!member.isAdministrator');
    expect(screens).toContain('!member.isProtectedMember');
    expect(screens).toContain('!memberHasActiveTrustedRole(member.personId)');
    expect(screens).toContain('currentHouseholdScope?.isPayer === true');
    expect(screens).toContain('currentHouseholdScope?.isBillingManager === true');
    expect(screens).toContain('(currentHouseholdScope?.trustedCircleGrants.length ?? 0) > 0');
    expect(screens).toContain('(isHouseholdAdministrator || removingSelf)');
    expect(screens).toContain(
      'The server will refuse if any protected, Trusted Circle, administrator, payer, or billing role remains.',
    );
  });

  it('refreshes account truth after self-leave and the household roster after administrator removal', () => {
    expect(screens).toContain(
      "await mobileRequest<unknown>('/v1/me', { signal: controller.signal })",
    );
    expect(screens).toContain(
      'refreshed.principal.households.some((scope) => scope.id === householdId)',
    );
    expect(screens).toContain('const nextHouseholdId = replacePrincipal(refreshed.principal)');
    expect(screens).toContain("dispatchFamily({ type: 'reset' })");
    expect(screens).toContain("navigation.navigate('Home')");
    expect(screens).toContain('const refreshedFamily = await load(householdId, controller.signal)');
    expect(screens).toContain('The neutral household membership was removed.');
  });

  it('does not retry a recent-authentication denial or an uncertain post-commit refresh', () => {
    expect(screens).toContain('setMutationError(caught)');
    expect(screens).toContain('requiresRecentAuthentication(caught)');
    expect(screens).toContain('BoomerBuddy did not make the change or retry it.');
    expect(screens).toContain('Do not submit it again. Return Home and refresh access.');
    expect(screens).not.toContain('retryNeutralMembership');
  });
});
