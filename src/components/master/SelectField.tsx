import { useState } from 'react';
import { View, Text, Pressable, Modal, FlatList, StyleSheet } from 'react-native';
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

export function SelectField({ label, value, options, onChange, placeholder = 'Select…' }: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.field} onPress={() => setOpen(true)}>
        <Text style={selected ? styles.valueText : styles.placeholderText}>
          {selected ? selected.label : placeholder}
        </Text>
        <Text style={styles.chevron}>⌄</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 340 }}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.option}
                  onPress={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                >
                  <Text style={item.id === value ? styles.optionTextActive : styles.optionText}>{item.label}</Text>
                  {item.id === value && <Text style={styles.check}>✓</Text>}
                </Pressable>
              )}
              ListEmptyComponent={<Text style={styles.emptyText}>No options yet</Text>}
            />
          </View>
        </Pressable>
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
    padding: spacing.lg,
    paddingBottom: spacing.xl,
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
