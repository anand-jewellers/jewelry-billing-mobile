import { useCallback, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card, Button, Input } from '../../../src/components/ui';
import { MasterListItem, FormSheet, SelectField } from '../../../src/components/master';
import { colors, spacing } from '../../../src/theme';
import {
  listValueAddedChargeTypes,
  createValueAddedChargeType,
  updateValueAddedChargeType,
  deleteValueAddedChargeType,
} from '../../../src/lib/api/settings';
import type { ValueAddedChargeType, CalculationType } from '../../../src/types/settings';

const CALC_TYPES = [
  { id: 'fixed', label: 'Fixed Amount' },
  { id: 'per_gram', label: 'Per Gram' },
  { id: 'percentage', label: 'Percentage' },
];

export default function ValueAddedChargesScreen() {
  const [items, setItems] = useState<ValueAddedChargeType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ValueAddedChargeType | null>(null);
  const [name, setName] = useState('');
  const [calcType, setCalcType] = useState<string | null>('fixed');
  const [defaultValue, setDefaultValue] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    listValueAddedChargeTypes()
      .then(setItems)
      .catch(() => setError('Could not load value added charges.'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const formatValue = (item: ValueAddedChargeType) => {
    if (item.calculation_type === 'percentage') return `${item.default_value}%`;
    if (item.calculation_type === 'per_gram') return `₹${item.default_value}/g`;
    return `₹${item.default_value}`;
  };

  const openAdd = () => {
    setEditing(null);
    setName('');
    setCalcType('fixed');
    setDefaultValue('');
    setSheetOpen(true);
  };

  const openEdit = (item: ValueAddedChargeType) => {
    setEditing(item);
    setName(item.name);
    setCalcType(item.calculation_type);
    setDefaultValue(item.default_value.toString());
    setSheetOpen(true);
  };

  const handleSave = async () => {
    const value = parseFloat(defaultValue) || 0;
    if (!name.trim() || !calcType) return;
    setSaving(true);
    try {
      const input = { name: name.trim(), calculation_type: calcType as CalculationType, default_value: value };
      if (editing) {
        await updateValueAddedChargeType(editing.id, input);
      } else {
        await createValueAddedChargeType(input);
      }
      setSheetOpen(false);
      load();
    } catch {
      setError('Could not save. That name may already be in use.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteValueAddedChargeType(id);
      load();
    } catch {
      setError('Could not delete — it may be in use by products.');
    }
  };

  return (
    <View style={styles.screen}>
      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <Card padded={false} style={{ flex: 1, margin: spacing.lg }}>
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <MasterListItem
                title={item.name}
                subtitle={`Default: ${formatValue(item)}`}
                isActive={item.is_active}
                onPress={() => openEdit(item)}
                onDelete={() => handleDelete(item.id)}
              />
            )}
            ListEmptyComponent={<Text style={styles.emptyText}>No charge types yet.</Text>}
          />
        </Card>
      )}

      <View style={styles.addButton}>
        <Button label="Add Charge Type" onPress={openAdd} />
      </View>

      <FormSheet
        visible={sheetOpen}
        title={editing ? 'Edit Charge Type' : 'Add Charge Type'}
        onClose={() => setSheetOpen(false)}
        onSave={handleSave}
        saving={saving}
      >
        <Input label="Name" value={name} onChangeText={setName} placeholder="e.g. Wastage Charge" />
        <SelectField label="Calculation Type" value={calcType} options={CALC_TYPES} onChange={setCalcType} />
        <Input label="Default Value" value={defaultValue} onChangeText={setDefaultValue} keyboardType="decimal-pad" />
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  error: { fontSize: 13, color: colors.error, textAlign: 'center', marginTop: spacing.md },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
  addButton: { padding: spacing.lg },
});
