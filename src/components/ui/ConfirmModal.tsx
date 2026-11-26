import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { CheckCircle2, HelpCircle } from 'lucide-react-native';
import { colors, spacing, radius } from '../../theme';

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string | null; // null = hide the cancel button (info/success popup)
  variant?: 'confirm' | 'success';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  visible,
  title,
  message,
  confirmText = 'OK',
  cancelText = 'Cancel',
  variant = 'confirm',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const Icon = variant === 'success' ? CheckCircle2 : HelpCircle;
  const iconColor = variant === 'success' ? '#137333' : colors.primary;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={[styles.iconWrap, { backgroundColor: iconColor + '1A' }]}>
            <Icon size={28} color={iconColor} />
          </View>

          <Text style={styles.title}>{title}</Text>
          {!!message && <Text style={styles.message}>{message}</Text>}

          <View style={styles.btnRow}>
            {cancelText !== null && (
              <Pressable style={[styles.btn, styles.btnGhost]} onPress={onCancel} disabled={loading}>
                <Text style={styles.btnGhostText}>{cancelText}</Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.btn, styles.btnPrimary, loading && { opacity: 0.6 }]}
              onPress={onConfirm}
              disabled={loading}
            >
              <Text style={styles.btnPrimaryText}>{loading ? 'Please wait…' : confirmText}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius?.lg ?? 16,
    padding: spacing.lg,
    alignItems: 'center',
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { fontSize: 17, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
  message: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  btnRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, width: '100%' },
  btn: {
    flex: 1,
    minHeight: 46,
    borderRadius: radius?.md ?? 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnGhost: { borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  btnGhostText: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
});