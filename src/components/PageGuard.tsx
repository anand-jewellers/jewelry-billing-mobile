// src/components/PageGuard.tsx
import { View, Text, StyleSheet } from 'react-native';
import { useStaff } from '../context/StaffContext';
import type { PageKey } from '../types/settings';
import { colors, spacing } from '../theme';

interface Props {
  pageKey?: PageKey;
  anyOf?: PageKey[]; // allow if the user has ANY of these keys
  children: React.ReactNode;
}

export function PageGuard({ pageKey, anyOf, children }: Props) {
  const { hasAccess, currentStaff } = useStaff();
  if (!currentStaff) return null;

  const keys = anyOf ?? (pageKey ? [pageKey] : []);
  const allowed = keys.some((k) => hasAccess(k));

  if (!allowed) {
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