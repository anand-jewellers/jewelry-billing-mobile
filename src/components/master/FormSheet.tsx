// src/components/master/FormSheet.tsx

import React from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  Keyboard,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../ui';
import { colors, radius, spacing } from '../../theme';

interface FormSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSave: () => void;
  saving?: boolean;
  saveLabel?: string;
  children: React.ReactNode;
}

function SheetContent({
  title,
  onClose,
  onSave,
  saving,
  saveLabel = 'Save',
  children,
}: Omit<FormSheetProps, 'visible'>) {
  const insets = useSafeAreaInsets();

  const bottomPad = Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 16) + spacing.sm;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.keyboardContainer}
    >
      <View style={styles.backdrop}>
        {/* Backdrop dismiss */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        {/* Sheet container */}
        <View style={[styles.sheet, { paddingBottom: bottomPad }]}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          {/* Form scroll area */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
          >
            {children}
          </ScrollView>

          {/* Action buttons pinned at bottom */}
          <View style={styles.footer}>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="outline" onPress={onClose} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label={saveLabel} onPress={onSave} loading={saving} />
            </View>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

export function FormSheet({
  visible,
  title,
  onClose,
  onSave,
  saving,
  saveLabel = 'Save',
  children,
}: FormSheetProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <SafeAreaProvider>
        <SheetContent
          title={title}
          onClose={onClose}
          onSave={onSave}
          saving={saving}
          saveLabel={saveLabel}
        >
          {children}
        </SheetContent>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardContainer: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,31,61,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    maxHeight: '85%', // Prevents the sheet from exceeding screen bounds
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  close: {
    fontSize: 18,
    color: colors.textMuted,
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingBottom: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
});