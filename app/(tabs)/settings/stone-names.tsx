import { useCallback, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card, Button, Input } from '../../../src/components/ui';
import { MasterListItem, FormSheet } from '../../../src/components/master';
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
      .then(setStones)
      .catch(() => setError('Could not load stone names.'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => {
    setEditing(null);
    setName('');
    setSheetOpen(true);
  };

  const openEdit = (stone: StoneName) => {
    setEditing(stone);
    setName(stone.name);
    setSheetOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await updateStoneName(editing.id, { name: name.trim() });
      } else {
        await createStoneName({ name: name.trim() });
      }
      setSheetOpen(false);
      load();
    } catch {
      setError('Could not save. That stone name may already exist.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteStoneName(id);
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
        <Card padded={false} style={{ margin: spacing.lg }}>
          <FlatList
            data={stones}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <MasterListItem
                title={item.name}
                isActive={item.is_active}
                onPress={() => openEdit(item)}
                onDelete={() => handleDelete(item.id)}
              />
            )}
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
        <Input label="Name" value={name} onChangeText={setName} placeholder="e.g. Ruby" />
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