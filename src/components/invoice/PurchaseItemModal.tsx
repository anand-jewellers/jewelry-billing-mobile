// src/components/invoice/PurchaseItemModal.tsx
//
// Add / edit one old-gold (or silver) item for a cash purchase.
// Fields: product name, metal, purity, weight, stone weight, old %.
// Amount uses the SAME calculation as the old-gold exchange on the invoice
// (computeExchangeItem in lib/exchangeGold.ts).

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { SelectField } from '../master';
import {
  computeExchangeItem,
  deductionFromOldPercent,
  displayNetWeight,
  OLD_PERCENT_STEPS,
} from '../../lib/exchangeGold';
import type { Metal, Purity } from '../../types/settings';
import type { PurchaseItem } from '../../lib/api/cashPurchases';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (item: PurchaseItem) => void;
  metals: Metal[];
  purities: Purity[];
  fetchRate: (metalId: string, purityId: string) => Promise<number>;
  editingItem?: PurchaseItem | null;
}

export function PurchaseItemModal({
  visible,
  onClose,
  onSave,
  metals,
  purities,
  fetchRate,
  editingItem = null,
}: Props) {
  const [name, setName] = useState('');
  const [metalId, setMetalId] = useState('');
  const [purityId, setPurityId] = useState('');
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

  // Purities that belong to the chosen metal (if the purity rows carry a metal_id)
  const purityListFor = (mid: string) => {
    const list = purities.filter((p: any) => !p.metal_id || !mid || p.metal_id === mid);
    return list.length > 0 ? list : purities;
  };
  const purityOptions = useMemo(
    () => purityListFor(metalId).map((p) => ({ id: p.id, label: p.name })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [purities, metalId]
  );
  const metalOptions = useMemo(() => metals.map((m) => ({ id: m.id, label: m.name })), [metals]);

  // Today's rate for metal + purity (rate stays editable)
  const loadRate = async (mid: string, pid: string) => {
    setRateError(null);
    if (!mid || !pid) return;
    setRateLoading(true);
    try {
      const rate = await fetchRate(mid, pid);
      if (rate > 0) setRatePerGram(String(rate));
      else {
        setRatePerGram('');
        setRateError('No current rate found for this purity - enter it manually.');
      }
    } catch {
      setRateError("Could not fetch today's rate - enter it manually.");
    } finally {
      setRateLoading(false);
    }
  };

  const handleMetalChange = (id: string) => {
    setMetalId(id);
    const first = purityListFor(id)[0];
    const pid = first?.id ?? '';
    setPurityId(pid);
    void loadRate(id, pid);
  };

  const handlePurityChange = (id: string) => {
    setPurityId(id);
    void loadRate(metalId, id);
  };

  useEffect(() => {
    if (!visible) return;

    if (editingItem) {
      setName(editingItem.name);
      setMetalId(editingItem.metal_id ?? '');
      setPurityId(editingItem.purity_id ?? '');
      setGrossWeight(String(editingItem.gross_weight));
      setStoneWeight(String(editingItem.stone_weight ?? 0));
      setOldPercent(editingItem.old_percent > 0 ? String(editingItem.old_percent) : '');
      setRatePerGram(String(editingItem.rate_per_gram));
      setRateError(null);
      return; // keep the saved rate - do not overwrite with today's
    }

    setName('');
    setGrossWeight('');
    setStoneWeight('0');
    setOldPercent('');
    setRatePerGram('');

    // New item: start with Gold + 22K and fetch the rate straight away
    const gold = metals.find((m) => /gold/i.test(m.name)) ?? metals[0];
    const mid = gold?.id ?? '';
    const list = purityListFor(mid);
    const p22 = list.find((p) => p.name.trim().toLowerCase() === '22k') ?? list[0];
    setMetalId(mid);
    setPurityId(p22?.id ?? '');
    void loadRate(mid, p22?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingItem]);

  const gross = Number(grossWeight) || 0;
  const stone = Number(stoneWeight) || 0;
  const old = Number(oldPercent) || 0;
  const rate = Number(ratePerGram) || 0;

  const stoneExceedsGross = stone > gross && gross > 0;
  const oldInvalid = old > 100;

  const preview = useMemo(
    () =>
      computeExchangeItem({
        gross_weight: gross,
        stone_weight: stone,
        purity_percent: 0, // informational only in the calculation
        old_percent: old,
        deduction_percent: deductionFromOldPercent(old),
        rate_per_gram: rate,
      }),
    [gross, stone, old, rate]
  );

  const canSave =
    name.trim().length > 0 &&
    !!metalId &&
    !!purityId &&
    gross > 0 &&
    rate > 0 &&
    old > 0 &&
    !stoneExceedsGross &&
    !oldInvalid;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      id: editingItem?.id ?? `tmp_${Date.now()}`,
      name: name.trim(),
      metal_id: metalId,
      metal_name: metals.find((m) => m.id === metalId)?.name ?? '',
      purity_id: purityId,
      purity_name: purities.find((p) => p.id === purityId)?.name ?? '',
      gross_weight: gross,
      stone_weight: stone,
      old_percent: old,
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
            <Text style={styles.title}>{editingItem ? 'Edit Item' : 'Add Item'}</Text>
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

            <Field label="">
              <SelectField
                label="Metal"
                value={metalId}
                options={metalOptions}
                placeholder="Select metal"
                onChange={(id) => handleMetalChange(id as string)}
              />
            </Field>

            <Field label="">
              <SelectField
                label="Purity"
                value={purityId}
                options={purityOptions}
                placeholder="Select purity"
                onChange={(id) => handlePurityChange(id as string)}
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
                <Text style={styles.previewLabel}>Amount</Text>
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
  options,
  placeholder,
  invalid,
  onFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  options: number[];
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
  children: React.ReactNode;
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