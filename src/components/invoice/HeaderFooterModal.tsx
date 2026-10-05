// src/components/invoice/HeaderFooterModal.tsx

import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { X } from 'lucide-react-native';
import { colors, spacing, radius, shadow } from '../../theme';

interface HeaderFooterModalProps {
  visible: boolean;
  onYes: () => void;   // print WITH shop header + footer
  onNo: () => void;    // print WITHOUT header + footer
  onClose: () => void; // X button / Android back — cancel, nothing is printed
}

export function HeaderFooterModal({ visible, onYes, onNo, onClose }: HeaderFooterModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Close (X) — top left */}
          <Pressable
            style={styles.closeBtn}
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <X size={20} color={colors.textPrimary} />
          </Pressable>

          <Text style={styles.title}>Do you want header and footer?</Text>
          <Text style={styles.subtitle}>
            {/* Choose No to print only the bill, for pre-printed stationery. */}
          </Text>

          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.yesBtn]} onPress={onYes}>
              <Text style={styles.yesText}>Yes</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.noBtn]} onPress={onNo}>
              <Text style={styles.noText}>No</Text>
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
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius?.lg ?? 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: 52,
    paddingBottom: spacing.lg,
    ...shadow.card,
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  btn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: radius?.md ?? 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yesBtn: { backgroundColor: colors.primary },
  yesText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  noBtn: { borderWidth: 1, borderColor: colors.primary, backgroundColor: 'transparent' },
  noText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
});