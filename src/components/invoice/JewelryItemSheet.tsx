// src/components/invoice/JewelryItemSheet.tsx

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Modal,
  Keyboard,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, X, Check, Search } from 'lucide-react-native';
import { SelectField, SelectOption } from '../ui/SelectField';
import { MultiSelectField } from '../ui/MultiSelectField';
import { colors, spacing } from '../../theme';
import { useKeyboardHeight } from '../../lib/useKeyboardHeight';
import {
  getCurrentRate,
  getDefaultTaxSetting,
  getMakingChargeRule,
  searchProductNames,
} from '../../lib/api/invoices';
import { getStoneNames } from '../../lib/products';
import { createStoneName } from '../../lib/api/settings';
import {
  recalcItem,
  recalcVaLineAmount,
  isDiamondCharge,
  parseCarat,
  diamondChargeAmount,
  DIAMOND_CHARGE_PREFIX,
} from '../../lib/invoiceCalc';
import type { InvoiceItem, ValueAddedChargeLine } from '../../types/invoices';
import type { Metal, Purity, Category, TaxSetting, ValueAddedChargeType, CalculationType } from '../../types/settings';

const VA_CHARGE = 'Value Added Charge';
const STONE_CHARGE = 'Stone Charge';

// Defaults applied for a manual entry when a 91.6 (22k) purity is selected.
// Both stay editable by the cashier.
const DEFAULT_VA_PERCENT = 13;
const MAKING_PER_GRAM = 100; // 4 g -> 400, 5 g -> 500, 6 g -> 600

interface Props {
  visible: boolean;
  initial: InvoiceItem | null;
  metals: Metal[];
  purities: Purity[];
  categories: Category[];
  taxSettings: TaxSetting[];
  vaChargeTypes: ValueAddedChargeType[];
  billGstEnabled?: boolean;
  onClose: () => void;
  // Save: add the item and close the sheet.
  onSave: (item: InvoiceItem) => void;
  // Add New: add the item and keep the sheet open with a fresh form.
  // The "Add New" button only shows when this is passed (new items only).
  onSaveAndNext?: (item: InvoiceItem) => void;
  // Kept so the parent does not break; the sheet no longer creates these.
  onCategoryAdded?: (category: Category) => void;
  onPurityAdded?: (purity: Purity) => void;
}

// One editable diamond line: size = carat weight, rate = ₹ per carat.
// `fixedCharge` holds the charge exactly as it came from a scanned/saved item,
// so opening and re-saving an item never shifts the amount by a paisa.
// It is cleared as soon as the cashier edits the size or rate.
type DiamondRow = { key: string; size: string; rate: string; fixedCharge: number | null };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// A purity "is 91.6" when its name says so (916, 91.6, 22k) or its
// percentage is ~91.6. This way any naming the shop uses is recognised.
function isPurity916(p?: Purity | null): boolean {
  if (!p) return false;
  const name = String(p.name ?? '');
  if (/916|91\.6|22\s*k/i.test(name)) return true;
  const pct = Number((p as any).purity_percentage);
  return Number.isFinite(pct) && Math.abs(pct - 91.6) < 0.15;
}

// Piece-rate purities (e.g. "GOLD - PR", "SILVER - PR"): no weight / VA / making,
// the cashier just types the total amount.
export function isPiecePurity(p?: Purity | null): boolean {
  if (!p) return false;
  return /\bPR\b|piece\s*rate/i.test(String(p.name ?? ''));
}

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
    // No input any more. Only carried over from an existing item so its
    // net weight and total never change when it is opened and re-saved.
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
    stoneIds: [] as string[], // multi-select stones
    stoneAmounts: {} as Record<string, string>, // ₹ per stone id (used when 2+ stones)
    stoneName: null as string | null, // only used to restore multi-stone names on edit
    extraCharges: [] as ValueAddedChargeLine[], // other lines the sheet has no input for
    pieceAmount: '', // total amount for piece-rate purities
  };
}

type SheetState = ReturnType<typeof blankState>;

const netWeightOf = (s: SheetState) => {
  const gross = parseFloat(s.grossWeight) || 0;
  const stone = parseFloat(s.stoneWeight) || 0;
  const other = parseFloat(s.otherWeight) || 0;
  return Math.max(+(gross - stone - other).toFixed(3), 0);
};

// Stone charge:
// 2+ stones with typed per-stone amounts -> sum of those amounts.
// Otherwise (0/1 stone, or an old saved item with no per-stone amounts)
// -> the single Stone (₹) value.
function stoneChargeOf(s: SheetState): number {
  if (s.stoneIds.length >= 2) {
    const entered = s.stoneIds.some((id) => (s.stoneAmounts[id] ?? '').trim() !== '');
    if (entered) {
      return s.stoneIds.reduce((sum, id) => sum + (parseFloat(s.stoneAmounts[id]) || 0), 0);
    }
  }
  return parseFloat(s.stoneChargeFixed) || 0;
}

// Populate the sheet from an existing item (edit mode, or the draft
// item seeded from a customer order).
function stateFromItem(item: InvoiceItem): SheetState {
  const va = item.value_added_charges?.find((c) => c.name === VA_CHARGE);
  const stone = item.value_added_charges?.find((c) => c.name === STONE_CHARGE);
  const savedStoneName = item.stone_name ?? '';
  const hasMultiNames = savedStoneName.includes(',');
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
    stoneIds: item.stone_id && !hasMultiNames ? [item.stone_id] : [],
    stoneAmounts: {},
    stoneName: hasMultiNames ? savedStoneName : null,
    extraCharges: otherExtraLines(item.value_added_charges ?? []),
    pieceAmount: item.total_amount != null ? String(item.total_amount) : '',
  };
}

