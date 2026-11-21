// app/(tabs)/customers/add.tsx

import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Plus, Trash2 } from 'lucide-react-native';
import { Input } from '../../../src/components/ui';
import { DateField } from '../../../src/components/ui/DateFilter';
import { SelectField, SelectOption } from '../../../src/components/ui/SelectField';
import { ErrorModal } from '../../../src/components/ui/ErrorModal';
import { ImagePickerGrid, PickedImage } from '../../../src/components/product/ImagePickerGrid';
import { ExchangeGoldSection } from '../../../src/components/invoice/ExchangeGoldSection';
import { colors, spacing } from '../../../src/theme';
import { createCustomer } from '../../../src/lib/api/customers';
import {
  createCustomerOrder,
  attachOrderReferenceImages,
  getOrderImageUrl,
  PAYMENT_MODES,
  PaymentMode,
} from '../../../src/lib/api/customerOrders';
import { getCurrentRate } from '../../../src/lib/api/invoices';
import { shareOrderWithGoldsmithOnWhatsApp } from '../../../src/lib/whatsappShare';
import { getMetals, getPurities, getCategories } from '../../../src/lib/products';
import { listMetals, listPurities, createCategory } from '../../../src/lib/api/settings';
import { useKeyboardHeight } from '../../../src/lib/useKeyboardHeight';
import { useNotifications } from '../../../src/context/NotificationContext';
import { formatDisplayDate } from '../../../src/lib/dateUtils';
import type { ExchangeItem } from '../../../src/types/invoices';
import type { Metal, Purity } from '../../../src/types/settings';

// Defaults applied when a 91.6 (22k) purity is selected.
// Both stay editable. Making charge follows the minimum weight of the order.
const DEFAULT_VA_PERCENT = 13;
const MAKING_PER_GRAM = 100; // 4 g -> 400, 5 g -> 500, 6 g -> 600

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// A purity "is 91.6" when its name says so (916, 91.6, 22k) or its
// percentage is ~91.6. This way any naming the shop uses is recognised.
function isPurity916(name?: string | null, percentage?: number | null): boolean {
  if (name && /916|91\.6|22\s*k/i.test(name)) return true;
  const pct = Number(percentage);
  return Number.isFinite(pct) && Math.abs(pct - 91.6) < 0.15;
}

// Purity option = dropdown-style option + the percentage kept for the 91.6 check.
type PurityOption = SelectOption & { percentage: number | null };

// What a fresh order starts with (Gold + its 91.6 purity), filled in once master data loads.
type OrderDefaults = { metalId: string | null; purityId: string | null };

// ===========================================================
// One order "draft" — everything the cashier fills in for ONE order
// ===========================================================

interface OrderDraft {
  key: string;
  categoryId: string | null;
  metalId: string | null;
  purityId: string | null;
  weightMin: string;
  weightMax: string;
  stoneWeight: string;
  orderNotes: string;
  dueDate: string | null;
  vacPercent: string;
  makingChargeFixed: string;
  stoneChargeFixed: string;
  // Set once the cashier types their own VA % / making charge, so the
  // 91.6 auto-fill stops overwriting it.
  vaEdited: boolean;
  makingEdited: boolean;
  images: PickedImage[];
  goldsmithName: string;
  goldsmithPhone: string;
  advanceAmount: string;
  paymentMode: PaymentMode | null;
}

const genKey = () => Math.random().toString(36).slice(2, 10);

function newDraft(defaults?: OrderDefaults): OrderDraft {
  return {
    key: genKey(),
    categoryId: null,
    metalId: defaults?.metalId ?? null,
    purityId: defaults?.purityId ?? null,
    weightMin: '',
    weightMax: '',
    stoneWeight: '',
    orderNotes: '',
    dueDate: null,
    vacPercent: '',
    makingChargeFixed: '',
    stoneChargeFixed: '',
    vaEdited: false,
    makingEdited: false,
    images: [],
    goldsmithName: '',
    goldsmithPhone: '',
    advanceAmount: '',
    paymentMode: null,
  };
}

