// app/(tabs)/_layout.tsx

import { memo, useEffect, useMemo } from 'react';
import { Tabs, useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWindowDimensions, View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '../../src/theme';
import { AppHeader } from '../../src/components/AppHeader';
import { useStaff } from '../../src/context/StaffContext';
import type { PageKey } from '../../src/types/settings';
import DailyRatePrompt from '../../src/components/DailyRatePrompt';

const ACTIVE_COLOR = '#1E3A8A';
const DESKTOP_BREAKPOINT = 768;
const SIDEBAR_WIDTH = 240;
const BAR_CONTENT_HEIGHT = 60; // was 52: more room so icon + label never clip
const BAR_MIN_BOTTOM_PADDING = 10; // keeps labels clear of the Android nav bar

type IconName = keyof typeof Ionicons.glyphMap;

interface NavItemConfig {
  name: string;
  route: string;
  title: string; // used by the desktop sidebar
  tabLabel: string; // short label used by the mobile bottom bar
  pageKey: PageKey;
  iconActive: IconName;
  iconInactive: IconName;
}

const NAV_ITEMS: NavItemConfig[] = [
  { name: 'index', route: '/', title: 'Dashboard', tabLabel: 'Dashboard', pageKey: 'dashboard', iconActive: 'grid', iconInactive: 'grid-outline' },
  { name: 'customers', route: '/customers', title: 'Customers', tabLabel: 'Customers', pageKey: 'customers', iconActive: 'people', iconInactive: 'people-outline' },
  { name: 'products', route: '/products', title: 'Products', tabLabel: 'Products', pageKey: 'products', iconActive: 'cube', iconInactive: 'cube-outline' },
  { name: 'invoices', route: '/invoices', title: 'Invoices', tabLabel: 'Invoices', pageKey: 'invoices', iconActive: 'document-text', iconInactive: 'document-text-outline' },
  { name: 'settings', route: '/settings', title: 'Settings', tabLabel: 'Settings', pageKey: 'settings', iconActive: 'settings', iconInactive: 'settings-outline' },
];

function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  return <Ionicons name={name} size={22} color={focused ? ACTIVE_COLOR : colors.textMuted} />;
}

// Bottom-bar label: single line, never truncated, ignores the phone's font-size
// setting so 5 tabs always fit on small screens.
function TabLabel({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text
      numberOfLines={1}
      allowFontScaling={false}
      style={[
        styles.tabLabel,
        { color: focused ? ACTIVE_COLOR : colors.textMuted },
        focused && styles.tabLabelActive,
      ]}
    >
      {label}
    </Text>
  );
}

