// app\(tabs)\settings\metals.tsx
import { useCallback, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card, Button, Input } from '../../../src/components/ui';
import { FormSheet, SelectField } from '../../../src/components/master';
import { ManageListItem } from '../../../src/components/master/ManageListItem';
import { colors, spacing } from '../../../src/theme';
import { listMetals, createMetal, updateMetal, deleteMetal } from '../../../src/lib/api/settings';
import type { Metal } from '../../../src/types/settings';

const METAL_TYPES = [
  { id: 'gold', label: 'Gold' },
  { id: 'silver', label: 'Silver' },
  { id: 'platinum', label: 'Platinum' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'other', label: 'Other' },
];

export default function MetalsScreen() {
  const [metals, setMetals] = useState<Metal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Metal | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    listMetals()
      .then((list) => {
        setMetals(list);
        setError(null);
      })
      .catch(() => setError('Could not load metals.'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => {
    setEditing(null);
    setName('');
    setCode('');
    setType(null);
    setError(null);
    setSheetOpen(true);
  };

  const openEdit = (metal: Metal) => {
    setEditing(metal);
    setName(metal.name);
    setCode(metal.code);
    setType(metal.type);
    setError(null);
    setSheetOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !code.trim() || !type) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        type: type as Metal['type'],
      };
      if (editing) {
        await updateMetal(editing.id, payload);
      } else {
        // If a deleted metal with the same name/code exists, it is brought back.
        await createMetal(payload);
      }
      setSheetOpen(false);
      load();
    } catch (e: any) {
      console.log('save metal failed:', JSON.stringify(e, null, 2));
      const errCode = e?.code; // Postgres/Supabase error code
      if (errCode === '23505') setError('That code is already in use.');
      else if (errCode === '23514') setError('Invalid metal type.');
      else if (errCode === '42501') setError('Permission denied (RLS policy).');
      else setError(e?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  // Soft delete: hides the metal (and its purities) in the app, keeps it in the database.
  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await deleteMetal(id);
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
            data={metals}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ManageListItem
                title={item.name}
                subtitle={`${item.code} · ${item.type}`}
                confirmNote="Its purities will also be hidden."
                onEdit={() => openEdit(item)}
                onDelete={() => handleDelete(item.id)}
              />
            )}
            ListEmptyComponent={<Text style={styles.emptyText}>No metals yet.</Text>}
          />
        </Card>
      )}

      <View style={styles.addButton}>
        <Button label="Add Metal" onPress={openAdd} />
      </View>

      <FormSheet
        visible={sheetOpen}
        title={editing ? 'Edit Metal' : 'Add Metal'}
        onClose={() => setSheetOpen(false)}
        onSave={handleSave}
        saving={saving}
      >
        {error ? <Text style={styles.sheetError}>{error}</Text> : null}
        <Input label="Name" value={name} onChangeText={setName} placeholder="e.g. Gold" />
        <Input label="Code" value={code} onChangeText={setCode} placeholder="e.g. GOLD" autoCapitalize="characters" />
        <SelectField label="Type" value={type} options={METAL_TYPES} onChange={setType} />
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