// An order is only created when at least one of its fields has been touched.
// Once touched, the full validation applies.
// Values filled in automatically (default Gold + 91.6, auto VA % and making
// charge) do NOT count, so a customer can still be saved without an order.
function isTouched(d: OrderDraft, defaults: OrderDefaults): boolean {
  return (
    !!d.categoryId ||
    d.metalId !== defaults.metalId ||
    d.purityId !== defaults.purityId ||
    d.weightMin.trim() !== '' ||
    d.weightMax.trim() !== '' ||
    d.stoneWeight.trim() !== '' ||
    d.orderNotes.trim() !== '' ||
    !!d.dueDate ||
    (d.vaEdited && d.vacPercent.trim() !== '') ||
    (d.makingEdited && d.makingChargeFixed.trim() !== '') ||
    d.stoneChargeFixed.trim() !== '' ||
    d.goldsmithName.trim() !== '' ||
    d.goldsmithPhone.trim() !== '' ||
    d.advanceAmount.trim() !== '' ||
    !!d.paymentMode ||
    d.images.length > 0
  );
}

interface PreparedOrder {
  draft: OrderDraft;
  categoryName: string;
  metalName: string;
  purityName: string;
  min: number;
  max: number | null;
  advance: number | null;
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
    return <Text style={styles.helperText}>{emptyText ?? 'No options'}</Text>;
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

// ===========================================================
// Screen
// ===========================================================

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

  // Master data
  const [categories, setCategories] = useState<SelectOption[]>([]);
  const [metals, setMetals] = useState<SelectOption[]>([]);
  // Purities per metal id (each order can use a different metal)
  const [purityByMetal, setPurityByMetal] = useState<Record<string, PurityOption[]>>({});
  const [loadingMeta, setLoadingMeta] = useState(true);

  // Gold + its 91.6 purity: what every new order starts with.
  const defaultsRef = useRef<OrderDefaults>({ metalId: null, purityId: null });

  // Full master records — needed by the Old Gold Exchange modal (same as the invoice screen)
  const [exchangeMetals, setExchangeMetals] = useState<Metal[]>([]);
  const [exchangePurities, setExchangePurities] = useState<Purity[]>([]);

  // ONE old gold exchange for the whole customer (not per order).
  // It is saved on the first order that gets created.
  const [exchangeItems, setExchangeItems] = useState<ExchangeItem[]>([]);
  const [exchangeTotal, setExchangeTotal] = useState(0);

  // Orders — starts with one (blank = customer only)
  const [orders, setOrders] = useState<OrderDraft[]>([newDraft()]);

  const [saving, setSaving] = useState(false);

  const [errorInfo, setErrorInfo] = useState<{ title: string; message: string } | null>(null);
  const [errorVisible, setErrorVisible] = useState(false);

  function showError(message: string, title = 'Something went wrong') {
    setErrorInfo({ title, message });
    setErrorVisible(true);
  }

  const touchedOrders = orders.filter((o) => isTouched(o, defaultsRef.current));
  const anyOrder = touchedOrders.length > 0;

  // ---------------------------------------------------------
  // Draft helpers
  // ---------------------------------------------------------

