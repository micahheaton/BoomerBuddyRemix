import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const source = (path: string): string => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('mobile product-value journey', () => {
  it('keeps one simple Learn and updates destination behind the protected-adult boundary', () => {
    const app = source('apps/mobile/App.tsx');
    const navigation = source('apps/mobile/src/navigation.ts');
    const home = source('apps/mobile/src/screens.tsx');
    const learning = source('apps/mobile/src/member-learning-screen.tsx');

    expect(navigation).toContain('LearnUpdates: undefined;');
    expect(navigation).not.toContain('Lessons: undefined;');
    expect(navigation).not.toContain('Guidance: undefined;');
    expect(navigation).not.toContain('Reminders: undefined;');
    expect(app).toContain('name="LearnUpdates"');
    expect(app).toContain(
      "import { clearMobileMemberLearningPendingOperations } from './src/member-learning-idempotency'",
    );
    expect(app).toContain('return clearMobilePrivateDeviceState({');
    expect(app).toContain(
      'clearPendingLearningOperations: clearMobileMemberLearningPendingOperations,',
    );
    expect(home).toContain('<Text style={s.pill}>This week</Text>');
    expect(home).toContain('National guidance remains available when no reviewed');
    expect(home).not.toContain('review source-linked regional guidance');
    expect(home).toContain("navigation.navigate('LearnUpdates')");
    for (const directHomeAction of [
      'Check a message or link',
      'Open history',
      'Trusted Circle and family',
      'Family Safe Word',
      'Seven lessons and regional guidance',
      'Share feedback',
      'Support',
    ]) {
      expect(home).toContain(directHomeAction);
    }
    expect(learning).toContain('selectedScope?.isProtectedMember === true');
    expect(learning).toContain("selectedScope.capabilities.includes('orientation:use')");
    expect(learning).toContain('Protected adult access required');
  });

  it('uses only canonical person-and-household-scoped learning APIs', () => {
    const resource = source('apps/mobile/src/member-learning-resource.ts');
    const screen = source('apps/mobile/src/member-learning-screen.tsx');
    const idempotency = source('apps/mobile/src/member-learning-idempotency.ts');

    for (const path of [
      "'/v1/member-learning'",
      "'/v1/member-learning/preferences'",
      "'/v1/member-learning/rehearsal/answer'",
      '`/v1/member-learning/lessons/${encodeURIComponent(lesson.key)}/start`',
      '`/v1/member-learning/lessons/${encodeURIComponent(lesson.key)}/answer`',
      '`/v1/member-learning/feed/${encodeURIComponent(item.key)}`',
    ]) {
      expect(resource).toContain(path);
    }
    expect(resource).toContain("'X-BB-Household-Id': householdId");
    expect(resource).toContain("{ 'Idempotency-Key': idempotencyKey }");
    expect(resource).toContain('householdHeaders(householdId, idempotencyKey)');
    expect(resource).toContain('memberLearningResponseSchema.safeParse(value)');
    expect(resource).toContain('answerMemberLearningLessonResponseSchema.safeParse(response)');
    expect(resource).toContain('answerWeeklyRehearsalResponseSchema.safeParse(response)');
    expect(resource).toContain('occurrenceVersion: rehearsal.occurrenceVersion');
    expect(idempotency).toContain("import * as SecureStore from './secure-store'");
    expect(idempotency).toContain('boomerbuddy.mobile.member-learning.pending-operations');
    expect(idempotency).toContain('SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY');
    expect(idempotency).toContain(
      'mobileMemberLearningOperationScope(personId: string, householdId: string)',
    );
    expect(screen).toContain('createMobileMemberLearningOperationKeys()');
    expect(screen).toContain('operationKeys().retain({');
    expect(screen).toContain(
      'scope: mobileMemberLearningOperationScope(principal.personId, householdId),',
    );
    expect(screen).not.toContain('SecureStore');
    expect(screen).not.toContain('AsyncStorage');
    expect(screen).not.toContain('localStorage');
    expect(screen).not.toContain('personId:');
    expect(screen).toContain('Review my first step');
    expect(screen).toContain('selectedRehearsalOption');
    expect(screen).toContain("item.kind !== 'weekly_rehearsal'");
    expect(screen).not.toContain('{weeklyRehearsal.takeaway}');
    expect(screen).not.toContain('Complete two-minute rehearsal');
  });

  it('fails closed on household/offline errors and states content freshness limits', () => {
    const screen = source('apps/mobile/src/member-learning-screen.tsx');

    expect(screen).toContain('householdResourceIsVisible(resource, selectedHouseholdId)');
    expect(screen).toContain('selectedHouseholdIdRef.current !== householdId');
    expect(screen).toContain('No lesson, guidance, or inbox data is shown');
    expect(screen).toContain('Your saved server progress is unchanged.');
    expect(screen).toContain('Guidance needs a freshness review');
    expect(screen).toContain('not live monitoring or a complete list');
    expect(screen).toContain('Open official source:');
    expect(screen).toContain('email, text, and remote push delivery are disabled');
    expect(screen).toContain('one generic local notification');
    expect(screen).toContain('In-app updates remain the source of truth');
  });

  it('preserves explicit no-monitoring and no-provider boundaries', () => {
    const surface = [
      source('apps/mobile/src/member-learning-screen.tsx'),
      source('apps/mobile/src/member-learning-resource.ts'),
      source('apps/mobile/src/weekly-rehearsal-reminder.ts'),
    ].join('\n');

    expect(surface).toContain('does not monitor messages');
    expect(surface).toContain('read the clipboard');
    expect(surface).toContain('run in the background');
    expect(surface).toContain('or send');
    expect(surface).toContain('texts. Guidance is curated');
    expect(surface).not.toContain('Twilio');
    expect(surface).not.toContain('Clipboard.');
    expect(surface).not.toContain('getExpoPushTokenAsync');
    expect(surface).not.toContain('getDevicePushTokenAsync');
  });

  it('keeps in-app weekly practice separate from explicit device reminder permission', () => {
    const screen = source('apps/mobile/src/member-learning-screen.tsx');
    const weeklyPreference = screen.slice(
      screen.indexOf('async function setWeeklyPractice'),
      screen.indexOf('async function enableThisDeviceReminder'),
    );

    expect(weeklyPreference).not.toContain('enableWeeklyRehearsalReminder');
    expect(screen).toContain(
      'Turning on in-app practice does not request notification permission.',
    );
    expect(screen).toContain('title="Enable a reminder on this device"');
    expect(screen).toContain('onPress={() => void enableThisDeviceReminder()}');
  });

  it('wires production-safe Trusted Circle connection and durable share follow-up', () => {
    const screens = source('apps/mobile/src/screens.tsx');

    expect(screens).toContain("'/v1/family/recipient-connection-codes'");
    expect(screens).toContain('recipientConnectionCode: recipientConnectionCode.trim()');
    expect(screens).not.toContain('intendedCustomerSubject');
    expect(screens).toContain('Trusted Circle invitation created');
    expect(screens).toContain("created.delivery === 'local_only'");
    expect(screens).toContain('BoomerBuddy does not create or send a second credential.');
    expect(screens).toContain('Share only with the intended trusted person. Do not forward.');
    expect(screens).not.toContain('Share only with the intended protected adult.');
    expect(screens).toContain('BoomerBuddy did not choose a recipient or send a message.');
    expect(screens).toContain('share-acknowledgement');
    expect(screens).toContain('/closure`');
    expect(screens).toContain('I reviewed this result');
    expect(screens).toContain('No notification or message was sent.');
    expect(screens).toContain("'/v1/trusted-circle/attention'");
    expect(screens).toContain('Trusted Circle attention');
    expect(screens).toContain('No shared results are waiting for your acknowledgement.');
    expect(screens).toContain('does not send a text, email, or push alert');
    expect(screens).not.toContain('device-local acknowledgement');
  });

  it('refreshes Trusted Circle attention on Home focus without accepting stale household data', () => {
    const screens = source('apps/mobile/src/screens.tsx');
    const home = screens.slice(
      screens.indexOf('export function HomeScreen'),
      screens.indexOf('export function ProtectedAccessScreen'),
    );

    expect(home).toContain('useFocusEffect(\n    useCallback(() => {');
    expect(home).toContain(
      'const attentionFocusGeneration = ++attentionFocusGenerationRef.current;',
    );
    expect(home).toContain('selectedHomeHouseholdIdRef.current === householdId');
    expect(home).toContain('attentionFocusGenerationRef.current === attentionFocusGeneration');
    expect(home).toContain(
      "mobileRequest<TrustedCircleAttentionResponse>('/v1/trusted-circle/attention', {",
    );
    expect(home).toContain("headers: { 'X-BB-Household-Id': householdId }");
    expect(home).toContain('signal: controller.signal');
    expect(home).toContain('controller.signal.aborted || !attentionRequestIsCurrent()');
    expect(home).toContain('controller.abort()');
    expect(home).toContain('[attentionRefreshAttempt, hasTrustedCircleGrant, selectedHouseholdId]');
    expect(home).not.toContain(
      'useEffect(() => {\n    if (!selectedHouseholdId || !hasTrustedCircleGrant)',
    );
  });

  it('keeps organizer-first household membership separate from protected and Trusted Circle access', () => {
    const screens = source('apps/mobile/src/screens.tsx');

    expect(screens).toContain("'/v1/family/member-invitations'");
    expect(screens).toContain('/member-invitations/${encodeURIComponent');
    expect(screens).toContain('Accept a household membership invitation');
    expect(screens).toContain('Neutral household membership only');
    expect(screens).toContain('Invite someone to join the household');
    expect(screens).toContain('Create household membership invitation');
    expect(screens).toContain("navigation.navigate('ProtectedAccess')");
    expect(screens).toContain('Accept a Trusted Circle invitation');
    expect(screens).toContain('BoomerBuddy did not choose a recipient or send a message.');
    expect(screens).not.toContain('auto-enroll');
  });
});
