// src/components/ui/MultiSelectField.tsx
//
// Dropdown-style multi-select field. Tapping it opens a modal listing all
// options as checkboxes; selections are staged in local `draft` state and
// only committed via onChange when the user taps "OK" (Cancel discards
// the draft and restores whatever was selected before opening).
//
// Optionally accepts onAddNew: tapping "+ Add New" swaps the checkbox list
// for a text input; submitting creates the record, stages the new option
// as selected in draft, and returns to the checkbox list (sheet stays open
// so the user can keep picking/adding).
import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { ChevronDown, Check } from 'lucide-react-native';
import { colors, spacing } from '../../theme';

export type SelectOption = { id: string; label: string };

type Props = {
  label?: string;
  options: SelectOption[];
  values: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  onAddNew?: (name: string) => Promise<SelectOption>;
  addNewLabel?: string;
};

export function MultiSelectField({
  label, options, values, onChange, disabled, placeholder = 'Select', onAddNew, addNewLabel = '+ Add New',
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(values);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  function openModal() {
    if (disabled) return;
    setDraft(values);
    setOpen(true);
  }

  function toggle(id: string) {
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function confirm() {
    onChange(draft);
    setOpen(false);
  }

  function cancel() {
    setDraft(values);
    setAdding(false);
    setNewName('');
    setOpen(false);
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name || !onAddNew) return;
    setSaving(true);
    try {
      const created = await onAddNew(name);
      setDraft((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]));
      setAdding(false);
      setNewName('');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to add option');
    } finally {
      setSaving(false);
    }
  }

  const selectedLabels = options.filter((o) => values.includes(o.id)).map((o) => o.label);
  const displayText = selectedLabels.length ? selectedLabels.join(', ') : placeholder;

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <TouchableOpacity
        style={[styles.field, disabled && styles.fieldDisabled]}
        onPress={openModal}
        disabled={disabled}
        activeOpacity={0.7}
      >
        <Text style={[styles.fieldText, !selectedLabels.length && styles.placeholderText]} numberOfLines={1}>
          {displayText}
        </Text>
        <ChevronDown size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={cancel}>
        <Pressable style={styles.overlay} onPress={cancel}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{label ?? 'Select options'}</Text>

            {!adding && (
              <ScrollView style={styles.optionList}>
                {options.map((opt) => {
                  const selected = draft.includes(opt.id);
                  return (
                    <TouchableOpacity key={opt.id} style={styles.optionRow} onPress={() => toggle(opt.id)}>
                      <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                        {selected && <Check size={14} color="#fff" />}
                      </View>
                      <Text style={styles.optionText}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
                {options.length === 0 && <Text style={styles.emptyText}>No options available.</Text>}
                {onAddNew && (
                  <TouchableOpacity style={styles.addNewRow} onPress={() => setAdding(true)}>
                    <Text style={styles.addNewText}>{addNewLabel}</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            )}

            {adding && (
              <View style={styles.addNewForm}>
                <TextInput
                  style={styles.addNewInput}
                  placeholder="New option name"
                  placeholderTextColor={colors.textMuted}
                  value={newName}
                  onChangeText={setNewName}
                  autoFocus
                  editable={!saving}
                />
                <View style={styles.addNewActions}>
                  <TouchableOpacity
                    style={styles.addNewCancelBtn}
                    onPress={() => { setAdding(false); setNewName(''); }}
                    disabled={saving}
                  >
                    <Text style={styles.addNewCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.addNewSaveBtn, (!newName.trim() || saving) && styles.addNewSaveBtnDisabled]}
                    onPress={handleCreate}
                    disabled={!newName.trim() || saving}
                  >
                    {saving
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.addNewSaveText}>Add</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {!adding && (
              <View style={styles.actions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={cancel}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.okBtn} onPress={confirm}>
                  <Text style={styles.okBtnText}>OK</Text>
                </TouchableOpacity>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.sm },
  label: { fontSize: 13, color: colors.textMuted, marginBottom: 4 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  fieldDisabled: { opacity: 0.5 },
  fieldText: { fontSize: 15, color: colors.text, flex: 1, marginRight: spacing.sm },
  placeholderText: { color: colors.textMuted },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '70%',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  optionList: { marginBottom: spacing.sm },
  optionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  checkboxSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  optionText: { fontSize: 15, color: colors.text },
  emptyText: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic', paddingVertical: spacing.sm },
  addNewRow: { paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 4 },
  addNewText: { fontSize: 15, color: colors.primary, fontWeight: '700' },
  addNewForm: { marginBottom: spacing.sm },
  addNewInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 12,
    paddingHorizontal: spacing.md, fontSize: 15, color: colors.text, backgroundColor: colors.background ?? '#fff',
  },
  addNewActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  addNewCancelBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  addNewCancelText: { color: colors.textMuted, fontWeight: '600', fontSize: 14 },
  addNewSaveBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20, minWidth: 56, alignItems: 'center' },
  addNewSaveBtnDisabled: { opacity: 0.5 },
  addNewSaveText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  cancelBtnText: { color: colors.textMuted, fontWeight: '600', fontSize: 14 },
  okBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20 },
  okBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});