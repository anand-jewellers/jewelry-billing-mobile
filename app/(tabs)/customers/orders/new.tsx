// app/(tabs)/customers/orders/new.tsx

import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../../../src/components/ui';
import { DateField } from '../../../../src/components/ui/DateFilter';
import { SelectField, SelectOption } from '../../../../src/components/ui/SelectField';
import { MultiSelectField } from '../../../../src/components/ui/MultiSelectField';
import { colors, spacing } from '../../../../src/theme';
import { createCustomerOrder } from '../../../../src/lib/api/customerOrders';
import { getCustomerById } from '../../../../src/lib/api/customers';
import { getMetals, getPurities, getCategories, getStoneNames } from '../../../../src/lib/products';
import { createCategory, createPurity, createStoneName } from '../../../../src/lib/api/settings';
import { useKeyboardHeight } from '../../../../src/lib/useKeyboardHeight';
import { useNotifications } from '../../../../src/context/NotificationContext';
import { formatDisplayDate } from '../../../../src/lib/dateUtils';

export default function NewCustomerOrderScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const keyboardHeight = useKeyboardHeight();
  const { notify } = useNotifications();

  const [loadingMeta, setLoadingMeta] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Master data (same sources as the Add Product screen)
  const [categories, setCategories] = useState<SelectOption[]>([]);
  const [metals, setMetals] = useState<SelectOption[]>([]);
  const [purities, setPurities] = useState<SelectOption[]>([]);
  const [stoneOptions, setStoneOptions] = useState<SelectOption[]>([]);

  // Selections (ids)
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [metalId, setMetalId] = useState<string | null>(null);
  const [purityId, setPurityId] = useState<string | null>(null);
  const [stoneIds, setStoneIds] = useState<string[]>([]);

  const [weightMin, setWeightMin] = useState('');
  const [weightMax, setWeightMax] = useState('');
  const [stoneWeight, setStoneWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState<string | null>(null);

  // ---------------------------------------------------------
  // Load categories, metals and stone names from the database
  // ---------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const [c, m, stones] = await Promise.all([getCategories(), getMetals(), getStoneNames()]);
        setCategories((c ?? []).map((x: any) => ({ id: x.id, label: x.name })));
        setMetals((m ?? []).map((x: any) => ({ id: x.id, label: x.name })));
        setStoneOptions((stones ?? []).map((x: any) => ({ id: x.id, label: x.name })));
      } catch (e: any) {
        setError(e?.message ?? 'Could not load master data.');
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, []);

  // Purities depend on the selected metal
  useEffect(() => {
    setPurityId(null);
    setPurities([]);
    if (!metalId) return;
    getPurities(metalId)
      .then((p) => setPurities((p ?? []).map((x: any) => ({ id: x.id, label: x.name }))))
      .catch((e) => setError(e?.message ?? 'Could not load purities.'));
  }, [metalId]);

  // ---------------------------------------------------------
  // Inline "Add New" handlers (same pattern as Add Product)
  // ---------------------------------------------------------
  async function handleAddCategory(name: string): Promise<SelectOption> {
    const created = await createCategory({ name });
    const opt: SelectOption = { id: created.id, label: created.name };
    setCategories((prev) => [...prev, opt].sort((a, b) => a.label.localeCompare(b.label)));
    return opt;
  }

  async function handleAddPurity(name: string): Promise<SelectOption> {
    if (!metalId) throw new Error('Select a metal first');
    const created = await createPurity({ metal_id: metalId, name, purity_percentage: null });
    const opt: SelectOption = { id: created.id, label: created.name };
    setPurities((prev) => [...prev, opt].sort((a, b) => a.label.localeCompare(b.label)));
    return opt;
  }

  async function handleAddStoneName(name: string): Promise<SelectOption> {
    const created = await createStoneName({ name });
    const opt: SelectOption = { id: created.id, label: created.name };
    setStoneOptions((prev) => [...prev, opt].sort((a, b) => a.label.localeCompare(b.label)));
    return opt;
  }

  // ---------------------------------------------------------
  // Save
  //
  // The order still stores category / metal / purity / stone as NAMES
  // (that's what the invoice prefill matches on), so the selected ids
  // are resolved back to their master-table names here.
  // ---------------------------------------------------------
  const handleSave = async () => {
    if (!customerId) return;

    const categoryName = categories.find((c) => c.id === categoryId)?.label;
    const metalName = metals.find((m) => m.id === metalId)?.label;
    const purityName = purities.find((p) => p.id === purityId)?.label;

    if (!categoryName) return setError('Select a category.');
    if (!metalName) return setError('Select a metal.');
    if (!purityName) return setError('Select a purity.');

    const min = parseFloat(weightMin);
    const max = parseFloat(weightMax);
    if (isNaN(min) || isNaN(max)) return setError('Enter a valid weight range.');
    if (min > max) return setError('Minimum weight cannot exceed maximum weight.');

    // A jewel order can carry several stones — stored as one comma-separated string.
    const stoneNames = stoneIds
      .map((id) => stoneOptions.find((s) => s.id === id)?.label)
      .filter(Boolean)
      .join(', ');

    setSaving(true);
    setError(null);
    try {
      const order = await createCustomerOrder({
        customer_id: customerId,
        category: categoryName,
        metal: metalName,
        purity: purityName,
        weight_min: min,
        weight_max: max,
        stone_weight: stoneWeight ? parseFloat(stoneWeight) : null,
        stone_name: stoneNames || null,
        notes,
        due_date: dueDate,
      });

      // Tell the other staff a new order was created
      let customerName = '';
      try {
        customerName = (await getCustomerById(customerId))?.name ?? '';
      } catch {}

      await notify(
        'order',
        'New jewel order',
        `${order.order_number}${customerName ? ` for ${customerName}` : ''}: ${categoryName}, ${metalName} (${purityName}), ${min}–${max}g` +
          (dueDate ? `, due ${formatDisplayDate(dueDate)}` : '')
      );

      router.replace(`/customers/orders/${order.id}`);
    } catch (e: any) {
      setError(e?.message ?? 'Could not create order.');
    } finally {
      setSaving(false);
    }
  };

  if (loadingMeta) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xl * 2 + keyboardHeight }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>New Jewel Order</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.sectionTitle}>Category</Text>
      <SelectField
        label="Category"
        value={categoryId}
        options={categories}
        onChange={setCategoryId}
        onAddNew={handleAddCategory}
      />

      <Text style={styles.sectionTitle}>Metal & Purity</Text>
      <SelectField label="Metal" value={metalId} options={metals} onChange={setMetalId} />
      <SelectField
        label="Purity"
        value={purityId}
        options={purities}
        onChange={setPurityId}
        disabled={!metalId}
        onAddNew={handleAddPurity}
      />

      <Text style={styles.sectionTitle}>Weight Range (grams)</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.rowInput]}
          placeholder="Min weight"
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          value={weightMin}
          onChangeText={setWeightMin}
        />
        <TextInput
          style={[styles.input, styles.rowInput]}
          placeholder="Max weight"
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          value={weightMax}
          onChangeText={setWeightMax}
        />
      </View>

      <Text style={styles.sectionTitle}>Stones</Text>
      <MultiSelectField
        options={stoneOptions}
        values={stoneIds}
        onChange={setStoneIds}
        placeholder="Select stones"
        onAddNew={handleAddStoneName}
      />
      {stoneOptions.length === 0 && (
        <Text style={styles.helperText}>
          No stone names yet — tap the field and use "+ Add New" to create one.
        </Text>
      )}
      <TextInput
        style={styles.input}
        placeholder="Stone weight (ct, optional)"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
        value={stoneWeight}
        onChangeText={setStoneWeight}
      />

      <Text style={styles.sectionTitle}>Due Date (optional)</Text>
      <DateField
        value={dueDate}
        onChange={setDueDate}
        placeholder="When does the customer need it?"
        minimumDate={new Date()}
        title="Due date"
      />

      <Text style={styles.sectionTitle}>Notes (optional)</Text>
      <TextInput
        style={[styles.input, styles.notesInput]}
        placeholder="Design reference, special instructions"
        placeholderTextColor={colors.textMuted}
        value={notes}
        onChangeText={setNotes}
        onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300)}
        multiline
      />

      <View style={{ marginTop: spacing.lg }}>
        <Button label={saving ? 'Creating…' : 'Create Order'} onPress={handleSave} disabled={saving} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  error: { fontSize: 13, color: colors.error, marginBottom: spacing.md, textAlign: 'center' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  notesInput: { minHeight: 70, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: spacing.sm },
  rowInput: { flex: 1 },
  helperText: { color: colors.textMuted, fontSize: 12, marginTop: 2, marginBottom: spacing.sm, fontStyle: 'italic' },
});