import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import type { MeResponse, PrincipalDto } from '@boomerbuddy/contracts';
import { designTokens } from '@boomerbuddy/design';
import { mobileRequest } from './src/api';
import { MobileHouseholdProvider } from './src/household';
import type { NativeEntrySignal, RootStackParamList } from './src/navigation';
import {
  clearSessionToken,
  readSessionToken,
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
  SignInScreen,
} from './src/screens';

const Stack = createNativeStackNavigator<RootStackParamList>();

function nativeEntrySignal(url: string): NativeEntrySignal {
  if (/^boomerbuddy-local:\/\/check\/?$/u.test(url)) return 'route_only_check';
  if (url.startsWith('boomerbuddy-local://check')) return 'rejected_payload';
  return 'none';
}

export default function App() {
  const [principal, setPrincipal] = useState<PrincipalDto>();
  const [restoring, setRestoring] = useState(true);
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
    let active = true;
    async function restoreSession() {
      try {
        const token = await readSessionToken();
        if (!token) {
          await setSelectedHouseholdId(null);
          return;
        }
        await restoreSelectedHouseholdId();
        const response = await mobileRequest<MeResponse>('/v1/me');
        const stored = readSelectedHouseholdId();
        const selected =
          response.principal.households.find((scope) => scope.id === stored)?.id ??
          response.principal.households[0]?.id ??
          null;
        await setSelectedHouseholdId(selected);
        if (active) setPrincipal(response.principal);
      } catch {
        await clearSessionToken();
      } finally {
        if (active) setRestoring(false);
      }
    }
    void restoreSession();
    return () => {
      active = false;
    };
  }, []);

  async function signOut() {
    try {
      await mobileRequest('/v1/sessions/current', { method: 'DELETE' });
    } catch {
      /* Local token cleanup still completes. */
    }
    await clearSessionToken();
    setPrincipal(undefined);
  }

  if (restoring)
    return (
      <View style={[appStyles.safe, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator accessibilityLabel="Restoring local session" size="large" />
        <Text style={appStyles.body}>Restoring local session…</Text>
      </View>
    );

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      {!principal ? (
        <Stack.Navigator
          screenOptions={{
            headerBackTitle: 'Back',
            headerStyle: { backgroundColor: designTokens.colors.primaryHover },
            headerTintColor: designTokens.colors.onPrimary,
            headerTitleStyle: { fontWeight: '700' },
          }}
        >
          <Stack.Screen name="SignIn" options={{ title: 'BoomerBuddy' }}>
            {(props) => <SignInScreen {...props} onSignedIn={setPrincipal} />}
          </Stack.Screen>
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
