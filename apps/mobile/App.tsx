import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ClerkProvider, useAuth, useSession } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { StatusBar } from 'expo-status-bar';
import type { MeResponse, PrincipalDto } from '@boomerbuddy/contracts';
import { designTokens } from '@boomerbuddy/design';
import { mobileRequest, readableError } from './src/api';
import {
  captureMobileAuthenticationContext,
  configureMobileAuthentication,
  isMobileAuthenticationContextCurrent,
  readCurrentMobileAuthenticationToken,
} from './src/authentication';
import { MobileHouseholdProvider } from './src/household';
import { FamilySafeWordScreen } from './src/family-safe-word-screen';
import { MemberLearningScreen } from './src/member-learning-screen';
import { clearMobileMemberLearningPendingOperations } from './src/member-learning-idempotency';
import {
  classifyNativeEntryUrl,
  type NativeEntrySignal,
  type RootStackParamList,
} from './src/navigation';
import {
  AccessibilityScreen,
  AccountDeletionScreen,
  HelpPoliciesScreen,
  PrivacyScreen,
  TermsScreen,
} from './src/policy-screens';
import {
  beginMobileHouseholdSession,
  clearPendingMobileSignOut,
  clearLegacyDevelopmentSessionToken,
  clearMobileDeviceState,
  endMobileHouseholdSession,
  isMobileSignOutPending,
  isMobileHouseholdSessionCurrent,
  markPendingMobileSignOut,
  readPendingMobileSignOut,
  restoreSelectedHouseholdId,
  setSelectedHouseholdId,
  type MobileHouseholdSession,
} from './src/session';
import {
  beginMobileSignOutAttempt,
  classifyMobileSignOutInspection,
  clearMobilePrivateDeviceState,
  completeMobileSignOut,
  createMobileSignOutAttemptGate,
  mobileProviderStateSettleTimeoutMs,
  planMobileSignOut,
  shouldUseProviderWideMobileSignOut,
  type MobileSignOutOutcome,
} from './src/sign-out';
import { SupportScreen } from './src/support-screen';
import { appStyles } from './src/theme';
import {
  disableWeeklyRehearsalReminder,
  prepareWeeklyReminderBoundary,
} from './src/weekly-rehearsal-reminder';
import {
  CheckScreen,
  FamilyScreen,
  HistoryScreen,
  HomeScreen,
  NativeProofScreen,
  OrientationScreen,
  ProtectedAccessScreen,
  ResultScreen,
  SessionRecoveryScreen,
  SignInScreen,
} from './src/screens';

const Stack = createNativeStackNavigator<RootStackParamList>();
const mobileJwtTemplate = 'boomerbuddy-mobile';

declare const process: { env: { EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?: string } };
declare const __DEV__: boolean;

function requirePublishableKey(): string {
  const value = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  if (!value?.startsWith('pk_')) {
    throw new Error('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required for mobile authentication.');
  }
  if (!__DEV__ && !value.startsWith('pk_live_')) {
    throw new Error('Production mobile builds require a live Clerk publishable key.');
  }
  return value;
}

const publishableKey = requirePublishableKey();

async function clearPrivateDeviceState(
  householdSession?: MobileHouseholdSession,
): Promise<boolean> {
  return clearMobilePrivateDeviceState({
    clearWeeklyReminder: async () => {
      const reminder = await disableWeeklyRehearsalReminder();
      if (reminder.state === 'error') throw new Error('Weekly reminder cleanup failed');
    },
    clearPendingLearningOperations: clearMobileMemberLearningPendingOperations,
    clearHouseholdState: () => clearMobileDeviceState(householdSession),
  });
}

type RestoredMobileSession = {
  identitySessionId: string;
  householdSession: MobileHouseholdSession;
  principal: PrincipalDto;
};

type MobileSignOutTarget = Readonly<{
  identitySessionId?: string;
  householdSession?: MobileHouseholdSession;
}>;

