import { useCallback, useLayoutEffect, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type {
  DurableActionOperationKeys,
  MemberLearningFeedItemDto,
  MemberLearningLessonDto,
  MemberLearningMutationAction,
  MemberLearningResponse,
} from '@boomerbuddy/contracts';
import { readableError } from './api';
import {
  emptyHouseholdResource,
  householdBoundDraftValue,
  householdResourceIsVisible,
  householdResourceReducer,
  type HouseholdBoundDraft,
} from './household-resource';
import { mobileHouseholdScopeSummary, useMobileHousehold } from './household';
import {
  createMobileMemberLearningOperationKeys,
  mobileMemberLearningOperationScope,
} from './member-learning-idempotency';
import {
  answerMemberLearningLesson,
  completeMemberWeeklyRehearsal,
  loadMemberLearning,
  startMemberLearningLesson,
  updateMemberLearningFeedItem,
  updateMemberLearningPreferences,
} from './member-learning-resource';
import { resolveMemberLearningCoarseRegion } from './member-learning-region';
import { validatedOfficialSourceUrl } from './official-source';
import { appStyles as s } from './theme';
import {
  disableWeeklyRehearsalReminder,
  enableWeeklyRehearsalReminder,
  readWeeklyReminderState,
  type WeeklyReminderState,
} from './weekly-rehearsal-reminder';

type ButtonProps = Readonly<{
  title: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: 'primary' | 'secondary';
  style?: StyleProp<ViewStyle>;
}>;

function ActionButton({
  title,
  onPress,
  disabled = false,
  kind = 'primary',
  style,
}: ButtonProps): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        kind === 'primary' ? s.buttonPrimary : s.buttonSecondary,
        disabled && s.buttonDisabled,
        pressed && { opacity: 0.82 },
        style,
      ]}
    >
      <Text style={kind === 'primary' ? s.buttonTextPrimary : s.buttonTextSecondary}>{title}</Text>
    </Pressable>
  );
}

