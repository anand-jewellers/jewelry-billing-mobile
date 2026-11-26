// src/components/invoice/ExchangeGoldModal.tsx
//
// Add / edit one old-gold item on an invoice (exchange).
// UI + keyboard handling are the same as PurchaseItemModal:
//   Product name, Metal, Purity, Weight, Stone/Dust, Old %, Rate, preview.
// Metal and Purity are small radio buttons (Gold + 916 selected by default).
// The default Old % per purity (incl. SADHA = SADHA_OLD_PERCENT) is kept exactly as before.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Keyboard,
  Platform,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, ChevronDown, ChevronUp } from 'lucide-react-native';
import { colors, spacing, radius } from '../../theme';
import {
  computeExchangeItem,
  deductionFromOldPercent,
  displayNetWeight,
  COMMON_PURITIES,
  OLD_PERCENT_STEPS,
  SADHA_OLD_PERCENT,
  defaultOldPercentForPurity,
} from '../../lib/exchangeGold';
import type { ExchangeItem } from '../../types/invoices';
import type { Metal, Purity } from '../../types/settings';

// key: stable id used only by the radio control.
// dbId: the REAL purity_id to save / use for rate-fetch.
interface PurityOption {
  key: string;
  dbId: string | null;
  metalId: string | null;
  name: string;
  percent: number;
  defaultOld: number; // Old % filled in when this purity is picked
  isSadha: boolean; // purity row named SADHA (same 91.6 value, different shop name)
}

const isSadhaName = (name: string) => /sadha/i.test(name);

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (item: ExchangeItem) => void;
  metals?: Metal[];
  purities?: Purity[];
  fetchRate?: (metalId: string, purityId: string) => Promise<number>;
  editingItem?: ExchangeItem | null;
}