// Custom vertical sidebar for desktop view.
// usePathname lives HERE so only the sidebar re-renders on navigation.
const DesktopSidebar = memo(function DesktopSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { hasAccess } = useStaff();

  const visibleItems = NAV_ITEMS.filter((item) => hasAccess(item.pageKey));

  return (
    <View style={[styles.sidebar, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.brandContainer} />
      <View style={styles.navMenu}>
        {visibleItems.map((item) => {
          const isFocused =
            item.name === 'index'
              ? pathname === '/' || pathname === '/index'
              : pathname.includes(item.name);

          return (
            <Pressable
              key={item.name}
              onPress={() => router.navigate(item.route as any)}
              style={({ hovered }: any) => [
                styles.navItem,
                isFocused && styles.navItemActive,
                hovered && !isFocused && styles.navItemHovered,
              ]}
            >
              <Ionicons
                name={isFocused ? item.iconActive : item.iconInactive}
                size={20}
                color={isFocused ? ACTIVE_COLOR : colors.textMuted}
              />
              <Text
                style={[
                  styles.navItemLabel,
                  { color: isFocused ? ACTIVE_COLOR : colors.textMuted },
                  isFocused && styles.navItemLabelActive,
                ]}
              >
                {item.title}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});

// Isolated redirect: it re-renders on navigation, but the Tabs navigator doesn't.
function DashboardRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  const { hasAccess, currentStaff } = useStaff();

  useEffect(() => {
    if (!currentStaff) return;
    const onDashboard = pathname === '/' || pathname === '/index';
    if (onDashboard && !hasAccess('dashboard')) {
      const firstAllowed = NAV_ITEMS.find((item) => hasAccess(item.pageKey));
      if (firstAllowed && firstAllowed.route !== '/') {
        router.replace(firstAllowed.route as any);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStaff, pathname]);

  return null;
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { hasAccess, currentStaff } = useStaff();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const bottomPadding = Math.max(insets.bottom, BAR_MIN_BOTTOM_PADDING);

  // "10110"-style string: changes only when permissions actually change,
  // so the screen list below isn't rebuilt on unrelated re-renders.
  const accessKey = NAV_ITEMS.map((i) => (hasAccess(i.pageKey) ? '1' : '0')).join('');

  const screenOptions = useMemo(
    () => ({
      headerShown: false, // AppHeader is rendered once, above the Tabs
      freezeOnBlur: true, // don't re-render hidden tabs
      tabBarHideOnKeyboard: true, // bar no longer jumps above the keyboard
      tabBarActiveTintColor: ACTIVE_COLOR,
      tabBarInactiveTintColor: colors.textMuted,
      tabBarStyle: isDesktop
        ? { display: 'none' as const }
        : {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            height: BAR_CONTENT_HEIGHT + bottomPadding,
            paddingBottom: bottomPadding,
            paddingTop: 8,
            paddingHorizontal: 0,
            elevation: 0,
            shadowOpacity: 0,
          },
      // equal-width tabs, no side padding, so labels get the full 1/5 of the width
      tabBarItemStyle: {
        paddingHorizontal: 0,
        paddingVertical: 0,
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
      },
      tabBarIconStyle: { marginBottom: 2 },
    }),
    [isDesktop, bottomPadding]
  );

  const screens = useMemo(
    () =>
      NAV_ITEMS.map((item, index) => (
        <Tabs.Screen
          key={item.name}
          name={item.name}
          options={{
            title: item.title,
            // null removes the tab button; undefined keeps the default
            href: accessKey[index] === '1' ? undefined : null,
            tabBarLabel: ({ focused }) => <TabLabel label={item.tabLabel} focused={focused} />,
            tabBarIcon: ({ focused }) => (
              <TabIcon name={focused ? item.iconActive : item.iconInactive} focused={focused} />
            ),
          }}
        />
      )),
    [accessKey]
  );

  // Wait for staff data so tabs don't flicker (all hooks are above this line)
  if (!currentStaff) return null;

  return (
    <View style={styles.rootContainer}>
      {isDesktop && <DesktopSidebar />}
      <DashboardRedirect />

      <View style={styles.contentContainer}>
        <AppHeader />
        <View style={styles.tabsContainer}>
          <Tabs screenOptions={screenOptions}>{screens}</Tabs>
          <DailyRatePrompt />
        </View>
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.background || '#F8FAFC',
  },
  contentContainer: {
    flex: 1,
    height: '100%',
  },
  tabsContainer: {
    flex: 1,
  },
  sidebar: {
    width: SIDEBAR_WIDTH,
    backgroundColor: colors.surface || '#FFFFFF',
    borderRightWidth: 1,
    borderRightColor: colors.border || '#E2E8F0',
    paddingHorizontal: 12,
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    marginBottom: 24,
    gap: 12,
  },
  navMenu: { gap: 6 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    gap: 12,
  },
  navItemHovered: { backgroundColor: '#F1F5F9' },
  navItemActive: { backgroundColor: '#EEF2FF' },
  navItemLabel: { fontSize: 14, fontWeight: '500' },
  navItemLabelActive: { fontWeight: '700', color: ACTIVE_COLOR },
  tabLabel: {
    fontSize: 10.5,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 2,
  },
  tabLabelActive: { fontWeight: '700' },
});