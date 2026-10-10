// app\(tabs)\settings\purity.tsx

import { useCallback, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card, Button, Input } from '../../../src/components/ui';
import { FormSheet, SelectField } from '../../../src/components/master';
import { ManageListItem } from '../../../src/components/master/ManageListItem';
import { colors, spacing } from '../../../src/theme';
import { listMetals, listPurities, createPurity, updatePurity, deletePurity } from '../../../src/lib/api/settings';
import type { Metal, Purity } from '../../../src/types/settings';

export default function PurityScreen() {
  const [metals, setMetals] = useState<Metal[]>([]);
  const [purities, setPurities] = useState<Purity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Purity | null>(null);
  const [metalId, setMetalId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [percentage, setPercentage] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([listMetals(), listPurities()])
      .then(([m, p]) => {
        setMetals(m);
        setPurities(p);
        setError(null);
      })
      .catch(() => setError('Could not load purities.'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const metalOptions = metals.map((m) => ({ id: m.id, label: m.name }));
  const metalName = (id: string) => metals.find((m) => m.id === id)?.name ?? '—';

  const openAdd = () => {
    setEditing(null);
    setMetalId(null);
    setName('');
    setPercentage('');
    setError(null);
    setSheetOpen(true);
  };

  const toFineness = (pct: number | null) =>
    pct != null ? Math.round(pct * 10) : null;

  const formatPuritySubtitle = (item: Purity, metal: string) => {
    if (item.purity_percentage == null) return metal;
    const fineness = toFineness(item.purity_percentage);
    return `${metal} · ${item.purity_percentage}% · ${fineness}`;
  };

  const openEdit = (purity: Purity) => {
    setEditing(purity);
    setMetalId(purity.metal_id);
    setName(purity.name);
    setPercentage(purity.purity_percentage?.toString() ?? '');
    setError(null);
    setSheetOpen(true);
  };

  const handleSave = async () => {
    if (!metalId || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const input = {
        metal_id: metalId,
        name: name.trim(),
        purity_percentage: percentage ? parseFloat(percentage) : null,
      };
      if (editing) {
        await updatePurity(editing.id, input);
      } else {
        // If a deleted purity with the same name for this metal exists, it is brought back.
        await createPurity(input);
      }
      setSheetOpen(false);
      load();
    } catch (e: any) {
      setError(e?.message || 'Could not save. That purity may already exist for this metal.');
    } finally {
      setSaving(false);
    }
  };

  // Soft delete: hides the purity in the app, keeps it in the database.
  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await deletePurity(id);
      load();
    } catch (e: any) {
      setError(e?.message || 'Could not delete.');
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
            data={purities}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ManageListItem
                title={item.name}
                subtitle={formatPuritySubtitle(item, metalName(item.metal_id))}
                onEdit={() => openEdit(item)}
                onDelete={() => handleDelete(item.id)}
              />
            )}
            contentContainerStyle={purities.length === 0 ? { flexGrow: 1 } : undefined}
            ListEmptyComponent={<Text style={styles.emptyText}>No purities yet.</Text>}
          />
        </Card>
      )}

      <View style={styles.addButton}>
        <Button label="Add Purity" onPress={openAdd} />
      </View>

      <FormSheet
        visible={sheetOpen}
        title={editing ? 'Edit Purity' : 'Add Purity'}
        onClose={() => setSheetOpen(false)}
        onSave={handleSave}
        saving={saving}
      >
        {error ? <Text style={styles.sheetError}>{error}</Text> : null}
        <SelectField label="Metal" value={metalId} options={metalOptions} onChange={setMetalId} />
        <Input label="Name" value={name} onChangeText={setName} placeholder="e.g. 22K" />
        <Input
          label="Purity % (optional)"
          value={percentage}
          onChangeText={setPercentage}
          placeholder="e.g. 91.6"
          keyboardType="decimal-pad"
        />
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  error: { fontSize: 13, color: colors.error, textAlign: 'center', marginTop: spacing.md },
  sheetError: { fontSize: 13, color: colors.error, marginBottom: spacing.sm },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
  addButton: { padding: spacing.lg },
});