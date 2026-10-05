// app/_layout.tsx
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
import {
  CompanySettingsProvider,
  useCompanySettings,
} from '../src/context/CompanySettingsContext';
import { NotificationProvider } from '../src/context/NotificationContext';
import { colors } from '../src/theme';
import MoonToJewelSplash from '../src/components/MoonToJewelSplash';
import { supabase } from '../src/lib/supabaseClient';

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
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return <>{children}</>;
}

/**
 * Renders the branded intro, but only once company settings have actually
 * loaded. While they're still loading we render a solid colour screen so
 * the user doesn't see the intro animate in with the wrong brand name.
 */
function IntroGate({ onFinish }: { onFinish: () => void }) {
  const { settings, loading } = useCompanySettings();

  // If your context doesn't expose `loading`, swap this line for the
  // truthiness check below instead:
  //
  //   if (!settings) return <View style={{ flex: 1, backgroundColor: '#0B3D91' }} />;
  //
  if (loading) {
    return <View style={{ flex: 1, backgroundColor: '#0B3D91' }} />;
  }

  return (
    <MoonToJewelSplash
      backgroundColor="#0B3D91"
      onFinish={onFinish}
    />
  );
}

export default function RootLayout() {
  const [interLoaded] = useInterFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  const [playfairLoaded] = usePlayfairFonts({ PlayfairDisplay_600SemiBold });
  const [introDone, setIntroDone] = useState(false);

  const fontsReady = interLoaded && playfairLoaded;

  // Warm up DNS/TLS/auth while the intro splash plays.
  useEffect(() => {
    supabase
      .from('invoices')
      .select('id')
      .limit(1)
      .then(() => {})
      .catch(() => {});
  }, []);

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // Fonts still loading — hold the OS splash. This is the shortest path
  // and keeps the native splash up until we're actually ready to draw.
  if (!fontsReady) {
    return (
      <SafeAreaProvider>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.background,
          }}
        >
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
              {/* The intro lives INSIDE the provider tree, so
                  `useCompanySettings()` resolves correctly. It also
                  waits for settings to load before starting. */}
              {!introDone ? (
                <IntroGate onFinish={() => setIntroDone(true)} />
              ) : (
                <RouteGuard>
                  <StatusBar style="dark" translucent backgroundColor="transparent" />
                  <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="login" />
                    <Stack.Screen name="forgot-password" />
                    <Stack.Screen name="reset-password" />
                  </Stack>
                </RouteGuard>
              )}
            </NotificationProvider>
          </CompanySettingsProvider>
        </StaffProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}