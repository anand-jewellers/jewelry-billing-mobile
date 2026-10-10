// app\(tabs)\settings\categories.tsx
import { useCallback, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card, Button, Input } from '../../../src/components/ui';
import { FormSheet } from '../../../src/components/master';
import { ManageListItem } from '../../../src/components/master/ManageListItem';
import { colors, spacing } from '../../../src/theme';
import { listCategories, createCategory, updateCategory, deleteCategory } from '../../../src/lib/api/settings';
import type { Category } from '../../../src/types/settings';

export default function CategoriesScreen() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    listCategories()
      .then((list) => {
        setCategories(list);
        setError(null);
      })
      .catch(() => setError('Could not load categories.'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => {
    setEditing(null);
    setName('');
    setError(null);
    setSheetOpen(true);
  };

  const openEdit = (category: Category) => {
    setEditing(category);
    setName(category.name);
    setError(null);
    setSheetOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateCategory(editing.id, { name: name.trim() });
      } else {
        // If a deleted category with the same name exists, it is brought back.
        await createCategory({ name: name.trim() });
      }
      setSheetOpen(false);
      load();
    } catch (e: any) {
      setError(e?.message || 'Could not save. That category may already exist.');
    } finally {
      setSaving(false);
    }
  };

  // Soft delete: hides the category (and its subcategories) in the app, keeps it in the database.
  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await deleteCategory(id);
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
            data={categories}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ManageListItem
                title={item.name}
                confirmNote="Its subcategories will also be hidden."
                onEdit={() => openEdit(item)}
                onDelete={() => handleDelete(item.id)}
              />
            )}
            contentContainerStyle={categories.length === 0 ? { flexGrow: 1 } : undefined}
            ListEmptyComponent={<Text style={styles.emptyText}>No categories yet.</Text>}
          />
        </Card>
      )}

      <View style={styles.addButton}>
        <Button label="Add Category" onPress={openAdd} />
      </View>

      <FormSheet
        visible={sheetOpen}
        title={editing ? 'Edit Category' : 'Add Category'}
        onClose={() => setSheetOpen(false)}
        onSave={handleSave}
        saving={saving}
      >
        {error ? <Text style={styles.sheetError}>{error}</Text> : null}
        <Input label="Name" value={name} onChangeText={setName} placeholder="e.g. Ring" />
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