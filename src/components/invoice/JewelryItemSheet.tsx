import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { X } from 'lucide-react-native';
import { FormSheet, SelectField } from '../master';
import { colors, spacing } from '../../theme';
import { searchProducts, getCurrentRate, getMakingChargeRule, getDefaultTaxSetting } from '../../lib/api/invoices';
import { recalcItem, recalcVaLineAmount } from '../../lib/invoiceCalc';
import type { InvoiceItem, ValueAddedChargeLine, Product } from '../../types/invoices';
import type { Metal, Purity, Category, TaxSetting, ValueAddedChargeType, CalculationType } from '../../types/settings';

interface Props {
  visible: boolean;
  initial: InvoiceItem | null;
  metals: Metal[];
  purities: Purity[];
  categories: Category[];
  taxSettings: TaxSetting[];
  vaChargeTypes: ValueAddedChargeType[];
  onClose: () => void;
  onSave: (item: InvoiceItem) => void;
}

const CALC_TYPES = [
  { id: 'per_gram', label: 'Per Gram' },
  { id: 'percentage', label: 'Percentage' },
  { id: 'fixed', label: 'Fixed' },
];

function blankState() {
  return {
    name: '',
    metalId: null as string | null,
    purityId: null as string | null,
    categoryId: null as string | null,
    grossWeight: '',
    stoneWeight: '0',
    otherWeight: '0',
    quantity: '1',
    rate: '',
    makingType: 'per_gram' as CalculationType,
    makingValue: '',
    vaLines: [] as ValueAddedChargeLine[],
    itemDiscount: '0',
    taxSettingId: null as string | null,
    huid: '',
  };
}

