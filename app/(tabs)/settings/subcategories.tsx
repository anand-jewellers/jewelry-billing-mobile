// app\(tabs)\settings\subcategories.tsx
import { useCallback, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card, Button, Input } from '../../../src/components/ui';
import { FormSheet } from '../../../src/components/master';
import { ManageListItem } from '../../../src/components/master/ManageListItem';
import { SelectField, SelectOption } from '../../../src/components/ui/SelectField';
import { colors, spacing } from '../../../src/theme';
import { listSubcategories, createSubcategory, updateSubcategory, deleteSubcategory } from '../../../src/lib/api/settings';
import { getCategories } from '../../../src/lib/products';
import type { Subcategory } from '../../../src/types/settings';

type Row = Subcategory & { categories?: { name: string } };

export default function SubcategoriesScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([listSubcategories(), getCategories()])
      .then(([subs, cats]) => {
        setRows(subs);
        setCategoryOptions((cats ?? []).map((c: any) => ({ id: c.id, label: c.name })));
        setError(null);
      })
      .catch(() => setError('Could not load subcategories.'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => {
    setEditing(null);
    setName('');
    setCategoryId(null);
    setError(null);
    setSheetOpen(true);
  };

  const openEdit = (item: Row) => {
    setEditing(item);
    setName(item.name);
    setCategoryId(item.category_id);
    setError(null);
    setSheetOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !categoryId) return;
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateSubcategory(editing.id, { name: name.trim(), category_id: categoryId });
      } else {
        // If a deleted subcategory with the same name under this category exists, it is brought back.
        await createSubcategory({ category_id: categoryId, name: name.trim() });
      }
      setSheetOpen(false);
      load();
    } catch (e: any) {
      setError(e?.message || 'Could not save. That subcategory may already exist under this category.');
    } finally {
      setSaving(false);
    }
  };

  // Soft delete: hides the subcategory in the app, keeps it in the database.
  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await deleteSubcategory(id);
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
            data={rows}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ManageListItem
                title={item.name}
                subtitle={item.categories?.name ?? '—'}
                onEdit={() => openEdit(item)}
                onDelete={() => handleDelete(item.id)}
              />
            )}
            contentContainerStyle={rows.length === 0 ? { flexGrow: 1 } : undefined}
            ListEmptyComponent={<Text style={styles.emptyText}>No subcategories yet.</Text>}
          />
        </Card>
      )}

      <View style={styles.addButton}>
        <Button label="Add Sub Category" onPress={openAdd} />
      </View>

      <FormSheet
        visible={sheetOpen}
        title={editing ? 'Edit Sub Category' : 'Add Sub Category'}
        onClose={() => setSheetOpen(false)}
        onSave={handleSave}
        saving={saving}
      >
        {error ? <Text style={styles.sheetError}>{error}</Text> : null}
        <SelectField label="Category" value={categoryId} options={categoryOptions} onChange={setCategoryId} />
        <Input label="Name" value={name} onChangeText={setName} placeholder="e.g. Chain" />
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