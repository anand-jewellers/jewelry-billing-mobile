// src\components\invoice\JewelryItemSheet.tsx

import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Platform, ScrollView } from 'react-native';
import { Check, Plus, X } from 'lucide-react-native';
import { FormSheet, SelectField } from '../master';
import { colors, spacing } from '../../theme';
import {
  searchProducts,
  getProductByCode,
  getCurrentRate,
  getDefaultTaxSetting,
  getMakingChargeRule,
} from '../../lib/api/invoices';
import {
  recalcItem,
  recalcVaLineAmount,
  buildInvoiceItemFromProduct,
  isDiamondCharge,
  parseCarat,
  diamondChargeAmount,
  DIAMOND_CHARGE_PREFIX,
} from '../../lib/invoiceCalc';
import type { InvoiceItem, ValueAddedChargeLine, Product } from '../../types/invoices';
import type { Metal, Purity, Category, TaxSetting, ValueAddedChargeType, CalculationType } from '../../types/settings';

const VA_CHARGE = 'Value Added Charge';
const STONE_CHARGE = 'Stone Charge';

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

// One editable diamond line: size = carat weight, rate = ₹ per carat.
// `fixedCharge` holds the charge exactly as it came from a scanned/saved item,
// so opening and re-saving an item never shifts the amount by a paisa.
// It is cleared as soon as the cashier edits the size or rate.
type DiamondRow = { key: string; size: string; rate: string; fixedCharge: number | null };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function diamondRowsFromLines(lines: ValueAddedChargeLine[]): DiamondRow[] {
  return (lines ?? [])
    .filter((c) => isDiamondCharge(c.name))
    .map((c, i) => {
      const size = c.name.slice(DIAMOND_CHARGE_PREFIX.length).trim();
      const ct = parseCarat(size);
      const rate = ct > 0 ? round2(c.amount / ct) : c.amount;
      return { key: `dm-${c.id}-${i}`, size, rate: String(rate), fixedCharge: c.amount };
    });
}

// Lines the sheet has no dedicated input for (everything except VA, Stone, Diamond).
function otherExtraLines(lines: ValueAddedChargeLine[]): ValueAddedChargeLine[] {
  return (lines ?? []).filter(
    (c) => c.name !== VA_CHARGE && c.name !== STONE_CHARGE && !isDiamondCharge(c.name)
  );
}

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
    makingType: 'fixed' as CalculationType,
    makingChargeFixed: '',
    vacPercent: '',
    stoneChargeFixed: '',
    diamonds: [] as DiamondRow[],
    itemDiscount: '0',
    taxSettingId: null as string | null,
    gstEnabled: true,
    huid: '',
    extraCharges: [] as ValueAddedChargeLine[], // other lines the sheet has no input for
  };
}

type SheetState = ReturnType<typeof blankState>;

// Populate the sheet from an existing item (edit mode, or the draft
// item seeded from a customer order).
function stateFromItem(item: InvoiceItem): SheetState {
  const va = item.value_added_charges?.find((c) => c.name === VA_CHARGE);
  const stone = item.value_added_charges?.find((c) => c.name === STONE_CHARGE);
  return {
    name: item.name ?? '',
    metalId: item.metal_id ?? null,
    purityId: item.purity_id ?? null,
    categoryId: item.category_id ?? null,
    grossWeight: item.gross_weight != null ? String(item.gross_weight) : '',
    stoneWeight: String(item.stone_weight ?? 0),
    otherWeight: String(item.other_weight ?? 0),
    quantity: String(item.quantity ?? 1),
    rate: item.metal_rate ? String(item.metal_rate) : '',
    makingType: (item.making_charge_type ?? 'fixed') as CalculationType,
    makingChargeFixed: item.making_charge_value ? String(item.making_charge_value) : '',
    vacPercent: va ? String(va.value) : '',
    stoneChargeFixed: stone ? String(stone.amount) : '',
    diamonds: diamondRowsFromLines(item.value_added_charges ?? []),
    itemDiscount: String(item.item_discount ?? 0),
    taxSettingId: item.tax_setting_id ?? null,
    gstEnabled: item.gst_enabled !== false,
    huid: item.huid ?? '',
    extraCharges: otherExtraLines(item.value_added_charges ?? []),
  };
}

