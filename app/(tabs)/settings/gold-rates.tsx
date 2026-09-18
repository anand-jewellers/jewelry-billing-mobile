import { useCallback, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card, Button, Input } from '../../../src/components/ui';
import { FormSheet, SelectField } from '../../../src/components/master';
import { colors, spacing } from '../../../src/theme';
import { listMetals, listPurities, listCurrentRates, addMetalRate } from '../../../src/lib/api/settings';
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
      })
      .catch(() => setError('Could not load gold rates.'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const metalName = (id: string) => metals.find((m) => m.id === id)?.name ?? '—';
  const purityName = (id: string) => purities.find((p) => p.id === id)?.name ?? '—';

  const metalOptions = metals.map((m) => ({ id: m.id, label: m.name }));
  const purityOptions = purities.filter((p) => p.metal_id === metalId).map((p) => ({ id: p.id, label: p.name }));

  const openAdd = () => {
    setMetalId(null);
    setPurityId(null);
    setRate('');
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

  return (
    <View style={styles.screen}>
      {/* <Text style={styles.note}>
        Adding a rate here sets the new "current" rate for that metal + purity. Past invoices already
        locked in their rate at the time of sale and are unaffected.
      </Text> */}

      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <Card padded={false} style={{ flex: 1, marginHorizontal: spacing.lg }}>
          <FlatList
            data={rates}
            keyExtractor={(item) => `${item.metal_id}-${item.purity_id}`}
            renderItem={({ item }) => (
              <View style={styles.rateRow}>
                <View>
                  <Text style={styles.rateTitle}>
                    {metalName(item.metal_id)} — {purityName(item.purity_id)}
                  </Text>
                  <Text style={styles.rateDate}>as of {item.effective_date}</Text>
                </View>
                <Text style={styles.rateValue}>₹{item.rate_per_gram.toLocaleString('en-IN')}/g</Text>
              </View>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={<Text style={styles.emptyText}>No rates set yet.</Text>}
          />
        </Card>
      )}

      <View style={styles.addButton}>
        <Button label="Add / Update Rate" onPress={openAdd} />
      </View>

      <FormSheet visible={sheetOpen} title="Add / Update Rate" onClose={() => setSheetOpen(false)} onSave={handleSave} saving={saving}>
        <SelectField
          label="Metal"
          value={metalId}
          options={metalOptions}
          onChange={(id) => {
            setMetalId(id);
            setPurityId(null);
          }}
        />
        <SelectField label="Purity" value={purityId} options={purityOptions} onChange={setPurityId} placeholder="Select a metal first" />
        <Input label="Rate per gram (₹)" value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="e.g. 7250" />
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background,paddingTop: spacing.lg, },
  note: {
    fontSize: 12,
    color: colors.textSecondary,
    backgroundColor: colors.primarySurface,
    margin: spacing.lg,
    marginBottom: 0,
    padding: spacing.md,
    borderRadius: 8,
  },
  error: { fontSize: 13, color: colors.error, textAlign: 'center', marginTop: spacing.md },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
  addButton: { padding: spacing.lg },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  rateTitle: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  rateDate: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rateValue: { fontSize: 15, fontWeight: '700', color: colors.gold },
  separator: { height: 1, backgroundColor: colors.border },
});