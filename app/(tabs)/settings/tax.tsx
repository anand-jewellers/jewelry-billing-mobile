// app/(tabs)/settings/tax.tsx

import { useCallback, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card, Button, Input } from '../../../src/components/ui';
import { FormSheet } from '../../../src/components/master';
import { ManageListItem } from '../../../src/components/master/ManageListItem';
import { colors, spacing } from '../../../src/theme';
import { listTaxSettings, createTaxSetting, updateTaxSetting, deleteTaxSetting } from '../../../src/lib/api/settings';
import type { TaxSetting } from '../../../src/types/settings';

export default function TaxSettingsScreen() {
  const [items, setItems] = useState<TaxSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<TaxSetting | null>(null);
  const [taxName, setTaxName] = useState('');
  const [percentage, setPercentage] = useState('');
  const [cgst, setCgst] = useState('');
  const [sgst, setSgst] = useState('');
  const [igst, setIgst] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    listTaxSettings()
      .then((data) => {
        setItems(data);
        setError(null);
      })
      .catch(() => setError('Could not load tax settings.'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = () => {
    setEditing(null);
    setTaxName('');
    setPercentage('');
    setCgst('');
    setSgst('');
    setIgst('');
    setError(null);
    setSheetOpen(true);
  };

  const openEdit = (item: TaxSetting) => {
    setEditing(item);
    setTaxName(item.tax_name);
    setPercentage(item.tax_percentage.toString());
    setCgst(item.cgst.toString());
    setSgst(item.sgst.toString());
    setIgst(item.igst.toString());
    setError(null);
    setSheetOpen(true);
  };

  const handleSave = async () => {
    if (!taxName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const input = {
        tax_name: taxName.trim(),
        tax_percentage: parseFloat(percentage) || 0,
        cgst: parseFloat(cgst) || 0,
        sgst: parseFloat(sgst) || 0,
        igst: parseFloat(igst) || 0,
      };
      if (editing) {
        await updateTaxSetting(editing.id, input);
      } else {
        await createTaxSetting(input);
      }
      setSheetOpen(false);
      load();
    } catch (e: any) {
      setError(e?.message || 'Could not save the tax setting.');
    } finally {
      setSaving(false);
    }
  };

  // Soft delete: hides the tax in the app, keeps it in the database.
  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await deleteTaxSetting(id);
      load();
    } catch (e: any) {
      setError(e?.message || 'Could not delete the tax setting.');
    }
  };

  return (
    <View style={styles.screen}>
      {error && !sheetOpen && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <Card padded={false} style={{ flex: 1, margin: spacing.lg }}>
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ManageListItem
                title={item.tax_name}
                subtitle={`${item.tax_percentage}% · CGST ${item.cgst}% · SGST ${item.sgst}% · IGST ${item.igst}%`}
                onEdit={() => openEdit(item)}
                onDelete={() => handleDelete(item.id)}
              />
            )}
            contentContainerStyle={items.length === 0 ? { flexGrow: 1 } : undefined}
            ListEmptyComponent={<Text style={styles.emptyText}>No tax settings yet.</Text>}
          />
        </Card>
      )}

      <View style={styles.addButton}>
        <Button label="Add Tax" onPress={openAdd} />
      </View>

      <FormSheet
        visible={sheetOpen}
        title={editing ? 'Edit Tax' : 'Add Tax'}
        onClose={() => setSheetOpen(false)}
        onSave={handleSave}
        saving={saving}
      >
        {error ? <Text style={styles.sheetError}>{error}</Text> : null}
        <Input label="Tax Name" value={taxName} onChangeText={setTaxName} placeholder="e.g. GST 3%" />
        <Input label="Total Tax %" value={percentage} onChangeText={setPercentage} keyboardType="decimal-pad" />
        <Input label="CGST %" value={cgst} onChangeText={setCgst} keyboardType="decimal-pad" />
        <Input label="SGST %" value={sgst} onChangeText={setSgst} keyboardType="decimal-pad" />
        <Input label="IGST %" value={igst} onChangeText={setIgst} keyboardType="decimal-pad" />
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