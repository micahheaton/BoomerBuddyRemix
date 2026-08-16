import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import type { MeResponse, PrincipalDto } from '@boomerbuddy/contracts';
import { designTokens } from '@boomerbuddy/design';
import { mobileRequest } from './src/api';
import { MobileHouseholdProvider } from './src/household';
import type { RootStackParamList } from './src/navigation';
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
  OrientationScreen,
  ResultScreen,
  SignInScreen,
} from './src/screens';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [principal, setPrincipal] = useState<PrincipalDto>();
  const [restoring, setRestoring] = useState(true);

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
                {(props) => <HomeScreen {...props} onSignOut={() => void signOut()} />}
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
            </>
          </Stack.Navigator>
        </MobileHouseholdProvider>
      )}
    </NavigationContainer>
  );
}
