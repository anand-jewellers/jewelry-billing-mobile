// app/(tabs)/_layout.tsx

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tabs, useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useWindowDimensions,
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Platform,
} from 'react-native';
import { colors } from '../../src/theme';
import { AppHeader } from '../../src/components/AppHeader';
import { useStaff } from '../../src/context/StaffContext';
import type { PageKey } from '../../src/types/settings';
import DailyRatePrompt from '../../src/components/DailyRatePrompt';

const ACTIVE_COLOR = '#1E3A8A';
const DESKTOP_BREAKPOINT = 768;
const SIDEBAR_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 72;
const SIDEBAR_ANIM_MS = 180;
const HOVER_OUT_DELAY_MS = 150; // small delay so the bar never flickers
const SIDEBAR_STORAGE_KEY = 'sidebarPinned';
const BAR_CONTENT_HEIGHT = 60; // was 52: more room so icon + label never clip
const BAR_MIN_BOTTOM_PADDING = 10; // keeps labels clear of the Android nav bar

// Remember the pinned/collapsed choice on web
function readPinned(): boolean {
  if (Platform.OS !== 'web') return true;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function savePinned(value: boolean) {
  if (Platform.OS !== 'web') return;
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, value ? '1' : '0');
  } catch {}
}

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
// - Collapsed = icons only. Hovering opens it over the content, leaving closes it.
// - The pin button (visible only while the bar is open) keeps it open / collapsed
//   and is remembered on web. It sits INSIDE the bar, so it can't cause hover flicker.
// usePathname lives HERE so only the sidebar re-renders on navigation.
const DesktopSidebar = memo(function DesktopSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { hasAccess } = useStaff();

  const [pinned, setPinned] = useState(readPinned);
  const [hovered, setHovered] = useState(false);
  const expanded = pinned || hovered;

  // slot = space the sidebar takes in the layout (pushes content)
  // panel = the visible sidebar (floats over content while hover-expanded)
  const slotWidth = useRef(
    new Animated.Value(pinned ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH)
  ).current;
  const panelWidth = useRef(
    new Animated.Value(expanded ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH)
  ).current;

  useEffect(() => {
    Animated.timing(slotWidth, {
      toValue: pinned ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH,
      duration: SIDEBAR_ANIM_MS,
      useNativeDriver: false,
    }).start();
  }, [pinned, slotWidth]);

  useEffect(() => {
    Animated.timing(panelWidth, {
      toValue: expanded ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH,
      duration: SIDEBAR_ANIM_MS,
      useNativeDriver: false,
    }).start();
  }, [expanded, panelWidth]);

  // hover in = open immediately, hover out = close after a short delay
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearLeaveTimer = () => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  };
  const handleHoverIn = useCallback(() => {
    clearLeaveTimer();
    setHovered(true);
  }, []);
  const handleHoverOut = useCallback(() => {
    clearLeaveTimer();
    leaveTimer.current = setTimeout(() => setHovered(false), HOVER_OUT_DELAY_MS);
  }, []);
  useEffect(() => clearLeaveTimer, []);

  const toggle = useCallback(() => {
    const next = !pinned;
    setPinned(next);
    savePinned(next);
  }, [pinned]);

  // Web: use the browser's mouseenter / mouseleave. Unlike Pressable's hover,
  // these ignore the children, so moving onto the pin button or a nav item
  // never counts as "leaving" the sidebar.
  const hoverRef = useRef<any>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = hoverRef.current as HTMLElement | null;
    if (!el || typeof el.addEventListener !== 'function') return;
    el.addEventListener('mouseenter', handleHoverIn);
    el.addEventListener('mouseleave', handleHoverOut);
    return () => {
      el.removeEventListener('mouseenter', handleHoverIn);
      el.removeEventListener('mouseleave', handleHoverOut);
    };
  }, [handleHoverIn, handleHoverOut]);

  const visibleItems = NAV_ITEMS.filter((item) => hasAccess(item.pageKey));

  return (
    <Animated.View style={[styles.sidebarSlot, { width: slotWidth }]}>
      <Animated.View
        style={[styles.sidebar, { width: panelWidth }, !pinned && expanded && styles.sidebarFloating]}
      >
        <View
          ref={hoverRef}
          style={[
            styles.sidebarInner,
            { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 },
          ]}
        >
          {/* top row: pin / unpin button (only while the bar is open) */}
          <View style={styles.toggleRow}>
            {expanded && (
              <Pressable onPress={toggle} hitSlop={6} style={styles.toggleButton}>
                <Ionicons
                  name={pinned ? 'chevron-back' : 'chevron-forward'}
                  size={16}
                  color={colors.textMuted}
                />
              </Pressable>
            )}
          </View>

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
                  style={({ hovered: h }: any) => [
                    styles.navItem,
                    isFocused && styles.navItemActive,
                    h && !isFocused && styles.navItemHovered,
                  ]}
                >
                  <Ionicons
                    name={isFocused ? item.iconActive : item.iconInactive}
                    size={20}
                    color={isFocused ? ACTIVE_COLOR : colors.textMuted}
                  />
                  {expanded && (
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.navItemLabel,
                        { color: isFocused ? ACTIVE_COLOR : colors.textMuted },
                        isFocused && styles.navItemLabelActive,
                      ]}
                    >
                      {item.title}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Animated.View>
    </Animated.View>
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

// Forces the Customers stack back to [index], no matter what was opened
// inside it (orders, add, customer details, or a stack that was created with
// only "orders" in it). Works on any react-navigation version.
function resetCustomersStack(navigation: any) {
  const route = navigation.getState().routes.find((r: any) => r.name === 'customers');
  const stack = route?.state;
  if (!stack?.key) return; // stack not created yet, nothing to reset
  const alreadyOnList = stack.routes.length === 1 && stack.routes[0].name === 'index';
  if (alreadyOnList) return;
  navigation.dispatch({
    type: 'RESET',
    payload: { index: 0, routes: [{ name: 'index' }] },
    target: stack.key, // run the reset inside the Customers stack
  });
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
          listeners={
            item.name === 'customers'
              ? ({ navigation }: any) => ({
                  // leaving the Customers tab: reset it to the list
                  blur: () => resetCustomersStack(navigation),
                  // tapping Customers while already inside it (e.g. on Orders): reset too
                  // preventDefault stops the stack's own "pop to top" from running
                  // on top of our reset (that was causing the POP_TO_TOP error)
                  tabPress: (e: any) => {
                    if (navigation.isFocused()) {
                      e.preventDefault();
                      resetCustomersStack(navigation);
                    }
                  },
                })
              : undefined
          }
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

  // ---- Desktop sidebar ----
  sidebarSlot: {
    position: 'relative',
    zIndex: 20,
  },
  sidebar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden', // labels never spill while the width animates
    backgroundColor: colors.surface || '#FFFFFF',
    borderRightWidth: 1,
    borderRightColor: colors.border || '#E2E8F0',
  },
  sidebarFloating: {
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  sidebarInner: {
    flex: 1,
    width: SIDEBAR_WIDTH, // fixed inner width: content doesn't re-wrap while animating
  },
  toggleRow: {
    height: 28,
    marginBottom: 12,
    paddingHorizontal: 12,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  toggleButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border || '#E2E8F0',
    backgroundColor: colors.surface || '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navMenu: { gap: 6, paddingHorizontal: 12 },
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

  // ---- Mobile bottom bar ----
  tabLabel: {
    fontSize: 10.5,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 2,
  },
  tabLabelActive: { fontWeight: '700' },
});