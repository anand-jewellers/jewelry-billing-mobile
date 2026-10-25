// src/components/invoice/ExchangeGoldModal.tsx

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
  useWindowDimensions,
} from 'react-native';
import { X, ChevronDown, ChevronUp } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius } from '../../theme';
import { SelectField } from '../master';
import { useKeyboardHeight } from '../../lib/useKeyboardHeight';
import {
  computeExchangeItem,
  deductionFromOldPercent,
  COMMON_PURITIES,
  DISPLAY_PURITY_NAMES,
  OLD_PERCENT_STEPS,
  type ExchangeItemInput,
} from '../../lib/exchangeGold';
import type { ExchangeItem } from '../../types/invoices';
import type { Metal, Purity } from '../../types/settings';

// key: stable id used only by the dropdown control.
// dbId: the REAL purity_id to save/use for rate-fetch — null for the
// hardcoded fallback entries (91.6/REG/925) when no live Purity table rows exist.
interface PurityOption {
  key: string;
  dbId: string | null;
  label: string;
  percent: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (item: ExchangeItem) => void;
  metals?: Metal[];
  purities?: Purity[];
  fetchRate?: (metalId: string, purityId: string) => Promise<number>;
  editingItem?: ExchangeItem | null;
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
  const [description, setDescription] = useState('');
  const [grossWeight, setGrossWeight] = useState('');
  const [stoneWeight, setStoneWeight] = useState('0');

  const [purityKey, setPurityKey] = useState<string>('');
  const [selectedPurityId, setSelectedPurityId] = useState<string | null>(null);
  const [purityPercent, setPurityPercent] = useState('91.6');

  const [oldPercent, setOldPercent] = useState('');
  const [ratePerGram, setRatePerGram] = useState('');
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  // Keyboard / safe-area handling
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const { height: windowHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);

