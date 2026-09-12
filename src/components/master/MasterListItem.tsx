import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Badge } from '../ui';
import { colors, spacing } from '../../theme';

interface MasterListItemProps {
  title: string;
  subtitle?: string;
  isActive?: boolean;
  onPress: () => void;
  onDelete: () => void;
}

export function MasterListItem({ title, subtitle, isActive, onPress, onDelete }: MasterListItemProps) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {isActive === false && <Badge label="Inactive" tone="error" />}
        </View>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      <Pressable onPress={onDelete} hitSlop={10} style={styles.deleteBtn}>
        <Text style={styles.deleteText}>Delete</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  subtitle: { fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  deleteBtn: { paddingLeft: spacing.md },
  deleteText: { fontSize: 12.5, color: colors.error, fontWeight: '600' },
});
