// src/components/master/FormSheet.tsx

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  Keyboard,
  useWindowDimensions,
  type LayoutChangeEvent,
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

function useKeyboardHeight() {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvt, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvt, () => setHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
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
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const keyboardOpen = keyboardHeight > 0;

  // ---------------------------------------------------------
  // Keyboard handling (same approach as JewelryItemSheet).
  //
  // On some Android builds the window ALREADY shrinks when the keyboard
  // opens; on others it does not. Lifting by the full keyboard height in
  // the first case lifts twice, and not lifting in the second case hides
  // the buttons behind the keyboard.
  //
  // So we measure the overlay: `baseH` is its tallest height (keyboard
  // closed), `overlayH` its current height. The difference is what the
  // window already gave up. We only lift by what is still covered.
  // ---------------------------------------------------------
  const [overlayH, setOverlayH] = useState(0);
  const [baseH, setBaseH] = useState(0);

  const handleOverlayLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    setOverlayH(h);
    setBaseH((prev) => Math.max(prev, h));
  };

  const shrink = baseH > 0 && overlayH > 0 ? baseH - overlayH : 0;
  const rawLift = keyboardOpen ? Math.max(0, keyboardHeight - shrink) : 0;
  const lift = rawLift < 24 ? 0 : rawLift; // ignore rounding / nav-bar noise

  // The sheet may never be taller than what is visible above the keyboard.
  const availableH = overlayH > 0 ? overlayH : windowHeight;
  const sheetMaxHeight = Math.max(280, availableH - lift - insets.top - spacing.md);

  // When the keyboard is open it already covers the nav bar area.
  const bottomPad = keyboardOpen
    ? spacing.md
    : Math.max(insets.bottom, Platform.OS === 'android' ? 24 : 16) + spacing.md;

  return (
    <View style={styles.backdrop} onLayout={handleOverlayLayout}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => (keyboardOpen ? Keyboard.dismiss() : onClose())}
      />

      <View
        style={[
          styles.sheet,
          { maxHeight: sheetMaxHeight, marginBottom: lift, paddingBottom: bottomPad },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        {/* The form area shrinks (and scrolls) so the footer buttons always stay visible */}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
        >
          {children}
        </ScrollView>

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
      {/* Own provider = insets measured in the Modal's own window */}
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
  backdrop: { flex: 1, backgroundColor: 'rgba(15,31,61,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  close: { fontSize: 18, color: colors.textMuted },
  scroll: { flexGrow: 0, flexShrink: 1 },
  footer: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
});