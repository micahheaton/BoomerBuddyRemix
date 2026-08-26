import { useEffect, useRef, useState } from 'react';
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
} from './src/authentication';
import { MobileHouseholdProvider } from './src/household';
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
  clearLegacyDevelopmentSessionToken,
  clearMobileDeviceState,
  endMobileHouseholdSession,
  isMobileHouseholdSessionCurrent,
  restoreSelectedHouseholdId,
  setSelectedHouseholdId,
  type MobileHouseholdSession,
} from './src/session';
import { clearMobileDeviceStateSafely, completeMobileSignOut } from './src/sign-out';
import { SupportScreen } from './src/support-screen';
import { appStyles } from './src/theme';
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

type RestoredMobileSession = {
  identitySessionId: string;
  householdSession: MobileHouseholdSession;
  principal: PrincipalDto;
};

function MobileApplication(): React.ReactElement {
  const { isLoaded, isSignedIn, sessionId, signOut: clerkSignOut } = useAuth();
  const { session: clerkSession } = useSession();
  const [restoredSession, setRestoredSession] = useState<RestoredMobileSession>();
  const [restoring, setRestoring] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [nativeEntry, setNativeEntry] = useState<NativeEntrySignal>('none');
  const householdSessionRef = useRef<MobileHouseholdSession | undefined>(undefined);

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
    let active = true;
    let householdSession: MobileHouseholdSession | undefined;
    const restoreController = new AbortController();
    const isCurrent = (): boolean =>
      active && householdSession !== undefined && isMobileHouseholdSessionCurrent(householdSession);

    async function restoreSession() {
      if (!isLoaded) return;
      if (!isSignedIn) {
        // A device-keystore failure must not strand a signed-out user on the restore screen.
        // The in-memory household selection is cleared before persisted cleanup is attempted.
        await clearMobileDeviceStateSafely(clearMobileDeviceState);
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
  }, [isLoaded, isSignedIn, restoreAttempt, sessionId]);

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
      getToken: (request) => {
        if (!identitySession || !householdSession) return Promise.resolve(null);
        return identitySession.getToken({
          template: mobileJwtTemplate,
          ...(request?.skipCache ? { skipCache: true } : {}),
        });
      },
      recoverUnauthorizedSession: async (guard) => {
        if (!identitySessionId || !householdSession || !guard.isCurrent()) return;
        const outcome = await completeMobileSignOut({
          clearDeviceState: () =>
            guard.isCurrent() ? clearMobileDeviceState(householdSession) : Promise.resolve(),
          signOutIdentitySession: () =>
            guard.isCurrent() ? clerkSignOut({ sessionId: identitySessionId }) : Promise.resolve(),
        });
        if (!guard.isCurrent()) return;
        setRestoredSession(undefined);
        setSessionError(
          outcome === 'complete'
            ? ''
            : 'Your session ended, but secure sign out did not finish. Check your connection and try again.',
        );
      },
    });
  }, [clerkSession, clerkSignOut, isLoaded, isSignedIn, restoreAttempt, sessionId]);

  const activeRestoredSession =
    isSignedIn && sessionId && restoredSession?.identitySessionId === sessionId
      ? restoredSession
      : undefined;
  const principal = activeRestoredSession?.principal;

  async function signOut() {
    const identitySessionId = activeRestoredSession?.identitySessionId;
    const householdSession = activeRestoredSession?.householdSession;
    if (!identitySessionId || !householdSession) return;
    const authenticationContext = captureMobileAuthenticationContext();
    try {
      await mobileRequest('/v1/sessions/current', { method: 'DELETE' });
    } catch {
      /* Clerk sign-out and local preference cleanup still complete. */
    }
    if (!isMobileAuthenticationContextCurrent(authenticationContext)) return;
    const outcome = await completeMobileSignOut({
      clearDeviceState: () =>
        isMobileAuthenticationContextCurrent(authenticationContext)
          ? clearMobileDeviceState(householdSession)
          : Promise.resolve(),
      signOutIdentitySession: () =>
        isMobileAuthenticationContextCurrent(authenticationContext)
          ? clerkSignOut({ sessionId: identitySessionId })
          : Promise.resolve(),
    });
    if (!isMobileAuthenticationContextCurrent(authenticationContext)) return;
    setRestoredSession(undefined);
    setSessionError(
      outcome === 'complete'
        ? ''
        : 'We could not finish secure sign out. Check your connection and try again.',
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
                onRetry={() => setRestoreAttempt((attempt) => attempt + 1)}
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