// ---------- Small radio group (radio + text only, no background) ----------
function RadioGroup({
  options,
  value,
  onChange,
  emptyText,
}: {
  options: { id: string; label: string }[];
  value: string | null;
  onChange: (id: string) => void;
  emptyText?: string;
}) {
  if (options.length === 0) {
    return <Text style={styles.helperText}>{emptyText ?? 'No options'}</Text>;
  }
  return (
    <View style={styles.radioWrap}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable key={o.id} style={styles.radioItem} onPress={() => onChange(o.id)} hitSlop={6}>
            <View style={[styles.radioOuter, on && styles.radioOuterOn]}>
              {on && <View style={styles.radioInner} />}
            </View>
            <Text style={[styles.radioLabel, on && styles.radioLabelOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ExchangeGoldModal({
  visible,
  onClose,
  onSave,
  metals = [],
  purities = [],
  fetchRate,
  editingItem = null,
}: Props) {
  const [name, setName] = useState('');
  const [metalId, setMetalId] = useState('');
  const [purityKey, setPurityKey] = useState('');
  const [purityId, setPurityId] = useState<string | null>(null);
  const [purityPercent, setPurityPercent] = useState('0');
  const [grossWeight, setGrossWeight] = useState('');
  const [stoneWeight, setStoneWeight] = useState('0');
  const [oldPercent, setOldPercent] = useState('');
  const [ratePerGram, setRatePerGram] = useState('');
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  // ---- keyboard: keep the focused field visible (Rate is near the bottom) ----
  const insets = useSafeAreaInsets();
  // lifts the button above the Android nav buttons / gesture bar
  const bottomPad = Math.max(insets.bottom, Platform.OS === 'android' ? 48 : 20) + 12;
  const scrollRef = useRef<ScrollView>(null);
  const fieldY = useRef<Record<string, number>>({});
  const [kbHeight, setKbHeight] = useState(0);

  // coordination refs
  const initPendingRef = useRef(false); // defaults still need to be applied for this open
  const rateReqRef = useRef(0); // ignores stale rate responses
  const fetchRateRef = useRef(fetchRate);
  fetchRateRef.current = fetchRate;

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates.height));
    const b = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  const regField = (key: string) => (e: LayoutChangeEvent) => {
    fieldY.current[key] = e.nativeEvent.layout.y;
  };
  // once the keyboard is open, bring the tapped field near the top
  const scrollToField = (key: string) => {
    const y = fieldY.current[key];
    if (y == null) return;
    setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true }), 280);
  };

  // ---- all purity options (live table first, hardcoded list only as fallback) ----
  const allPurityOptions: PurityOption[] = useMemo(() => {
    if (purities.length > 0) {
      return purities.map((p) => {
        const percent = Number((p as any).purity_percentage) || 0;
        const sadha = isSadhaName(p.name);
        return {
          key: p.id,
          dbId: p.id,
          metalId: (p as any).metal_id ?? null,
          name: p.name,
          percent,
          defaultOld: sadha ? SADHA_OLD_PERCENT : defaultOldPercentForPurity(percent),
          isSadha: sadha,
        };
      });
    }
    return COMMON_PURITIES.map((p, i) => ({
      key: `fallback_${i}`,
      dbId: p.id,
      metalId: null,
      name: p.label,
      percent: p.percent,
      defaultOld: defaultOldPercentForPurity(p.percent),
      isSadha: false,
    }));
  }, [purities]);

  // Purities that belong to the chosen metal (if the purity rows carry a metal_id)
  const purityListFor = (mid: string) => {
    const list = allPurityOptions.filter((o) => !o.metalId || !mid || o.metalId === mid);
    return list.length > 0 ? list : allPurityOptions;
  };

  const purityOptions = useMemo(
    () => purityListFor(metalId).map((o) => ({ id: o.key, label: o.name })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allPurityOptions, metalId]
  );
  const metalOptions = useMemo(() => metals.map((m) => ({ id: m.id, label: m.name })), [metals]);

  // Default purity for a list: the 916 / 91.6 / 22K one (never SADHA, which shares 91.6), else first
  const pickDefaultPurity = (list: PurityOption[]): PurityOption | null =>
    list.find((o) => !o.isSadha && /916|91\.6|22\s*k/i.test(o.name)) ??
    list.find((o) => !o.isSadha && Math.abs(o.percent - 91.6) < 0.15) ??
    list.find((o) => !o.isSadha) ??
    list[0] ??
    null;

  // Today's rate for metal + purity (rate stays editable)
  const loadRate = async (mid: string, pid: string | null) => {
    const fetcher = fetchRateRef.current;
    setRateError(null);
    if (!fetcher || !mid || !pid) return;
    const req = ++rateReqRef.current;
    setRateLoading(true);
    try {
      const rate = await fetcher(mid, pid);
      if (req !== rateReqRef.current) return;
      if (rate > 0) setRatePerGram(String(rate));
      else {
        setRatePerGram('');
        setRateError('No current rate found for this purity - enter it manually.');
      }
    } catch {
      if (req === rateReqRef.current) {
        setRateError("Could not fetch today's rate - enter it manually.");
      }
    } finally {
      if (req === rateReqRef.current) setRateLoading(false);
    }
  };

  // Picks a purity: fills purity %, the DEFAULT OLD % for that purity, then loads rate
  const applyPurity = (option: PurityOption | null, mid: string) => {
    if (!option) return;
    setPurityKey(option.key);
    setPurityId(option.dbId);
    setPurityPercent(String(option.percent));
    setOldPercent(option.defaultOld > 0 ? String(option.defaultOld) : '');
    void loadRate(mid, option.dbId);
  };

  const handleMetalChange = (id: string) => {
    setMetalId(id);
    applyPurity(pickDefaultPurity(purityListFor(id)), id);
  };

  const handlePurityChange = (key: string) => {
    const option = allPurityOptions.find((o) => o.key === key);
    applyPurity(option ?? null, metalId);
  };

  // 1) reset / populate plain fields each time the modal opens
  useEffect(() => {
    if (!visible) {
      initPendingRef.current = false;
      return;
    }
    initPendingRef.current = true;
    setRateError(null);

    if (editingItem) {
      setName(editingItem.description);
      setGrossWeight(String(editingItem.gross_weight));
      setStoneWeight(String(editingItem.stone_weight ?? 0));
      setPurityPercent(String(editingItem.purity_percent));
      setOldPercent(editingItem.old_percent > 0 ? String(editingItem.old_percent) : '');
      setRatePerGram(String(editingItem.rate_per_gram)); // keep the saved rate
    } else {
      setName('');
      setGrossWeight('');
      setStoneWeight('0');
      setOldPercent('');
      setRatePerGram('');
      setPurityKey('');
      setPurityId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingItem]);

  // 2) apply metal + purity once options are available (runs again if they load late)
  useEffect(() => {
    if (!visible || !initPendingRef.current) return;
    if (allPurityOptions.length === 0) return;

    const gold = metals.find((m) => /gold/i.test(m.name)) ?? metals[0];
    const mid = gold?.id ?? '';
    if (metals.length > 0 && !mid) return;
    initPendingRef.current = false;
    setMetalId(mid);

    const list = purityListFor(mid);

    if (editingItem) {
      // select the matching option WITHOUT touching the saved rate / old %
      const match =
        list.find((o) => o.dbId != null && o.dbId === editingItem.purity_id) ??
        list.find((o) => !o.isSadha && o.percent === editingItem.purity_percent);
      setPurityKey(match?.key ?? '');
      setPurityId(match?.dbId ?? editingItem.purity_id ?? null);
    } else {
      applyPurity(pickDefaultPurity(list), mid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingItem, allPurityOptions, metals]);

  const gross = Number(grossWeight) || 0;
  const stone = Number(stoneWeight) || 0;
  const old = Number(oldPercent) || 0;
  const rate = Number(ratePerGram) || 0;
  const purityPct = Number(purityPercent) || 0;
  const deduction = deductionFromOldPercent(old);

  const stoneExceedsGross = stone > gross && gross > 0;
  const oldInvalid = old > 100;

  const preview = useMemo(
    () =>
      computeExchangeItem({
        gross_weight: gross,
        stone_weight: stone,
        purity_percent: purityPct,
        old_percent: old,
        deduction_percent: deduction,
        rate_per_gram: rate,
      }),
    [gross, stone, purityPct, old, deduction, rate]
  );

  const canSave =
    name.trim().length > 0 &&
    gross > 0 &&
    rate > 0 &&
    old > 0 &&
    !stoneExceedsGross &&
    !oldInvalid;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      id: editingItem?.id ?? `tmp_${Date.now()}`,
      description: name.trim(),
      gross_weight: gross,
      stone_weight: stone,
      purity_id: purityId,
      purity_percent: purityPct,
      old_percent: old,
      deduction_percent: deduction,
      rate_per_gram: rate,
      net_weight: preview.net_weight,
      amount: preview.amount,
    });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{editingItem ? 'Edit Old Gold Item' : 'Add Old Gold Item'}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={20} color={colors.textPrimary} />
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ paddingBottom: spacing.md + kbHeight }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <Field label="Product name" onLayout={regField('name')}>
              <TextInput
                style={styles.input}
                placeholder="e.g. Old chain, broken bangle"
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={setName}
                onFocus={() => scrollToField('name')}
              />
            </Field>

            <Field label="Metal">
              <RadioGroup
                options={metalOptions}
                value={metalId || null}
                onChange={handleMetalChange}
                emptyText="No metals found"
              />
            </Field>

            <Field label="Purity">
              <RadioGroup
                options={purityOptions}
                value={purityKey || null}
                onChange={handlePurityChange}
                emptyText="No purities found"
              />
            </Field>

            <View style={styles.row2} onLayout={regField('weights')}>
              <Field label="Weight (g)" style={{ flex: 1 }}>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  placeholder="0.000"
                  placeholderTextColor={colors.textMuted}
                  value={grossWeight}
                  onChangeText={setGrossWeight}
                  onFocus={() => scrollToField('weights')}
                />
              </Field>
              <Field label="Stone (or) Dust (g)" style={{ flex: 1 }}>
                <TextInput
                  style={[styles.input, stoneExceedsGross && styles.inputError]}
                  keyboardType="decimal-pad"
                  placeholder="0.000"
                  placeholderTextColor={colors.textMuted}
                  value={stoneWeight}
                  onChangeText={setStoneWeight}
                  onFocus={() => scrollToField('weights')}
                />
              </Field>
            </View>
            {stoneExceedsGross && (
              <Text style={styles.errorText}>Stone weight can't exceed the weight.</Text>
            )}

            <Field label="Old %" onLayout={regField('old')}>
              <PercentPickerField
                value={oldPercent}
                onChange={setOldPercent}
                options={OLD_PERCENT_STEPS}
                placeholder="Tap to pick or type a value"
                invalid={oldInvalid}
                onFocus={() => scrollToField('old')}
              />
              {oldInvalid && <Text style={styles.errorText}>Old % can't exceed 100%.</Text>}
            </Field>

            <Field label="Rate / gram (₹)" onLayout={regField('rate')}>
              <View style={styles.rateInputWrap}>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  value={ratePerGram}
                  onChangeText={setRatePerGram}
                  onFocus={() => scrollToField('rate')}
                />
                {rateLoading && (
                  <ActivityIndicator size="small" color={colors.primary} style={styles.rateSpinner} />
                )}
              </View>
              {rateError && <Text style={styles.errorText}>{rateError}</Text>}
            </Field>

            <View style={styles.previewCard}>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Weight after stone</Text>
                <Text style={styles.previewValue}>
                  {displayNetWeight({ gross_weight: gross, stone_weight: stone }).toFixed(3)} g
                </Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Payable weight (× old %)</Text>
                <Text style={styles.previewValue}>{preview.net_weight.toFixed(3)} g</Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Exchange Value</Text>
                <Text style={styles.previewValueBold}>
                  ₹{preview.amount.toLocaleString('en-IN')}
                </Text>
              </View>
            </View>
          </ScrollView>

          {/* Save button at the bottom, with margin so the nav bar never covers it */}
          <Pressable
            style={[styles.saveBtn, { marginBottom: bottomPad }, !canSave && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!canSave}
          >
            <Text style={styles.saveBtnText}>{editingItem ? 'Update Item' : 'Add Item'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// Old % : text field + toggle that opens the 60-100 preset chips
function PercentPickerField({
  value,
  onChange,
  options = [],
  placeholder,
  invalid,
  onFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  options?: number[];
  placeholder?: string;
  invalid?: boolean;
  onFocus?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <View style={styles.percentRow}>
        <TextInput
          style={[styles.input, styles.percentInput, invalid && styles.inputError]}
          keyboardType="decimal-pad"
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          value={value}
          onChangeText={onChange}
          onFocus={onFocus}
        />
        <Pressable style={styles.percentToggle} onPress={() => setOpen((o) => !o)} hitSlop={8}>
          {open ? (
            <ChevronUp size={18} color={colors.textMuted} />
          ) : (
            <ChevronDown size={18} color={colors.textMuted} />
          )}
        </Pressable>
      </View>

      {open && (
        <View style={styles.chipRow}>
          {options.map((p) => {
            const active = Number(value) === p;
            return (
              <Pressable
                key={p}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => {
                  onChange(String(p));
                  setOpen(false);
                }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{p}%</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function Field({
  label,
  children,
  style,
  onLayout,
}: {
  label: string;
  children: ReactNode;
  style?: any;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  return (
    <View style={[{ marginBottom: spacing.md }, style]} onLayout={onLayout}>
      {!!label && <Text style={styles.fieldLabel}>{label}</Text>}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    maxHeight: '92%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius?.md ?? 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
  },
  inputError: { borderColor: colors.error ?? 'crimson' },
  errorText: { fontSize: 11, color: colors.error ?? 'crimson', marginTop: 4 },
  row2: { flexDirection: 'row', gap: spacing.md },
  rateInputWrap: { position: 'relative', justifyContent: 'center' },
  rateSpinner: { position: 'absolute', right: 10 },
  previewCard: {
    backgroundColor: colors.background,
    borderRadius: radius?.md ?? 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  previewLabel: { fontSize: 13, color: colors.textMuted },
  previewValue: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
  previewValueBold: { fontSize: 16, color: colors.primary, fontWeight: '800' },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius?.md ?? 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Radio buttons (small, no background)
  helperText: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic' },
  radioWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 18,
    rowGap: 8,
  },
  radioItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  radioOuter: {
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterOn: { borderColor: colors.primary },
  radioInner: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  radioLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  radioLabelOn: { color: colors.textPrimary, fontWeight: '700' },

  percentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  percentInput: { flex: 1 },
  percentToggle: {
    width: 44,
    height: 44,
    borderRadius: radius?.md ?? 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: '#fff' },
});