// app/(tabs)/customers/add.tsx

import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Input } from '../../../src/components/ui';
import { DateField } from '../../../src/components/ui/DateFilter';
import { SelectField, SelectOption } from '../../../src/components/ui/SelectField';
import { MultiSelectField } from '../../../src/components/ui/MultiSelectField';
import { ErrorModal } from '../../../src/components/ui/ErrorModal';
import { colors, spacing } from '../../../src/theme';
import { createCustomer } from '../../../src/lib/api/customers';
import { createCustomerOrder } from '../../../src/lib/api/customerOrders';
import { getMetals, getPurities, getCategories, getStoneNames } from '../../../src/lib/products';
import { createCategory, createPurity, createStoneName } from '../../../src/lib/api/settings';
import { useKeyboardHeight } from '../../../src/lib/useKeyboardHeight';
import { useNotifications } from '../../../src/context/NotificationContext';
import { formatDisplayDate } from '../../../src/lib/dateUtils';

export default function AddCustomerScreen() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const keyboardHeight = useKeyboardHeight();
  const { notify } = useNotifications();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [gstin, setGstin] = useState('');

  // Master data (same sources as the Add Product screen)
  const [categories, setCategories] = useState<SelectOption[]>([]);
  const [metals, setMetals] = useState<SelectOption[]>([]);
  const [purities, setPurities] = useState<SelectOption[]>([]);
  const [stoneOptions, setStoneOptions] = useState<SelectOption[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);

  // Selections (ids)
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [metalId, setMetalId] = useState<string | null>(null);
  const [purityId, setPurityId] = useState<string | null>(null);
  const [stoneIds, setStoneIds] = useState<string[]>([]);

  const [weightMin, setWeightMin] = useState('');
  const [weightMax, setWeightMax] = useState('');
  const [stoneWeight, setStoneWeight] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [dueDate, setDueDate] = useState<string | null>(null);

  // The jewel order fields are always visible. An order is only created when
  // the cashier has filled in at least one of them; if they're all left
  // blank, only the customer is saved. Once any field is touched, the full
  // order validation below applies (category, metal, purity, weight range).
  const includeOrder =
    !!categoryId ||
    !!metalId ||
    !!purityId ||
    weightMin.trim() !== '' ||
    weightMax.trim() !== '' ||
    stoneIds.length > 0 ||
    stoneWeight.trim() !== '' ||
    orderNotes.trim() !== '' ||
    !!dueDate;

  const [saving, setSaving] = useState(false);

  // Error modal state. errorInfo is intentionally NOT cleared on close so the
  // message stays mounted while the modal fades out; errorVisible drives it.
  const [errorInfo, setErrorInfo] = useState<{ title: string; message: string } | null>(null);
  const [errorVisible, setErrorVisible] = useState(false);

  function showError(message: string, title = 'Something went wrong') {
    setErrorInfo({ title, message });
    setErrorVisible(true);
  }

  // Load categories, metals and stone names from the database
  useEffect(() => {
    (async () => {
      try {
        const [c, m, stones] = await Promise.all([getCategories(), getMetals(), getStoneNames()]);
        setCategories((c ?? []).map((x: any) => ({ id: x.id, label: x.name })));
        setMetals((m ?? []).map((x: any) => ({ id: x.id, label: x.name })));
        setStoneOptions((stones ?? []).map((x: any) => ({ id: x.id, label: x.name })));
      } catch (e: any) {
        console.warn('Could not load order master data:', e);
        showError(e?.message ?? 'Could not load order master data.');
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
      .catch((e) => {
        console.warn('Could not load purities:', e);
        showError(e?.message ?? 'Failed to load purities');
      });
  }, [metalId]);

  // ---------------------------------------------------------
  // Inline "Add New" handlers (same pattern as Add Product)
  // Errors are thrown so the dropdown component can handle them itself.
  // ---------------------------------------------------------
  async function handleAddCategory(newName: string): Promise<SelectOption> {
    const created = await createCategory({ name: newName });
    const opt: SelectOption = { id: created.id, label: created.name };
    setCategories((prev) => [...prev, opt].sort((a, b) => a.label.localeCompare(b.label)));
    return opt;
  }

  async function handleAddPurity(newName: string): Promise<SelectOption> {
    if (!metalId) throw new Error('Select a metal first');
    const created = await createPurity({ metal_id: metalId, name: newName, purity_percentage: null });
    const opt: SelectOption = { id: created.id, label: created.name };
    setPurities((prev) => [...prev, opt].sort((a, b) => a.label.localeCompare(b.label)));
    return opt;
  }

  async function handleAddStoneName(newName: string): Promise<SelectOption> {
    const created = await createStoneName({ name: newName });
    const opt: SelectOption = { id: created.id, label: created.name };
    setStoneOptions((prev) => [...prev, opt].sort((a, b) => a.label.localeCompare(b.label)));
    return opt;
  }

  const handleSave = async () => {
    if (!name.trim()) {
      showError('Customer name is required.', 'Missing information');
      return;
    }
    if (!phone.trim()) {
      showError('Phone number is required.', 'Missing information');
      return;
    }

    // The order is stored by NAME (category / metal / purity / stone), which
    // is what the invoice prefill matches on, so resolve ids back to names.
    let categoryName = '';
    let metalName = '';
    let purityName = '';
    let stoneNames = '';
    let min: number | null = null;
    let max: number | null = null;

    if (includeOrder) {
      categoryName = categories.find((c) => c.id === categoryId)?.label ?? '';
      metalName = metals.find((m) => m.id === metalId)?.label ?? '';
      purityName = purities.find((p) => p.id === purityId)?.label ?? '';

      if (!categoryName) {
        showError('Select a category for the jewel order.', 'Incomplete order');
        return;
      }
      if (!metalName) {
        showError('Select a metal for the jewel order.', 'Incomplete order');
        return;
      }
      if (!purityName) {
        showError('Select a purity for the jewel order.', 'Incomplete order');
        return;
      }

      min = parseFloat(weightMin);
      max = parseFloat(weightMax);
      if (isNaN(min) || isNaN(max)) {
        showError('Enter a valid weight range for the jewel order.', 'Incomplete order');
        return;
      }
      if (min > max) {
        showError('Minimum weight cannot exceed maximum weight.', 'Invalid weight range');
        return;
      }

      // A jewel order can carry several stones — stored as one comma-separated string.
      stoneNames = stoneIds
        .map((id) => stoneOptions.find((s) => s.id === id)?.label)
        .filter(Boolean)
        .join(', ');
    }

    setSaving(true);
    try {
      const customer = await createCustomer({ name, phone, email, address, gstin });

      if (includeOrder && min !== null && max !== null) {
        try {
          const order = await createCustomerOrder({
            customer_id: customer.id,
            category: categoryName,
            metal: metalName,
            purity: purityName,
            weight_min: min,
            weight_max: max,
            stone_weight: stoneWeight ? parseFloat(stoneWeight) : null,
            stone_name: stoneNames || null,
            notes: orderNotes,
            due_date: dueDate,
          });

          // Tell the other staff a new order was created
          await notify(
            'order',
            'New jewel order',
            `${order.order_number} for ${name.trim()}: ${categoryName}, ${metalName} (${purityName}), ${min}–${max}g` +
              (dueDate ? `, due ${formatDisplayDate(dueDate)}` : '')
          );
        } catch (orderErr: any) {
          console.error('Order creation failed:', orderErr);
          router.replace(`/customers/${customer.id}?orderFailed=1`);
          return;
        }
      }

      router.replace(`/customers/${customer.id}`);
    } catch (e: any) {
      showError(e.message ?? 'Could not save customer.', 'Could not save customer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ScrollView
        ref={scrollRef}
        style={styles.screen}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 + keyboardHeight }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>New Customer</Text>

        <Input label="Name" value={name} onChangeText={setName} placeholder="Customer name" />
        <Input label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="10-digit mobile number" />
        <Input label="Email (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="customer@example.com" />
        <Input label="Address (optional)" value={address} onChangeText={setAddress} placeholder="Address" />
        {/* <Input label="GSTIN (optional)" value={gstin} onChangeText={setGstin} placeholder="GSTIN" /> */}

        <View style={styles.orderHeader}>
          <Text style={styles.toggleTitle}>Jewel Order Details</Text>
          <Text style={styles.toggleSubtitle}>
            Customer is ordering a jewel — capture category, metal, weight and stone details. Leave blank to save
            the customer only.
          </Text>
        </View>

        <View style={styles.orderSection}>
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
          {stoneOptions.length === 0 && !loadingMeta && (
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

          <Text style={styles.sectionTitle}>Order Notes (optional)</Text>
          <TextInput
            style={[styles.input, styles.notesInput]}
            placeholder="Design reference, special instructions"
            placeholderTextColor={colors.textMuted}
            value={orderNotes}
            onChangeText={setOrderNotes}
            onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300)}
            multiline
          />
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <Button
            label={saving ? 'Saving…' : includeOrder ? 'Save Customer & Order' : 'Save Customer'}
            onPress={handleSave}
            disabled={saving || (includeOrder && loadingMeta)}
          />
        </View>
      </ScrollView>

      <ErrorModal
        visible={errorVisible}
        title={errorInfo?.title}
        message={errorInfo?.message ?? null}
        onClose={() => setErrorVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  orderHeader: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  toggleTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  toggleSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  orderSection: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.sm },
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