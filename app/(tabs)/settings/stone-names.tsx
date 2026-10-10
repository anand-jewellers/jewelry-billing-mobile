// app\(tabs)\settings\stone-names.tsx  (use your existing file name)
import { useCallback, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card, Button, Input } from '../../../src/components/ui';
import { FormSheet } from '../../../src/components/master';
import { ManageListItem } from '../../../src/components/master/ManageListItem';
import { colors, spacing } from '../../../src/theme';
import { listStoneNames, createStoneName, updateStoneName, deleteStoneName } from '../../../src/lib/api/settings';
import type { StoneName } from '../../../src/types/settings';

export default function StoneNamesScreen() {
  const [stones, setStones] = useState<StoneName[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<StoneName | null>(null);
  const [name, setName] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    listStoneNames()
      .then((list) => {
        setStones(list);
        setError(null);
      })
      .catch(() => setError('Could not load stone names.'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => {
    setEditing(null);
    setName('');
    setError(null);
    setSheetOpen(true);
  };

  const openEdit = (stone: StoneName) => {
    setEditing(stone);
    setName(stone.name);
    setError(null);
    setSheetOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateStoneName(editing.id, { name: name.trim() });
      } else {
        // If a deleted stone with the same name exists, it is brought back.
        await createStoneName({ name: name.trim() });
      }
      setSheetOpen(false);
      load();
    } catch (e: any) {
      setError(e?.message || 'Could not save. That stone name may already exist.');
    } finally {
      setSaving(false);
    }
  };

  // Soft delete: hides the stone in the app, keeps it in the database.
  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await deleteStoneName(id);
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
        <Card padded={false} style={{ flex: 1, margin: spacing.sm, overflow: 'hidden' }}>
          <FlatList
            data={stones}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ManageListItem
                title={item.name}
                onEdit={() => openEdit(item)}
                onDelete={() => handleDelete(item.id)}
              />
            )}
            contentContainerStyle={stones.length === 0 ? { flexGrow: 1 } : undefined}
            ListEmptyComponent={<Text style={styles.emptyText}>No stone names yet.</Text>}
          />
        </Card>
      )}

      <View style={styles.addButton}>
        <Button label="Add Stone Name" onPress={openAdd} />
      </View>

      <FormSheet
        visible={sheetOpen}
        title={editing ? 'Edit Stone Name' : 'Add Stone Name'}
        onClose={() => setSheetOpen(false)}
        onSave={handleSave}
        saving={saving}
      >
        {error ? <Text style={styles.sheetError}>{error}</Text> : null}
        <Input label="Name" value={name} onChangeText={setName} placeholder="e.g. Ruby" />
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  error: { fontSize: 13, color: colors.error, textAlign: 'center', marginTop: spacing.md },
  sheetError: { fontSize: 13, color: colors.error, marginBottom: spacing.sm },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
  addButton: { padding: spacing.sm },
});