function Screen({ children }: { children: React.ReactNode }): React.ReactElement {
  const household = useMobileHousehold();
  return (
    <ScrollView style={s.safe} contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      {household.selectedScope ? (
        <View style={s.scopeBanner}>
          <Text style={s.label}>Active household: {household.selectedHouseholdName}</Text>
          <Text style={s.muted}>{mobileHouseholdScopeSummary(household.selectedScope)}</Text>
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}

function ErrorText({ message }: { message: string }): React.ReactElement {
  return (
    <Text accessibilityRole="alert" style={s.error}>
      {message}
    </Text>
  );
}

function formatDate(value: string | undefined): string {
  return value ? new Date(value).toLocaleString() : 'Not scheduled';
}

const lessonStatusLabels: Record<MemberLearningLessonDto['progress']['state'], string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Complete',
  review_due: 'Review due',
};

const guidanceStateLabels: Record<MemberLearningResponse['guidance']['state'], string> = {
  current: 'Current guidance for your selected region',
  fallback_national: 'Current national guidance; no current state brief was available',
  stale: 'Guidance needs a freshness review',
  none: 'No approved current guidance is available',
};

function deviceReminderMessage(state: WeeklyReminderState | undefined): string {
  switch (state?.state) {
    case 'scheduled':
      return 'A generic weekly reminder is scheduled on this device. Delivery depends on device settings.';
    case 'permission_denied':
      return state.canAskAgain
        ? 'Device notifications are not allowed. You can try the permission request again.'
        : 'Device notifications are turned off. Use device settings if you want a local reminder.';
    case 'unsupported':
      return 'On-device reminders are unavailable on this platform. In-app updates still work.';
    case 'error':
      return 'The device reminder status could not be verified. In-app updates still work.';
    case 'not_scheduled':
      return 'No weekly reminder is scheduled on this device.';
    default:
      return 'Checking this device’s reminder status…';
  }
}

export function MemberLearningScreen(): React.ReactElement {
  const { principal, selectedHouseholdId, selectedScope } = useMobileHousehold();
  const canUseLearning =
    selectedScope?.isProtectedMember === true &&
    selectedScope.capabilities.includes('orientation:use');
  const [resource, dispatch] = useReducer(
    householdResourceReducer<MemberLearningResponse>,
    emptyHouseholdResource<MemberLearningResponse>(),
  );
  const selectedHouseholdIdRef = useRef(selectedHouseholdId);
  const requestIdRef = useRef(0);
  const operationKeysRef = useRef<DurableActionOperationKeys | undefined>(undefined);
  const [selectedLessonKeyDraft, setSelectedLessonKeyDraft] =
    useState<HouseholdBoundDraft<string>>();
  const [selectedOptionKeyDraft, setSelectedOptionKeyDraft] =
    useState<HouseholdBoundDraft<string>>();
  const [lessonFeedbackDraft, setLessonFeedbackDraft] = useState<HouseholdBoundDraft<string>>();
  const [regionDraftState, setRegionDraftState] = useState<HouseholdBoundDraft<string>>();
  const [busy, setBusy] = useState('');
  const [announcementDraft, setAnnouncementDraft] = useState<HouseholdBoundDraft<string>>();
  const [deviceReminder, setDeviceReminder] = useState<WeeklyReminderState>();

  const selectedLessonKey =
    householdBoundDraftValue(selectedLessonKeyDraft, selectedHouseholdId) ?? '';
  const selectedOptionKey =
    householdBoundDraftValue(selectedOptionKeyDraft, selectedHouseholdId) ?? '';
  const lessonFeedback = householdBoundDraftValue(lessonFeedbackDraft, selectedHouseholdId) ?? '';
  const announcement = householdBoundDraftValue(announcementDraft, selectedHouseholdId) ?? '';
  const setSelectedLessonKey = (value: string): void => {
    setSelectedLessonKeyDraft({ householdId: selectedHouseholdId, value });
  };
  const setSelectedOptionKey = (value: string): void => {
    setSelectedOptionKeyDraft({ householdId: selectedHouseholdId, value });
  };
  const setLessonFeedback = (value: string): void => {
    setLessonFeedbackDraft({ householdId: selectedHouseholdId, value });
  };
  const setAnnouncement = (value: string): void => {
    setAnnouncementDraft({ householdId: selectedHouseholdId, value });
  };
  const operationKeys = (): DurableActionOperationKeys => {
    operationKeysRef.current ??= createMobileMemberLearningOperationKeys();
    return operationKeysRef.current;
  };
  const mutationKey = (
    householdId: string,
    action: MemberLearningMutationAction,
    signature: string,
  ): Promise<string> =>
    operationKeys().retain({
      scope: mobileMemberLearningOperationScope(principal.personId, householdId),
      action,
      canonicalRequest: signature,
      keyPrefix: `member-learning:${action}`,
    });
  const settleMutationKey = (
    householdId: string,
    action: MemberLearningMutationAction,
    key: string,
  ): Promise<void> =>
    operationKeys().settle({
      scope: mobileMemberLearningOperationScope(principal.personId, householdId),
      action,
      key,
    });

  useLayoutEffect(() => {
    selectedHouseholdIdRef.current = selectedHouseholdId;
  }, [selectedHouseholdId]);

  const load = useCallback(async (householdId: string, signal?: AbortSignal) => {
    if (!householdId || selectedHouseholdIdRef.current !== householdId) return;
    const requestId = ++requestIdRef.current;
    dispatch({ type: 'started', householdId, requestId });
    try {
      const value = await loadMemberLearning(householdId, signal);
      if (selectedHouseholdIdRef.current !== householdId || signal?.aborted) return;
      dispatch({ type: 'succeeded', householdId, requestId, value });
    } catch (caught) {
      if (selectedHouseholdIdRef.current !== householdId || signal?.aborted) return;
      dispatch({ type: 'failed', householdId, requestId, message: readableError(caught) });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!canUseLearning || !selectedHouseholdId) {
        requestIdRef.current += 1;
        dispatch({ type: 'reset' });
        return undefined;
      }
      const controller = new AbortController();
      void load(selectedHouseholdId, controller.signal);
      void readWeeklyReminderState().then(setDeviceReminder);
      return () => controller.abort();
    }, [canUseLearning, load, selectedHouseholdId]),
  );

  const visibleResource = householdResourceIsVisible(resource, selectedHouseholdId)
    ? resource
    : undefined;
  const learning = visibleResource?.status === 'ready' ? visibleResource.value : undefined;

  const regionDraft =
    householdBoundDraftValue(regionDraftState, selectedHouseholdId) ??
    (learning?.preferences.coarseRegion === 'US'
      ? ''
      : learning?.preferences.coarseRegion.slice(3)) ??
    '';

  const selectedLesson =
    learning?.curriculum.lessons.find((lesson) => lesson.key === selectedLessonKey) ??
    learning?.curriculum.lessons.find(
      (lesson) => lesson.key === learning.curriculum.resume?.lessonKey,
    ) ??
    learning?.curriculum.lessons[0];

  async function applyCanonicalMutation(
    operationName: string,
    operationAction: MemberLearningMutationAction,
    operationSignature: string,
    operation: (idempotencyKey: string) => Promise<MemberLearningResponse>,
    successMessage: string,
  ): Promise<MemberLearningResponse | undefined> {
    const householdId = selectedHouseholdId;
    if (!householdId || selectedHouseholdIdRef.current !== householdId) return undefined;
    const requestId = ++requestIdRef.current;
    setBusy(operationName);
    setAnnouncement('');
    dispatch({ type: 'started', householdId, requestId });
    try {
      const idempotencyKey = await mutationKey(householdId, operationAction, operationSignature);
      const value = await operation(idempotencyKey);
      await settleMutationKey(householdId, operationAction, idempotencyKey);
      if (selectedHouseholdIdRef.current !== householdId) return undefined;
      dispatch({ type: 'succeeded', householdId, requestId, value });
      setAnnouncement(successMessage);
      return value;
    } catch (caught) {
      if (selectedHouseholdIdRef.current === householdId) {
        dispatch({ type: 'failed', householdId, requestId, message: readableError(caught) });
      }
      return undefined;
    } finally {
      if (selectedHouseholdIdRef.current === householdId) setBusy('');
    }
  }

  async function startLesson(lesson: MemberLearningLessonDto) {
    setSelectedOptionKey('');
    setLessonFeedback('');
    await applyCanonicalMutation(
      `start:${lesson.key}`,
      'lesson-start',
      JSON.stringify([lesson.key, lesson.version]),
      (idempotencyKey) => startMemberLearningLesson(selectedHouseholdId, lesson, idempotencyKey),
      `${lesson.title} is ready.`,
    );
  }

  async function answerLesson(lesson: MemberLearningLessonDto) {
    if (!selectedOptionKey) return;
    const optionKey = selectedOptionKey;
    const householdId = selectedHouseholdId;
    const requestId = ++requestIdRef.current;
    setBusy(`answer:${lesson.key}`);
    setAnnouncement('');
    dispatch({ type: 'started', householdId, requestId });
    const operationAction = 'lesson-answer' as const;
    try {
      const idempotencyKey = await mutationKey(
        householdId,
        operationAction,
        JSON.stringify([lesson.key, lesson.version, optionKey]),
      );
      const response = await answerMemberLearningLesson(
        householdId,
        lesson,
        optionKey,
        idempotencyKey,
      );
      await settleMutationKey(householdId, operationAction, idempotencyKey);
      if (selectedHouseholdIdRef.current !== householdId) return;
      dispatch({
        type: 'succeeded',
        householdId,
        requestId,
        value: response.learning,
      });
      setLessonFeedback(response.feedback);
      setAnnouncement(
        response.correct ? 'Correct. Lesson progress saved.' : 'Try this lesson again.',
      );
      if (response.correct) setSelectedOptionKey('');
    } catch (caught) {
      if (selectedHouseholdIdRef.current === householdId) {
        dispatch({ type: 'failed', householdId, requestId, message: readableError(caught) });
      }
    } finally {
      if (selectedHouseholdIdRef.current === householdId) setBusy('');
    }
  }

  async function saveRegion() {
    if (!learning) return;
    const coarseRegion = resolveMemberLearningCoarseRegion(regionDraft);
    if (!coarseRegion) {
      setAnnouncement(
        'Enter a recognized US state or District of Columbia abbreviation, or leave it blank for US guidance.',
      );
      return;
    }
    await applyCanonicalMutation(
      'region',
      'preferences-update',
      JSON.stringify([coarseRegion, learning.preferences.weeklyRehearsalEnabled]),
      (idempotencyKey) =>
        updateMemberLearningPreferences(
          selectedHouseholdId,
          {
            coarseRegion,
            weeklyRehearsalEnabled: learning.preferences.weeklyRehearsalEnabled,
          },
          idempotencyKey,
        ),
      'Guidance region updated.',
    );
  }

  async function setWeeklyPractice(enabled: boolean) {
    if (!learning) return;
    if (!enabled) setDeviceReminder(await disableWeeklyRehearsalReminder());
    await applyCanonicalMutation(
      'weekly-preference',
      'preferences-update',
      JSON.stringify([learning.preferences.coarseRegion, enabled]),
      (idempotencyKey) =>
        updateMemberLearningPreferences(
          selectedHouseholdId,
          {
            coarseRegion: learning.preferences.coarseRegion,
            weeklyRehearsalEnabled: enabled,
          },
          idempotencyKey,
        ),
      enabled
        ? 'Weekly in-app practice enabled. Device reminders stay off unless you choose them separately.'
        : 'Weekly practice and this device reminder are off.',
    );
  }

  async function enableThisDeviceReminder() {
    setBusy('device-reminder');
    setDeviceReminder(await enableWeeklyRehearsalReminder());
    setBusy('');
  }

  async function removeThisDeviceReminder() {
    setBusy('device-reminder');
    setDeviceReminder(await disableWeeklyRehearsalReminder());
    setAnnouncement('This device reminder was removed. In-app weekly practice remains enabled.');
    setBusy('');
  }

  async function completeRehearsal() {
    await applyCanonicalMutation(
      'rehearsal',
      'weekly-rehearsal-complete',
      'complete:true',
      (idempotencyKey) => completeMemberWeeklyRehearsal(selectedHouseholdId, idempotencyKey),
      'Weekly safety rehearsal completed.',
    );
  }

  async function updateFeedItem(item: MemberLearningFeedItemDto, state: 'read' | 'dismissed') {
    await applyCanonicalMutation(
      `feed:${item.key}`,
      'feed-item-update',
      JSON.stringify([item.key, item.version, state]),
      (idempotencyKey) =>
        updateMemberLearningFeedItem(selectedHouseholdId, item, state, idempotencyKey),
      state === 'read' ? 'Update marked read.' : 'Update dismissed.',
    );
  }

  async function openSource(url: string) {
    const validatedUrl = validatedOfficialSourceUrl(url);
    if (!validatedUrl) {
      setAnnouncement('This source is not an approved official government link.');
      return;
    }
    try {
      await Linking.openURL(validatedUrl);
    } catch {
      setAnnouncement('The official source could not be opened on this device.');
    }
  }

  return (
    <Screen>
      <Text style={s.pill}>This week</Text>
      <Text accessibilityRole="header" style={s.title}>
        Learn and updates
      </Text>
      <Text style={s.body}>
        Practice one short safety skill, review current approved guidance, and manage in-app
        reminders for this household.
      </Text>
      <View style={s.banner}>
        <Text style={s.label}>You stay in control</Text>
        <Text style={s.muted}>
          BoomerBuddy does not monitor messages, read the clipboard, run in the background, or send
          texts. Guidance is curated and may not cover every scam in your area.
        </Text>
      </View>
      {announcement ? (
        <Text accessibilityLiveRegion="polite" style={s.body}>
          {announcement}
        </Text>
      ) : null}
      {!canUseLearning ? (
        <View style={s.banner}>
          <Text style={s.heading}>Protected adult access required</Text>
          <Text style={s.body}>
            Learning progress and updates belong to the enrolled protected adult. Managing or paying
            for a household does not grant access to another adult’s learning record.
          </Text>
        </View>
      ) : visibleResource?.status === 'error' ? (
        <View style={s.card}>
          <ErrorText message={visibleResource.message} />
          <Text style={s.muted}>
            No lesson, guidance, or inbox data is shown while the current household cannot be
            verified. Your saved server progress is unchanged.
          </Text>
          <ActionButton
            kind="secondary"
            title="Try Learn and updates again"
            disabled={Boolean(busy)}
            onPress={() => void load(selectedHouseholdId)}
          />
        </View>
      ) : !learning ? (
        <View style={s.card}>
          <ActivityIndicator accessibilityLabel="Loading lessons and updates" />
          <Text style={s.body}>Loading lessons and updates…</Text>
        </View>
      ) : (
        <>
          <View style={s.card}>
            <Text style={s.pill}>Short safety curriculum</Text>
            <Text style={s.heading}>
              {learning.curriculum.completedCount} of {learning.curriculum.totalCount} lessons
              complete
            </Text>
            <Text style={s.body}>
              Progress is saved to this person and household. Lessons return for a short review
              after 30 days.
            </Text>
          </View>

          {selectedLesson ? (
            <View style={s.card}>
              <Text style={s.pill}>{lessonStatusLabels[selectedLesson.progress.state]}</Text>
              <Text accessibilityRole="header" style={s.heading}>
                {selectedLesson.title}
              </Text>
              <Text style={s.muted}>About {selectedLesson.estimatedMinutes} minutes</Text>
              <Text style={s.body}>{selectedLesson.objective}</Text>
              <Text style={s.label}>Practice scenario</Text>
              <Text style={s.body}>{selectedLesson.scenario}</Text>
              {selectedLesson.progress.state === 'not_started' ? (
                <ActionButton
                  title="Start this lesson"
                  disabled={Boolean(busy)}
                  onPress={() => void startLesson(selectedLesson)}
                />
              ) : (
                <>
                  <Text style={s.label}>Choose the safer response</Text>
                  {selectedLesson.options.map((option) => (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selectedOptionKey === option.key }}
                      key={option.key}
                      onPress={() => {
                        setSelectedOptionKey(option.key);
                        setLessonFeedback('');
                      }}
                      style={[s.choice, selectedOptionKey === option.key && s.choiceSelected]}
                    >
                      <View
                        style={[s.radio, selectedOptionKey === option.key && s.radioSelected]}
                      />
                      <Text style={s.body}>{option.label}</Text>
                    </Pressable>
                  ))}
                  <ActionButton
                    title={busy.startsWith('answer:') ? 'Checking answer…' : 'Check my answer'}
                    disabled={Boolean(busy) || !selectedOptionKey}
                    onPress={() => void answerLesson(selectedLesson)}
                  />
                </>
              )}
              {lessonFeedback ? (
                <Text accessibilityLiveRegion="polite" style={s.body}>
                  {lessonFeedback}
                </Text>
              ) : null}
              <Text style={s.label}>Remember</Text>
              <Text style={s.body}>{selectedLesson.takeaway}</Text>
              {selectedLesson.sources.map((source) => (
                <ActionButton
                  kind="secondary"
                  key={source.url}
                  title={`Open official source: ${source.title}`}
                  disabled={Boolean(busy)}
                  onPress={() => void openSource(source.url)}
                />
              ))}
            </View>
          ) : null}

          <View style={s.card}>
            <Text style={s.heading}>All short lessons</Text>
            {learning.curriculum.lessons.map((lesson) => (
              <ActionButton
                kind="secondary"
                key={lesson.key}
                title={`${lesson.order}. ${lesson.title} - ${lessonStatusLabels[lesson.progress.state]}`}
                disabled={Boolean(busy)}
                onPress={() => {
                  setSelectedLessonKey(lesson.key);
                  setSelectedOptionKey('');
                  setLessonFeedback('');
                }}
              />
            ))}
          </View>

          <View style={s.card}>
            <Text style={s.pill}>Regional guidance</Text>
            <Text accessibilityRole="header" style={s.heading}>
              Current scam guidance
            </Text>
            <Text style={s.body}>{guidanceStateLabels[learning.guidance.state]}</Text>
            <Text style={s.muted}>
              This is a curated, source-linked briefing, not live monitoring or a complete list of
              activity near you. BoomerBuddy does not fetch or scan regional activity from this
              screen.
            </Text>
            <Text style={s.label}>Two-letter state abbreviation (optional)</Text>
            <TextInput
              accessibilityLabel="Two-letter state abbreviation for guidance"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!busy}
              maxLength={2}
              onChangeText={(value) =>
                setRegionDraftState({ householdId: selectedHouseholdId, value })
              }
              placeholder="Leave blank for US"
              style={s.input}
              value={regionDraft}
            />
            <ActionButton
              kind="secondary"
              title="Save guidance region"
              disabled={Boolean(busy)}
              onPress={() => void saveRegion()}
            />
            {learning.guidance.staleMessage ? (
              <ErrorText message={learning.guidance.staleMessage} />
            ) : null}
            {learning.guidance.briefs.length ? (
              learning.guidance.briefs.map((brief) => (
                <View key={`${brief.key}:${brief.version}`} style={s.card}>
                  <Text style={s.pill}>{brief.freshness === 'current' ? 'Current' : 'Stale'}</Text>
                  <Text style={s.heading}>{brief.title}</Text>
                  <Text style={s.body}>{brief.summary}</Text>
                  <Text style={s.label}>Safer actions</Text>
                  {brief.safeActions.map((action, index) => (
                    <Text key={`${brief.key}:action:${index}`} style={s.body}>
                      {index + 1}. {action}
                    </Text>
                  ))}
                  <Text style={s.muted}>
                    Region: {brief.region}. Reviewed {formatDate(brief.reviewedAt)}. Expires{' '}
                    {formatDate(brief.expiresAt)}.
                  </Text>
                  <ActionButton
                    kind="secondary"
                    title={`Open official source: ${brief.source.title}`}
                    disabled={Boolean(busy)}
                    onPress={() => void openSource(brief.source.url)}
                  />
                </View>
              ))
            ) : (
              <Text style={s.muted}>
                No approved current brief is available. Use independently found official channels
                for urgent verification.
              </Text>
            )}
          </View>

          <View style={s.card}>
            <Text style={s.pill}>In-app reminder center</Text>
            <Text accessibilityRole="header" style={s.heading}>
              Updates and reminders
            </Text>
            <Text style={s.body}>
              {learning.feed.unreadCount} unread. This inbox is the authoritative reminder record;
              email, text, and remote push delivery are disabled. If you opt in below, this device
              may schedule one generic local notification.
            </Text>
            <Text style={s.muted}>
              No reminder includes a submitted message, URL, Check result, person, or household
              identifier.
            </Text>
            {learning.feed.items.length ? (
              learning.feed.items.map((item) => (
                <View key={`${item.key}:${item.version}`} style={s.card}>
                  <Text style={s.pill}>{item.state === 'unread' ? 'New' : 'Read'}</Text>
                  <Text style={s.heading}>{item.title}</Text>
                  <Text style={s.body}>{item.summary}</Text>
                  {item.dueAt ? <Text style={s.muted}>Due {formatDate(item.dueAt)}</Text> : null}
                  {item.lessonKey ? (
                    <ActionButton
                      kind="secondary"
                      title="Open this lesson"
                      disabled={Boolean(busy)}
                      onPress={() => {
                        setSelectedLessonKey(item.lessonKey ?? '');
                        setSelectedOptionKey('');
                        void updateFeedItem(item, 'read');
                      }}
                    />
                  ) : item.action === 'weekly_rehearsal' ? (
                    <ActionButton
                      kind="secondary"
                      title="Complete two-minute rehearsal"
                      disabled={Boolean(busy)}
                      onPress={() => void completeRehearsal()}
                    />
                  ) : item.state === 'unread' ? (
                    <ActionButton
                      kind="secondary"
                      title="Mark guidance read"
                      disabled={Boolean(busy)}
                      onPress={() => void updateFeedItem(item, 'read')}
                    />
                  ) : null}
                  <ActionButton
                    kind="secondary"
                    title="Dismiss this update"
                    disabled={Boolean(busy)}
                    onPress={() => void updateFeedItem(item, 'dismissed')}
                  />
                </View>
              ))
            ) : (
              <Text style={s.body}>You are caught up.</Text>
            )}
          </View>

          <View style={s.card}>
            <Text style={s.heading}>Weekly practice</Text>
            <Text style={s.body}>
              {learning.preferences.weeklyRehearsalEnabled
                ? `In-app weekly practice is on. Next due: ${formatDate(learning.preferences.nextRehearsalAt)}.`
                : 'In-app weekly practice is off.'}
            </Text>
            <Text style={s.muted}>{deviceReminderMessage(deviceReminder)}</Text>
            <Text style={s.muted}>
              Device reminder delivery has not yet been verified across supported iOS and Android
              devices. In-app updates remain the source of truth.
            </Text>
            {!learning.preferences.weeklyRehearsalEnabled ? (
              <>
                <Text style={s.muted}>
                  Turning on in-app practice does not request notification permission. You can opt
                  in to one generic reminder separately after practice is enabled.
                </Text>
                <ActionButton
                  title="Turn on weekly practice"
                  disabled={Boolean(busy)}
                  onPress={() => void setWeeklyPractice(true)}
                />
              </>
            ) : (
              <>
                {deviceReminder?.state !== 'scheduled' ? (
                  <ActionButton
                    kind="secondary"
                    title="Enable a reminder on this device"
                    disabled={Boolean(busy)}
                    onPress={() => void enableThisDeviceReminder()}
                  />
                ) : (
                  <ActionButton
                    kind="secondary"
                    title="Remove only this device reminder"
                    disabled={Boolean(busy)}
                    onPress={() => void removeThisDeviceReminder()}
                  />
                )}
                <ActionButton
                  kind="secondary"
                  title="Turn off weekly practice"
                  disabled={Boolean(busy)}
                  onPress={() => void setWeeklyPractice(false)}
                />
              </>
            )}
          </View>
        </>
      )}
    </Screen>
  );
}
