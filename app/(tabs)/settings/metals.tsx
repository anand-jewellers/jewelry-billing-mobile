import { useCallback, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card, Button, Input } from '../../../src/components/ui';
import { MasterListItem, FormSheet, SelectField } from '../../../src/components/master';
import { colors, spacing } from '../../../src/theme';
import { listMetals, createMetal, updateMetal, deleteMetal } from '../../../src/lib/api/settings';
import type { Metal } from '../../../src/types/settings';

const METAL_TYPES = [
  { id: 'gold', label: 'Gold' },
  { id: 'silver', label: 'Silver' },
  { id: 'platinum', label: 'Platinum' },
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
      .then(setMetals)
      .catch(() => setError('Could not load metals.'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => {
    setEditing(null);
    setName('');
    setCode('');
    setType(null);
    setSheetOpen(true);
  };

  const openEdit = (metal: Metal) => {
    setEditing(metal);
    setName(metal.name);
    setCode(metal.code);
    setType(metal.type);
    setSheetOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !code.trim() || !type) return;
    setSaving(true);
    try {
      if (editing) {
        await updateMetal(editing.id, { name: name.trim(), code: code.trim().toUpperCase(), type: type as Metal['type'] });
      } else {
        await createMetal({ name: name.trim(), code: code.trim().toUpperCase(), type: type as Metal['type'] });
      }
      setSheetOpen(false);
      load();
    } catch {
      setError('Could not save. That code may already be in use.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMetal(id);
      load();
    } catch {
      setError('Could not delete — it may be in use by products or purities.');
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
              <MasterListItem
                title={item.name}
                subtitle={`${item.code} · ${item.type}`}
                isActive={item.is_active}
                onPress={() => openEdit(item)}
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
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
  addButton: { padding: spacing.lg },
});
