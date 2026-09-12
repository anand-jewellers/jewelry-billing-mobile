// src/components/StaffLogoutButton.tsx
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { LogOut } from 'lucide-react-native';
import { useStaff } from '../context/StaffContext';
import { colors, spacing } from '../theme';

export function StaffLogoutButton() {
  const { currentStaff, logoutStaff } = useStaff();
  if (!currentStaff) return null;

  const handleLogout = () => {
    Alert.alert('Log out', `Log out ${currentStaff.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => logoutStaff() },
    ]);
  };

  return (
    <View style={styles.row}>
      <View>
        <Text style={styles.name}>{currentStaff.name}</Text>
        <Text style={styles.role}>{currentStaff.role}</Text>
      </View>
      <Pressable style={styles.logoutBtn} onPress={handleLogout}>
        <LogOut size={16} color={colors.textSecondary} />
        <Text style={styles.logoutText}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 10,
    marginBottom: spacing.lg,
  },
  name: { fontWeight: '700', color: colors.textPrimary },
  role: { fontSize: 12, color: colors.textSecondary, marginTop: 2, textTransform: 'capitalize' },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  logoutText: { fontSize: 12.5, color: colors.textSecondary },
});