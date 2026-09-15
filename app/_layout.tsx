import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts as useInterFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import {
  useFonts as usePlayfairFonts,
  PlayfairDisplay_600SemiBold,
} from '@expo-google-fonts/playfair-display';
import { AuthProvider } from '../src/context/AuthContext';
import { StaffProvider, useStaff } from '../src/context/StaffContext';
import { CompanySettingsProvider } from '../src/context/CompanySettingsContext';
import { NotificationProvider } from '../src/context/NotificationContext';
import { colors } from '../src/theme';
import MoonToJewelSplash from '../src/components/MoonToJewelSplash';

SplashScreen.preventAutoHideAsync().catch(() => {});

const PUBLIC_ROUTES = ['login', 'forgot-password', 'reset-password'];

function RouteGuard({ children }: { children: React.ReactNode }) {
  const { currentStaff, loading: staffLoading } = useStaff();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (staffLoading) return;

    const onPublicRoute = segments.some((s) => PUBLIC_ROUTES.includes(s));

    if (!currentStaff && !onPublicRoute) {
      router.replace('/login');
    } else if (currentStaff && onPublicRoute) {
      router.replace('/');
    }
  }, [currentStaff, staffLoading, segments]);

  if (staffLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  const [interLoaded] = useInterFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  const [playfairLoaded] = usePlayfairFonts({ PlayfairDisplay_600SemiBold });
  const [introDone, setIntroDone] = useState(false);

  const fontsReady = interLoaded && playfairLoaded;

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  if (!introDone) {
    return (
      <SafeAreaProvider>
        <MoonToJewelSplash
          backgroundColor="#0B3D91"
          onFinish={() => setIntroDone(true)}
        />
      </SafeAreaProvider>
    );
  }

  if (!fontsReady) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StaffProvider>
          <CompanySettingsProvider>
            <NotificationProvider>
              <RouteGuard>
                <StatusBar style="dark" translucent backgroundColor="transparent" />
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="login" />
                  <Stack.Screen name="forgot-password" />
                  <Stack.Screen name="reset-password" />
                </Stack>
              </RouteGuard>
            </NotificationProvider>
          </CompanySettingsProvider>
        </StaffProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}