  const patchOrder = (key: string, patch: Partial<OrderDraft>) =>
    setOrders((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)));

  const addOrder = () => {
    setOrders((prev) => [...prev, newDraft(defaultsRef.current)]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
  };

  const removeOrder = (key: string) => setOrders((prev) => prev.filter((o) => o.key !== key));

  // Loads (and caches) the purities of a metal, in the same order as the purity master.
  async function loadPuritiesFor(metalId: string): Promise<PurityOption[]> {
    if (purityByMetal[metalId]) return purityByMetal[metalId];
    try {
      const p = await getPurities(metalId);
      const list: PurityOption[] = (p ?? []).map((x: any) => ({
        id: x.id,
        label: x.name,
        percentage: x.purity_percentage ?? null,
      }));
      setPurityByMetal((prev) => ({ ...prev, [metalId]: list }));
      return list;
    } catch (e: any) {
      console.warn('Could not load purities:', e);
      showError(e?.message ?? 'Failed to load purities');
      return [];
    }
  }

  const handleMetalChange = async (key: string, metalId: string | null) => {
    // Purity depends on metal, so reset it, then pick the 91.6 one once loaded
    patchOrder(key, { metalId, purityId: null });
    if (!metalId) return;

    const list = await loadPuritiesFor(metalId);
    const def = list.find((p) => isPurity916(p.label, p.percentage))?.id ?? null;
    setOrders((prev) =>
      prev.map((o) => (o.key === key && o.metalId === metalId && !o.purityId ? { ...o, purityId: def } : o))
    );
  };

  // Asks whether to send the design to the goldsmith right after the order is saved
  function askShareWithSmith(goldsmithName: string, orderNumber: string): Promise<boolean> {
    return new Promise((resolve) => {
      Alert.alert(
        'Share with goldsmith?',
        `Send the design details and reference picture of ${orderNumber} to ${goldsmithName.trim() || 'the goldsmith'} on WhatsApp?`,
        [
          { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Share', onPress: () => resolve(true) },
        ],
        { cancelable: false }
      );
    });
  }

  // ---------------------------------------------------------
  // Load master data, then start the first order with Gold + 91.6
  // ---------------------------------------------------------

  useEffect(() => {
    (async () => {
      try {
        const [c, m, fullMetals, fullPurities] = await Promise.all([
          getCategories(),
          getMetals(),
          listMetals(),
          listPurities(),
        ]);
        const metalOptions: SelectOption[] = (m ?? []).map((x: any) => ({ id: x.id, label: x.name }));
        setCategories((c ?? []).map((x: any) => ({ id: x.id, label: x.name })));
        setMetals(metalOptions);
        setExchangeMetals(fullMetals ?? []);
        setExchangePurities(fullPurities ?? []);

        // Gold + 91.6 become the starting selection of every order.
        const gold = metalOptions.find((x) => /^gold$/i.test(x.label.trim()));
        if (gold) {
          const list = await loadPuritiesFor(gold.id);
          const purityId = list.find((p) => isPurity916(p.label, p.percentage))?.id ?? null;
          defaultsRef.current = { metalId: gold.id, purityId };
          setOrders((prev) =>
            prev.map((o) => (!o.metalId ? { ...o, metalId: gold.id, purityId } : o))
          );
        }
      } catch (e: any) {
        console.warn('Could not load order master data:', e);
        showError(e?.message ?? 'Could not load order master data.');
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, []);

  // ---------------------------------------------------------
  // 91.6 defaults, per order:
  //   Value added % -> 13 (cleared again for other purities)
  //   Making charge -> ₹100 per gram of the minimum weight (4 g = 400, 5 g = 500)
  // Each stops auto-updating as soon as the cashier types their own value.
  // ---------------------------------------------------------
  useEffect(() => {
    setOrders((prev) => {
      let changed = false;
      const next = prev.map((d) => {
        const purity = (d.metalId ? purityByMetal[d.metalId] : undefined)?.find((p) => p.id === d.purityId);
        const is916 = isPurity916(purity?.label, purity?.percentage);
        let nd = d;

        if (!d.vaEdited) {
          const va = is916 ? String(DEFAULT_VA_PERCENT) : '';
          if (d.vacPercent !== va) nd = { ...nd, vacPercent: va };
        }
        if (!d.makingEdited) {
          const minW = parseFloat(d.weightMin) || 0;
          const mc = is916 && minW > 0 ? String(round2(minW * MAKING_PER_GRAM)) : '';
          if (d.makingChargeFixed !== mc) nd = { ...nd, makingChargeFixed: mc };
        }

        if (nd !== d) changed = true;
        return nd;
      });
      return changed ? next : prev;
    });
  }, [orders, purityByMetal]);

  // ---------------------------------------------------------
  // Inline "Add New" handler (category only; purities are managed in Settings)
  // Errors are thrown so the dropdown component can handle them itself.
  // ---------------------------------------------------------

  async function handleAddCategory(newName: string): Promise<SelectOption> {
    const created = await createCategory({ name: newName });
    const opt: SelectOption = { id: created.id, label: created.name };
    setCategories((prev) => [...prev, opt].sort((a, b) => a.label.localeCompare(b.label)));
    return opt;
  }

  // ---------------------------------------------------------
  // Save
  // ---------------------------------------------------------

  const handleSave = async () => {
    if (!name.trim()) {
      showError('Customer name is required.', 'Missing information');
      return;
    }
    if (!phone.trim()) {
      showError('Phone number is required.', 'Missing information');
      return;
    }

    // Validate EVERY touched order before saving anything, so the customer
    // is never saved with only some of the orders.
    const touched = touchedOrders;

    if (exchangeItems.length > 0 && touched.length === 0) {
      showError(
        'Old gold exchange is saved together with a jewel order. Fill in the order details, or remove the old gold items.',
        'Incomplete order'
      );
      return;
    }
    const multi = touched.length > 1;
    const prepared: PreparedOrder[] = [];

    for (const d of touched) {
      const idx = orders.findIndex((o) => o.key === d.key) + 1;
      const prefix = multi || orders.length > 1 ? `Order ${idx}: ` : '';
      const fail = (msg: string, title: string) => showError(prefix + msg, title);

      const categoryName = categories.find((c) => c.id === d.categoryId)?.label ?? '';
      const metalName = metals.find((m) => m.id === d.metalId)?.label ?? '';
      const purityName =
        (d.metalId ? purityByMetal[d.metalId] : undefined)?.find((p) => p.id === d.purityId)?.label ?? '';

      if (!categoryName) return fail('Select a category for the jewel order.', 'Incomplete order');
      if (!metalName) return fail('Select a metal for the jewel order.', 'Incomplete order');
      if (!purityName) return fail('Select a purity for the jewel order.', 'Incomplete order');

      const min = parseFloat(d.weightMin);
      if (isNaN(min)) return fail('Enter the minimum weight for the jewel order.', 'Incomplete order');

      let max: number | null = null;
      if (d.weightMax.trim()) {
        max = parseFloat(d.weightMax);
        if (isNaN(max)) return fail('Enter a valid maximum weight.', 'Invalid weight range');
        if (min > max) return fail('Minimum weight cannot exceed maximum weight.', 'Invalid weight range');
      }

      let advance: number | null = null;
      if (d.advanceAmount.trim()) {
        advance = parseFloat(d.advanceAmount);
        if (isNaN(advance) || advance < 0) return fail('Enter a valid advance amount.', 'Invalid advance');
        if (advance > 0 && !d.paymentMode) {
          return fail('Select a payment mode for the advance.', 'Incomplete order');
        }
      }

      prepared.push({ draft: d, categoryName, metalName, purityName, min, max, advance });
    }

    setSaving(true);
    try {
      const customer = await createCustomer({ name, phone, email, address, gstin });

      let failedOrders = 0;

      for (let pi = 0; pi < prepared.length; pi++) {
        const p = prepared[pi];
        const d = p.draft;
        // The shared old gold goes on the FIRST order only, so it is never counted twice
        const withExchange = pi === 0;
        try {
          const order = await createCustomerOrder({
            customer_id: customer.id,
            category: p.categoryName,
            metal: p.metalName,
            purity: p.purityName,
            weight_min: p.min,
            weight_max: p.max,
            stone_weight: d.stoneWeight ? parseFloat(d.stoneWeight) : null,
            notes: d.orderNotes,
            due_date: d.dueDate,
            vac_percent: d.vacPercent ? parseFloat(d.vacPercent) : null,
            making_charge: d.makingChargeFixed ? parseFloat(d.makingChargeFixed) : null,
            stone_charge: d.stoneChargeFixed ? parseFloat(d.stoneChargeFixed) : null,
            goldsmith_name: d.goldsmithName,
            goldsmith_phone: d.goldsmithPhone,
            advance_amount: p.advance,
            payment_mode: p.advance ? d.paymentMode : null,
            exchange_items: withExchange ? exchangeItems : [],
            exchange_total: withExchange ? exchangeTotal : 0,
          });

          // Upload reference pictures (order is already saved; a failed upload shouldn't lose it)
          const withData = d.images.filter((i) => !!i.base64) as { base64: string }[];
          let uploadedPaths: string[] = [];
          if (withData.length) {
            try {
              uploadedPaths = await attachOrderReferenceImages(order.id, withData);
            } catch (imgErr: any) {
              console.error('Reference image upload failed:', imgErr);
              showError(imgErr?.message ?? 'Pictures could not be uploaded.', 'Order saved, pictures failed');
            }
          }

          // Tell the other staff a new order was created
          const weightText = p.max !== null ? `${p.min}–${p.max}g` : `${p.min}g`;
          try {
            await notify(
              'order',
              'New jewel order',
              `${order.order_number} for ${name.trim()}: ${p.categoryName}, ${p.metalName} (${p.purityName}), ${weightText}` +
              (d.dueDate ? `, due ${formatDisplayDate(d.dueDate)}` : '') +
              (withExchange && exchangeTotal > 0 ? `, old gold ₹${exchangeTotal.toLocaleString('en-IN')}` : '')
            );
          } catch (notifyErr) {
            console.warn('Failed to send order notification', notifyErr);
          }

          // Offer to send the design to the goldsmith
          if (d.goldsmithName.trim() || d.goldsmithPhone.trim()) {
            if (await askShareWithSmith(d.goldsmithName, order.order_number)) {
              try {
                await shareOrderWithGoldsmithOnWhatsApp({
                  order,
                  base64Images: withData.map((i) => i.base64),
                  imageUrls: uploadedPaths.map(getOrderImageUrl), // fallback
                });
              } catch (shareErr) {
                console.warn('Goldsmith share failed', shareErr);
              }
            }
          }
        } catch (orderErr: any) {
          console.error('Order creation failed:', orderErr);
          failedOrders++;
        }
      }

      router.replace(
        failedOrders > 0 ? `/customers/${customer.id}?orderFailed=1` : `/customers/${customer.id}`
      );
    } catch (e: any) {
      showError(e.message ?? 'Could not save customer.', 'Could not save customer');
    } finally {
      setSaving(false);
    }
  };

  const saveLabel = saving
    ? 'Saving…'
    : !anyOrder
      ? 'Save Customer'
      : touchedOrders.length > 1
        ? `Save Customer & ${touchedOrders.length} Orders`
        : 'Save Order';

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

        {/* One old gold exchange for the whole customer — same component the invoice screen uses */}
        <ExchangeGoldSection
          items={exchangeItems}
          onChange={(list, sum) => {
            setExchangeItems(list);
            setExchangeTotal(sum);
          }}
          metals={exchangeMetals}
          purities={exchangePurities}
          fetchRate={getCurrentRate}
        />

        {orders.map((draft, index) => (
          <OrderForm
            key={draft.key}
            draft={draft}
            index={index}
            total={orders.length}
            categories={categories}
            metals={metals}
            purityOptions={draft.metalId ? purityByMetal[draft.metalId] ?? [] : []}
            onPatch={(patch) => patchOrder(draft.key, patch)}
            onMetalChange={(metalId) => handleMetalChange(draft.key, metalId)}
            onAddCategory={handleAddCategory}
            onRemove={() => removeOrder(draft.key)}
            onNotesFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300)}
          />
        ))}

        <View style={styles.footerRow}>
          <Pressable
            style={[styles.footerBtn, styles.footerBtnOutline, saving && styles.footerBtnDisabled]}
            onPress={addOrder}
            disabled={saving}
          >
            <Plus size={18} color={colors.white} />
            <Text style={[styles.footerBtnText, { color: '#fff' }]} numberOfLines={1}>
              Another Order
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.footerBtn,
              styles.footerBtnFilled,
              (saving || (anyOrder && loadingMeta)) && styles.footerBtnDisabled,
            ]}
            onPress={handleSave}
            disabled={saving || (anyOrder && loadingMeta)}
          >
            <Text
              style={[styles.footerBtnText, { color: '#fff' }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {saveLabel}
            </Text>
          </Pressable>
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

// ===========================================================
// One order's form (top-level component so typing never remounts it)
// ===========================================================

function OrderForm({
  draft,
  index,
  total,
  categories,
  metals,
  purityOptions,
  onPatch,
  onMetalChange,
  onAddCategory,
  onRemove,
  onNotesFocus,
}: {
  draft: OrderDraft;
  index: number;
  total: number;
  categories: SelectOption[];
  metals: SelectOption[];
  purityOptions: PurityOption[];
  onPatch: (patch: Partial<OrderDraft>) => void;
  onMetalChange: (metalId: string | null) => void;
  onAddCategory: (name: string) => Promise<SelectOption>;
  onRemove: () => void;
  onNotesFocus: () => void;
}) {
  const d = draft;

  return (
    <View style={styles.orderSection}>
      <View style={styles.orderTitleRow}>
        <Text style={styles.orderTitle}>{total > 1 ? `Order ${index + 1}` : 'Order'}</Text>
        {total > 1 && (
          <TouchableOpacity onPress={onRemove} hitSlop={8} style={styles.removeOrderBtn}>
            <Trash2 size={16} color={colors.error ?? 'crimson'} />
            <Text style={styles.removeOrderText}>Remove</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.sectionTitleFirst}>Reference Pictures</Text>
      <ImagePickerGrid images={d.images} onChange={(images) => onPatch({ images })} />

      <Text style={styles.sectionTitle}>Category</Text>
      <SelectField
        label="Category"
        value={d.categoryId}
        options={categories}
        onChange={(id) => onPatch({ categoryId: id as string })}
        onAddNew={onAddCategory}
      />

      {/* Metal & purity: radio buttons, Gold + 91.6 selected by default */}
      <Text style={styles.sectionTitle}>Metal & Purity</Text>
      <Text style={styles.label}>Metal</Text>
      <RadioGroup
        options={metals}
        value={d.metalId}
        onChange={(id) => onMetalChange(id)}
        emptyText="No metals found"
      />
      <Text style={[styles.label, styles.radioLabelGap]}>Purity</Text>
      <RadioGroup
        options={purityOptions}
        value={d.purityId}
        onChange={(id) => onPatch({ purityId: id })}
        disabled={!d.metalId}
        emptyText={d.metalId ? 'No purities for this metal' : 'Select a metal first'}
      />

      <Text style={styles.sectionTitle}>Weight Range (grams)</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.rowInput]}
          placeholder="Min weight *"
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          value={d.weightMin}
          onChangeText={(t) => onPatch({ weightMin: t })}
        />
        <TextInput
          style={[styles.input, styles.rowInput]}
          placeholder="Max weight (optional)"
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          value={d.weightMax}
          onChangeText={(t) => onPatch({ weightMax: t })}
        />
      </View>

      <Text style={styles.sectionTitle}>Stone Weight</Text>
      <TextInput
        style={styles.input}
        placeholder="Stone weight (ct, optional)"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
        value={d.stoneWeight}
        onChangeText={(t) => onPatch({ stoneWeight: t })}
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
            value={d.vacPercent}
            onChangeText={(t) => onPatch({ vacPercent: t, vaEdited: true })}
          />
        </View>
        <View style={styles.rowInput}>
          <Text style={styles.label}>Making charge ₹</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            value={d.makingChargeFixed}
            onChangeText={(t) => onPatch({ makingChargeFixed: t, makingEdited: true })}
          />
        </View>
      </View>
      <Text style={styles.label}>Stone charge ₹</Text>
      <TextInput
        style={styles.input}
        placeholder="0"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
        value={d.stoneChargeFixed}
        onChangeText={(t) => onPatch({ stoneChargeFixed: t })}
      />

      <Text style={styles.sectionTitle}>Issued to Goldsmith</Text>
      <TextInput
        style={styles.input}
        placeholder="Goldsmith name"
        placeholderTextColor={colors.textMuted}
        value={d.goldsmithName}
        onChangeText={(t) => onPatch({ goldsmithName: t })}
      />
      <TextInput
        style={styles.input}
        placeholder="Goldsmith phone number"
        placeholderTextColor={colors.textMuted}
        keyboardType="phone-pad"
        value={d.goldsmithPhone}
        onChangeText={(t) => onPatch({ goldsmithPhone: t })}
      />

      <Text style={styles.sectionTitle}>Advance Payment</Text>
      <TextInput
        style={styles.input}
        placeholder="Advance amount ₹ (optional)"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
        value={d.advanceAmount}
        onChangeText={(t) => onPatch({ advanceAmount: t })}
      />
      <Text style={styles.label}>Payment mode</Text>
      <View style={styles.chipWrap}>
        {PAYMENT_MODES.map((mode) => {
          const active = d.paymentMode === mode;
          return (
            <TouchableOpacity
              key={mode}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onPatch({ paymentMode: active ? null : mode })}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{mode}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>Due Date (optional)</Text>
      <DateField
        value={d.dueDate}
        onChange={(v) => onPatch({ dueDate: v })}
        placeholder="When does the customer need it?"
        minimumDate={new Date()}
        title="Due date"
      />

      <Text style={styles.sectionTitle}>Order Notes (optional)</Text>
      <TextInput
        style={[styles.input, styles.notesInput]}
        placeholder="Design reference, special instructions"
        placeholderTextColor={colors.textMuted}
        value={d.orderNotes}
        onChangeText={(t) => onPatch({ orderNotes: t })}
        onFocus={onNotesFocus}
        multiline
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  orderSection: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
  },
  orderTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  orderTitle: { fontSize: 15, fontWeight: '800', color: colors.primary },
  removeOrderBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4 },
  removeOrderText: { fontSize: 12, fontWeight: '700', color: colors.error ?? 'crimson' },
  addAnotherBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    borderRadius: 14,
  },
  addAnotherText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  sectionTitleFirst: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.sm },
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

  // Radio buttons (small, no background)
  helperText: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm, fontStyle: 'italic' },
  radioWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 18,
    rowGap: 8,
    marginBottom: spacing.sm,
  },
  radioLabelGap: { marginTop: spacing.xs },
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
  // Bottom buttons: same line, equal width, same size and style
  footerRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  footerBtn: {
    flex: 1,
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  footerBtnOutline: { backgroundColor: colors.primary },
  footerBtnFilled: { backgroundColor: colors.primary },
  footerBtnText: { fontSize: 15, fontWeight: '700' },
  footerBtnDisabled: { opacity: 0.6 },
});