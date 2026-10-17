// app/(tabs)/customers/orders/new.tsx

import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../../../src/components/ui';
import { DateField } from '../../../../src/components/ui/DateFilter';
import { SelectField, SelectOption } from '../../../../src/components/ui/SelectField';
// import { MultiSelectField } from '../../../../src/components/ui/MultiSelectField'; // stone name removed
import { ImagePickerGrid, PickedImage } from '../../../../src/components/product/ImagePickerGrid';
import { colors, spacing } from '../../../../src/theme';
import {
  createCustomerOrder,
  attachOrderReferenceImages,
  PAYMENT_MODES,
  PaymentMode,
} from '../../../../src/lib/api/customerOrders';
import { getCustomerById } from '../../../../src/lib/api/customers';
import { getMetals, getPurities, getCategories /*, getStoneNames */ } from '../../../../src/lib/products';
import { createCategory, createPurity /*, createStoneName */ } from '../../../../src/lib/api/settings';
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
  // const [stoneOptions, setStoneOptions] = useState<SelectOption[]>([]); // stone name removed

  // Selections (ids)
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [metalId, setMetalId] = useState<string | null>(null);
  const [purityId, setPurityId] = useState<string | null>(null);
  // const [stoneIds, setStoneIds] = useState<string[]>([]); // stone name removed

  const [weightMin, setWeightMin] = useState('');
  const [weightMax, setWeightMax] = useState(''); // optional
  const [stoneWeight, setStoneWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState<string | null>(null);

  // Charges (same fields as the Add Product screen)
  const [vacPercent, setVacPercent] = useState('');
  const [makingChargeFixed, setMakingChargeFixed] = useState('');
  const [stoneChargeFixed, setStoneChargeFixed] = useState('');

  // Reference pictures
  const [images, setImages] = useState<PickedImage[]>([]);

  // Goldsmith
  const [goldsmithName, setGoldsmithName] = useState('');
  const [goldsmithPhone, setGoldsmithPhone] = useState('');

  // Advance payment
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(null);

  // ---------------------------------------------------------
  // Load categories and metals from the database
  // ---------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const [c, m /*, stones */] = await Promise.all([getCategories(), getMetals() /*, getStoneNames() */]);
        setCategories((c ?? []).map((x: any) => ({ id: x.id, label: x.name })));
        setMetals((m ?? []).map((x: any) => ({ id: x.id, label: x.name })));
        // setStoneOptions((stones ?? []).map((x: any) => ({ id: x.id, label: x.name })));
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

  // Stone name removed
  // async function handleAddStoneName(name: string): Promise<SelectOption> {
  //   const created = await createStoneName({ name });
  //   const opt: SelectOption = { id: created.id, label: created.name };
  //   setStoneOptions((prev) => [...prev, opt].sort((a, b) => a.label.localeCompare(b.label)));
  //   return opt;
  // }

  // ---------------------------------------------------------
  // Save
  //
  // The order still stores category / metal / purity as NAMES
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

    // Min weight is required, max weight is optional
    const min = parseFloat(weightMin);
    if (isNaN(min)) return setError('Enter the minimum weight.');
    const max = weightMax.trim() ? parseFloat(weightMax) : null;
    if (max !== null && isNaN(max)) return setError('Enter a valid maximum weight.');
    if (max !== null && min > max) return setError('Minimum weight cannot exceed maximum weight.');

    const advance = advanceAmount.trim() ? parseFloat(advanceAmount) : null;
    if (advance !== null && (isNaN(advance) || advance < 0)) return setError('Enter a valid advance amount.');
    if (advance && !paymentMode) return setError('Select a payment mode for the advance.');

    // Stone name removed
    // A jewel order can carry several stones — stored as one comma-separated string.
    // const stoneNames = stoneIds
    //   .map((id) => stoneOptions.find((s) => s.id === id)?.label)
    //   .filter(Boolean)
    //   .join(', ');

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
        // stone_name: stoneNames || null,
        notes,
        due_date: dueDate,
        vac_percent: vacPercent ? parseFloat(vacPercent) : null,
        making_charge: makingChargeFixed ? parseFloat(makingChargeFixed) : null,
        stone_charge: stoneChargeFixed ? parseFloat(stoneChargeFixed) : null,
        goldsmith_name: goldsmithName,
        goldsmith_phone: goldsmithPhone,
        advance_amount: advance,
        payment_mode: advance ? paymentMode : null,
      });

      // Upload reference pictures (order is already saved; a failed upload shouldn't lose it)
      const withData = images.filter((i) => !!i.base64) as { base64: string }[];
      if (withData.length) {
        try {
          await attachOrderReferenceImages(order.id, withData);
        } catch (imgErr) {
          console.warn('Failed to upload order reference images', imgErr);
        }
      }

      // Tell the other staff a new order was created
      let customerName = '';
      try {
        customerName = (await getCustomerById(customerId))?.name ?? '';
      } catch {}

      const weightText = max !== null ? `${min}–${max}g` : `${min}g`;
      try {
        await notify(
          'order',
          'New jewel order',
          `${order.order_number}${customerName ? ` for ${customerName}` : ''}: ${categoryName}, ${metalName} (${purityName}), ${weightText}` +
            (dueDate ? `, due ${formatDisplayDate(dueDate)}` : '')
        );
      } catch (notifyError) {
        console.warn('Failed to send order notification', notifyError);
      }

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

      <Text style={styles.sectionTitle}>Reference Pictures</Text>
      <ImagePickerGrid images={images} onChange={setImages} />

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
          placeholder="Min weight *"
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          value={weightMin}
          onChangeText={setWeightMin}
        />
        <TextInput
          style={[styles.input, styles.rowInput]}
          placeholder="Max weight (optional)"
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          value={weightMax}
          onChangeText={setWeightMax}
        />
      </View>

      {/* Stone name field removed
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
      */}
      <Text style={styles.sectionTitle}>Stone Weight</Text>
      <TextInput
        style={styles.input}
        placeholder="Stone weight (ct, optional)"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
        value={stoneWeight}
        onChangeText={setStoneWeight}
      />

      <Text style={styles.sectionTitle}>Charges</Text>
      <View style={styles.row}>
        <View style={styles.rowInput}>
          <Text style={styles.label}>Value added %</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            value={vacPercent}
            onChangeText={setVacPercent}
          />
        </View>
        <View style={styles.rowInput}>
          <Text style={styles.label}>Making charge ₹</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            value={makingChargeFixed}
            onChangeText={setMakingChargeFixed}
          />
        </View>
      </View>
      <Text style={styles.label}>Stone charge ₹</Text>
      <TextInput
        style={styles.input}
        placeholder="0"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
        value={stoneChargeFixed}
        onChangeText={setStoneChargeFixed}
      />

      <Text style={styles.sectionTitle}>Issued to Goldsmith</Text>
      <TextInput
        style={styles.input}
        placeholder="Goldsmith name"
        placeholderTextColor={colors.textMuted}
        value={goldsmithName}
        onChangeText={setGoldsmithName}
      />
      <TextInput
        style={styles.input}
        placeholder="Goldsmith phone number"
        placeholderTextColor={colors.textMuted}
        keyboardType="phone-pad"
        value={goldsmithPhone}
        onChangeText={setGoldsmithPhone}
      />

      <Text style={styles.sectionTitle}>Advance Payment</Text>
      <TextInput
        style={styles.input}
        placeholder="Advance amount ₹ (optional)"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
        value={advanceAmount}
        onChangeText={setAdvanceAmount}
      />
      <Text style={styles.label}>Payment mode</Text>
      <View style={styles.chipWrap}>
        {PAYMENT_MODES.map((mode) => {
          const active = paymentMode === mode;
          return (
            <TouchableOpacity
              key={mode}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setPaymentMode(active ? null : mode)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{mode}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

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
  label: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 6 },
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
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  chipTextActive: { color: '#fff' },
});