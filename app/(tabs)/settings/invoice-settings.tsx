import { useEffect, useState } from 'react';
import { ScrollView, Text, View, ActivityIndicator, StyleSheet } from 'react-native';
import { Card, Input, Button } from '../../../src/components/ui';
import { ToggleRow } from '../../../src/components/master';
import { colors, spacing } from '../../../src/theme';
import { getInvoiceSettings, updateInvoiceSettings } from '../../../src/lib/api/settings';
import type { InvoiceSettings } from '../../../src/types/settings';

const emptyForm: Omit<InvoiceSettings, 'id'> = {
  invoice_prefix: 'INV',
  invoice_number_format: '{PREFIX}-{YYYY}-{SEQ:6}',
  starting_number: 1,
  invoice_footer: '',
  terms_and_conditions: '',
  show_logo: true,
  show_huid: true,
  show_weight: true,
  show_making_charges: true,
  show_value_added_charges: true,
};

export default function InvoiceSettingsScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    getInvoiceSettings()
      .then((data) => setForm(data))
      .catch(() => setError('Could not load invoice settings.'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await updateInvoiceSettings(form);
      setSaved(true);
    } catch {
      setError('Could not save. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.lg }}>
      <Card style={{ marginBottom: spacing.lg }}>
        {error && <Text style={styles.error}>{error}</Text>}
        {saved && <Text style={styles.success}>Saved.</Text>}

        <Input
          label="Invoice Prefix"
          value={form.invoice_prefix}
          onChangeText={(v) => setForm((f) => ({ ...f, invoice_prefix: v }))}
          autoCapitalize="characters"
        />
        <Input
          label="Number Format"
          value={form.invoice_number_format}
          onChangeText={(v) => setForm((f) => ({ ...f, invoice_number_format: v }))}
        />
        <Input
          label="Starting Number"
          value={form.starting_number.toString()}
          onChangeText={(v) => setForm((f) => ({ ...f, starting_number: parseInt(v, 10) || 1 }))}
          keyboardType="number-pad"
        />
        <Input
          label="Invoice Footer"
          value={form.invoice_footer ?? ''}
          onChangeText={(v) => setForm((f) => ({ ...f, invoice_footer: v }))}
          multiline
        />
        <Input
          label="Terms & Conditions"
          value={form.terms_and_conditions ?? ''}
          onChangeText={(v) => setForm((f) => ({ ...f, terms_and_conditions: v }))}
          multiline
          style={{ minHeight: 80, textAlignVertical: 'top' }}
        />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Print Options</Text>
        <ToggleRow label="Show Logo" value={form.show_logo} onValueChange={(v) => setForm((f) => ({ ...f, show_logo: v }))} />
        <ToggleRow label="Show HUID" value={form.show_huid} onValueChange={(v) => setForm((f) => ({ ...f, show_huid: v }))} />
        <ToggleRow label="Show Weight" value={form.show_weight} onValueChange={(v) => setForm((f) => ({ ...f, show_weight: v }))} />
        <ToggleRow
          label="Show Making Charges"
          value={form.show_making_charges}
          onValueChange={(v) => setForm((f) => ({ ...f, show_making_charges: v }))}
        />
        <ToggleRow
          label="Show Value Added Charges"
          value={form.show_value_added_charges}
          onValueChange={(v) => setForm((f) => ({ ...f, show_value_added_charges: v }))}
        />
      </Card>

      <View style={{ marginTop: spacing.lg }}>
        <Button label={saving ? 'Saving…' : 'Save Changes'} onPress={handleSave} loading={saving} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  error: { fontSize: 13, color: colors.error, marginBottom: spacing.md, textAlign: 'center' },
  success: { fontSize: 13, color: colors.success, marginBottom: spacing.md, textAlign: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
});
