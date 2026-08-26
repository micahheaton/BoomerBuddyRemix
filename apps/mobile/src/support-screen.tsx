import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '@clerk/expo';
import * as Crypto from 'expo-crypto';
import { apiPaths, type SupportReceiptRecordDto } from '@boomerbuddy/contracts';
import { MobileCustomerError, mobileRequest, readableError } from './api';
import { useOptionalMobileHousehold } from './household';
import {
  canWithdrawMobileSupportReceipt,
  isDefinitiveMobileSupportReceiptMutationFailure,
  mobileSupportReceiptCategories,
  mobileSupportReceiptImpacts,
  mobileSupportReceiptOperationKey,
  mobileSupportReceiptResolutionLabels,
  mobileSupportReceiptStateLabels,
  parseMobileSupportReceiptList,
  parseMobileSupportReceiptMutation,
  type MobileSupportReceiptCategory,
  type MobileSupportReceiptImpact,
} from './support-receipts';
import { appStyles as s } from './theme';

const supportEmail = 'support@boomerbuddy.net';
const pageSize = 10;

function SupportButton({
  title,
  onPress,
  disabled = false,
  kind = 'secondary',
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: 'primary' | 'secondary' | 'danger';
}) {
  const buttonStyle =
    kind === 'primary' ? s.buttonPrimary : kind === 'danger' ? s.buttonDanger : s.buttonSecondary;
  const textStyle =
    kind === 'primary'
      ? s.buttonTextPrimary
      : kind === 'danger'
        ? s.buttonTextDanger
        : s.buttonTextSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        buttonStyle,
        disabled && s.buttonDisabled,
        pressed && { opacity: 0.82 },
      ]}
    >
      <Text style={textStyle}>{title}</Text>
    </Pressable>
  );
}

function customerErrorStatus(error: unknown, status: number): boolean {
  return error instanceof MobileCustomerError && error.status === status;
}

function optionLabel<T extends string>(
  options: readonly { readonly value: T; readonly label: string }[],
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? 'Support request';
}

export function SupportScreen(): React.ReactElement {
  const { isLoaded, isSignedIn } = useAuth();
  const household = useOptionalMobileHousehold();
  const selectedHouseholdId = household?.selectedHouseholdId ?? '';
  const scopeKey = !isLoaded
    ? 'loading'
    : isSignedIn
      ? `signed-in:${selectedHouseholdId}`
      : 'signed-out';
  return (
    <SupportReceiptContent
      isLoaded={isLoaded}
      isSignedIn={isSignedIn}
      key={scopeKey}
      selectedHouseholdId={selectedHouseholdId}
    />
  );
}

