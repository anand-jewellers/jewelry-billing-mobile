// src/components/master/SelectField.tsx

import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  FlatList,
  StyleSheet,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../../theme';

export interface SelectOption {
  id: string;
  label: string;
}

interface SelectFieldProps {
  label: string;
  value: string | null;
  options: SelectOption[];
  onChange: (id: string) => void;
  placeholder?: string;
}

// ---------------------------------------------------------------
// The picker sheet is its OWN component so useSafeAreaInsets() runs
// under the SafeAreaProvider placed inside the Modal. A Modal is a
// separate Android window; insets read from the root provider can be
// 0 there in a release (edge-to-edge) build, which hides the last
// rows under the navigation buttons.
// ---------------------------------------------------------------
interface SheetProps {
  label: string;
  value: string | null;
  options: SelectOption[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

function PickerSheet({ label, value, options, onSelect, onClose }: SheetProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  // Real inset, with a floor so the last row is never flush with the screen edge.
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'android' ? 24 : 16) + spacing.md;

  return (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <View
        style={[styles.sheet, { paddingBottom: bottomPad, maxHeight: windowHeight * 0.75 }]}
        // taps inside the sheet must not close it
        onStartShouldSetResponder={() => true}
      >
        <Text style={styles.sheetTitle}>{label}</Text>
        <FlatList
          data={options}
          keyExtractor={(item) => item.id}
          style={{ maxHeight: Math.min(340, windowHeight * 0.45) }}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <Pressable style={styles.option} onPress={() => onSelect(item.id)}>
              <Text style={item.id === value ? styles.optionTextActive : styles.optionText}>
                {item.label}
              </Text>
              {item.id === value && <Text style={styles.check}>✓</Text>}
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>No options yet</Text>}
        />
      </View>
    </Pressable>
  );
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select…',
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);

  const close = () => setOpen(false);

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.field} onPress={() => setOpen(true)}>
        <Text style={selected ? styles.valueText : styles.placeholderText}>
          {selected ? selected.label : placeholder}
        </Text>
        <Text style={styles.chevron}>⌄</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={close}
      >
        {/* Own provider = insets measured in the Modal's own window */}
        <SafeAreaProvider>
          <PickerSheet
            label={label}
            value={value}
            options={options}
            onSelect={(id) => {
              onChange(id);
              close();
            }}
            onClose={close}
          />
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, color: colors.textSecondary, marginBottom: 6, fontWeight: '500' },
  field: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  valueText: { fontSize: 14, color: colors.textPrimary },
  placeholderText: { fontSize: 14, color: colors.textMuted },
  chevron: { fontSize: 16, color: colors.textMuted },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,31,61,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  sheetTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  optionText: { fontSize: 14, color: colors.textPrimary },
  optionTextActive: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  check: { fontSize: 14, color: colors.primary, fontWeight: '700' },
  separator: { height: 1, backgroundColor: colors.border },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
});