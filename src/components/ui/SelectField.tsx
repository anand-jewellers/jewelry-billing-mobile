// src/components/ui/SelectField.tsx

import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../../theme';

export interface SelectOption {
  id: string;
  label: string;
}

interface Props {
  label: string;
  value: string | null;
  options: SelectOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  // When provided, a "+ Add New" row appears at the bottom of the list.
  // Tapping it swaps the list for a text input; submitting calls
  // onAddNew(name), which must create the record and resolve with the
  // new { id, label } option. The field then auto-selects it and closes.
  onAddNew?: (name: string) => Promise<SelectOption>;
  addNewLabel?: string;
}

// ---------------------------------------------------------------
// The picker sheet lives in its OWN component so that
// useSafeAreaInsets() runs under the SafeAreaProvider placed
// inside the Modal. A Modal is a separate Android window; insets
// read from the app's root provider can be 0 there in a release
// (edge-to-edge) build, which hides the last rows under the
// navigation buttons.
// ---------------------------------------------------------------
interface SheetProps {
  label: string;
  value: string | null;
  options: SelectOption[];
  onSelect: (id: string) => void;
  onClose: () => void;
  onAddNew?: (name: string) => Promise<SelectOption>;
  addNewLabel: string;
}

function PickerSheet({ label, value, options, onSelect, onClose, onAddNew, addNewLabel }: SheetProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  // Real inset, with a floor so the last row is never flush with the screen edge.
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'android' ? 24 : 16) + spacing.md;

  async function handleCreate() {
    const name = newName.trim();
    if (!name || !onAddNew) return;
    setSaving(true);
    try {
      const created = await onAddNew(name);
      onSelect(created.id);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? `Failed to add ${label.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <View
          style={[styles.sheet, { paddingBottom: bottomPad, maxHeight: windowHeight * 0.75 }]}
          // taps inside the sheet must not close it
          onStartShouldSetResponder={() => true}
        >
          <Text style={styles.sheetTitle}>{label}</Text>

          {!adding && (
            <FlatList
              data={options}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: Math.min(360, windowHeight * 0.45) }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.option} onPress={() => onSelect(item.id)}>
                  <Text style={item.id === value ? styles.optionTextSelected : styles.optionText}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.empty}>No options available</Text>}
              ListFooterComponent={
                onAddNew ? (
                  <TouchableOpacity style={styles.addNewRow} onPress={() => setAdding(true)}>
                    <Text style={styles.addNewText}>{addNewLabel}</Text>
                  </TouchableOpacity>
                ) : null
              }
            />
          )}

          {adding && (
            <View style={styles.addNewForm}>
              <TextInput
                style={styles.addNewInput}
                placeholder={`New ${label.toLowerCase()} name`}
                placeholderTextColor={colors.textMuted}
                value={newName}
                onChangeText={setNewName}
                autoFocus
                editable={!saving}
              />
              <View style={styles.addNewActions}>
                <TouchableOpacity
                  style={styles.addNewCancelBtn}
                  onPress={() => {
                    setAdding(false);
                    setNewName('');
                  }}
                  disabled={saving}
                >
                  <Text style={styles.addNewCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.addNewSaveBtn,
                    (!newName.trim() || saving) && styles.addNewSaveBtnDisabled,
                  ]}
                  onPress={handleCreate}
                  disabled={!newName.trim() || saving}
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.addNewSaveText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select...',
  disabled,
  onAddNew,
  addNewLabel = '+ Add New',
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);

  const close = () => setOpen(false);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={[styles.field, disabled && styles.fieldDisabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={selected ? styles.valueText : styles.placeholderText}>
          {selected ? selected.label : placeholder}
        </Text>
      </TouchableOpacity>

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
            onAddNew={onAddNew}
            addNewLabel={addNewLabel}
          />
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.xs, fontWeight: '600' },
  field: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  fieldDisabled: { opacity: 0.5 },
  valueText: { color: colors.text, fontSize: 15 },
  placeholderText: { color: colors.textMuted, fontSize: 15 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  option: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  optionText: { fontSize: 15, color: colors.text },
  optionTextSelected: { fontSize: 15, color: colors.primary, fontWeight: '700' },
  empty: { textAlign: 'center', color: colors.textMuted, paddingVertical: spacing.lg },
  addNewRow: {
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: 4,
  },
  addNewText: { fontSize: 15, color: colors.primary, fontWeight: '700' },
  addNewForm: { paddingTop: spacing.sm },
  addNewInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.background ?? '#fff',
  },
  addNewActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  addNewCancelBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  addNewCancelText: { color: colors.textMuted, fontWeight: '600', fontSize: 14 },
  addNewSaveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    minWidth: 64,
    alignItems: 'center',
  },
  addNewSaveBtnDisabled: { opacity: 0.5 },
  addNewSaveText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});