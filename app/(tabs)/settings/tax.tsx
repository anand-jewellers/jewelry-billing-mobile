import { useCallback, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card, Button, Input } from '../../../src/components/ui';
import { MasterListItem, FormSheet } from '../../../src/components/master';
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
      .then(setItems)
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
    setSheetOpen(true);
  };

  const openEdit = (item: TaxSetting) => {
    setEditing(item);
    setTaxName(item.tax_name);
    setPercentage(item.tax_percentage.toString());
    setCgst(item.cgst.toString());
    setSgst(item.sgst.toString());
    setIgst(item.igst.toString());
    setSheetOpen(true);
  };

  const handleSave = async () => {
    if (!taxName.trim()) return;
    setSaving(true);
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
    } catch {
      setError('Could not save the tax setting.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTaxSetting(id);
      load();
    } catch {
      setError('Could not delete the tax setting.');
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
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <MasterListItem
                title={item.tax_name}
                subtitle={`${item.tax_percentage}% total · CGST ${item.cgst}% · SGST ${item.sgst}% · IGST ${item.igst}%`}
                isActive={item.is_active}
                onPress={() => openEdit(item)}
                onDelete={() => handleDelete(item.id)}
              />
            )}
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
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
  addButton: { padding: spacing.lg },
});
