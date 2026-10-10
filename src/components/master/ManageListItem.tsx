// src/components/master/ManageListItem.tsx

import { View, Text, Pressable, Alert, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';

interface Props {
  title: string;
  subtitle?: string;
  onEdit: () => void;
  // Called only AFTER the user confirms in the "Do you want to delete?" dialog.
  onDelete: () => void;
  // Optional extra line shown in the confirm dialog (e.g. "Its purities will also be hidden.")
  confirmNote?: string;
  // When false, the Delete button becomes "Restore" (needs onRestore).
  isActive?: boolean;
  onRestore?: () => void;
  // Hides Edit / Delete completely (e.g. the admin row).
  readOnly?: boolean;
}

export function ManageListItem({
  title,
  subtitle,
  onEdit,
  onDelete,
  confirmNote,
  isActive = true,
  onRestore,
  readOnly = false,
}: Props) {
  const askDelete = () => {
    Alert.alert(
      'Delete',
      `Do you want to delete "${title}"?${confirmNote ? `\n\n${confirmNote}` : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: onDelete },
      ]
    );
  };

  return (
    <View style={[styles.row, !isActive && { opacity: 0.6 }]}>
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {!readOnly && (
        <View style={styles.actions}>
          <Pressable style={[styles.btn, styles.editBtn]} onPress={onEdit} hitSlop={6}>
            <Text style={styles.editText}>Edit</Text>
          </Pressable>

          {!isActive && onRestore ? (
            <Pressable style={[styles.btn, styles.restoreBtn]} onPress={onRestore} hitSlop={6}>
              <Text style={styles.restoreText}>Restore</Text>
            </Pressable>
          ) : (
            <Pressable style={[styles.btn, styles.deleteBtn]} onPress={askDelete} hitSlop={6}>
              <Text style={styles.deleteText}>Delete</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  textWrap: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8 },
  btn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  editBtn: { borderColor: colors.primary, backgroundColor: colors.surface },
  editText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  deleteBtn: { borderColor: '#DC2626', backgroundColor: '#FEF2F2' },
  deleteText: { color: '#DC2626', fontWeight: '700', fontSize: 13 },
  restoreBtn: { borderColor: '#16A34A', backgroundColor: '#F0FDF4' },
  restoreText: { color: '#16A34A', fontWeight: '700', fontSize: 13 },
});