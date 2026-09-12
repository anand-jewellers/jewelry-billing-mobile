import { useState } from 'react';
import { View, Text, Image, Pressable, Modal, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme';
import { useCompanySettings } from '../context/CompanySettingsContext';
import { useStaff } from '../context/StaffContext';

export function AppHeader() {
  const { settings } = useCompanySettings();
  const { currentStaff, logoutStaff } = useStaff();
  const [menuOpen, setMenuOpen] = useState(false);

  const initial = currentStaff?.name?.trim()?.[0]?.toUpperCase() ?? '?';

  const handleSignOut = async () => {
    setMenuOpen(false);
    await logoutStaff();
  };

  return (
    <View style={styles.container}>
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

      <Pressable onPress={() => setMenuOpen(true)} style={styles.avatarButton} hitSlop={8}>
        <Text style={styles.avatarInitial}>{initial}</Text>
      </Pressable>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.menu}>
            <View style={styles.menuHeader}>
              <View style={styles.menuAvatar}>
                <Text style={styles.menuAvatarInitial}>{initial}</Text>
              </View>
              <View style={styles.menuHeaderText}>
                <Text style={styles.menuName} numberOfLines={1}>
                  {currentStaff?.name || 'User'}
                </Text>
                {currentStaff?.role ? <Text style={styles.menuRole}>{currentStaff.role}</Text> : null}
              </View>
            </View>

            <View style={styles.menuDivider} />

            <Pressable onPress={handleSignOut} style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}>
              <Text style={styles.menuItemText}>Sign out</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const AVATAR_SIZE = 34;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
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
});