function makingLabel(type: CalculationType): string {
  const t = String(type);
  if (t === 'per_gram') return 'Making (₹/g)';
  if (t === 'percentage') return 'Making (%)';
  return 'Making (₹)';
}

// ---------- Small radio group (radio + text only, no background) ----------
function RadioGroup({
  options,
  value,
  onChange,
  disabled,
  emptyText,
}: {
  options: { id: string; label: string }[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  emptyText?: string;
}) {
  if (options.length === 0) {
    return <Text style={styles.emptyHint}>{emptyText ?? 'No options'}</Text>;
  }
  return (
    <View style={[styles.radioWrap, disabled && { opacity: 0.5 }]}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            style={styles.radioItem}
            onPress={() => !disabled && onChange(o.id)}
            hitSlop={6}
          >
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

// ---------- One row of the product-name dropdown ----------
// The part of the name that matches what was typed is shown in bold.
function NameSuggestionRow({
  name,
  query,
  last,
  onPress,
}: {
  name: string;
  query: string;
  last: boolean;
  onPress: () => void;
}) {
  const q = query.trim().toLowerCase();
  const at = q ? name.toLowerCase().indexOf(q) : -1;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.dropRow,
        !last && styles.dropRowBorder,
        pressed && styles.dropRowPressed,
      ]}
    >
      <Search size={15} color={colors.textMuted} />
      <Text style={styles.dropText} numberOfLines={1}>
        {at >= 0 ? (
          <>
            {name.slice(0, at)}
            <Text style={styles.dropTextMatch}>{name.slice(at, at + q.length)}</Text>
            {name.slice(at + q.length)}
          </>
        ) : (
          name
        )}
      </Text>
    </Pressable>
  );
}

