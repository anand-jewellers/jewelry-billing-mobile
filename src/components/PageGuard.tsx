// src/components/PageGuard.tsx
import { View, Text, StyleSheet } from 'react-native';
import { useStaff } from '../context/StaffContext';
import type { PageKey } from '../types/settings';
import { colors, spacing } from '../theme';

export function PageGuard({ pageKey, children }: { pageKey: PageKey; children: React.ReactNode }) {
  const { hasAccess, currentStaff } = useStaff();
  if (!currentStaff) return null;

  if (!hasAccess(pageKey)) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Access restricted</Text>
        <Text style={styles.body}>
          {currentStaff.name} doesn't have permission to view this page. Ask an admin or manager to grant
          access from Settings → Staff.
        </Text>
      </View>
    );
  }
  return <>{children}</>;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  body: { fontSize: 13.5, color: colors.textSecondary, textAlign: 'center' },
});