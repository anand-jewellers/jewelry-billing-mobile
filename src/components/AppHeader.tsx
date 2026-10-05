// src/components/AppHeader.tsx
import { memo, useCallback, useState } from 'react';
import { View, Text, Image, Pressable, Modal, StyleSheet, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { useCompanySettings } from '../context/CompanySettingsContext';
import { useStaff } from '../context/StaffContext';
import { useNotifications, AppNotification } from '../context/NotificationContext';

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const TYPE_ICON: Record<AppNotification['type'], keyof typeof Ionicons.glyphMap> = {
  product: 'cube-outline',
  invoice: 'document-text-outline',
  settings: 'settings-outline',
  order: 'diamond-outline',
};

/* ---------- Profile menu (mounted only while open) ---------- */
const ProfileMenu = memo(function ProfileMenu({
  initial,
  name,
  role,
  onClose,
  onSignOut,
}: {
  initial: string;
  name: string;
  role?: string;
  onClose: () => void;
  onSignOut: () => void;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.menu}>
          <View style={styles.menuHeader}>
            <View style={styles.menuAvatar}>
              <Text style={styles.menuAvatarInitial}>{initial}</Text>
            </View>
            <View style={styles.menuHeaderText}>
              <Text style={styles.menuName} numberOfLines={1}>
                {name}
              </Text>
              {role ? <Text style={styles.menuRole}>{role}</Text> : null}
            </View>
          </View>

          <View style={styles.menuDivider} />

          <Pressable
            onPress={onSignOut}
            style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
          >
            <Text style={styles.menuItemText}>Sign out</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
});

/* ---------- Notification panel (mounted only while open) ---------- */
const NotificationPanel = memo(function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { notifications, clearOne, clearAll } = useNotifications();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.notifPanel} onPress={() => {}}>
          <View style={styles.notifHeader}>
            <Text style={styles.notifTitle}>Notifications</Text>
            {notifications.length > 0 && (
              <Pressable onPress={clearAll} hitSlop={8}>
                <Text style={styles.clearAllText}>Clear all</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.menuDivider} />

          {notifications.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="notifications-off-outline" size={22} color={colors.textMuted} />
              <Text style={styles.emptyText}>No notifications</Text>
            </View>
          ) : (
            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id}
              style={styles.notifList}
              renderItem={({ item }) => (
                <View style={styles.notifItem}>
                  <View style={styles.notifIconBox}>
                    <Ionicons name={TYPE_ICON[item.type]} size={16} color={colors.primary} />
                  </View>
                  <View style={styles.notifItemText}>
                    <Text style={styles.notifItemTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.notifItemMessage} numberOfLines={4}>{item.message}</Text>
                    <Text style={styles.notifItemTime}>{timeAgo(item.created_at)}</Text>
                  </View>
                  <Pressable onPress={() => clearOne(item.id)} hitSlop={8} style={styles.notifClearButton}>
                    <Ionicons name="close" size={16} color={colors.textMuted} />
                  </Pressable>
                </View>
              )}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
});

/* ---------- Header ---------- */
export const AppHeader = memo(function AppHeader() {
  const { settings } = useCompanySettings();
  const { currentStaff, logoutStaff } = useStaff();
  const { unreadCount } = useNotifications();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const insets = useSafeAreaInsets();

  const initial = currentStaff?.name?.trim()?.[0]?.toUpperCase() ?? '?';

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeNotif = useCallback(() => setNotifOpen(false), []);
  const handleSignOut = useCallback(async () => {
    setMenuOpen(false);
    await logoutStaff();
  }, [logoutStaff]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.left}>
        <View style={styles.logoBox}>
          {settings?.logo_url ? (
            <Image source={{ uri: settings.logo_url }} style={styles.logo} resizeMode="contain" />
          ) : (
            <Text style={styles.logoPlaceholder}>{settings?.company_name?.[0]?.toUpperCase() ?? '?'}</Text>
          )}
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {settings?.company_name || 'My Company'}
        </Text>
      </View>

      <View style={styles.right}>
        <Pressable onPress={() => setNotifOpen(true)} style={styles.bellButton} hitSlop={8}>
          <Ionicons name="notifications-outline" size={22} color={colors.textPrimary} />
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          )}
        </Pressable>

        <Pressable onPress={() => setMenuOpen(true)} style={styles.avatarButton} hitSlop={8}>
          <Text style={styles.avatarInitial}>{initial}</Text>
        </Pressable>
      </View>

      {menuOpen && (
        <ProfileMenu
          initial={initial}
          name={currentStaff?.name || 'User'}
          role={currentStaff?.role}
          onClose={closeMenu}
          onSignOut={handleSignOut}
        />
      )}
      {notifOpen && <NotificationPanel onClose={closeNotif} />}
    </View>
  );
});

const AVATAR_SIZE = 34;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logoBox: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  logo: { width: '100%', height: '100%' },
  logoPlaceholder: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  name: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, flexShrink: 1 },

  bellButton: { width: AVATAR_SIZE, height: AVATAR_SIZE, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.error ?? '#D64545',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { fontSize: 9.5, fontWeight: '700', color: '#FFFFFF' },

  avatarButton: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 14, fontWeight: '700', color: colors.surface },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.15)' },
  menu: {
    position: 'absolute',
    top: 58,
    right: spacing.lg,
    minWidth: 200,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  menuAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuAvatarInitial: { fontSize: 13, fontWeight: '700', color: colors.surface },
  menuHeaderText: { flexShrink: 1 },
  menuName: { fontSize: 13.5, fontWeight: '700', color: colors.textPrimary },
  menuRole: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  menuDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  menuItem: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  menuItemPressed: { backgroundColor: colors.background },
  menuItemText: { fontSize: 13.5, fontWeight: '600', color: colors.error },

  notifPanel: {
    position: 'absolute',
    top: 58,
    right: spacing.lg,
    width: 300,
    maxHeight: 380,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
  },
  notifHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  notifTitle: { fontSize: 14.5, fontWeight: '700', color: colors.textPrimary },
  clearAllText: { fontSize: 12.5, fontWeight: '600', color: colors.primary },
  notifList: { maxHeight: 320 },
  notifItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  notifIconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  notifItemText: { flex: 1 },
  notifItemTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  notifItemMessage: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  notifItemTime: { fontSize: 10.5, color: colors.textMuted, marginTop: 3 },
  notifClearButton: { padding: 2 },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.lg, gap: 6 },
  emptyText: { fontSize: 12.5, color: colors.textMuted },
});