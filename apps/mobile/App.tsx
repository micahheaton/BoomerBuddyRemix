import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { StatusBar } from 'expo-status-bar';
import type { MeResponse, PrincipalDto } from '@boomerbuddy/contracts';
import { designTokens } from '@boomerbuddy/design';
import { mobileRequest, readableError } from './src/api';
import { configureMobileAuthentication } from './src/authentication';
import { MobileHouseholdProvider } from './src/household';
import type { NativeEntrySignal, RootStackParamList } from './src/navigation';
import {
  AccessibilityScreen,
  AccountDeletionScreen,
  HelpPoliciesScreen,
  PrivacyScreen,
  SupportScreen,
  TermsScreen,
} from './src/policy-screens';
import {
  clearLegacyDevelopmentSessionToken,
  clearMobileDeviceState,
  readSelectedHouseholdId,
  restoreSelectedHouseholdId,
  setSelectedHouseholdId,
} from './src/session';
import { appStyles } from './src/theme';
import {
  CheckScreen,
  FamilyScreen,
  HistoryScreen,
  HomeScreen,
  NativeProofScreen,
  OrientationScreen,
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

function nativeEntrySignal(url: string): NativeEntrySignal {
  if (/^boomerbuddy:\/\/check\/?$/u.test(url)) return 'route_only_check';
  if (url.startsWith('boomerbuddy://check')) return 'rejected_payload';
  return 'none';
}

function MobileApplication(): React.ReactElement {
  const { getToken, isLoaded, isSignedIn, sessionId, signOut: clerkSignOut } = useAuth();
  const [principal, setPrincipal] = useState<PrincipalDto>();
  const [restoring, setRestoring] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [nativeEntry, setNativeEntry] = useState<NativeEntrySignal>('none');

  useEffect(() => {
    let active = true;
    const observe = (url: string) => {
      const signal = nativeEntrySignal(url);
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
    return configureMobileAuthentication({
      getToken: (request) =>
        getToken({
          template: mobileJwtTemplate,
          ...(request?.skipCache ? { skipCache: true } : {}),
        }),
      recoverUnauthorizedSession: async () => {
        await clearMobileDeviceState();
        setPrincipal(undefined);
        setSessionError('');
        await clerkSignOut();
      },
    });
  }, [clerkSignOut, getToken]);

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      if (!isLoaded) return;
      if (!isSignedIn) {
        await clearMobileDeviceState();
        if (active) {
          setPrincipal(undefined);
          setSessionError('');
          setRestoring(false);
        }
        return;
      }
      if (active) {
        setRestoring(true);
        setSessionError('');
      }
      try {
        await clearLegacyDevelopmentSessionToken();
        await restoreSelectedHouseholdId();
        const response = await mobileRequest<MeResponse>('/v1/me');
        const stored = readSelectedHouseholdId();
        const selected =
          response.principal.households.find((scope) => scope.id === stored)?.id ??
          response.principal.households[0]?.id ??
          null;
        await setSelectedHouseholdId(selected);
        if (active) setPrincipal(response.principal);
      } catch (error) {
        if (active) {
          setPrincipal(undefined);
          setSessionError(readableError(error));
        }
      } finally {
        if (active) setRestoring(false);
      }
    }
    void restoreSession();
    return () => {
      active = false;
    };
  }, [isLoaded, isSignedIn, restoreAttempt, sessionId]);

  async function signOut() {
    try {
      await mobileRequest('/v1/sessions/current', { method: 'DELETE' });
    } catch {
      /* Clerk sign-out and local preference cleanup still complete. */
    }
    await clearMobileDeviceState();
    await clerkSignOut();
    setPrincipal(undefined);
    setSessionError('');
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
      <SessionRecoveryScreen
        message={sessionError}
        onRetry={() => setRestoreAttempt((attempt) => attempt + 1)}
        onSignOut={() => void signOut()}
      />
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      {!isSignedIn || !principal ? (
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
        <MobileHouseholdProvider principal={principal} onPrincipalChanged={setPrincipal}>
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