// ---------- Small layout helper ----------
function Section({
  title,
  hint,
  children,
  style,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  style?: any;
}) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        {hint ? <Text style={styles.cardHint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
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
  onSaveAndNext,
  billGstEnabled = true,
}: Props) {
  const [state, setState] = useState<SheetState>(blankState());
  const [saving, setSaving] = useState(false);

  // Validation message shown above the footer buttons.
  const [formError, setFormError] = useState<string | null>(null);
  // How many items were added with "Add New" during this open session.
  const [addedCount, setAddedCount] = useState(0);
  // Bumped whenever the form is reset for the next product, so the
  // auto-fill effects run again even if metal / purity did not change.
  const [formKey, setFormKey] = useState(0);

  const scrollRef = useRef<ScrollView>(null);

  // Once the cashier types their own rate / making charge / VA %, auto-fill
  // must stop overwriting it (even if they later change metal/purity).
  const rateEditedRef = useRef(false);
  const makingEditedRef = useRef(false);
  const vaEditedRef = useRef(false);

  // ---------------------------------------------------------
  // Product name dropdown (names only, from the products table).
  //
  // Nothing is shown until the cashier TYPES something. `nameQuery` holds
  // only what was typed by hand, so opening an item for edit, picking a
  // suggestion or clearing the field never triggers a search.
  // ---------------------------------------------------------
  const [nameFocused, setNameFocused] = useState(false);
  const [nameQuery, setNameQuery] = useState('');
  const [nameResults, setNameResults] = useState<string[]>([]);
  const [nameNoMatch, setNameNoMatch] = useState(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearNameDropdown = () => {
    setNameQuery('');
    setNameResults([]);
    setNameNoMatch(false);
  };

  useEffect(() => {
    const q = nameQuery.trim();
    if (!visible || !nameFocused || !q) {
      setNameResults([]);
      setNameNoMatch(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const list = await searchProductNames(q, 5);
        if (cancelled) return;
        const typed = q.toLowerCase();
        // Hide a result that is exactly what was typed, there is nothing to pick.
        setNameResults(list.filter((n) => n.toLowerCase() !== typed).slice(0, 5));
        setNameNoMatch(list.length === 0);
      } catch (e) {
        console.warn('[JewelryItemSheet] product name search failed:', e);
        if (!cancelled) {
          setNameResults([]);
          setNameNoMatch(false);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visible, nameFocused, nameQuery]);

  useEffect(
    () => () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    },
    []
  );

  const handleNameChange = (v: string) => {
    setState((s) => ({ ...s, name: v }));
    setNameQuery(v);
  };

  const handleNameFocus = () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    setNameFocused(true);
  };

  // Small delay so a tap on a dropdown row still registers before it hides.
  const handleNameBlur = () => {
    blurTimerRef.current = setTimeout(() => setNameFocused(false), 200);
  };

  const selectSuggestedName = (name: string) => {
    setState((s) => ({ ...s, name }));
    clearNameDropdown();
    setNameFocused(false);
    Keyboard.dismiss();
  };

  const clearName = () => {
    setState((s) => ({ ...s, name: '' }));
    clearNameDropdown();
  };

  const showNameDropdown =
    nameFocused && nameQuery.trim().length > 0 && (nameResults.length > 0 || nameNoMatch);

  // ---------------------------------------------------------
  // Default metal / purity helpers
  // ---------------------------------------------------------

  // Default purity for a metal: the first one that means 91.6
  // (named 916, 91.6, 22k ... or with a ~91.6 percentage).
  const defaultPurityFor = (metalId: string | null): string | null => {
    if (!metalId) return null;
    return (purities ?? []).find((p) => p.metal_id === metalId && isPurity916(p))?.id ?? null;
  };

  const newItemDefaults = () => {
    const gold = (metals ?? []).find((m) => /^gold$/i.test(m.name.trim()));
    return { metalId: gold?.id ?? null, purityId: defaultPurityFor(gold?.id ?? null) };
  };

  // ---------------------------------------------------------
  // Piece-rate purity (GOLD - PR / SILVER - PR): only name + total amount.
  // ---------------------------------------------------------
  const isPiece = isPiecePurity((purities ?? []).find((p) => p.id === state.purityId));

  // ---------------------------------------------------------
  // Diamond detection: metal OR category whose name contains "diamond".
  //
  // The section also stays visible whenever diamond rows already exist
  // (scanned product / edit mode), so an existing diamond charge is never
  // hidden from the cashier while still being added to the total.
  // Never shown for piece-rate purities.
  // ---------------------------------------------------------
  const selectedMetalName = (metals ?? []).find((m) => m.id === state.metalId)?.name ?? '';
  const selectedCategoryName = (categories ?? []).find((c) => c.id === state.categoryId)?.name ?? '';
  const isDiamond = /diamond/i.test(selectedMetalName) || /diamond/i.test(selectedCategoryName);
  const showDiamonds = !isPiece && (isDiamond || state.diamonds.length > 0);

  // ---------------------------------------------------------
  // Keyboard handling.
  //
  // On Android the window may ALREADY shrink when the keyboard opens
  // (adjustResize). Lifting the sheet by the full keyboard height on top
  // of that lifts it twice and squashes it.
  //
  // So we measure the overlay: `baseH` is its tallest height (keyboard
  // closed), `overlayH` its current height. The difference is what the
  // window already gave up. We only lift by what is still covered.
  // ---------------------------------------------------------
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const kbHeight = useKeyboardHeight();

  const [overlayH, setOverlayH] = useState(0);
  const [baseH, setBaseH] = useState(0);

  const handleOverlayLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    setOverlayH(h);
    setBaseH((prev) => Math.max(prev, h));
  };

  // Reset when the sheet closes so it never re-opens "lifted".
  useEffect(() => {
    if (!visible) {
      setOverlayH(0);
      setBaseH(0);
    }
  }, [visible]);

  // How much the window already shrank for the keyboard (0 if it didn't).
  const shrink = baseH > 0 && overlayH > 0 ? baseH - overlayH : 0;
  // Only lift by what is still uncovered. Small leftovers are rounding / nav-bar noise.
  const rawLift = visible && kbHeight > 0 ? Math.max(0, kbHeight - shrink) : 0;
  const lift = rawLift < 24 ? 0 : rawLift;

  const availableH = overlayH > 0 ? overlayH : windowHeight;
  const sheetMaxHeight = Math.max(320, availableH - lift - insets.top - spacing.md);

  // ---------------------------------------------------------
  // Stone names for the Stones dropdown (loaded when the sheet opens).
  // ---------------------------------------------------------
  const [stoneOptions, setStoneOptions] = useState<SelectOption[]>([]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    getStoneNames()
      .then((list: any[]) => {
        if (cancelled) return;
        setStoneOptions((list ?? []).map((x: any) => ({ id: x.id, label: x.name })));
      })
      .catch((e: any) => console.warn('[JewelryItemSheet] Failed to load stone names:', e));
    return () => {
      cancelled = true;
    };
  }, [visible]);

  // Edit mode: a saved item has "Ruby, Emerald" as a name string -> map back to ids.
  useEffect(() => {
    if (!visible || stoneOptions.length === 0) return;
    setState((s) => {
      if (s.stoneIds.length > 0 || !s.stoneName) return s;
      const names = s.stoneName
        .split(',')
        .map((n) => n.trim().toLowerCase())
        .filter(Boolean);
      const ids = stoneOptions
        .filter((o) => names.includes(o.label.toLowerCase()))
        .map((o) => o.id);
      return ids.length ? { ...s, stoneIds: ids } : s;
    });
  }, [visible, stoneOptions, state.stoneName]);

  // ---------------------------------------------------------
  // Reset / populate every time the sheet opens.
  // MUST stay above the auto-fill effects so it runs first.
  // ---------------------------------------------------------
  useEffect(() => {
    if (!visible) return;

    rateEditedRef.current = false;
    makingEditedRef.current = false;
    vaEditedRef.current = false;
    setNameFocused(false);
    clearNameDropdown();
    setFormError(null);
    setAddedCount(0);

    if (initial) {
      const base = stateFromItem(initial);
      // A piece-rate item is stored WITH tax on top. While the bill's GST is off,
      // show the tax-free amount the cashier typed instead.
      const initialIsPiece = isPiecePurity((purities ?? []).find((p) => p.id === initial.purity_id));
      setState({
        ...base,
        gstEnabled: billGstEnabled,
        pieceAmount:
          initialIsPiece && !billGstEnabled && initial.taxable_amount != null
            ? String(initial.taxable_amount)
            : base.pieceAmount,
      });
    } else {
      setState({ ...blankState(), ...newItemDefaults(), gstEnabled: billGstEnabled });
    }
  }, [visible, initial]);

  // A validation message goes away as soon as the cashier changes anything.
  useEffect(() => {
    setFormError((prev) => (prev ? null : prev));
  }, [state]);

  // ---------------------------------------------------------
  // Auto-fill rate, default GST, and (for non-91.6 purities) the making
  // charge rule, for MANUAL entries (no `initial`).
  // For 91.6 purities the making charge comes from the weight-based
  // default in the next effect.
  // Piece-rate purities skip the rate and making rule entirely.
  // ---------------------------------------------------------
  useEffect(() => {
    if (!visible || initial) return;

    const { metalId, purityId, categoryId } = state;
    if (!metalId || !purityId) return;

    const selectedPurity = (purities ?? []).find((p) => p.id === purityId);
    const purityIs916 = isPurity916(selectedPurity);
    const purityIsPiece = isPiecePurity(selectedPurity);

    let cancelled = false;

    (async () => {
      try {
        const [liveRate, taxSetting] = await Promise.all([
          purityIsPiece ? Promise.resolve(0) : getCurrentRate(metalId, purityId).catch(() => 0),
          getDefaultTaxSetting().catch(() => null),
        ]);

        let makingRule: any = null;
        if (!purityIs916 && !purityIsPiece) {
          makingRule = await getMakingChargeRule(metalId, purityId, categoryId ?? null).catch((e) => {
            console.warn('[JewelryItemSheet] making rule (with category) failed:', e);
            return null;
          });

          if (!makingRule && categoryId) {
            makingRule = await getMakingChargeRule(metalId, purityId, null).catch((e) => {
              console.warn('[JewelryItemSheet] making rule (no category) failed:', e);
              return null;
            });
          }
        }

        if (cancelled) return;

        setState((s) => {
          // Ignore results that no longer match what's selected
          if (s.metalId !== metalId || s.purityId !== purityId) return s;

          // Piece-rate: no rate / making, only keep the default GST setting.
          if (purityIsPiece) {
            return { ...s, taxSettingId: s.taxSettingId ?? taxSetting?.id ?? null };
          }

          const keepMaking = makingEditedRef.current || purityIs916;

          return {
            ...s,
            rate: rateEditedRef.current ? s.rate : liveRate ? String(liveRate) : '',
            makingType: keepMaking
              ? s.makingType
              : ((makingRule?.calculation_type ?? 'fixed') as CalculationType),
            makingChargeFixed: keepMaking
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
  }, [visible, initial, state.metalId, state.purityId, state.categoryId, formKey]);

  // ---------------------------------------------------------
  // 91.6 defaults for MANUAL entries:
  //   VA %   -> 13 (cleared again for other purities)
  //   Making -> ₹100 per net gram, follows the weight (4 g = 400, 5 g = 500)
  // Both stop auto-updating as soon as the cashier types their own value.
  // Reads everything from the latest state so it is never stale.
  // ---------------------------------------------------------
  useEffect(() => {
    if (!visible || initial) return;

    setState((s) => {
      const purityIs916 = isPurity916((purities ?? []).find((p) => p.id === s.purityId));
      let next = s;

      if (!vaEditedRef.current) {
        const va = purityIs916 ? String(DEFAULT_VA_PERCENT) : '';
        if (s.vacPercent !== va) next = { ...next, vacPercent: va };
      }

      if (purityIs916 && !makingEditedRef.current) {
        const net = netWeightOf(s);
        const mc = net > 0 ? String(round2(net * MAKING_PER_GRAM)) : '';
        if (next.makingChargeFixed !== mc || next.makingType !== 'fixed') {
          next = { ...next, makingType: 'fixed' as CalculationType, makingChargeFixed: mc };
        }
      }

      return next;
    });
  }, [visible, initial, purities, state.purityId, state.grossWeight, state.stoneWeight, formKey]);

  // ---------------------------------------------------------
  // Inline "Add New" for Stone
  // ---------------------------------------------------------
  const handleAddStone = async (name: string): Promise<SelectOption> => {
    const created = await createStoneName({ name });
    const opt: SelectOption = { id: created.id, label: created.name };
    setStoneOptions((prev) => [...prev, opt].sort((a, b) => a.label.localeCompare(b.label)));
    return opt;
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
    // Piece-rate: the typed amount is the final (GST-inclusive) total.
    if (isPiece) {
      const total = Math.max(parseFloat(state.pieceAmount) || 0, 0);
      const pieceTax = state.gstEnabled
        ? taxSettings.find((t) => t.id === state.taxSettingId) ?? null
        : null;
      const pct = Number(pieceTax?.tax_percentage) || 0;
      const taxableBase = round2(total / (1 + pct / 100));

      // Reuse recalcItem only to get the CGST/SGST/IGST split and tax amount.
      const pieceCalc = recalcItem({
        netWeight: 1,
        rate: taxableBase,
        quantity: 1,
        makingType: 'fixed',
        makingValue: 0,
        vaCharges: [],
        itemDiscount: 0,
        taxSetting: pieceTax,
      });

      return {
        netWeight: 0,
        quantity: 1,
        vaLinesWithAmount: [] as ValueAddedChargeLine[],
        ...pieceCalc,
        metal_value: taxableBase,
        making_charge_amount: 0,
        taxable_amount: round2(total - pieceCalc.tax_amount),
        total_amount: total, // exactly what the cashier typed
      };
    }

    const netWeight = netWeightOf(state);
    const quantity = Math.max(parseFloat(state.quantity) || 1, 1);
    const rate = parseFloat(state.rate) || 0;
    const makingValue = parseFloat(state.makingChargeFixed) || 0;
    const itemDiscount = parseFloat(state.itemDiscount) || 0;

    // Per-item "Apply GST". When off, the item is calculated with no tax,
    // but taxSettingId is kept so ticking it again restores the same setting.
    const taxSetting = state.gstEnabled
      ? taxSettings.find((t) => t.id === state.taxSettingId) ?? null
      : null;

    const synthesizedVaLines: ValueAddedChargeLine[] = [];
    const vacValue = parseFloat(state.vacPercent) || 0;
    const stoneValue = stoneChargeOf(state);

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
    // Only counted while the Diamonds section is visible, so a hidden section
    // can never silently add charges to the bill.
    if (showDiamonds) {
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
    }

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
  }, [state, taxSettings, vaChargeTypes, showDiamonds, isPiece]);

  // ---------------------------------------------------------
  // Validate + build the item (shared by Save and Add New)
  // ---------------------------------------------------------
  const validate = (): string | null => {
    if (!state.name.trim()) return 'Enter the product name.';
    if (!state.metalId) return 'Select a metal.';
    if (!state.purityId) return 'Select a purity.';
    if (isPiece) {
      if (derived.total_amount <= 0) return 'Enter the total amount.';
    } else if (derived.netWeight <= 0) {
      return 'Enter the gross weight.';
    }
    return null;
  };

  const buildItem = (): InvoiceItem => {
    const stoneLabels = state.stoneIds
      .map((id) => stoneOptions.find((o) => o.id === id)?.label)
      .filter(Boolean) as string[];

    return {
      id: initial?.id ?? `local-${Date.now()}`,
      product_id: initial?.product_id ?? null,
      product_code: initial?.product_code ?? null,
      name: state.name.trim(),
      metal_id: state.metalId,
      purity_id: state.purityId,
      category_id: state.categoryId,
      quantity: derived.quantity,
      gross_weight: isPiece ? 0 : parseFloat(state.grossWeight) || 0,
      stone_weight: isPiece ? 0 : parseFloat(state.stoneWeight) || 0,
      other_weight: isPiece ? 0 : parseFloat(state.otherWeight) || 0,
      net_weight: derived.netWeight,
      metal_rate: isPiece ? 0 : parseFloat(state.rate) || 0,
      making_charge_type: state.makingType,
      making_charge_value: isPiece ? 0 : parseFloat(state.makingChargeFixed) || 0,
      value_added_charges: derived.vaLinesWithAmount,
      item_discount: isPiece ? 0 : parseFloat(state.itemDiscount) || 0,
      tax_setting_id: state.taxSettingId,
      gst_enabled: state.gstEnabled, // bill-wide GST toggle on the invoice screen decides at billing time
      huid: isPiece ? null : state.huid || null,
      // With several stones: first id + all names joined by comma.
      stone_id: isPiece ? null : state.stoneIds[0] ?? null,
      stone_name: isPiece
        ? null
        : stoneLabels.length
          ? stoneLabels.join(', ')
          : state.stoneName ?? null,
      metal_value: derived.metal_value,
      making_charge_amount: derived.making_charge_amount,
      taxable_amount: derived.taxable_amount,
      tax_percentage: derived.tax_percentage,
      cgst_percentage: derived.cgst_percentage,
      sgst_percentage: derived.sgst_percentage,
      igst_percentage: derived.igst_percentage,
      tax_amount: derived.tax_amount,
      total_amount: derived.total_amount,
    } as InvoiceItem;
  };

  // ---------------------------------------------------------
  // Save (adds the item and closes the sheet)
  // ---------------------------------------------------------
  const handleSave = () => {
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    setSaving(true);
    Keyboard.dismiss();
    onSave(buildItem());
    setSaving(false);
  };

  // ---------------------------------------------------------
  // Add New (adds the item, then clears the form for the next product)
  // ---------------------------------------------------------
  const resetForNext = () => {
    rateEditedRef.current = false;
    makingEditedRef.current = false;
    vaEditedRef.current = false;
    setNameFocused(false);
    clearNameDropdown();
    setState({ ...blankState(), ...newItemDefaults(), gstEnabled: state.gstEnabled });
    setFormKey((k) => k + 1);
    setAddedCount((n) => n + 1);
    setFormError(null);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const handleAddNew = () => {
    if (!onSaveAndNext) return;
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    Keyboard.dismiss();
    onSaveAndNext(buildItem());
    resetForNext();
  };

  const handleCancel = () => {
    Keyboard.dismiss();
    onClose();
  };

  // Tapping the dark area: first tap just hides the keyboard,
  // so half-typed data is never lost by accident.
  const handleBackdropPress = () => {
    if (kbHeight > 0) Keyboard.dismiss();
    else onClose();
  };

  const multiStone = state.stoneIds.length >= 2;
  const hiddenOtherWeight = parseFloat(state.otherWeight) || 0;

  // "Add New" is only for new entries. When editing an existing item
  // it would overwrite that item, so it is hidden.
  const canAddNew = !initial && !!onSaveAndNext;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={handleCancel}
    >
      <View style={styles.overlay} onLayout={handleOverlayLayout}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleBackdropPress} />

        <View style={[styles.sheet, { maxHeight: sheetMaxHeight, marginBottom: lift }]}>
          {/* Grab handle */}
          <View style={styles.handleWrap}>
            <View style={styles.handle} />
          </View>

          {/* Header: title on the left, close (X) on the right */}
          <View style={styles.header}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {initial
                ? 'Edit Item'
                : addedCount > 0
                  ? `Add Item · ${addedCount} added`
                  : 'Add Item'}
            </Text>
            <Pressable style={styles.closeBtn} onPress={handleCancel} hitSlop={8}>
              <X size={20} color={colors.textPrimary} />
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.xs,
              paddingBottom: spacing.lg,
            }}
          >
            {/* ---------------- Product ---------------- */}
            <Section title="Product">
              <Text style={styles.label}>Product Name *</Text>
              <View style={styles.nameWrap}>
                <TextInput
                  style={[styles.input, styles.nameInput]}
                  placeholder="Type a product name"
                  placeholderTextColor={colors.textMuted}
                  value={state.name}
                  onChangeText={handleNameChange}
                  onFocus={handleNameFocus}
                  onBlur={handleNameBlur}
                  autoCorrect={false}
                  returnKeyType="done"
                />
                {state.name.length > 0 && (
                  <Pressable style={styles.clearBtn} onPress={clearName} hitSlop={8}>
                    <X size={16} color={colors.textMuted} />
                  </Pressable>
                )}
              </View>

              {/* Dropdown: only after typing, max 5 matching product names */}
              {showNameDropdown && (
                <View style={styles.dropdown}>
                  {nameResults.length > 0 ? (
                    nameResults.map((n, i) => (
                      <NameSuggestionRow
                        key={n}
                        name={n}
                        query={nameQuery}
                        last={i === nameResults.length - 1}
                        onPress={() => selectSuggestedName(n)}
                      />
                    ))
                  ) : (
                    <View style={styles.dropEmpty}>
                      <Text style={styles.dropEmptyText}>
                        No matching product. “{nameQuery.trim()}” will be used as typed.
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </Section>

            {/* ---------------- Metal & Purity ---------------- */}
            <Section title="Metal & Purity">
              <Text style={styles.label}>Metal</Text>
              <RadioGroup
                options={(metals ?? []).map((m) => ({ id: m.id, label: m.name }))}
                value={state.metalId}
                onChange={(id) =>
                  setState((s) => ({ ...s, metalId: id, purityId: defaultPurityFor(id) }))
                }
              />

              <Text style={styles.label}>Purity</Text>
              <RadioGroup
                options={(purities ?? [])
                  .filter((p) => p.metal_id === state.metalId)
                  .map((p) => ({ id: p.id, label: p.name }))}
                value={state.purityId}
                onChange={(id) => setState((s) => ({ ...s, purityId: id }))}
                disabled={!state.metalId}
                emptyText={state.metalId ? 'No purities for this metal' : 'Select a metal first'}
              />
            </Section>

            {/* ---------------- Piece rate: only the total amount ---------------- */}
            {isPiece && (
              <Section title="Total Amount" hint="piece rate, no weight">
                <Text style={styles.label}>Total Amount (₹) *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  value={state.pieceAmount}
                  onChangeText={(v) => setState((s) => ({ ...s, pieceAmount: v }))}
                />
                <Text style={styles.computedHint}>
                  {state.gstEnabled
                    ? 'Amount includes GST (tax is taken out of it).'
                    : 'GST off: this amount is the final total.'}
                </Text>
              </Section>
            )}

            {/* ---------------- Piece rate: GST on/off ---------------- */}
            {isPiece && (
              <Section title="Tax">
                <Pressable
                  style={styles.gstToggle}
                  onPress={() => setState((s) => ({ ...s, gstEnabled: !s.gstEnabled }))}
                  hitSlop={8}
                >
                  <View style={[styles.checkbox, state.gstEnabled && styles.checkboxOn]}>
                    {state.gstEnabled && <Check size={14} color="#fff" strokeWidth={3} />}
                  </View>
                  <Text style={styles.gstLabel}>Apply GST</Text>
                </Pressable>

                <SelectField
                  label="GST Setting"
                  value={state.taxSettingId}
                  options={(taxSettings ?? []).map((t) => ({
                    id: t.id,
                    label: `${t.tax_name} (${t.tax_percentage}%)`,
                  }))}
                  onChange={(id) => setState((s) => ({ ...s, taxSettingId: id }))}
                  disabled={!state.gstEnabled}
                />

                {state.gstEnabled && derived.tax_percentage > 0 && (
                  <Text style={styles.computedHint}>
                    {derived.cgst_percentage > 0 || derived.sgst_percentage > 0
                      ? `CGST ${derived.cgst_percentage}% + SGST ${derived.sgst_percentage}%`
                      : `IGST ${derived.igst_percentage}%`}
                    {' · '}Tax: ₹{derived.tax_amount.toLocaleString('en-IN')}
                  </Text>
                )}
              </Section>
            )}

            {/* ---------------- Weight & Rate ---------------- */}
            {!isPiece && (
              <Section title="Weight & Rate" hint="weights in grams">
                <View style={styles.row}>
                  <View style={styles.col}>
                    <Text style={styles.label}>Gross (g)</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="0.000"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="decimal-pad"
                      value={state.grossWeight}
                      onChangeText={(v) => setState((s) => ({ ...s, grossWeight: v }))}
                    />
                  </View>
                  <View style={styles.col}>
                    <Text style={styles.label}>Stone (g)</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="0.000"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="decimal-pad"
                      value={state.stoneWeight}
                      onChangeText={(v) => setState((s) => ({ ...s, stoneWeight: v }))}
                    />
                  </View>
                </View>

                <View style={styles.weightBadge}>
                  <Text style={styles.weightBadgeLabel}>Calculated Net Weight</Text>
                  <Text style={styles.weightBadgeVal}>{derived.netWeight} g</Text>
                </View>
                {hiddenOtherWeight > 0 && (
                  <Text style={styles.computedHint}>
                    Includes {hiddenOtherWeight} g other weight already on this item.
                  </Text>
                )}

                <Text style={styles.label}>Rate per gram (₹)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  value={state.rate}
                  onChangeText={(v) => {
                    rateEditedRef.current = true;
                    setState((s) => ({ ...s, rate: v }));
                  }}
                />
              </Section>
            )}

            {/* ---------------- Charges ---------------- */}
            {!isPiece && (
              <Section title="Charges">
                <Text style={styles.label}>Stones</Text>
                <MultiSelectField
                  options={stoneOptions}
                  values={state.stoneIds}
                  onChange={(ids: string[]) =>
                    setState((s) => ({ ...s, stoneIds: ids, stoneName: null }))
                  }
                  placeholder="Select stones (optional)"
                  onAddNew={handleAddStone}
                />

                {/* One amount per stone, only when 2+ are selected */}
                {multiStone &&
                  state.stoneIds.map((id) => {
                    const label = stoneOptions.find((o) => o.id === id)?.label ?? 'Stone';
                    return (
                      <View key={id}>
                        <Text style={styles.label}>{label} amount (₹)</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="0"
                          placeholderTextColor={colors.textMuted}
                          keyboardType="decimal-pad"
                          value={state.stoneAmounts[id] ?? ''}
                          onChangeText={(v) =>
                            setState((s) => ({ ...s, stoneAmounts: { ...s.stoneAmounts, [id]: v } }))
                          }
                        />
                      </View>
                    );
                  })}

                <View style={[styles.row, { marginTop: spacing.xs }]}>
                  <View style={styles.col}>
                    <Text style={styles.label}>VA (%)</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="decimal-pad"
                      value={state.vacPercent}
                      onChangeText={(v) => {
                        vaEditedRef.current = true;
                        setState((s) => ({ ...s, vacPercent: v }));
                      }}
                    />
                  </View>
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
                    <Text style={styles.label}>{multiStone ? 'Stone total (₹)' : 'Stone (₹)'}</Text>
                    {multiStone ? (
                      <View style={[styles.input, styles.inputLocked]}>
                        <Text style={styles.lockedText}>{stoneChargeOf(state).toFixed(2)}</Text>
                      </View>
                    ) : (
                      <TextInput
                        style={styles.input}
                        placeholder="0"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="decimal-pad"
                        value={state.stoneChargeFixed}
                        onChangeText={(v) => setState((s) => ({ ...s, stoneChargeFixed: v }))}
                      />
                    )}
                  </View>
                </View>

                {/* Any other charge lines carried over from the scanned product */}
                {state.extraCharges.length > 0 && (
                  <View style={{ marginTop: spacing.xs }}>
                    {state.extraCharges.map((c) => (
                      <Text key={c.id} style={styles.computedHint}>
                        {c.name}: ₹{c.amount.toLocaleString('en-IN')}
                      </Text>
                    ))}
                  </View>
                )}
              </Section>
            )}

            {/* ---------------- Diamonds ----------------
                Shown when the Metal OR Category is Diamond
                (or when the item already carries diamond lines).
                Never for piece-rate purities. */}
            {showDiamonds && (
              <Section title="Diamonds" hint="size (ct) × rate per carat">
                {state.diamonds.length === 0 && (
                  <Text style={styles.emptyHint}>No diamonds added.</Text>
                )}
                {state.diamonds.map((d) => {
                  const ct = parseCarat(d.size);
                  const charge = diamondCharge(d);
                  return (
                    <View key={d.key} style={styles.diamondBlock}>
                      <View style={styles.diamondRow}>
                        <View style={styles.colFlex}>
                          <Text style={styles.label}>Size (ct)</Text>
                          <TextInput
                            style={styles.input}
                            placeholder="e.g. 0.25"
                            placeholderTextColor={colors.textMuted}
                            value={d.size}
                            onChangeText={(v) => updateDiamondRow(d.key, { size: v })}
                          />
                        </View>
                        <View style={styles.colFlex}>
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
              </Section>
            )}

            {/* ---------------- Tax & Discounts ---------------- */}
            {!isPiece && (
              <Section title="Tax & Discount">
                <Pressable
                  style={styles.gstToggle}
                  onPress={() => setState((s) => ({ ...s, gstEnabled: !s.gstEnabled }))}
                  hitSlop={8}
                >
                  <View style={[styles.checkbox, state.gstEnabled && styles.checkboxOn]}>
                    {state.gstEnabled && <Check size={14} color="#fff" strokeWidth={3} />}
                  </View>
                  <Text style={styles.gstLabel}>Apply GST</Text>
                </Pressable>

                <SelectField
                  label="GST Setting"
                  value={state.taxSettingId}
                  options={(taxSettings ?? []).map((t) => ({
                    id: t.id,
                    label: `${t.tax_name} (${t.tax_percentage}%)`,
                  }))}
                  onChange={(id) => setState((s) => ({ ...s, taxSettingId: id }))}
                  disabled={!state.gstEnabled}
                />

                {state.gstEnabled && derived.tax_percentage > 0 && (
                  <Text style={styles.computedHint}>
                    {derived.cgst_percentage > 0 || derived.sgst_percentage > 0
                      ? `CGST ${derived.cgst_percentage}% + SGST ${derived.sgst_percentage}%`
                      : `IGST ${derived.igst_percentage}%`}
                    {' · '}Tax: ₹{derived.tax_amount.toLocaleString('en-IN')}
                  </Text>
                )}

                <View style={[styles.row, { marginTop: spacing.xs }]}>
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
                      autoCapitalize="characters"
                      value={state.huid}
                      onChangeText={(v) => setState((s) => ({ ...s, huid: v }))}
                    />
                  </View>
                </View>
              </Section>
            )}

            {/* ---------------- Summary ---------------- */}
            {!isPiece && (
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
            )}
          </ScrollView>

          {/* ---------------- Footer: Add New + Save (always visible) ---------------- */}
          <View
            style={[
              styles.footer,
              { paddingBottom: (kbHeight > 0 ? 0 : insets.bottom) + spacing.sm },
            ]}
          >
            {formError ? <Text style={styles.formError}>{formError}</Text> : null}

            <View style={styles.footerRow}>
              {canAddNew && (
                <Pressable
                  style={[styles.footerBtn, styles.addNewBtn, saving && styles.btnDisabled]}
                  onPress={handleAddNew}
                  disabled={saving}
                >
                  <Plus size={18} color={colors.primary} />
                  <Text style={styles.addNewBtnText}>Add New</Text>
                </Pressable>
              )}

              <Pressable
                style={[styles.footerBtn, styles.saveBtn, saving && styles.btnDisabled]}
                onPress={handleSave}
                disabled={saving}
              >
                <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Sheet shell (centred with a max width, so it also looks right on tablets)
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  sheet: {
    width: '100%',
    maxWidth: 640,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  scroll: { flexShrink: 1 },
  handleWrap: { alignItems: 'center', paddingTop: 8 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  headerTitle: {
    flexShrink: 1,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  btnDisabled: { opacity: 0.6 },

  // Footer (Add New + Save)
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  footerRow: { flexDirection: 'row', gap: 10 },
  footerBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addNewBtn: { backgroundColor: '#FFFFFF' },
  addNewBtnText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  saveBtn: { backgroundColor: colors.primary },
  saveBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  formError: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#B00020',
    marginBottom: spacing.xs,
    textAlign: 'center',
  },

  // Section cards
  card: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.md,
    marginTop: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.xs,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardHint: { fontSize: 11.5, color: colors.textMuted },

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
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: '#fff',
  },
  inputLocked: { justifyContent: 'center', opacity: 0.8 },
  lockedText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },

  // Product name + dropdown
  nameWrap: { position: 'relative', justifyContent: 'center' },
  nameInput: { paddingRight: 40 },
  clearBtn: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  dropdown: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  dropRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  dropRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  dropRowPressed: { backgroundColor: '#F1F5F9' },
  dropText: { flex: 1, fontSize: 14, color: colors.textSecondary },
  dropTextMatch: { fontWeight: '800', color: colors.textPrimary },
  dropEmpty: { paddingHorizontal: spacing.md, paddingVertical: 12 },
  dropEmptyText: { fontSize: 12.5, color: colors.textMuted },

  // Responsive rows: columns wrap onto the next line on narrow screens
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: spacing.xs,
  },
  col: {
    flexGrow: 1,
    flexBasis: 96,
    minWidth: 96,
  },
  colFlex: { flex: 1 },

  // Radio buttons (small, no background)
  radioWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 18,
    rowGap: 8,
    marginBottom: spacing.xs,
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
  radioLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  radioLabelOn: { color: colors.textPrimary, fontWeight: '700' },

  // Diamond rows
  diamondBlock: { marginBottom: spacing.xs },
  diamondRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  removeBtn: { height: 42, width: 28, alignItems: 'center', justifyContent: 'center' },
  addRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  addRowBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  emptyHint: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic', marginBottom: 4 },

  weightBadge: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  weightBadgeLabel: {
    fontSize: 12,
    color: '#92400E',
    fontWeight: '600',
  },
  weightBadgeVal: {
    fontSize: 14,
    fontWeight: '800',
    color: '#92400E',
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
    backgroundColor: '#EEF2FF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  totalPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  totalPreviewBorder: {
    borderTopWidth: 1,
    borderTopColor: '#C7D2FE',
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
    fontSize: 17,
    fontWeight: '800',
    color: colors.primary,
  },
  // Apply GST checkbox
  gstToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.xs },
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
  gstLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
});