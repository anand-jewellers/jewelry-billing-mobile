// app\(tabs)\settings\gold-rates.tsx  (use your existing file name)
import { useCallback, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card, Button, Input } from '../../../src/components/ui';
import { FormSheet, SelectField } from '../../../src/components/master';
import { ManageListItem } from '../../../src/components/master/ManageListItem';
import { colors, spacing } from '../../../src/theme';
import {
  listMetals,
  listPurities,
  listCurrentRates,
  addMetalRate,
  deleteMetalRate,
} from '../../../src/lib/api/settings';
import { useStaff } from '../../../src/context/StaffContext';
import type { Metal, Purity, CurrentMetalRate } from '../../../src/types/settings';

export default function GoldRatesScreen() {
  const { currentStaff } = useStaff();
  const [metals, setMetals] = useState<Metal[]>([]);
  const [purities, setPurities] = useState<Purity[]>([]);
  const [rates, setRates] = useState<CurrentMetalRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<CurrentMetalRate | null>(null);
  const [metalId, setMetalId] = useState<string | null>(null);
  const [purityId, setPurityId] = useState<string | null>(null);
  const [rate, setRate] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([listMetals(), listPurities(), listCurrentRates()])
      .then(([m, p, r]) => {
        setMetals(m);
        setPurities(p);
        setRates(r);
        setError(null);
      })
      .catch(() => setError('Could not load gold rates.'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const metalName = (id: string) => metals.find((m) => m.id === id)?.name ?? '—';
  const purityName = (id: string) => purities.find((p) => p.id === id)?.name ?? '—';

  const metalOptions = metals.map((m) => ({ id: m.id, label: m.name }));
  const purityOptions = purities.filter((p) => p.metal_id === metalId).map((p) => ({ id: p.id, label: p.name }));

  // Hide rates whose metal or purity has been deleted.
  const visibleRates = rates.filter(
    (r) => metals.some((m) => m.id === r.metal_id) && purities.some((p) => p.id === r.purity_id)
  );

  const openAdd = () => {
    setEditing(null);
    setMetalId(null);
    setPurityId(null);
    setRate('');
    setError(null);
    setSheetOpen(true);
  };

  // Edit = change the rate of an existing metal + purity.
  // Metal and purity are locked; saving logs a new rate that becomes the current one.
  const openEdit = (item: CurrentMetalRate) => {
    setEditing(item);
    setMetalId(item.metal_id);
    setPurityId(item.purity_id);
    setRate(String(item.rate_per_gram));
    setError(null);
    setSheetOpen(true);
  };

  const handleSave = async () => {
    const value = parseFloat(rate);
    if (!metalId || !purityId || !value || value <= 0) return;
    if (!currentStaff) {
      setError('You must be signed in to update rates.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addMetalRate({
        metal_id: metalId,
        purity_id: purityId,
        rate_per_gram: value,
        staffId: currentStaff.id,
      });
      setSheetOpen(false);
      load();
    } catch (e: any) {
      setError(e.message ?? 'Could not save the new rate.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: CurrentMetalRate) => {
    setError(null);
    try {
      await deleteMetalRate(item.metal_id, item.purity_id);
      load();
    } catch (e: any) {
      setError(e?.message ?? 'Could not delete the rate.');
    }
  };

  return (
    <View style={styles.screen}>
      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <Card padded={false} style={{ flex: 1, marginHorizontal: spacing.lg }}>
          <FlatList
            data={visibleRates}
            keyExtractor={(item) => `${item.metal_id}-${item.purity_id}`}
            renderItem={({ item }) => (
              <ManageListItem
                title={`${metalName(item.metal_id)} — ${purityName(item.purity_id)}`}
                subtitle={`₹${item.rate_per_gram.toLocaleString('en-IN')}/g · as of ${item.effective_date}`}
                confirmNote="Invoices already made keep the rate they were billed at."
                onEdit={() => openEdit(item)}
                onDelete={() => handleDelete(item)}
              />
            )}
            ListEmptyComponent={<Text style={styles.emptyText}>No rates set yet.</Text>}
          />
        </Card>
      )}

      <View style={styles.addButton}>
        <Button label="Add / Update Rate" onPress={openAdd} />
      </View>

      <FormSheet
        visible={sheetOpen}
        title={editing ? 'Edit Rate' : 'Add / Update Rate'}
        onClose={() => setSheetOpen(false)}
        onSave={handleSave}
        saving={saving}
      >
        {error ? <Text style={styles.sheetError}>{error}</Text> : null}
        <SelectField
          label="Metal"
          value={metalId}
          options={metalOptions}
          disabled={!!editing}
          onChange={(id) => {
            setMetalId(id);
            setPurityId(null);
          }}
        />
        <SelectField
          label="Purity"
          value={purityId}
          options={purityOptions}
          disabled={!!editing || !metalId}
          onChange={setPurityId}
          placeholder="Select a metal first"
        />
        <Input label="Rate per gram (₹)" value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="e.g. 7250" />
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingTop: spacing.lg },
  error: { fontSize: 13, color: colors.error, textAlign: 'center', marginTop: spacing.md },
  sheetError: { fontSize: 13, color: colors.error, marginBottom: spacing.sm },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
  addButton: { padding: spacing.lg },
});