function SupportReceiptContent({
  isLoaded,
  isSignedIn,
  selectedHouseholdId,
}: {
  readonly isLoaded: boolean;
  readonly isSignedIn: boolean | undefined;
  readonly selectedHouseholdId: string;
}): React.ReactElement {
  const [category, setCategory] = useState<MobileSupportReceiptCategory>('account_access');
  const [impact, setImpact] = useState<MobileSupportReceiptImpact>('question');
  const [receipts, setReceipts] = useState<SupportReceiptRecordDto[]>([]);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [terminalTruncation, setTerminalTruncation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [listError, setListError] = useState('');
  const [actionError, setActionError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [intakeUnavailable, setIntakeUnavailable] = useState(false);
  const [confirmingWithdrawal, setConfirmingWithdrawal] = useState('');
  const [pendingCreate, setPendingCreate] = useState<{
    readonly key: string;
    readonly category: MobileSupportReceiptCategory;
    readonly impact: MobileSupportReceiptImpact;
  }>();
  const withdrawalKeys = useRef<Record<string, string>>({});

  const loadPage = useCallback(
    async (requestedOffset: number, signal?: AbortSignal): Promise<void> => {
      if (!selectedHouseholdId) return;
      try {
        const raw = await mobileRequest<unknown>(
          `${apiPaths.supportReceipts}?limit=${pageSize}&offset=${requestedOffset}`,
          {
            headers: { 'X-BB-Household-Id': selectedHouseholdId },
            ...(signal === undefined ? {} : { signal }),
          },
        );
        const response = parseMobileSupportReceiptList(raw);
        setReceipts(response.receipts);
        setNextOffset(response.nextOffset);
        setTerminalTruncation(response.truncated && response.nextOffset === null);
        setUnavailable(false);
        setListError('');
      } catch (caught) {
        if (signal?.aborted) return;
        setReceipts([]);
        setNextOffset(null);
        setTerminalTruncation(false);
        if (customerErrorStatus(caught, 404)) {
          setUnavailable(true);
          setListError('');
        } else {
          setUnavailable(false);
          setListError(readableError(caught));
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [selectedHouseholdId],
  );

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !selectedHouseholdId) {
      return () => undefined;
    }
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      setLoading(true);
      return loadPage(offset, controller.signal);
    });
    return () => controller.abort();
  }, [isLoaded, isSignedIn, loadPage, offset, selectedHouseholdId]);

  async function refreshPage(requestedOffset = offset): Promise<void> {
    setLoading(true);
    await loadPage(requestedOffset);
  }

  async function createReceipt(): Promise<void> {
    if (busy || !selectedHouseholdId) return;
    const operation =
      pendingCreate ??
      ({
        key: mobileSupportReceiptOperationKey('create', Crypto.randomUUID()),
        category,
        impact,
      } as const);
    setPendingCreate(operation);
    setBusy('create');
    setActionError('');
    setAnnouncement('');
    try {
      const raw = await mobileRequest<unknown>(apiPaths.supportReceipts, {
        method: 'POST',
        headers: {
          'Idempotency-Key': operation.key,
          'X-BB-Household-Id': selectedHouseholdId,
        },
        body: JSON.stringify({ category: operation.category, impact: operation.impact }),
      });
      const result = parseMobileSupportReceiptMutation(raw);
      setPendingCreate(undefined);
      setIntakeUnavailable(false);
      setAnnouncement(
        `Support receipt ${result.receipt.receiptCode} was recorded. No message or contact details were submitted.`,
      );
      setOffset(0);
      await refreshPage(0);
    } catch (caught) {
      if (customerErrorStatus(caught, 404)) {
        setPendingCreate(undefined);
        setIntakeUnavailable(true);
      } else {
        if (
          caught instanceof MobileCustomerError &&
          isDefinitiveMobileSupportReceiptMutationFailure(caught.status)
        ) {
          setPendingCreate(undefined);
        }
        setActionError(readableError(caught));
      }
    } finally {
      setBusy('');
    }
  }

  async function withdrawReceipt(receiptCode: string): Promise<void> {
    if (busy || !selectedHouseholdId) return;
    const key =
      withdrawalKeys.current[receiptCode] ??
      mobileSupportReceiptOperationKey('withdraw', Crypto.randomUUID());
    withdrawalKeys.current[receiptCode] = key;
    setBusy(receiptCode);
    setActionError('');
    setAnnouncement('');
    try {
      const raw = await mobileRequest<unknown>(`${apiPaths.supportReceipts}/withdrawals`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': key,
          'X-BB-Household-Id': selectedHouseholdId,
        },
        body: JSON.stringify({ receiptCode }),
      });
      parseMobileSupportReceiptMutation(raw);
      delete withdrawalKeys.current[receiptCode];
      setConfirmingWithdrawal('');
      setAnnouncement(`Support receipt ${receiptCode} was withdrawn.`);
      await refreshPage();
    } catch (caught) {
      if (customerErrorStatus(caught, 404) || customerErrorStatus(caught, 409)) {
        delete withdrawalKeys.current[receiptCode];
        setConfirmingWithdrawal('');
        await refreshPage();
        setAnnouncement('That receipt could not be withdrawn. Your receipt list was refreshed.');
      } else {
        setActionError(readableError(caught));
      }
    } finally {
      setBusy('');
    }
  }

  async function openSupportEmail(): Promise<void> {
    setEmailError('');
    try {
      await Linking.openURL(`mailto:${supportEmail}`);
    } catch {
      setEmailError('BoomerBuddy could not open an email app. Copy the address shown below.');
    }
  }

  const choicesDisabled = busy !== '' || pendingCreate !== undefined;

  return (
    <ScrollView style={s.safe} contentContainerStyle={s.screen}>
      <Text accessibilityRole="header" style={s.title}>
        Customer support
      </Text>
      <Text style={s.body}>
        Create a private, content-free receipt for account, privacy, accessibility, billing, or
        product help.
      </Text>
      {actionError ? (
        <Text accessibilityRole="alert" style={s.error}>
          {actionError}
        </Text>
      ) : null}
      {!isLoaded ? (
        <View style={s.card}>
          <Text style={s.heading}>Checking sign-in status</Text>
          <Text style={s.body}>Please wait while BoomerBuddy checks your account.</Text>
        </View>
      ) : !isSignedIn ? (
        <View style={s.card}>
          <Text style={s.heading}>Sign in for private support receipts</Text>
          <Text style={s.body}>
            Sign in to create, review, or withdraw a support receipt. The separate email option
            below remains available if you cannot sign in.
          </Text>
        </View>
      ) : !selectedHouseholdId ? (
        <View style={s.card}>
          <Text style={s.heading}>A household is required</Text>
          <Text style={s.body}>
            Private support receipts are tied to your signed-in account and selected household. Use
            the separate email option below if you are not connected to a household.
          </Text>
        </View>
      ) : (
        <>
          <View style={s.card}>
            <Text style={s.heading}>Create a private support receipt</Text>
            <Text style={s.body}>
              Choose only a topic and how much it affects you. There is no message box, attachment,
              name, email address, phone number, or website field.
            </Text>
            <Text style={s.muted}>
              Creating a receipt does not send an email, text message, or provider request. It adds
              only the two choices below to the private support queue. Receipts are not monitored in
              real time.
            </Text>
            {unavailable ? (
              <View style={s.banner} accessibilityLiveRegion="polite">
                <Text style={s.heading}>Support receipts are not available right now</Text>
                <Text style={s.body}>The separate email option remains available below.</Text>
              </View>
            ) : intakeUnavailable ? (
              <View style={s.banner} accessibilityLiveRegion="polite">
                <Text style={s.heading}>Creating a receipt is not available right now</Text>
                <Text style={s.body}>
                  Existing receipt history may still be available. The separate email option is
                  below if you need to explain the issue.
                </Text>
              </View>
            ) : (
              <>
                <Text style={s.label}>What do you need help with?</Text>
                <View accessibilityLabel="Support topic choices" style={s.navGrid}>
                  {mobileSupportReceiptCategories.map((option) => (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{
                        checked: category === option.value,
                        disabled: choicesDisabled,
                      }}
                      disabled={choicesDisabled}
                      key={option.value}
                      onPress={() => setCategory(option.value)}
                      style={[s.choice, category === option.value && s.choiceSelected]}
                    >
                      <View style={[s.radio, category === option.value && s.radioSelected]} />
                      <Text style={s.body}>{option.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={s.label}>How is this affecting you?</Text>
                <View accessibilityLabel="Support impact choices" style={s.navGrid}>
                  {mobileSupportReceiptImpacts.map((option) => (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{
                        checked: impact === option.value,
                        disabled: choicesDisabled,
                      }}
                      disabled={choicesDisabled}
                      key={option.value}
                      onPress={() => setImpact(option.value)}
                      style={[s.choice, impact === option.value && s.choiceSelected]}
                    >
                      <View style={[s.radio, impact === option.value && s.radioSelected]} />
                      <Text style={s.body}>{option.label}</Text>
                    </Pressable>
                  ))}
                </View>
                {pendingCreate && !busy ? (
                  <Text style={s.muted}>
                    The previous result was uncertain. Retry the same request so BoomerBuddy can
                    recover it without creating another receipt.
                  </Text>
                ) : null}
                <SupportButton
                  kind="primary"
                  title={
                    busy === 'create'
                      ? 'Creating receipt...'
                      : pendingCreate
                        ? 'Retry same receipt request'
                        : 'Create support receipt'
                  }
                  disabled={busy !== ''}
                  onPress={() => void createReceipt()}
                />
              </>
            )}
          </View>

          <View style={s.card}>
            <Text style={s.heading}>Your support receipts</Text>
            <Text style={s.body}>
              These records show only topic, impact, status, reference code, and time. They do not
              show a message or household identifier.
            </Text>
            {announcement ? (
              <Text accessibilityLiveRegion="polite" style={s.body}>
                {announcement}
              </Text>
            ) : null}
            {listError ? (
              <>
                <Text accessibilityRole="alert" style={s.error}>
                  {listError}
                </Text>
                <SupportButton
                  title="Try loading receipts again"
                  disabled={loading || busy !== ''}
                  onPress={() => void refreshPage()}
                />
              </>
            ) : loading ? (
              <Text accessibilityLiveRegion="polite" style={s.body}>
                Loading support receipts...
              </Text>
            ) : unavailable ? (
              <Text style={s.muted}>Receipt history is unavailable right now.</Text>
            ) : receipts.length === 0 ? (
              <Text style={s.muted}>No support receipts are on this page.</Text>
            ) : (
              receipts.map((receipt) => (
                <View style={s.banner} key={receipt.receiptCode}>
                  <Text style={s.heading}>
                    {optionLabel(mobileSupportReceiptCategories, receipt.category)}
                  </Text>
                  <Text style={s.body}>
                    {optionLabel(mobileSupportReceiptImpacts, receipt.impact)} |{' '}
                    {mobileSupportReceiptStateLabels[receipt.state]}
                  </Text>
                  <Text selectable style={s.label}>
                    Reference: {receipt.receiptCode}
                  </Text>
                  <Text style={s.muted}>
                    Created {new Date(receipt.createdAt).toLocaleString()}
                  </Text>
                  {receipt.resolutionCode ? (
                    <Text style={s.muted}>
                      Outcome: {mobileSupportReceiptResolutionLabels[receipt.resolutionCode]}
                    </Text>
                  ) : null}
                  {canWithdrawMobileSupportReceipt(receipt.state) ? (
                    confirmingWithdrawal === receipt.receiptCode ? (
                      <View accessibilityLiveRegion="polite" style={s.navGrid}>
                        <Text style={s.body}>
                          Withdraw this receipt? It will leave the active support queue and cannot
                          be reopened.
                        </Text>
                        <SupportButton
                          kind="danger"
                          title={
                            busy === receipt.receiptCode
                              ? 'Withdrawing receipt...'
                              : 'Confirm withdrawal'
                          }
                          disabled={busy !== ''}
                          onPress={() => void withdrawReceipt(receipt.receiptCode)}
                        />
                        <SupportButton
                          title="Cancel"
                          disabled={busy !== ''}
                          onPress={() => setConfirmingWithdrawal('')}
                        />
                      </View>
                    ) : (
                      <SupportButton
                        title="Withdraw receipt"
                        disabled={busy !== ''}
                        onPress={() => setConfirmingWithdrawal(receipt.receiptCode)}
                      />
                    )
                  ) : null}
                </View>
              ))
            )}
            {terminalTruncation && !loading && listError === '' ? (
              <Text accessibilityLiveRegion="polite" style={s.muted}>
                Additional older receipts are outside this bounded history view. Use Newer receipts
                to return to earlier pages.
              </Text>
            ) : null}
            {!unavailable ? (
              <View accessibilityLabel="Support receipt pages" style={s.row}>
                <SupportButton
                  title="Newer receipts"
                  disabled={loading || busy !== '' || offset === 0}
                  onPress={() => {
                    setLoading(true);
                    setOffset(Math.max(0, offset - pageSize));
                  }}
                />
                <SupportButton
                  title="Older receipts"
                  disabled={loading || busy !== '' || nextOffset === null}
                  onPress={() => {
                    if (nextOffset === null) return;
                    setLoading(true);
                    setOffset(nextOffset);
                  }}
                />
              </View>
            ) : null}
          </View>
        </>
      )}

      <View style={s.card}>
        <Text style={s.heading}>Separate email option</Text>
        <Text style={s.body}>
          Email is separate from support receipts. A receipt never opens your email app or sends a
          message. Choosing the button below opens a blank draft that you control.
        </Text>
        <Text selectable style={s.label}>
          {supportEmail}
        </Text>
        <Text style={s.muted}>
          Do not send passwords, verification codes, payment-card details, safe words, or the full
          text of a suspicious message.
        </Text>
        {emailError ? (
          <Text accessibilityRole="alert" style={s.error}>
            {emailError}
          </Text>
        ) : null}
        <SupportButton title="Open email app" onPress={() => void openSupportEmail()} />
      </View>
      <View style={s.card}>
        <Text style={s.heading}>Coverage and safety</Text>
        <Text style={s.body}>
          BoomerBuddy does not promise 24-hour or real-time support coverage. A receipt or email is
          not a guarantee that a person has seen it or will respond by a particular time. For an
          immediate threat, contact local emergency services.
        </Text>
      </View>
    </ScrollView>
  );
}