export function JewelryItemSheet({
  visible, initial, metals, purities, categories, taxSettings, vaChargeTypes, onClose, onSave,
}: Props) {
  const [state, setState] = useState(blankState());
  const [saving, setSaving] = useState(false);

  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const [selectedVaTypeId, setSelectedVaTypeId] = useState<string | null>(null);

  const linkedProductRef = useRef<Product | null>(
    initial?.product_id ? ({ id: initial.product_id } as Product) : null
  );

  useEffect(() => {
    if (!visible) return;
    if (initial) {
      setState({
        name: initial.name,
        metalId: initial.metal_id,
        purityId: initial.purity_id,
        categoryId: initial.category_id,
        grossWeight: String(initial.gross_weight),
        stoneWeight: String(initial.stone_weight),
        otherWeight: String(initial.other_weight),
        quantity: String(initial.quantity || 1),
        rate: String(initial.metal_rate),
        makingType: initial.making_charge_type,
        makingValue: String(initial.making_charge_value),
        vaLines: initial.value_added_charges,
        itemDiscount: String(initial.item_discount),
        taxSettingId: initial.tax_setting_id,
        huid: initial.huid ?? '',
      });
      setProductQuery(initial.name);
      linkedProductRef.current = initial.product_id ? ({ id: initial.product_id, product_code: initial.product_code } as Product) : null;
    } else {
      setState(blankState());
      setProductQuery('');
      linkedProductRef.current = null;
    }
    setShowResults(false);
    setSelectedVaTypeId(null);
  }, [visible, initial]);

  // Product search — plain rows, not FlatList (avoids nesting inside FormSheet's ScrollView)
  const handleProductQuery = (text: string) => {
    setProductQuery(text);
    setState((s) => ({ ...s, name: text }));
    setShowResults(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (text.trim().length >= 1) searchProducts(text).then(setProductResults);
      else setProductResults([]);
    }, 250);
  };

  const applyProduct = async (p: Product) => {
    setProductQuery(p.product_name);
    setShowResults(false);
    setProductResults([]);
    linkedProductRef.current = p;

    const [rate, makingRule, taxSetting] = await Promise.all([
      getCurrentRate(p.metal_id, p.purity_id),
      getMakingChargeRule(p.metal_id, p.purity_id, p.category_id),
      getDefaultTaxSetting(),
    ]);

    setState((s) => ({
      ...s,
      name: p.product_name,
      metalId: p.metal_id,
      purityId: p.purity_id,
      categoryId: p.category_id,
      grossWeight: String(p.gross_weight),
      stoneWeight: String(p.stone_weight),
      otherWeight: String(p.other_weight || 0),
      rate: String(rate || p.metal_rate || ''),
      makingType: makingRule?.calculation_type ?? p.making_charge_type ?? 'per_gram',
      makingValue: String(makingRule?.value ?? p.making_charge_value ?? 0),
      itemDiscount: String(p.discount || 0),
      taxSettingId: taxSetting?.id ?? s.taxSettingId,
      huid: p.huid ?? '',
    }));
  };

  // Live computed preview
  const derived = useMemo(() => {
    const gross = parseFloat(state.grossWeight) || 0;
    const stone = parseFloat(state.stoneWeight) || 0;
    const other = parseFloat(state.otherWeight) || 0;
    const netWeight = +(gross - stone - other).toFixed(3);
    const quantity = Math.max(parseFloat(state.quantity) || 1, 1);
    const rate = parseFloat(state.rate) || 0;
    const makingValue = parseFloat(state.makingValue) || 0;
    const itemDiscount = parseFloat(state.itemDiscount) || 0;
    const taxSetting = taxSettings.find((t) => t.id === state.taxSettingId) ?? null;

    const vaLinesWithAmount = state.vaLines.map((line) => ({
      ...line,
      amount: recalcVaLineAmount(line.calculation_type, line.value, netWeight, netWeight * rate),
    }));

    const calc = recalcItem({
      netWeight,
      rate,
      quantity,
      makingType: state.makingType,
      makingValue,
      vaCharges: vaLinesWithAmount,
      itemDiscount,
      taxSetting,
    });

    return { netWeight, quantity, vaLinesWithAmount, ...calc };
  }, [state, taxSettings]);

  const addVaCharge = () => {
    const type = vaChargeTypes.find((t) => t.id === selectedVaTypeId);
    if (!type) return;
    const newLine: ValueAddedChargeLine = {
      id: `va-${Date.now()}`,
      charge_type_id: type.id,
      name: type.name,
      calculation_type: type.calculation_type,
      value: type.default_value,
      amount: 0,
    };
    setState((s) => ({ ...s, vaLines: [...s.vaLines, newLine] }));
    setSelectedVaTypeId(null);
  };

  const updateVaValue = (id: string, text: string) => {
    const value = parseFloat(text) || 0;
    setState((s) => ({
      ...s,
      vaLines: s.vaLines.map((l) => (l.id === id ? { ...l, value } : l)),
    }));
  };

  const removeVaCharge = (id: string) => {
    setState((s) => ({ ...s, vaLines: s.vaLines.filter((l) => l.id !== id) }));
  };

  const handleSave = () => {
    if (!state.name.trim() || !state.metalId || !state.purityId || derived.netWeight <= 0) return;
    setSaving(true);

    onSave({
      id: initial?.id ?? `local-${Date.now()}`,
      product_id: initial?.product_id ?? linkedProductRef.current?.id ?? null,
      product_code: initial?.product_code ?? linkedProductRef.current?.product_code ?? null,
      name: state.name.trim(),
      metal_id: state.metalId,
      purity_id: state.purityId,
      category_id: state.categoryId,
      quantity: derived.quantity,
      gross_weight: parseFloat(state.grossWeight) || 0,
      stone_weight: parseFloat(state.stoneWeight) || 0,
      other_weight: parseFloat(state.otherWeight) || 0,
      net_weight: derived.netWeight,
      metal_rate: parseFloat(state.rate) || 0,
      making_charge_type: state.makingType,
      making_charge_value: parseFloat(state.makingValue) || 0,
      value_added_charges: derived.vaLinesWithAmount,
      item_discount: parseFloat(state.itemDiscount) || 0,
      tax_setting_id: state.taxSettingId,
      huid: state.huid || null,
      metal_value: derived.metal_value,
      making_charge_amount: derived.making_charge_amount,
      taxable_amount: derived.taxable_amount,
      tax_percentage: derived.tax_percentage,
      cgst_percentage: derived.cgst_percentage,
      sgst_percentage: derived.sgst_percentage,
      igst_percentage: derived.igst_percentage,
      tax_amount: derived.tax_amount,
      total_amount: derived.total_amount,
    });
    setSaving(false);
  };

  return (
    <FormSheet
      visible={visible}
      title={initial ? 'Edit Item' : 'Add Item'}
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
    >
      <Text style={styles.label}>Search or type a Product ID</Text>
      <TextInput
        style={styles.input}
        placeholder="Search or type a Product ID"
        placeholderTextColor={colors.textMuted}
        value={productQuery}
        onChangeText={handleProductQuery}
        onFocus={() => setShowResults(true)}
      />
      {showResults && productResults.length > 0 && (
        <View style={styles.dropdown}>
          {productResults.map((p) => (
            <Pressable key={p.id} style={styles.dropdownRow} onPress={() => applyProduct(p)}>
              <Text style={styles.dropdownName} numberOfLines={1}>{p.product_name}</Text>
              <Text style={styles.dropdownCode}>{p.product_code}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.sectionHeader}>Jewelry Details</Text>
      <SelectField
        label="Metal"
        value={state.metalId}
        options={metals.map((m) => ({ id: m.id, label: m.name }))}
        onChange={(id) => setState((s) => ({ ...s, metalId: id, purityId: null }))}
      />
      <SelectField
        label="Purity"
        value={state.purityId}
        options={purities.filter((p) => p.metal_id === state.metalId).map((p) => ({ id: p.id, label: p.name }))}
        onChange={(id) => setState((s) => ({ ...s, purityId: id }))}
      />
      <SelectField
        label="Category"
        value={state.categoryId}
        options={categories.map((c) => ({ id: c.id, label: c.name }))}
        onChange={(id) => setState((s) => ({ ...s, categoryId: id }))}
      />

      <View style={styles.row3}>
        <LabeledInput label="Gross (g)" value={state.grossWeight} onChangeText={(v) => setState((s) => ({ ...s, grossWeight: v }))} />
        <LabeledInput label="Stone (g)" value={state.stoneWeight} onChangeText={(v) => setState((s) => ({ ...s, stoneWeight: v }))} />
        <LabeledInput label="Other (g)" value={state.otherWeight} onChangeText={(v) => setState((s) => ({ ...s, otherWeight: v }))} />
      </View>
      <Text style={styles.netWeightHint}>Net weight: {derived.netWeight}g</Text>

      <LabeledInput label="Quantity" value={state.quantity} onChangeText={(v) => setState((s) => ({ ...s, quantity: v }))} keyboardType="number-pad" />
      <LabeledInput label="Rate per gram (₹)" value={state.rate} onChangeText={(v) => setState((s) => ({ ...s, rate: v }))} />

      <SelectField
        label="Making Charge Type"
        value={state.makingType}
        options={CALC_TYPES}
        onChange={(id) => setState((s) => ({ ...s, makingType: id as CalculationType }))}
      />
      <LabeledInput
        label={`Making Charge Value${state.makingType === 'percentage' ? ' (%)' : state.makingType === 'fixed' ? ' (₹)' : ' (₹/g)'}`}
        value={state.makingValue}
        onChangeText={(v) => setState((s) => ({ ...s, makingValue: v }))}
      />
      <Text style={styles.computedHint}>
        Making charge amount: ₹{derived.making_charge_amount} {derived.quantity > 1 ? `(×${derived.quantity})` : ''}
      </Text>

      <Text style={styles.sectionHeader}>Value Added Charges</Text>
      {derived.vaLinesWithAmount.map((line) => (
        <View key={line.id} style={styles.vaRow}>
          <Text style={styles.vaName} numberOfLines={1}>{line.name}</Text>
          <TextInput
            style={styles.vaValueInput}
            keyboardType="decimal-pad"
            value={String(line.value)}
            onChangeText={(t) => updateVaValue(line.id, t)}
          />
          <Text style={styles.vaAmount}>₹{line.amount}</Text>
          <Pressable onPress={() => removeVaCharge(line.id)} hitSlop={8}>
            <X size={16} color={colors.error ?? 'crimson'} />
          </Pressable>
        </View>
      ))}
      <View style={styles.addVaRow}>
        <View style={{ flex: 1 }}>
          <SelectField
            label="Add a charge"
            value={selectedVaTypeId}
            options={vaChargeTypes
              .filter((t) => !state.vaLines.some((l) => l.charge_type_id === t.id))
              .map((t) => ({ id: t.id, label: t.name }))}
            onChange={setSelectedVaTypeId}
          />
        </View>
        <Pressable style={styles.addVaBtn} onPress={addVaCharge} disabled={!selectedVaTypeId}>
          <Text style={styles.addVaBtnText}>Add</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionHeader}>Tax</Text>
      <SelectField
        label="GST Setting"
        value={state.taxSettingId}
        options={taxSettings.map((t) => ({ id: t.id, label: `${t.tax_name} (${t.tax_percentage}%)` }))}
        onChange={(id) => setState((s) => ({ ...s, taxSettingId: id }))}
      />
      {derived.tax_percentage > 0 && (
        <Text style={styles.computedHint}>
          {derived.cgst_percentage > 0 || derived.sgst_percentage > 0
            ? `CGST ${derived.cgst_percentage}% + SGST ${derived.sgst_percentage}%`
            : `IGST ${derived.igst_percentage}%`}
          {'  ·  '}Tax amount: ₹{derived.tax_amount}
        </Text>
      )}

      <LabeledInput label="Item Discount (₹)" value={state.itemDiscount} onChangeText={(v) => setState((s) => ({ ...s, itemDiscount: v }))} />
      <LabeledInput label="HUID (optional)" value={state.huid} onChangeText={(v) => setState((s) => ({ ...s, huid: v }))} keyboardType="default" />

      <View style={styles.totalPreview}>
        <Text style={styles.totalPreviewLabel}>Taxable Amount</Text>
        <Text style={styles.totalPreviewValue}>₹{derived.taxable_amount}</Text>
      </View>
      <View style={styles.totalPreview}>
        <Text style={styles.totalPreviewLabelBold}>Item Total</Text>
        <Text style={styles.totalPreviewValueBold}>₹{derived.total_amount}</Text>
      </View>
    </FormSheet>
  );
}

function LabeledInput({
  label, value, onChangeText, keyboardType = 'decimal-pad',
}: {
  label: string; value: string; onChangeText: (v: string) => void; keyboardType?: 'decimal-pad' | 'number-pad' | 'default';
}) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} keyboardType={keyboardType} value={value} onChangeText={onChangeText} />
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 4, marginTop: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: 14, color: colors.textPrimary },
  dropdown: { maxHeight: 180, borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginTop: 4, marginBottom: spacing.sm },
  dropdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  dropdownName: { fontSize: 13, color: colors.textPrimary, fontWeight: '600', flex: 1, marginRight: spacing.sm },
  dropdownCode: { fontSize: 12, color: colors.textMuted },
  sectionHeader: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.xs },
  row3: { flexDirection: 'row', gap: 8 },
  netWeightHint: { fontSize: 12, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.sm },
  computedHint: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  vaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  vaName: { flex: 1.4, fontSize: 13, color: colors.textPrimary },
  vaValueInput: { flex: 0.8, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, fontSize: 13, color: colors.textPrimary },
  vaAmount: { flex: 0.8, fontSize: 13, color: colors.textPrimary, textAlign: 'right' },
  addVaRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  addVaBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 2 },
  addVaBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  totalPreview: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, marginTop: spacing.xs },
  totalPreviewLabel: { fontSize: 13, color: colors.textSecondary },
  totalPreviewValue: { fontSize: 13, color: colors.textPrimary },
  totalPreviewLabelBold: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  totalPreviewValueBold: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
});