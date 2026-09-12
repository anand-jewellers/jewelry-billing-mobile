import { useCallback, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card, Button, Input } from '../../../src/components/ui';
import { MasterListItem, FormSheet, SelectField } from '../../../src/components/master';
import { colors, spacing } from '../../../src/theme';
import {
  listMetals,
  listPurities,
  listCategories,
  listMakingChargeRules,
  createMakingChargeRule,
  updateMakingChargeRule,
  deleteMakingChargeRule,
} from '../../../src/lib/api/settings';
import type { Metal, Purity, Category, MakingChargeRule, CalculationType } from '../../../src/types/settings';

const CALC_TYPES = [
  { id: 'per_gram', label: 'Per Gram' },
  { id: 'percentage', label: 'Percentage' },
  { id: 'fixed', label: 'Fixed' },
];

export default function MakingChargesScreen() {
  const [metals, setMetals] = useState<Metal[]>([]);
  const [purities, setPurities] = useState<Purity[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<MakingChargeRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<MakingChargeRule | null>(null);
  const [metalId, setMetalId] = useState<string | null>(null);
  const [purityId, setPurityId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [calcType, setCalcType] = useState<string | null>('per_gram');
  const [value, setValue] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([listMetals(), listPurities(), listCategories(), listMakingChargeRules()])
      .then(([m, p, c, r]) => {
        setMetals(m);
        setPurities(p);
        setCategories(c);
        setRules(r);
      })
      .catch(() => setError('Could not load making charge rules.'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const metalName = (id: string) => metals.find((m) => m.id === id)?.name ?? '—';
  const purityName = (id: string | null) => (id ? purities.find((p) => p.id === id)?.name : null);
  const categoryName = (id: string | null) => (id ? categories.find((c) => c.id === id)?.name : null);

  const formatValue = (rule: MakingChargeRule) => {
    if (rule.calculation_type === 'per_gram') return `₹${rule.value}/g`;
    if (rule.calculation_type === 'percentage') return `${rule.value}%`;
    return `₹${rule.value}`;
  };

  const openAdd = () => {
    setEditing(null);
    setMetalId(null);
    setPurityId(null);
    setCategoryId(null);
    setCalcType('per_gram');
    setValue('');
    setSheetOpen(true);
  };

  const openEdit = (rule: MakingChargeRule) => {
    setEditing(rule);
    setMetalId(rule.metal_id);
    setPurityId(rule.purity_id);
    setCategoryId(rule.category_id);
    setCalcType(rule.calculation_type);
    setValue(rule.value.toString());
    setSheetOpen(true);
  };

  const handleSave = async () => {
    const numericValue = parseFloat(value);
    if (!metalId || !calcType || Number.isNaN(numericValue)) return;
    setSaving(true);
    try {
      const input = {
        metal_id: metalId,
        purity_id: purityId,
        category_id: categoryId,
        calculation_type: calcType as CalculationType,
        value: numericValue,
      };
      if (editing) {
        await updateMakingChargeRule(editing.id, input);
      } else {
        await createMakingChargeRule(input);
      }
      setSheetOpen(false);
      load();
    } catch {
      setError('Could not save the rule.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMakingChargeRule(id);
      load();
    } catch {
      setError('Could not delete the rule.');
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
            data={rules}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const parts = [metalName(item.metal_id), purityName(item.purity_id), categoryName(item.category_id)].filter(Boolean);
              return (
                <MasterListItem
                  title={formatValue(item)}
                  subtitle={parts.join(' · ')}
                  isActive={item.is_active}
                  onPress={() => openEdit(item)}
                  onDelete={() => handleDelete(item.id)}
                />
              );
            }}
            ListEmptyComponent={<Text style={styles.emptyText}>No making charge rules yet.</Text>}
          />
        </Card>
      )}

      <View style={styles.addButton}>
        <Button label="Add Rule" onPress={openAdd} />
      </View>

      <FormSheet
        visible={sheetOpen}
        title={editing ? 'Edit Making Charge' : 'Add Making Charge'}
        onClose={() => setSheetOpen(false)}
        onSave={handleSave}
        saving={saving}
      >
        <SelectField
          label="Metal"
          value={metalId}
          options={metals.map((m) => ({ id: m.id, label: m.name }))}
          onChange={(id) => {
            setMetalId(id);
            setPurityId(null);
          }}
        />
        <SelectField
          label="Purity (optional — applies to all if blank)"
          value={purityId}
          options={purities.filter((p) => p.metal_id === metalId).map((p) => ({ id: p.id, label: p.name }))}
          onChange={setPurityId}
        />
        <SelectField
          label="Category (optional — applies to all if blank)"
          value={categoryId}
          options={categories.map((c) => ({ id: c.id, label: c.name }))}
          onChange={setCategoryId}
        />
        <SelectField label="Calculation Type" value={calcType} options={CALC_TYPES} onChange={setCalcType} />
        <Input
          label={calcType === 'percentage' ? 'Value (%)' : calcType === 'fixed' ? 'Value (₹)' : 'Value (₹ per gram)'}
          value={value}
          onChangeText={setValue}
          keyboardType="decimal-pad"
        />
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