function makingLabel(type: CalculationType): string {
  const t = String(type);
  if (t === 'per_gram') return 'Making (₹/g)';
  if (t === 'percentage') return 'Making (%)';
  return 'Making (₹)';
}

export function JewelryItemSheet({
  visible,
  initial,
  metals,
  purities,
  categories,
  taxSettings,
  vaChargeTypes,
  onClose,
  onSave,
}: Props) {
  const [state, setState] = useState<SheetState>(blankState());
  const [saving, setSaving] = useState(false);

  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const linkedProductRef = useRef<Product | null>(null);

  // Once the cashier types their own rate / making charge, auto-fill
  // must stop overwriting it (even if they later change metal/purity).
  const rateEditedRef = useRef(false);
  const makingEditedRef = useRef(false);

  // ---------------------------------------------------------
  // Reset / populate every time the sheet opens.
  // MUST stay above the auto-fill effect so it runs first.
  // ---------------------------------------------------------
  useEffect(() => {
    if (!visible) return;

    rateEditedRef.current = false;
    makingEditedRef.current = false;
    setShowResults(false);
    setProductResults([]);

    if (initial) {
      setState(stateFromItem(initial));
      setProductQuery(initial.name ?? '');
      linkedProductRef.current = initial.product_id ? ({ id: initial.product_id } as Product) : null;
    } else {
      setState(blankState());
      setProductQuery('');
      linkedProductRef.current = null;
    }
  }, [visible, initial]);

  // ---------------------------------------------------------
  // Auto-fill rate, making charge and default GST for MANUAL
  // entries (no `initial`, no linked product).
  // ---------------------------------------------------------
  useEffect(() => {
    if (!visible || initial || linkedProductRef.current) return;

    const { metalId, purityId, categoryId } = state;
    if (!metalId || !purityId) return;

    let cancelled = false;

    (async () => {
      try {
        const [liveRate, taxSetting] = await Promise.all([
          getCurrentRate(metalId, purityId).catch(() => 0),
          getDefaultTaxSetting().catch(() => null),
        ]);

        let makingRule = await getMakingChargeRule(metalId, purityId, categoryId ?? null).catch((e) => {
          console.warn('[JewelryItemSheet] making rule (with category) failed:', e);
          return null;
        });

        if (!makingRule && categoryId) {
          makingRule = await getMakingChargeRule(metalId, purityId, null).catch((e) => {
            console.warn('[JewelryItemSheet] making rule (no category) failed:', e);
            return null;
          });
        }

        if (cancelled) return;

        setState((s) => {
          // Ignore results that no longer match what's selected
          if (s.metalId !== metalId || s.purityId !== purityId) return s;

          return {
            ...s,
            rate: rateEditedRef.current ? s.rate : liveRate ? String(liveRate) : '',
            makingType: makingEditedRef.current
              ? s.makingType
              : ((makingRule?.calculation_type ?? 'fixed') as CalculationType),
            makingChargeFixed: makingEditedRef.current
              ? s.makingChargeFixed
              : makingRule?.value != null
                ? String(makingRule.value)
                : '',
            taxSettingId: s.taxSettingId ?? taxSetting?.id ?? null,
          };
        });
      } catch (e) {
        console.warn('[JewelryItemSheet] Auto-fill failed:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, initial, state.metalId, state.purityId, state.categoryId]);

  // ---------------------------------------------------------
  // Product search
  // ---------------------------------------------------------
  const handleProductQuery = (text: string) => {
    setProductQuery(text);
    setState((s) => ({ ...s, name: text }));
    setShowResults(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (text.trim().length >= 1) {
        searchProducts(text)
          .then((results) => setProductResults(Array.isArray(results) ? results : []))
          .catch(() => setProductResults([]));
      } else {
        setProductResults([]);
      }
    }, 250);
  };

  // ---------------------------------------------------------
  // Picking a product from the dropdown.
  // ---------------------------------------------------------
  const applyProduct = async (p: Product) => {
    if (!p) return;
    setProductQuery(p.product_name ?? '');
    setShowResults(false);
    setProductResults([]);
    linkedProductRef.current = p; // set immediately so auto-fill never fires

    try {
      const full = ((await getProductByCode(p.product_code ?? p.id)) ?? p) as any;
      linkedProductRef.current = full;

      const [rate, makingRule, taxSetting] = await Promise.all([
        full.metal_id && full.purity_id
          ? getCurrentRate(full.metal_id, full.purity_id).catch(() => 0)
          : Promise.resolve(0),
        full.metal_id && full.purity_id
          ? getMakingChargeRule(full.metal_id, full.purity_id, full.category_id ?? null).catch(() => null)
          : Promise.resolve(null),
        getDefaultTaxSetting().catch(() => null),
      ]);

      const item = buildInvoiceItemFromProduct(full, rate, makingRule, taxSetting);
      const va = item.value_added_charges.find((c) => c.name === VA_CHARGE);
      const stone = item.value_added_charges.find((c) => c.name === STONE_CHARGE);

      setState((s) => ({
        ...s,
        name: item.name,
        metalId: item.metal_id,
        purityId: item.purity_id,
        categoryId: item.category_id,
        grossWeight: String(item.gross_weight),
        stoneWeight: String(item.stone_weight),
        otherWeight: String(item.other_weight),
        rate: item.metal_rate ? String(item.metal_rate) : '',
        makingType: item.making_charge_type,
        makingChargeFixed: item.making_charge_value != null ? String(item.making_charge_value) : '',
        vacPercent: va ? String(va.value) : '',
        stoneChargeFixed: stone ? String(stone.amount) : '',
        diamonds: diamondRowsFromLines(item.value_added_charges),
        itemDiscount: String(item.item_discount ?? 0),
        taxSettingId: item.tax_setting_id ?? s.taxSettingId,
        huid: item.huid ?? '',
        extraCharges: otherExtraLines(item.value_added_charges),
      }));
    } catch (err) {
      console.error('Failed to populate product details:', err);
    }
  };

  // ---------------------------------------------------------
  // Diamond row helpers
  // ---------------------------------------------------------
  const addDiamondRow = () =>
    setState((s) => ({
      ...s,
      diamonds: [...s.diamonds, { key: `dm-new-${Date.now()}`, size: '', rate: '', fixedCharge: null }],
    }));

  const updateDiamondRow = (key: string, patch: Partial<Pick<DiamondRow, 'size' | 'rate'>>) =>
    setState((s) => ({
      ...s,
      // editing size/rate drops the frozen charge so it is recalculated
      diamonds: s.diamonds.map((d) => (d.key === key ? { ...d, ...patch, fixedCharge: null } : d)),
    }));

  const removeDiamondRow = (key: string) =>
    setState((s) => ({ ...s, diamonds: s.diamonds.filter((d) => d.key !== key) }));

  const diamondCharge = (d: DiamondRow) =>
    d.fixedCharge ?? diamondChargeAmount(d.size, parseFloat(d.rate) || 0);

  // ---------------------------------------------------------
  // Live computed preview
  // ---------------------------------------------------------
  const derived = useMemo(() => {
    const gross = parseFloat(state.grossWeight) || 0;
    const stone = parseFloat(state.stoneWeight) || 0;
    const other = parseFloat(state.otherWeight) || 0;
    const netWeight = Math.max(+(gross - stone - other).toFixed(3), 0);
    const quantity = Math.max(parseFloat(state.quantity) || 1, 1);
    const rate = parseFloat(state.rate) || 0;
    const makingValue = parseFloat(state.makingChargeFixed) || 0;
    const itemDiscount = parseFloat(state.itemDiscount) || 0;

    // GST unticked -> no tax setting is passed, so every tax figure is 0.
    const taxSetting = state.gstEnabled
      ? taxSettings.find((t) => t.id === state.taxSettingId) ?? null
      : null;

    const synthesizedVaLines: ValueAddedChargeLine[] = [];
    const vacValue = parseFloat(state.vacPercent) || 0;
    const stoneValue = parseFloat(state.stoneChargeFixed) || 0;

    if (vacValue > 0) {
      synthesizedVaLines.push({
        id: 'va-vac-percent',
        charge_type_id: vaChargeTypes.find((t) => t.calculation_type === 'percentage')?.id ?? 'va-vac',
        name: VA_CHARGE,
        calculation_type: 'percentage',
        value: vacValue,
        amount: recalcVaLineAmount('percentage', vacValue, netWeight, netWeight * rate),
      });
    }

    if (stoneValue > 0) {
      synthesizedVaLines.push({
        id: 'va-stone-fixed',
        charge_type_id: vaChargeTypes.find((t) => t.calculation_type === 'fixed')?.id ?? 'va-stone',
        name: STONE_CHARGE,
        calculation_type: 'fixed',
        value: stoneValue,
        amount: stoneValue,
      });
    }

    // Diamond lines: "Diamond <size>", fixed ₹ = carat × rate per carat.
    // Same naming/shape the scan flow produces, so slip + saved invoice match.
    state.diamonds.forEach((d) => {
      if (!d.size.trim()) return;
      const charge = diamondCharge(d);
      if (charge <= 0) return;
      synthesizedVaLines.push({
        id: `va-diamond-${d.key}`,
        charge_type_id: '',
        name: `${DIAMOND_CHARGE_PREFIX} ${d.size.trim()}`,
        calculation_type: 'fixed',
        value: charge,
        amount: charge,
      });
    });

    // Keep any other lines so editing the item never drops them.
    synthesizedVaLines.push(...state.extraCharges);

    const calc = recalcItem({
      netWeight,
      rate,
      quantity,
      makingType: state.makingType,
      makingValue,
      vaCharges: synthesizedVaLines,
      itemDiscount,
      taxSetting,
    });

    return { netWeight, quantity, vaLinesWithAmount: synthesizedVaLines, ...calc };
  }, [state, taxSettings, vaChargeTypes]);

  // ---------------------------------------------------------
  // Save
  // ---------------------------------------------------------
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
      making_charge_value: parseFloat(state.makingChargeFixed) || 0,
      value_added_charges: derived.vaLinesWithAmount,
      item_discount: parseFloat(state.itemDiscount) || 0,
      tax_setting_id: state.taxSettingId,
      gst_enabled: state.gstEnabled,
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
      {/* Search Input with Non-overlapping Dropdown */}
      <View style={styles.searchWrapper}>
        <Text style={styles.label}>Search or enter Product ID / Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Type to search product..."
          placeholderTextColor={colors.textMuted}
          value={productQuery}
          onChangeText={handleProductQuery}
          onFocus={() => setShowResults(true)}
        />
        {showResults && productResults.length > 0 && (
          <View style={styles.dropdown}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled={true}
              style={styles.dropdownScroll}
            >
              {productResults.map((p, idx) => {
                const itemKey = p?.id ?? p?.product_code ?? `prod-key-${idx}`;
                return (
                  <Pressable
                    key={itemKey}
                    style={styles.dropdownRow}
                    onPress={() => applyProduct(p)}
                  >
                    <Text style={styles.dropdownName} numberOfLines={1}>
                      {p?.product_name ?? 'Unnamed Product'}
                    </Text>
                    {p?.product_code ? (
                      <Text style={styles.dropdownCode}>{p.product_code}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>

      <Text style={styles.sectionHeader}>Jewelry Classification</Text>
      <SelectField
        label="Metal"
        value={state.metalId}
        options={(metals ?? []).map((m) => ({ id: m.id, label: m.name }))}
        onChange={(id) => setState((s) => ({ ...s, metalId: id, purityId: null }))}
      />
      <SelectField
        label="Purity"
        value={state.purityId}
        options={(purities ?? [])
          .filter((p) => p.metal_id === state.metalId)
          .map((p) => ({ id: p.id, label: p.name }))}
        onChange={(id) => setState((s) => ({ ...s, purityId: id }))}
      />
      <SelectField
        label="Category"
        value={state.categoryId}
        options={(categories ?? []).map((c) => ({ id: c.id, label: c.name }))}
        onChange={(id) => setState((s) => ({ ...s, categoryId: id }))}
      />

      <Text style={styles.sectionHeader}>Weight & Rate</Text>
      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={styles.label}>Gross (g)</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={state.grossWeight}
            onChangeText={(v) => setState((s) => ({ ...s, grossWeight: v }))}
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>Stone (g)</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={state.stoneWeight}
            onChangeText={(v) => setState((s) => ({ ...s, stoneWeight: v }))}
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>Other (g)</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={state.otherWeight}
            onChangeText={(v) => setState((s) => ({ ...s, otherWeight: v }))}
          />
        </View>
      </View>

      <View style={styles.weightBadge}>
        <Text style={styles.weightBadgeLabel}>Calculated Net Weight</Text>
        <Text style={styles.weightBadgeVal}>{derived.netWeight} g</Text>
      </View>

      <View style={styles.row}>
        <View style={[styles.col, { flex: 0.6 }]}>
          <Text style={styles.label}>Quantity</Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={state.quantity}
            onChangeText={(v) => setState((s) => ({ ...s, quantity: v }))}
          />
        </View>
        <View style={[styles.col, { flex: 1.4 }]}>
          <Text style={styles.label}>Rate per gram (₹)</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={state.rate}
            onChangeText={(v) => {
              rateEditedRef.current = true;
              setState((s) => ({ ...s, rate: v }));
            }}
          />
        </View>
      </View>

      {/* Direct Charges */}
      <Text style={styles.sectionHeader}>Charges</Text>
      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={styles.label}>{makingLabel(state.makingType)}</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            value={state.makingChargeFixed}
            onChangeText={(v) => {
              makingEditedRef.current = true;
              setState((s) => ({ ...s, makingChargeFixed: v }));
            }}
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>Stone (₹)</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            value={state.stoneChargeFixed}
            onChangeText={(v) => setState((s) => ({ ...s, stoneChargeFixed: v }))}
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>VA (%)</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            value={state.vacPercent}
            onChangeText={(v) => setState((s) => ({ ...s, vacPercent: v }))}
          />
        </View>
      </View>

      {/* Diamonds: size (ct) × rate per carat = charge */}
      <Text style={styles.sectionHeader}>Diamonds</Text>
      {state.diamonds.map((d) => {
        const ct = parseCarat(d.size);
        const charge = diamondCharge(d);
        return (
          <View key={d.key} style={styles.diamondBlock}>
            <View style={styles.diamondRow}>
              <View style={styles.col}>
                <Text style={styles.label}>Size (ct)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 0.25"
                  placeholderTextColor={colors.textMuted}
                  value={d.size}
                  onChangeText={(v) => updateDiamondRow(d.key, { size: v })}
                />
              </View>
              <View style={styles.col}>
                <Text style={styles.label}>Rate (₹/ct)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  value={d.rate}
                  onChangeText={(v) => updateDiamondRow(d.key, { rate: v })}
                />
              </View>
              <Pressable onPress={() => removeDiamondRow(d.key)} hitSlop={8} style={styles.removeBtn}>
                <X size={18} color="#DC2626" />
              </Pressable>
            </View>
            {ct > 0 && charge > 0 && (
              <Text style={styles.computedHint}>
                {ct} ct × ₹{(parseFloat(d.rate) || 0).toLocaleString('en-IN')} = ₹
                {charge.toLocaleString('en-IN')}
              </Text>
            )}
          </View>
        );
      })}
      <Pressable style={styles.addRowBtn} onPress={addDiamondRow}>
        <Plus size={16} color={colors.primary} />
        <Text style={styles.addRowBtnText}>Add diamond</Text>
      </Pressable>

      {/* Any other charge lines carried over from the scanned product */}
      {state.extraCharges.length > 0 && (
        <View style={{ marginBottom: spacing.xs }}>
          {state.extraCharges.map((c) => (
            <Text key={c.id} style={styles.computedHint}>
              {c.name}: ₹{c.amount.toLocaleString('en-IN')}
            </Text>
          ))}
        </View>
      )}

      <Text style={styles.sectionHeader}>Tax & Discounts</Text>

      {/* GST dropdown with the Apply GST checkbox right next to it */}
      <View style={styles.gstRow}>
        <View
          style={[styles.gstSelect, !state.gstEnabled && styles.gstSelectDisabled]}
          pointerEvents={state.gstEnabled ? 'auto' : 'none'}
        >
          <SelectField
            label="GST Setting"
            value={state.taxSettingId}
            options={(taxSettings ?? []).map((t) => ({
              id: t.id,
              label: `${t.tax_name} (${t.tax_percentage}%)`,
            }))}
            onChange={(id) => setState((s) => ({ ...s, taxSettingId: id }))}
          />
        </View>

        <Pressable
          style={styles.gstCheckWrap}
          onPress={() => setState((s) => ({ ...s, gstEnabled: !s.gstEnabled }))}
          hitSlop={8}
        >
          <View style={[styles.checkbox, state.gstEnabled && styles.checkboxOn]}>
            {state.gstEnabled && <Check size={14} color="#fff" strokeWidth={3} />}
          </View>
          <Text style={styles.gstCheckLabel}>Apply GST</Text>
        </Pressable>
      </View>

      {state.gstEnabled && derived.tax_percentage > 0 && (
        <Text style={styles.computedHint}>
          {derived.cgst_percentage > 0 || derived.sgst_percentage > 0
            ? `CGST ${derived.cgst_percentage}% + SGST ${derived.sgst_percentage}%`
            : `IGST ${derived.igst_percentage}%`}
          {' · '}Tax: ₹{derived.tax_amount.toLocaleString('en-IN')}
        </Text>
      )}
      {!state.gstEnabled && <Text style={styles.computedHint}>GST is not applied to this item.</Text>}

      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={styles.label}>Discount (₹)</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            value={state.itemDiscount}
            onChangeText={(v) => setState((s) => ({ ...s, itemDiscount: v }))}
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>HUID (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="HUID"
            placeholderTextColor={colors.textMuted}
            value={state.huid}
            onChangeText={(v) => setState((s) => ({ ...s, huid: v }))}
          />
        </View>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.totalPreview}>
          <Text style={styles.totalPreviewLabel}>Taxable Amount</Text>
          <Text style={styles.totalPreviewValue}>₹{derived.taxable_amount.toLocaleString('en-IN')}</Text>
        </View>
        <View style={[styles.totalPreview, styles.totalPreviewBorder]}>
          <Text style={styles.totalPreviewLabelBold}>Total Amount</Text>
          <Text style={styles.totalPreviewValueBold}>₹{derived.total_amount.toLocaleString('en-IN')}</Text>
        </View>
      </View>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  searchWrapper: {
    position: 'relative',
    zIndex: 9999,
    elevation: Platform.OS === 'android' ? 50 : undefined,
    marginBottom: spacing.xs,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 5,
    marginTop: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: '#fff',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginTop: 4,
    zIndex: 10000,
    elevation: 60,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    overflow: 'hidden',
  },
  dropdownScroll: {
    maxHeight: 180,
  },
  dropdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  dropdownName: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '600',
    flex: 1,
    marginRight: spacing.sm,
  },
  dropdownCode: {
    fontSize: 12,
    color: colors.textMuted,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: spacing.xs,
  },
  col: {
    flex: 1,
  },

  // Diamond rows
  diamondBlock: { marginBottom: spacing.xs },
  diamondRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  removeBtn: { height: 40, width: 28, alignItems: 'center', justifyContent: 'center' },
  addRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  addRowBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },

  // GST dropdown + checkbox on one line
  gstRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  gstSelect: { flex: 1 },
  gstSelectDisabled: { opacity: 0.45 },
  gstCheckWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 48,
    marginBottom: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  gstCheckLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },

  weightBadge: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    marginVertical: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  weightBadgeLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  weightBadgeVal: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  computedHint: {
    fontSize: 11.5,
    color: colors.textSecondary,
    marginTop: 4,
    marginBottom: spacing.xs,
  },
  summaryCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  totalPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  totalPreviewBorder: {
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    marginTop: 6,
    paddingTop: 8,
  },
  totalPreviewLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  totalPreviewValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  totalPreviewLabelBold: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  totalPreviewValueBold: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.primary,
  },
});