  // When a field near the bottom gets focus, scroll so it isn't hidden
  // behind the keyboard. The delay lets the keyboard finish opening.
  const scrollToField = () => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250);
  };

  const keyboardOpen = keyboardHeight > 0;

  // Sheet sits right above the keyboard when it is open, and is limited to
  // the space that is left so the header never goes off the top of the screen.
  const sheetMaxHeight = keyboardOpen
    ? Math.max(240, windowHeight - keyboardHeight - insets.top - 12)
    : windowHeight * 0.9;

  // Only 91.6% (22K), REG, and 925 (Silver) are ever shown, whether the
  // options come from the live Purity table or the hardcoded fallback.
  const purityOptions: PurityOption[] = useMemo(() => {
    if (purities.length > 0) {
      const filtered = purities.filter((p) =>
        DISPLAY_PURITY_NAMES.some((n) => n.toLowerCase() === p.name.trim().toLowerCase())
      );
      const list = filtered.length > 0 ? filtered : purities;
      return list.map((p) => ({
        key: p.id,
        dbId: p.id,
        label: `${p.name} (${(p as any).purity_percentage ?? '?'}%)`,
        percent: Number((p as any).purity_percentage) || 0,
      }));
    }
    return COMMON_PURITIES.map((p, i) => ({
      key: `fallback_${i}`,
      dbId: p.id,
      label: p.label,
      percent: p.percent,
    }));
  }, [purities]);

  const goldMetal = useMemo(
    () => metals.find((m) => /gold/i.test(m.name)) ?? metals[0] ?? null,
    [metals]
  );

  // Shared by both the initial default-selection AND manual dropdown taps,
  // so the rate always gets fetched the same way regardless of which path
  // set the purity — this is the fix for "amount doesn't calculate until I
  // reselect 916 a second time".
  const applyPurityOption = async (option: PurityOption | null) => {
    if (!option) return;

    setPurityKey(option.key);
    setSelectedPurityId(option.dbId);
    setPurityPercent(String(option.percent));
    setRateError(null);

    if (!fetchRate || !goldMetal || !option.dbId) return;

    setRateLoading(true);
    try {
      const rate = await fetchRate(goldMetal.id, option.dbId);
      if (rate > 0) {
        setRatePerGram(String(rate));
      } else {
        setRateError('No current rate found for this purity — enter it manually.');
      }
    } catch {
      setRateError("Could not fetch today's rate — enter it manually.");
    } finally {
      setRateLoading(false);
    }
  };

  const handleSelectPurity = (key: string) => {
    const option = purityOptions.find((o) => o.key === key);
    if (option) void applyPurityOption(option);
  };

  useEffect(() => {
    if (!visible) return;

    if (editingItem) {
      setDescription(editingItem.description);
      setGrossWeight(String(editingItem.gross_weight));
      setStoneWeight(String(editingItem.stone_weight ?? 0));
      setPurityPercent(String(editingItem.purity_percent));
      setOldPercent(editingItem.old_percent > 0 ? String(editingItem.old_percent) : '');
      setRatePerGram(String(editingItem.rate_per_gram));

      // Editing an existing item already has a saved rate — just select the
      // matching dropdown option without re-fetching (would overwrite what
      // was actually billed with today's rate).
      const match =
        purityOptions.find((o) => o.dbId != null && o.dbId === editingItem.purity_id) ??
        purityOptions.find((o) => o.percent === editingItem.purity_percent);
      setPurityKey(match?.key ?? '');
      setSelectedPurityId(match?.dbId ?? editingItem.purity_id);
      setRateError(null);
    } else {
      setDescription('');
      setGrossWeight('');
      setStoneWeight('0');
      setOldPercent('');
      setRatePerGram('');

      // New item: default to 91.6% (22K) AND fetch its rate immediately,
      // via the same path a manual tap uses — so the amount is ready to
      // calculate as soon as weight + old% are entered, no reselection needed.
      const def = purityOptions.find((o) => o.percent === 91.6) ?? purityOptions[0] ?? null;
      void applyPurityOption(def);
    }
    // purityOptions/goldMetal/fetchRate are stable per open; re-running this
    // only on visible/editingItem change avoids re-triggering on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingItem]);

  const parsedPurity = Number(purityPercent) || 0;
  const parsedOld = Number(oldPercent) || 0;
  const derivedDeduction = deductionFromOldPercent(parsedOld);

  const parsed: ExchangeItemInput = useMemo(
    () => ({
      gross_weight: Number(grossWeight) || 0,
      stone_weight: Number(stoneWeight) || 0,
      purity_percent: parsedPurity,
      old_percent: parsedOld,
      deduction_percent: derivedDeduction,
      rate_per_gram: Number(ratePerGram) || 0,
    }),
    [grossWeight, stoneWeight, parsedPurity, parsedOld, derivedDeduction, ratePerGram]
  );

  const stoneExceedsGross = parsed.stone_weight > parsed.gross_weight && parsed.gross_weight > 0;
  const oldPercentInvalid = parsedOld > 100;

  const preview = useMemo(() => computeExchangeItem(parsed), [parsed]);
  const canSave =
    description.trim().length > 0 &&
    parsed.gross_weight > 0 &&
    parsed.rate_per_gram > 0 &&
    parsedOld > 0 &&
    !stoneExceedsGross &&
    !oldPercentInvalid;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      id: editingItem?.id ?? `tmp_${Date.now()}`,
      description: description.trim(),
      gross_weight: parsed.gross_weight,
      stone_weight: parsed.stone_weight,
      purity_id: selectedPurityId,
      purity_percent: parsed.purity_percent,
      old_percent: parsed.old_percent,
      deduction_percent: parsed.deduction_percent,
      rate_per_gram: parsed.rate_per_gram,
      net_weight: preview.net_weight,
      amount: preview.amount,
    });
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      {/* Backdrop is pushed up by the keyboard height so the sheet sits above it */}
      <View style={[styles.backdrop, { paddingBottom: keyboardHeight }]}>
        <View
          style={[
            styles.sheet,
            {
              maxHeight: sheetMaxHeight,
              // Keyboard open: it already covers the navigation bar.
              // Keyboard closed: keep the button clear of the navigation bar.
              paddingBottom: keyboardOpen ? spacing.md : Math.max(insets.bottom, 24) + spacing.md,
            },
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.title}>{editingItem ? 'Edit Old Gold Item' : 'Add Old Gold Item'}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={20} color={colors.textPrimary} />
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: spacing.md }}
          >
            <Field label="Description">
              <TextInput
                style={styles.input}
                placeholder="e.g. Old gold chain, broken bangle"
                placeholderTextColor={colors.textMuted}
                value={description}
                onChangeText={setDescription}
              />
            </Field>

            <View style={styles.row2}>
              <Field label="Gross Weight (g)" style={{ flex: 1 }}>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.textMuted}
                  value={grossWeight}
                  onChangeText={setGrossWeight}
                />
              </Field>
              <Field label="Stone (or) Dust (g)" style={{ flex: 1 }}>
                <TextInput
                  style={[styles.input, stoneExceedsGross && styles.inputError]}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.textMuted}
                  value={stoneWeight}
                  onChangeText={setStoneWeight}
                />
              </Field>
            </View>
            {stoneExceedsGross && (
              <Text style={styles.errorText}>Stone weight can't exceed gross weight.</Text>
            )}

            <Field label="">
              <SelectField
                label="Purity"
                value={purityKey}
                options={purityOptions.map((o) => ({ id: o.key, label: o.label }))}
                onChange={(key) => handleSelectPurity(key as string)}
              />
            </Field>

            <Field label="Old %">
              <PercentPickerField
                value={oldPercent}
                onChange={setOldPercent}
                options={OLD_PERCENT_STEPS}
                placeholder="Tap to pick or type a value"
                invalid={oldPercentInvalid}
                onFocus={scrollToField}
              />
              {oldPercentInvalid && (
                <Text style={styles.errorText}>Old % can't exceed 100%.</Text>
              )}
            </Field>

            <Field label="Rate / gram (₹)">
              <View style={styles.rateInputWrap}>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  value={ratePerGram}
                  onChangeText={setRatePerGram}
                  onFocus={scrollToField}
                />
                {rateLoading && <ActivityIndicator size="small" color={colors.primary} style={styles.rateSpinner} />}
              </View>
              {rateError && <Text style={styles.errorText}>{rateError}</Text>}
            </Field>

            <View style={styles.previewCard}>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Exchange Value</Text>
                <Text style={styles.previewValueBold}>
                  ₹{Math.round(preview.amount).toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Text>
              </View>
            </View>
          </ScrollView>

          <Pressable
            style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
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

// ===========================================================
// Combined Old % control: a manual text field + a toggle that
// expands a row of preset chips (60–100) directly underneath.
// Tapping a chip fills the text field and collapses the presets;
// typing a custom value works exactly the same as before.
// ===========================================================

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

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: any }) {
  return (
    <View style={[{ marginBottom: spacing.md }, style]}>
      {!!label && <Text style={styles.fieldLabel}>{label}</Text>}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius?.md ?? 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.textPrimary },
  inputError: { borderColor: colors.error ?? 'crimson' },
  hintText: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  errorText: { fontSize: 11, color: colors.error ?? 'crimson', marginTop: 4 },
  row2: { flexDirection: 'row', gap: spacing.md },
  rateInputWrap: { position: 'relative', justifyContent: 'center' },
  rateSpinner: { position: 'absolute', right: 10 },
  previewCard: { backgroundColor: colors.background, borderRadius: radius?.md ?? 10, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.xs },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  previewLabel: { fontSize: 13, color: colors.textMuted },
  previewValueBold: { fontSize: 16, color: colors.primary, fontWeight: '800' },
  saveBtn: { backgroundColor: colors.primary, borderRadius: radius?.md ?? 10, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Combined Old % field: text input + toggle button in one row.
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
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: '#fff' },
});