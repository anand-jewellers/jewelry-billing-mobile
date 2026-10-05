// src/components/ui/SuccessModal.tsx

import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, Text, View, StyleSheet } from 'react-native';
import { CheckCircle2, X } from 'lucide-react-native';
import { colors, spacing } from '../../theme';

interface SuccessModalProps {
  visible: boolean;
  title?: string;
  message: string | null;
  onClose: () => void;
  /** Auto-dismiss after this many ms. Pass 0 to require a manual tap. */
  autoCloseMs?: number;
}

export function SuccessModal({
  visible,
  title = 'Success',
  message,
  onClose,
  autoCloseMs = 2000,
}: SuccessModalProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    if (!visible) return;

    opacity.setValue(0);
    scale.setValue(0.9);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }),
    ]).start();

    if (autoCloseMs > 0) {
      const t = setTimeout(onClose, autoCloseMs);
      return () => clearTimeout(t);
    }
  }, [visible]);

  if (!message) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Tapping the backdrop dismisses the dialog */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={10}>
            <X size={18} color={colors.textSecondary} />
          </Pressable>

          <View style={styles.iconWrap}>
            <CheckCircle2 size={28} color={colors.success ?? '#1E8E3E'} />
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <Pressable style={styles.okBtn} onPress={onClose}>
            <Text style={styles.okBtnText}>OK</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    padding: spacing.xs,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E8F6EE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  message: {
    fontSize: 13.5,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  okBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: 10,
  },
  okBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
});