type MobileSignOutState = Readonly<{
  status: 'pending' | 'awaiting_provider_state' | 'retry_required';
  target: MobileSignOutTarget;
}>;

type PendingSignOutInspection = Readonly<{
  authenticationKey: string;
  status: 'none' | 'pending' | 'unavailable';
}>;

function MobileApplication(): React.ReactElement {
  const { isLoaded, isSignedIn, sessionId, signOut: clerkSignOut } = useAuth();
  const { session: clerkSession } = useSession();
  const [restoredSession, setRestoredSession] = useState<RestoredMobileSession>();
  const [restoring, setRestoring] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [nativeEntry, setNativeEntry] = useState<NativeEntrySignal>('none');
  const [pendingSignOutInspection, setPendingSignOutInspection] =
    useState<PendingSignOutInspection>();
  const [signOutState, setSignOutState] = useState<MobileSignOutState>();
  const householdSessionRef = useRef<MobileHouseholdSession | undefined>(undefined);
  const signOutStateRef = useRef<MobileSignOutState | undefined>(undefined);
  const [signOutAttemptGate] = useState(createMobileSignOutAttemptGate);
  const authenticationKey = `${isSignedIn ? 'signed-in' : 'signed-out'}:${sessionId ?? ''}`;

  useEffect(() => {
    void prepareWeeklyReminderBoundary().catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    const observe = (url: string) => {
      const signal = classifyNativeEntryUrl(url);
      if (active && signal !== 'none') setNativeEntry(signal);
    };
    void Linking.getInitialURL()
      .then((url) => {
        if (url) observe(url);
      })
      .catch(() => {
        // Native intake remains explicitly unverified when the OS cannot provide an initial URL.
      });
    const subscription = Linking.addEventListener('url', ({ url }) => observe(url));
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    let active = true;
    void readPendingMobileSignOut().then(async (pending) => {
      if (!active) return;
      const inspection = classifyMobileSignOutInspection({
        isSignedIn: Boolean(isSignedIn),
        pendingStatus: pending.status,
        hasActiveSignOut: signOutStateRef.current !== undefined,
      });
      if (inspection === 'clear') {
        if (pending.status === 'pending') {
          await clearPendingMobileSignOut(pending.identitySessionId);
        }
        if (!active) return;
        signOutStateRef.current = undefined;
        setSignOutState(undefined);
        setSessionError('');
        setPendingSignOutInspection({ authenticationKey, status: 'none' });
        return;
      }
      if (inspection === 'restore_allowed') {
        setPendingSignOutInspection({ authenticationKey, status: 'none' });
        return;
      }

      const target: MobileSignOutTarget =
        signOutStateRef.current?.target ??
        (pending.status === 'pending'
          ? { identitySessionId: pending.identitySessionId }
          : sessionId
            ? { identitySessionId: sessionId }
            : {});
      const next: MobileSignOutState = { status: 'retry_required', target };
      signOutStateRef.current = next;
      endMobileHouseholdSession();
      householdSessionRef.current = undefined;
      setRestoredSession(undefined);
      setRestoring(false);
      setSessionError(
        pending.status === 'pending'
          ? 'Secure sign out still needs to finish. Your member area remains closed. Try sign out again when you have a connection.'
          : pending.status === 'unavailable'
            ? 'BoomerBuddy could not check whether secure sign out finished. Your member area remains closed. Try sign out again.'
            : 'The identity session changed before secure sign out was confirmed. Your member area remains closed. Try sign out again.',
      );
      setSignOutState(next);
      setPendingSignOutInspection({ authenticationKey, status: pending.status });
    });
    return () => {
      active = false;
    };
  }, [authenticationKey, isLoaded, isSignedIn, sessionId]);

  useEffect(() => {
    if (signOutState?.status !== 'awaiting_provider_state') return;
    const observedState = signOutState;
    const timeout = setTimeout(() => {
      if (signOutStateRef.current !== observedState) return;
      const retry: MobileSignOutState = {
        status: 'retry_required',
        target: observedState.target,
      };
      signOutStateRef.current = retry;
      setSignOutState(retry);
      setSessionError(
        'Secure sign out was accepted, but the identity session is still present on this device. Your member area remains closed. Try sign out again.',
      );
    }, mobileProviderStateSettleTimeoutMs);
    return () => clearTimeout(timeout);
  }, [signOutState]);

  useEffect(() => {
    let active = true;
    let householdSession: MobileHouseholdSession | undefined;
    const restoreController = new AbortController();
    const isCurrent = (): boolean =>
      active && householdSession !== undefined && isMobileHouseholdSessionCurrent(householdSession);

    async function restoreSession() {
      if (!isLoaded) return;
      if (
        pendingSignOutInspection?.authenticationKey !== authenticationKey ||
        pendingSignOutInspection.status !== 'none' ||
        signOutStateRef.current !== undefined
      ) {
        return;
      }
      if (!isSignedIn) {
        // A device-keystore failure must not strand a signed-out user on the restore screen.
        // Every private device-state category is retried, and the in-memory household selection
        // is cleared before persisted household cleanup is attempted.
        await clearPrivateDeviceState();
        if (active) {
          setRestoredSession(undefined);
          setSessionError('');
          setRestoring(false);
        }
        return;
      }
      if (!sessionId) {
        endMobileHouseholdSession();
        if (active) {
          setRestoredSession(undefined);
          setSessionError(
            'Your identity session could not be verified. Sign in again to continue.',
          );
          setRestoring(false);
        }
        return;
      }
      householdSession = beginMobileHouseholdSession(sessionId);
      householdSessionRef.current = householdSession;
      setRestoredSession(undefined);
      setRestoring(true);
      setSessionError('');
      try {
        await clearLegacyDevelopmentSessionToken();
        if (!isCurrent()) return;
        const response = await mobileRequest<MeResponse>('/v1/me', {
          signal: restoreController.signal,
        });
        if (!isCurrent()) return;
        const stored = await restoreSelectedHouseholdId(
          householdSession,
          response.principal.personId,
        );
        if (!isCurrent()) return;
        const selected =
          response.principal.households.find((scope) => scope.id === stored)?.id ??
          response.principal.households[0]?.id ??
          null;
        await setSelectedHouseholdId(householdSession, response.principal.personId, selected);
        if (!isCurrent()) return;
        setRestoredSession({
          identitySessionId: sessionId,
          householdSession,
          principal: response.principal,
        });
      } catch (error) {
        if (isCurrent()) {
          setRestoredSession(undefined);
          setSessionError(readableError(error));
        }
      } finally {
        if (isCurrent()) setRestoring(false);
      }
    }
    void restoreSession();
    return () => {
      active = false;
      restoreController.abort();
      if (householdSession) {
        if (householdSessionRef.current === householdSession) {
          householdSessionRef.current = undefined;
        }
        endMobileHouseholdSession(householdSession);
      }
    };
  }, [
    authenticationKey,
    isLoaded,
    isSignedIn,
    pendingSignOutInspection,
    restoreAttempt,
    sessionId,
  ]);

  const activeRestoredSession =
    isSignedIn && sessionId && restoredSession?.identitySessionId === sessionId
      ? restoredSession
      : undefined;
  const principal = activeRestoredSession?.principal;

  const runMobileSignOut = useCallback(
    (target: MobileSignOutTarget, attemptApiRevoke: boolean): Promise<MobileSignOutOutcome> => {
      const pending: MobileSignOutState = { status: 'pending', target };
      return beginMobileSignOutAttempt({
        gate: signOutAttemptGate,
        closePrivateAccess: () => {
          signOutStateRef.current = pending;
          setSignOutState(pending);
          setRestoredSession(undefined);
          setRestoring(false);
          setSessionError('');
        },
        operation: async () => {
          const identitySessionId = target.identitySessionId;
          const householdSession = target.householdSession;
          const authenticationContext = captureMobileAuthenticationContext();
          const markerPersisted = identitySessionId
            ? await markPendingMobileSignOut(identitySessionId)
            : false;
          const providerWideSignOut = shouldUseProviderWideMobileSignOut({
            markerPersisted,
            ...(identitySessionId ? { targetIdentitySessionId: identitySessionId } : {}),
            ...(sessionId ? { currentIdentitySessionId: sessionId } : {}),
          });
          if (
            attemptApiRevoke &&
            identitySessionId &&
            householdSession &&
            isMobileHouseholdSessionCurrent(householdSession)
          ) {
            try {
              await mobileRequest('/v1/sessions/current', {
                method: 'DELETE',
                authenticationPurpose: 'session_sign_out',
              });
            } catch {
              /* The pending marker and provider sign-out still fail closed. */
            }
          }
          const outcome = await completeMobileSignOut({
            clearDeviceState: async () => {
              const cleared = await clearPrivateDeviceState(
                householdSession && isMobileHouseholdSessionCurrent(householdSession)
                  ? householdSession
                  : undefined,
              );
              if (!cleared) throw new Error('Private device-state cleanup failed');
            },
            signOutIdentitySession: () =>
              providerWideSignOut || !identitySessionId
                ? clerkSignOut()
                : clerkSignOut({ sessionId: identitySessionId }),
          });
          if (
            signOutStateRef.current?.target !== target ||
            !isMobileAuthenticationContextCurrent(authenticationContext)
          ) {
            return outcome;
          }
          if (outcome === 'complete') {
            const complete: MobileSignOutState = { status: 'awaiting_provider_state', target };
            signOutStateRef.current = complete;
            setSignOutState(complete);
            setSessionError('');
          } else {
            const retry: MobileSignOutState = { status: 'retry_required', target };
            signOutStateRef.current = retry;
            setSignOutState(retry);
            setSessionError(
              'We could not finish secure sign out. Your member area remains closed. Check your connection and try sign out again.',
            );
          }
          return outcome;
        },
      });
    },
    [clerkSignOut, sessionId, signOutAttemptGate],
  );

  useEffect(() => {
    const identitySessionId = isSignedIn && sessionId ? sessionId : undefined;
    const identitySession =
      identitySessionId && clerkSession?.id === identitySessionId ? clerkSession : undefined;
    const householdSession =
      identitySessionId &&
      householdSessionRef.current?.identitySessionId === identitySessionId &&
      isMobileHouseholdSessionCurrent(householdSessionRef.current)
        ? householdSessionRef.current
        : undefined;
    return configureMobileAuthentication({
      getToken: (request) =>
        readCurrentMobileAuthenticationToken({
          isCurrent: () =>
            Boolean(
              identitySession &&
              householdSession &&
              isMobileHouseholdSessionCurrent(householdSession) &&
              (!isMobileSignOutPending() || request?.purpose === 'session_sign_out'),
            ),
          readToken: () =>
            identitySession
              ? identitySession.getToken({
                  template: mobileJwtTemplate,
                  ...(request?.skipCache ? { skipCache: true } : {}),
                })
              : Promise.resolve(null),
        }),
      recoverUnauthorizedSession: async (guard) => {
        if (
          !identitySessionId ||
          !householdSession ||
          !guard.isCurrent() ||
          signOutAttemptGate.isActive()
        ) {
          return;
        }
        await runMobileSignOut({ identitySessionId, householdSession }, false);
      },
    });
  }, [
    clerkSession,
    isLoaded,
    isSignedIn,
    restoreAttempt,
    runMobileSignOut,
    sessionId,
    signOutAttemptGate,
  ]);

  function signOut() {
    const existingTarget = signOutStateRef.current?.target;
    const plan = planMobileSignOut({
      isSignedIn: Boolean(isSignedIn),
      ...(existingTarget?.identitySessionId
        ? { pendingIdentitySessionId: existingTarget.identitySessionId }
        : {}),
      ...(sessionId ? { currentIdentitySessionId: sessionId } : {}),
      ...(activeRestoredSession
        ? { restoredIdentitySessionId: activeRestoredSession.identitySessionId }
        : {}),
    });
    if (!plan.shouldSignOut) return;
    const identitySessionId = plan.identitySessionId;
    const currentHouseholdSession =
      activeRestoredSession?.householdSession ??
      (householdSessionRef.current && isMobileHouseholdSessionCurrent(householdSessionRef.current)
        ? householdSessionRef.current
        : undefined);
    const target: MobileSignOutTarget = existingTarget ?? {
      ...(identitySessionId ? { identitySessionId } : {}),
      ...(currentHouseholdSession ? { householdSession: currentHouseholdSession } : {}),
    };
    void runMobileSignOut(target, existingTarget === undefined);
  }

  if (signOutState?.status === 'pending' || signOutState?.status === 'awaiting_provider_state') {
    return (
      <View style={[appStyles.safe, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator accessibilityLabel="Signing out securely" size="large" />
        <Text style={appStyles.body}>
          {signOutState.status === 'pending'
            ? 'Signing out securely…'
            : 'Secure sign out finished. Closing the previous session…'}
        </Text>
      </View>
    );
  }

  if (!isLoaded || restoring)
    return (
      <View style={[appStyles.safe, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator accessibilityLabel="Restoring secure session" size="large" />
        <Text style={appStyles.body}>Restoring secure session…</Text>
      </View>
    );

  if (isSignedIn && !principal && sessionError) {
    return (
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{
            headerBackTitle: 'Back',
            headerStyle: { backgroundColor: designTokens.colors.primaryHover },
            headerTintColor: designTokens.colors.onPrimary,
            headerTitleStyle: { fontWeight: '700' },
          }}
        >
          <Stack.Screen name="SessionRecovery" options={{ title: 'Account recovery' }}>
            {(props) => (
              <SessionRecoveryScreen
                {...props}
                message={sessionError}
                onRetry={() =>
                  signOutState?.status === 'retry_required'
                    ? signOut()
                    : setRestoreAttempt((attempt) => attempt + 1)
                }
                onSignOut={() => void signOut()}
              />
            )}
          </Stack.Screen>
          <Stack.Screen
            name="HelpPolicies"
            component={HelpPoliciesScreen}
            options={{ title: 'Help and policies' }}
          />
          <Stack.Screen name="Support" component={SupportScreen} options={{ title: 'Support' }} />
          <Stack.Screen name="Privacy" component={PrivacyScreen} options={{ title: 'Privacy' }} />
          <Stack.Screen name="Terms" component={TermsScreen} options={{ title: 'Terms' }} />
          <Stack.Screen
            name="Accessibility"
            component={AccessibilityScreen}
            options={{ title: 'Accessibility' }}
          />
          <Stack.Screen
            name="AccountDeletion"
            component={AccountDeletionScreen}
            options={{ title: 'Account deletion' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      {!activeRestoredSession ? (
        <Stack.Navigator
          screenOptions={{
            headerBackTitle: 'Back',
            headerStyle: { backgroundColor: designTokens.colors.primaryHover },
            headerTintColor: designTokens.colors.onPrimary,
            headerTitleStyle: { fontWeight: '700' },
          }}
        >
          <Stack.Screen name="SignIn" component={SignInScreen} options={{ title: 'BoomerBuddy' }} />
          <Stack.Screen
            name="HelpPolicies"
            component={HelpPoliciesScreen}
            options={{ title: 'Help and policies' }}
          />
          <Stack.Screen name="Support" component={SupportScreen} options={{ title: 'Support' }} />
          <Stack.Screen name="Privacy" component={PrivacyScreen} options={{ title: 'Privacy' }} />
          <Stack.Screen name="Terms" component={TermsScreen} options={{ title: 'Terms' }} />
          <Stack.Screen
            name="Accessibility"
            component={AccessibilityScreen}
            options={{ title: 'Accessibility' }}
          />
          <Stack.Screen
            name="AccountDeletion"
            component={AccountDeletionScreen}
            options={{ title: 'Account deletion' }}
          />
        </Stack.Navigator>
      ) : (
        <MobileHouseholdProvider
          householdSession={activeRestoredSession.householdSession}
          principal={activeRestoredSession.principal}
          onPrincipalChanged={(nextPrincipal) => {
            if (!isMobileHouseholdSessionCurrent(activeRestoredSession.householdSession)) return;
            setRestoredSession((current) =>
              current?.householdSession.generation ===
              activeRestoredSession.householdSession.generation
                ? { ...current, principal: nextPrincipal }
                : current,
            );
          }}
        >
          <Stack.Navigator
            screenOptions={{
              headerBackTitle: 'Back',
              headerStyle: { backgroundColor: designTokens.colors.primaryHover },
              headerTintColor: designTokens.colors.onPrimary,
              headerTitleStyle: { fontWeight: '700' },
            }}
          >
            <>
              <Stack.Screen name="Home" options={{ title: 'BoomerBuddy' }}>
                {(props) => (
                  <HomeScreen
                    {...props}
                    nativeEntrySignal={nativeEntry}
                    onNativeEntryHandled={() => setNativeEntry('none')}
                    onSignOut={() => void signOut()}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="Check" component={CheckScreen} options={{ title: 'Check' }} />
              <Stack.Screen name="Result" component={ResultScreen} options={{ title: 'Result' }} />
              <Stack.Screen
                name="History"
                component={HistoryScreen}
                options={{ title: 'History' }}
              />
              <Stack.Screen name="Family" options={{ title: 'Family' }}>
                {(props) => <FamilyScreen {...props} />}
              </Stack.Screen>
              <Stack.Screen
                name="FamilySafeWord"
                component={FamilySafeWordScreen}
                options={{ title: 'Family verification aid' }}
              />
              <Stack.Screen
                name="ProtectedAccess"
                component={ProtectedAccessScreen}
                options={{ title: 'Protected access' }}
              />
              <Stack.Screen
                name="Orientation"
                component={OrientationScreen}
                options={{ title: 'Orientation' }}
              />
              <Stack.Screen
                name="LearnUpdates"
                component={MemberLearningScreen}
                options={{ title: 'Learn and updates' }}
              />
              <Stack.Screen
                name="HelpPolicies"
                component={HelpPoliciesScreen}
                options={{ title: 'Help and policies' }}
              />
              <Stack.Screen
                name="Support"
                component={SupportScreen}
                options={{ title: 'Support' }}
              />
              <Stack.Screen
                name="Privacy"
                component={PrivacyScreen}
                options={{ title: 'Privacy' }}
              />
              <Stack.Screen name="Terms" component={TermsScreen} options={{ title: 'Terms' }} />
              <Stack.Screen
                name="Accessibility"
                component={AccessibilityScreen}
                options={{ title: 'Accessibility' }}
              />
              <Stack.Screen
                name="AccountDeletion"
                component={AccountDeletionScreen}
                options={{ title: 'Account deletion' }}
              />
              {__DEV__ ? (
                <Stack.Screen
                  name="NativeProof"
                  component={NativeProofScreen}
                  options={{ title: 'Native proof' }}
                />
              ) : null}
            </>
          </Stack.Navigator>
        </MobileHouseholdProvider>
      )}
    </NavigationContainer>
  );
}

export default function App(): React.ReactElement {
  return (
    <ClerkProvider publishableKey={publishableKey} {...(tokenCache ? { tokenCache } : {})}>
      <MobileApplication />
    </ClerkProvider>
  );
}
