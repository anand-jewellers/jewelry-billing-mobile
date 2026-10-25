// app/(tabs)/invoices/new.tsx

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { Plus, Barcode, X, Check } from 'lucide-react-native';
import { Button, Card, ErrorModal } from '../../../src/components/ui';
import { SelectField } from '../../../src/components/master';
import { colors, spacing, radius } from '../../../src/theme';
import { searchPhoneContacts } from '../../../src/lib/phoneContacts';
import { PageGuard } from '../../../src/components/PageGuard';

import {
  listMetals,
  listPurities,
  listCategories,
  listTaxSettings,
  listValueAddedChargeTypes,
  getCompanySettings,
  getInvoiceSettings,
} from '../../../src/lib/api/settings';

import {
  getProductByCode,
  getCurrentRate,
  getMakingChargeRule,
  getDefaultTaxSetting,
  createInvoice,
  searchCustomers,
} from '../../../src/lib/api/invoices';

import { getCustomerById, listCustomers } from '../../../src/lib/api/customers';
import { completeCustomerOrderWithInvoice } from '../../../src/lib/api/customerOrders';

import { buildInvoiceItemFromProduct, invoiceTotals, recalcItem, withoutGst } from '../../../src/lib/invoiceCalc';
import { companyToShopDetails, printHtml } from '../../../src/lib/invoicePdf';
import { buildEstimateSlip, type SlipLine } from '../../../src/lib/estimateSlip';

import { BarcodeScannerModal } from '../../../src/components/invoice/BarcodeScannerModal';
import { InvoiceItemRow } from '../../../src/components/invoice/InvoiceItemRow';
import { JewelryItemSheet } from '../../../src/components/invoice/JewelryItemSheet';
import { ExchangeGoldSection } from '../../../src/components/invoice/ExchangeGoldSection';

import { useNotifications } from '../../../src/context/NotificationContext';

import {
  saveHeldEstimate,
  getHeldEstimate,
  type HeldEstimate,
} from '../../../src/lib/heldEstimates';

import type { Metal, Purity, Category, TaxSetting, ValueAddedChargeType } from '../../../src/types/settings';
import type {
  InvoiceItem,
  PaymentMode,
  PaymentSplitEntry,
  ExchangeItem,
  InvoiceItemDetail,
  ExchangeItemDetail,
  InvoiceCharge,
  InvoiceDetail,
  Customer,
} from '../../../src/types/invoices';
import { getSavedPrinter } from '../../../src/lib/thermalPrint/printerStore';
import { getConnectedPrinter, disconnectActive } from '../../../src/lib/thermalPrint/printerService';
import { printThermalReceiptDirect } from '../../../src/lib/thermalPrint/escposReceipt';
import ReactNativePosPrinter from 'react-native-thermal-pos-printer';
import { displayNetWeight } from '../../../src/lib/exchangeGold';

// import RNBluetoothClassic from 'react-native-bluetooth-classic';
import { ensureBluetoothPermissions } from '../../../src/lib/thermalPrint/bluetoothPermissions';

// NEW: share the estimate on WhatsApp as a thermal-style PDF
import { shareEstimateOnWhatsApp } from '../../../src/lib/whatsappShare';

// ===========================================================
// Constants
// ===========================================================

const PAYMENT_MODES = [
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Card' },
  { id: 'upi', label: 'UPI' },
  { id: 'bank_transfer', label: 'Bank Transfer' },
  { id: 'cheque', label: 'Cheque' },
  { id: 'credit', label: 'Credit' },
];

// Charge names as saved on the product / invoice item lines.
const VA_CHARGE = 'Value Added Charge';
const STONE_CHARGE = 'Stone Charge';

// Diamond rows from a product are saved as charge lines named
// "Diamond <size>" (e.g. "Diamond 0.25 ct").
const DIAMOND_CHARGE_PREFIX = 'Diamond';
const isDiamondCharge = (name: unknown) => String(name ?? '').startsWith(DIAMOND_CHARGE_PREFIX);
// "Diamond 0.25 ct" -> "0.25 ct"
const diamondWeightText = (name: unknown) =>
  String(name ?? '').replace(/^Diamond\s*/i, '').trim();

type Stage = 'building' | 'estimate';

// One row in the on-screen payment list. `amountText` stays a raw string
// (not a number) so the cashier can type "1" -> "12" -> "12." without the
// field fighting them; it's parsed to a number only where needed.
// `mode` is '' until the cashier explicitly picks one (no default).
interface PaymentSplitRow {
  id: string;
  mode: PaymentMode | '';
  amountText: string;
}

const genRowId = () => Math.random().toString(36).slice(2, 10);


// ===========================================================
// Number formatting helpers for the payment summary
// ===========================================================

const money = (n: number) => n.toFixed(2);
const plain = (n: number) => String(Number(n.toFixed(2)));
const withRate = (label: string, rate?: number | null) =>
  rate != null && rate > 0 ? `${label} @ ${Number(rate.toFixed(2))}%` : label;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;


// Exported screen: only renders the New Invoice screen (and runs its data
// loading) when the user has the 'invoices.new_invoice' permission.
export default function NewInvoiceScreen() {
  return (
    <PageGuard pageKey="invoices.new_invoice">
      <NewInvoiceScreenInner />
    </PageGuard>
  );
}

function NewInvoiceScreenInner() {
  // ---------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------

  const { notify } = useNotifications();

  // ---------------------------------------------------------
  // Incoming params
  //  - customer jewel order "Create Invoice" flow (orderId, ...)
  //  - heldId: opened from the Invoices page "Held Bills" list
  // ---------------------------------------------------------

  const {
    customerId: orderCustomerId,
    orderId,
    category: orderCategory,
    metal: orderMetal,
    purity: orderPurity,
    weightMin: orderWeightMin,
    weightMax: orderWeightMax,
    stoneWeight: orderStoneWeight,
    stoneName: orderStoneName,
    notes: orderNotes,
    orderNumber: orderNumberParam,
    heldId: heldIdParam,
    scan: scanParam,
    ts: scanTs,
  } = useLocalSearchParams<{
    customerId?: string;
    orderId?: string;
    category?: string;
    metal?: string;
    purity?: string;
    weightMin?: string;
    weightMax?: string;
    stoneWeight?: string;
    stoneName?: string;
    notes?: string;
    orderNumber?: string;
    heldId?: string;
    scan?: string;
    ts?: string;
  }>();

  const fromOrder = Boolean(orderId);

  const [resolvedCustomerId, setResolvedCustomerId] = useState<string | null>(null);
  const [orderPrefillApplied, setOrderPrefillApplied] = useState(false);

  // ---------------------------------------------------------
  // Master data
  // ---------------------------------------------------------

  const [metals, setMetals] = useState<Metal[]>([]);
  const [purities, setPurities] = useState<Purity[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [taxSettings, setTaxSettings] = useState<TaxSetting[]>([]);
  const [vaChargeTypes, setVaChargeTypes] = useState<ValueAddedChargeType[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(true);

  // ---------------------------------------------------------
  // Customer
  // (LOC / Remark is now stored PER ITEM, on each InvoiceItem.remark)
  // ---------------------------------------------------------

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  // ---------------------------------------------------------
  // Customer autocomplete (search by name or phone)
  // ---------------------------------------------------------

  const [suggestions, setSuggestions] = useState<Customer[]>([]);
  const [activeField, setActiveField] = useState<'name' | 'phone' | null>(null);
  const [searchDone, setSearchDone] = useState(false);

  // True only right after the user TYPES a digit (not on focus, not on delete).
  // Auto-fill is allowed only while this is true.
  const autoFillArmed = useRef(false);
  const prevPhoneDigits = useRef(0);

  const selectCustomer = (c: Customer, opts?: { dismissKeyboard?: boolean }) => {
    const fromContacts = c.id.startsWith('contact-');
    setCustomerName(c.name ?? '');
    setCustomerPhone(c.phone ?? '');
    // A phone contact is a NEW customer, so it has no database id yet
    setResolvedCustomerId(fromContacts ? null : c.id);
    setSuggestions([]);
    setActiveField(null);
    prevPhoneDigits.current = (c.phone ?? '').replace(/\D/g, '').length;
    autoFillArmed.current = false;
    // Only close the keyboard when the user tapped a suggestion
    if (opts?.dismissKeyboard !== false) Keyboard.dismiss();
  };

  // Typing by hand means it's no longer a confirmed existing customer.
  const onNameChange = (text: string) => {
    autoFillArmed.current = false;
    setCustomerName(text);
    setResolvedCustomerId(null);
    setActiveField('name');
    setSearchDone(false);
  };

  const onPhoneChange = (text: string) => {
    const digits = text.replace(/\D/g, '').length;
    // Arm auto-fill only when the user is adding digits, never when deleting
    autoFillArmed.current = digits > prevPhoneDigits.current;
    prevPhoneDigits.current = digits;

    // Only clear the name when the phone field is emptied completely
    if (text.trim() === '') {
      setCustomerName('');
    }
    setCustomerPhone(text);
    setResolvedCustomerId(null);
    setActiveField('phone');
    setSearchDone(false);
  };

  // Focusing a field must never trigger auto-fill
  const onPhoneFocus = () => {
    autoFillArmed.current = false;
    setActiveField('phone');
  };

  const onNameFocus = () => {
    autoFillArmed.current = false;
    setActiveField('name');
  };

  // ---------------------------------------------------------
  // Invoice items
  // ---------------------------------------------------------

  const [items, setItems] = useState<InvoiceItem[]>([]);

  // ---------------------------------------------------------
  // Old gold exchange
  // ---------------------------------------------------------

  const [exchangeItems, setExchangeItems] = useState<ExchangeItem[]>([]);
  const [exchangeTotal, setExchangeTotal] = useState(0);

  // ---------------------------------------------------------
  // Estimate / final stage
  // ---------------------------------------------------------

  const [stage, setStage] = useState<Stage>('building');

  // ---------------------------------------------------------
  // Discount / payment
  // ---------------------------------------------------------

  const [discountAmount, setDiscountAmount] = useState('0');
  // Bill-wide "Apply GST" switch (shown in the Receipt Preview header).
  const [gstEnabled, setGstEnabled] = useState(true);
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplitRow[]>([]);
  const [paymentSplitsTouched, setPaymentSplitsTouched] = useState(false);

  // ---------------------------------------------------------
  // Held estimate currently open on this screen (if any)
  // ---------------------------------------------------------

  const [activeHeldId, setActiveHeldId] = useState<string | null>(null);

  // A held estimate that has already been billed opens read-only
  // (print only — no editing, no holding, no second invoice).
  const [readOnly, setReadOnly] = useState(false);
  const [billedNumber, setBilledNumber] = useState<string | null>(null);

  // ---------------------------------------------------------
  // Scanner
  // ---------------------------------------------------------

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);

  // ---------------------------------------------------------
  // Item sheet
  // ---------------------------------------------------------

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InvoiceItem | null>(null);

  // ---------------------------------------------------------
  // Saving
  // ---------------------------------------------------------

  const [saving, setSaving] = useState(false);

  // ---------------------------------------------------------
  // Print estimate (pre-save thermal preview)
  // ---------------------------------------------------------

  const [printingEstimate, setPrintingEstimate] = useState(false);

  // ---------------------------------------------------------
  // Share estimate on WhatsApp (thermal-style PDF)
  // ---------------------------------------------------------

  const [sharingEstimate, setSharingEstimate] = useState(false);

  // ---------------------------------------------------------
  // Inline validation error
  // ---------------------------------------------------------

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState<string>('Missing details');


  // =========================================================
  // Load master data
  // =========================================================

  const load = useCallback(() => {
    setLoadingMaster(true);
    Promise.all([
      listMetals(),
      listPurities(),
      listCategories(),
      listTaxSettings(),
      listValueAddedChargeTypes(),
    ])
      .then(([m, p, c, t, v]) => {
        setMetals(m);
        setPurities(p);
        setCategories(c);
        setTaxSettings(t);
        setVaChargeTypes(v);
      })
      .finally(() => setLoadingMaster(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // =========================================================
  // Customer autocomplete: debounced search
  // =========================================================

  useEffect(() => {
    if (readOnly || !activeField || resolvedCustomerId) {
      setSuggestions([]);
      setSearchDone(false);
      return;
    }

    const raw = activeField === 'name' ? customerName : customerPhone;
    const q = raw.trim().replace(/[,()%]/g, '');
    const minLen = activeField === 'phone' ? 3 : 2;

    if (q.length < minLen) {
      setSuggestions([]);
      setSearchDone(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const [dbResults, contactResults] = await Promise.all([
          listCustomers({ search: q }),
          searchPhoneContacts(q, activeField),
        ]);
        if (cancelled) return;

        // Don't show a phone contact if that number is already a saved customer
        const dbPhones = new Set(dbResults.map((c) => (c.phone ?? '').replace(/\D/g, '').slice(-10)));
        const extra = contactResults.filter((c) => !dbPhones.has(c.phone ?? ''));
        const merged = [...dbResults, ...extra];

        // Auto-fill ONLY if the user just typed forward to a full number
        if (
          activeField === 'phone' &&
          autoFillArmed.current &&
          q.replace(/\D/g, '').length >= 10 &&
          merged.length === 1
        ) {
          selectCustomer(merged[0], { dismissKeyboard: false });
          return;
        }

        setSuggestions(merged.slice(0, 6));
        setSearchDone(true);
      } catch (e: any) {
        console.warn('[customer search] failed:', e?.message ?? e);
        if (!cancelled) {
          setSuggestions([]);
          setSearchDone(true);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [customerName, customerPhone, activeField, resolvedCustomerId, readOnly]);


  // =========================================================
  // Pre-fill from a customer jewel order (Create Invoice flow)
  // =========================================================

  useEffect(() => {
    if (!fromOrder || loadingMaster || orderPrefillApplied) return;
    setOrderPrefillApplied(true);

    (async () => {
      if (orderCustomerId) {
        try {
          const customer = await getCustomerById(orderCustomerId);
          setResolvedCustomerId(customer.id);
          setCustomerName(customer.name ?? '');
          setCustomerPhone(customer.phone ?? '');
        } catch (e) {
          console.warn('Could not load customer for order prefill:', e);
        }
      }

      const matchedMetal = orderMetal
        ? metals.find((m) => m.name.toLowerCase() === orderMetal.toLowerCase())
        : undefined;
      const matchedPurity = orderPurity
        ? purities.find((p) => p.name.toLowerCase() === orderPurity.toLowerCase())
        : undefined;
      const matchedCategory = orderCategory
        ? categories.find((c) => c.name.toLowerCase() === orderCategory.toLowerCase())
        : undefined;

      // Min weight is required on the order, max weight is optional.
      // Use the max weight when it is given, otherwise fall back to the min weight.
      const minW = orderWeightMin ? parseFloat(orderWeightMin) : 0;
      const maxW = orderWeightMax ? parseFloat(orderWeightMax) : 0;
      const netWeight = maxW > 0 ? maxW : minW;
      const stoneWeight = orderStoneWeight ? parseFloat(orderStoneWeight) : 0;

      let rate = 0;
      let makingRule = null as Awaited<ReturnType<typeof getMakingChargeRule>>;
      let taxSetting = null as Awaited<ReturnType<typeof getDefaultTaxSetting>>;

      if (matchedMetal && matchedPurity) {
        try {
          [rate, makingRule, taxSetting] = await Promise.all([
            getCurrentRate(matchedMetal.id, matchedPurity.id),
            getMakingChargeRule(matchedMetal.id, matchedPurity.id, matchedCategory?.id ?? null),
            getDefaultTaxSetting(),
          ]);
        } catch (e) {
          console.warn('Could not fetch rate/making-charge/tax for order prefill:', e);
        }
      }

      const makingType = makingRule?.calculation_type ?? 'per_gram';
      const makingValue = makingRule?.value ?? 0;

      const calc = recalcItem({
        netWeight,
        rate,
        quantity: 1,
        makingType,
        makingValue,
        vaCharges: [],
        itemDiscount: 0,
        taxSetting,
      });

      const draftItem: InvoiceItem = {
        id: `draft-${Date.now()}`,
        product_id: null,
        product_code: null,
        name: orderCategory ? `${orderCategory} (Made to Order)` : 'Made to Order Item',
        metal_id: matchedMetal?.id ?? null,
        purity_id: matchedPurity?.id ?? null,
        category_id: matchedCategory?.id ?? null,
        quantity: 1,
        gross_weight: netWeight + stoneWeight,
        stone_weight: stoneWeight,
        other_weight: 0,
        net_weight: netWeight,
        metal_rate: rate,
        metal_value: calc.metal_value,
        making_charge_type: makingType,
        making_charge_value: makingValue,
        making_charge_amount: calc.making_charge_amount,
        value_added_charges: [],
        item_discount: 0,
        taxable_amount: calc.taxable_amount,
        tax_setting_id: taxSetting?.id ?? null,
        tax_percentage: calc.tax_percentage,
        cgst_percentage: calc.cgst_percentage,
        sgst_percentage: calc.sgst_percentage,
        igst_percentage: calc.igst_percentage,
        tax_amount: calc.tax_amount,
        total_amount: calc.total_amount,
        huid: null,
        // The order note now lives on the item itself
        remark: orderNumberParam
          ? `Order ${orderNumberParam}${orderCategory ? ` — ${orderCategory}` : ''}`
          : '',
      };

      if (!matchedMetal || !matchedPurity) {
        console.warn(
          `Order prefill: could not match metal "${orderMetal}" / purity "${orderPurity}" against master data — item opened with rate ₹0, select metal/purity manually.`
        );
      }

      setEditingItem(draftItem);
      setSheetOpen(true);
    })();
  }, [fromOrder, loadingMaster, orderPrefillApplied, orderCustomerId, orderMetal, orderPurity, orderCategory, orderWeightMin, orderWeightMax, orderStoneWeight, orderNumberParam, metals, purities, categories]);


  // =========================================================
  // Barcode scan -> auto-fetch product -> build priced item
  //
  // If the product is already sold, show ONLY an "Already sold"
  // message (no product details) and do not add anything.
  // =========================================================

  const handleScanned = async (code: string) => {
    if (scanBusy) return;
    setScanBusy(true);

    try {
      const trimmed = code.trim();
      const product = await getProductByCode(trimmed);

      if (!product) {
        Alert.alert(
          'Product not found',
          `No product matches "${trimmed}". Confirm the barcode was generated from this product's Product ID.`,
          [
            { text: 'OK' },
            {
              text: 'Add manually',
              onPress: () => {
                setScannerOpen(false);
                setEditingItem(null);
                setSheetOpen(true);
              },
            },
          ]
        );
        return;
      }

      // Already sold -> error modal only, no product details, nothing added.
      if (product.status === 'sold') {
        setScannerOpen(false); // close the scanner so the modal can show on top of it
        setErrorTitle('Already sold');
        setErrorMessage('This product has already been sold.');
        return;
      }

      // Same piece is already in the current bill.
      if (items.some((i) => i.product_id === product.id)) {
        setScannerOpen(false);
        setErrorTitle('Already added');
        setErrorMessage('This product is already in the current bill.');
        return;
      }

      
      const [rate, makingRule, taxSetting] = await Promise.all([
        getCurrentRate(product.metal_id, product.purity_id),
        getMakingChargeRule(product.metal_id, product.purity_id, product.category_id),
        getDefaultTaxSetting(),
      ]);

      const item = buildInvoiceItemFromProduct(product, rate, makingRule, taxSetting);
      setItems((prev) => [...prev, { ...item, remark: '' }]);
      setScannerOpen(false);
    } catch (e: any) {
      Alert.alert('Lookup error', e?.message ?? 'Could not fetch product.');
    } finally {
      setScanBusy(false);
    }
  };


  // =========================================================
  // Item sheet save / remove / per-item remark
  // =========================================================

  const handleItemSave = (item: InvoiceItem) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === item.id);
      // The sheet may not know about `remark`, so keep the one already typed.
      const merged: InvoiceItem = { ...item, remark: item.remark ?? existing?.remark ?? '' };
      return existing ? prev.map((i) => (i.id === item.id ? merged : i)) : [...prev, merged];
    });
    setSheetOpen(false);
    setEditingItem(null);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const updateItemRemark = (id: string, text: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, remark: text } : i)));
  };


  // =========================================================
  // Payment split row management
  // =========================================================

  const addPaymentSplit = () => {
    setPaymentSplitsTouched(true);
    setPaymentSplits((prev) => [...prev, { id: genRowId(), mode: '', amountText: '' }]);
  };

  const removePaymentSplit = (id: string) => {
    setPaymentSplitsTouched(true);
    setPaymentSplits((prev) => prev.filter((row) => row.id !== id));
  };

  const updatePaymentSplitMode = (id: string, mode: PaymentMode) => {
    setPaymentSplitsTouched(true);
    setPaymentSplits((prev) => prev.map((row) => (row.id === id ? { ...row, mode } : row)));
  };

  const updatePaymentSplitAmount = (id: string, text: string) => {
    setPaymentSplitsTouched(true);
    setPaymentSplits((prev) => prev.map((row) => (row.id === id ? { ...row, amountText: text } : row)));
  };


  // =========================================================
  // Totals
  // =========================================================

  const amountOf = (row: PaymentSplitRow) => parseFloat(row.amountText) || 0;

  // Money actually received (credit rows are NOT received)
  const totalReceived = paymentSplits
    .filter((r) => r.mode !== 'credit')
    .reduce((sum, r) => sum + amountOf(r), 0);

  // Amount the customer will pay later
  const creditAmount = round2(
    paymentSplits.filter((r) => r.mode === 'credit').reduce((sum, r) => sum + amountOf(r), 0)
  );

  // When "Apply GST" is unticked every item is stripped of tax, so all totals,
  // the preview, the print and the saved invoice are GST-free.
  const billItems = gstEnabled ? items : items.map(withoutGst);

  const totals = invoiceTotals(
    billItems,
    stage === 'estimate' ? parseFloat(discountAmount) || 0 : 0,
    stage === 'estimate' ? totalReceived : 0
  );


  const netFinalAmount = round2(Math.max(0, totals.grandTotal - exchangeTotal));
  const netBalanceDue = round2(Math.max(0, netFinalAmount - totalReceived));
  const splitMismatch = round2(netFinalAmount - totalReceived - creditAmount);

  const vaAmount = totals.vaBreakdown[VA_CHARGE] ?? 0;
  const vaRate = totals.vaRates[VA_CHARGE];
  const stoneAmount = totals.vaBreakdown[STONE_CHARGE] ?? 0;

  const otherCharges = Object.entries(totals.vaBreakdown)
    .filter(([name, amount]) => name !== VA_CHARGE && name !== STONE_CHARGE && amount > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  const hasTax = totals.cgstTotal > 0 || totals.sgstTotal > 0 || totals.igstTotal > 0;

  // Per-item remarks joined into one text, used for the invoice-level
  // `remark` column and the estimate object.
  const combinedRemark = items
    .map((i) => i.remark?.trim())
    .filter(Boolean)
    .join(' | ');


  // =========================================================
  // Apply GST toggle (Receipt Preview header)
  // Locked once the estimate is generated or the bill is already billed.
  // =========================================================

  const handleToggleGst = () => {
    if (readOnly) return;
    if (stage === 'estimate') {
      Alert.alert('Editing locked', 'Go back to editing to change GST.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Go back', onPress: handleBackToEditing },
      ]);
      return;
    }
    setGstEnabled((v) => !v);
  };


  // =========================================================
  // Held estimates: hold / load
  //
  // The list itself lives on the Invoices page ("Held Bills").
  // This screen only holds the current bill, and loads one back
  // when opened with ?heldId=...
  // =========================================================

  // Everything needed to rebuild the screen later.
  // `remark` is kept (blank) only so the HeldEstimate type is still satisfied;
  // the real remarks now live on each item.
  const buildHeldData = () => ({
    customerName,
    customerPhone,
    remark: '',
    resolvedCustomerId,
    items,
    exchangeItems,
    exchangeTotal,
    discountAmount,
    paymentSplits,
    paymentSplitsTouched,
    stage,
    gstEnabled,
  });

  const resetForm = () => {
    setItems([]);
    setExchangeItems([]);
    setExchangeTotal(0);
    setCustomerName('');
    setCustomerPhone('');
    setDiscountAmount('0');
    setPaymentSplits([]);
    setPaymentSplitsTouched(false);
    setResolvedCustomerId(null);
    setSuggestions([]);
    setActiveField(null);
    setStage('building');
    setActiveHeldId(null);
    setReadOnly(false);
    setBilledNumber(null);
    setGstEnabled(true);
    prevPhoneDigits.current = 0;
    autoFillArmed.current = false;
  };

  const handleHoldEstimate = async () => {
    if (readOnly) return; // billed estimates are print-only
    if (items.length === 0) {
      setErrorTitle('No items');
      setErrorMessage('Add at least one item before holding an estimate.');
      return;
    }
    try {
      await saveHeldEstimate({
        id: activeHeldId,
        label: customerName.trim() || 'Walk-in Customer',
        grandTotal: netFinalAmount,
        data: buildHeldData(),
      });
      resetForm(); // screen is clear for the next customer
      Alert.alert('Estimate held', 'Saved for 4 hours. Find it under "Held Bills" on the Invoices page.');
    } catch (e: any) {
      setErrorTitle('Could not hold estimate');
      setErrorMessage(e?.message ?? 'Unknown error');
    }
  };

  const applyHeld = (h: HeldEstimate) => {
    const d = h.data;
    setCustomerName(d.customerName);
    setCustomerPhone(d.customerPhone);
    prevPhoneDigits.current = (d.customerPhone ?? '').replace(/\D/g, '').length;
    autoFillArmed.current = false;
    setResolvedCustomerId(d.resolvedCustomerId);
    setActiveField(null); // loading a held bill must not trigger a customer search
    setSuggestions([]);
    // Older held bills had ONE bill-wide remark: copy it onto each item
    // that has no remark of its own.
    setItems(d.items.map((i: InvoiceItem) => ({ ...i, remark: i.remark ?? d.remark ?? '' })));
    setExchangeItems(d.exchangeItems);
    setExchangeTotal(d.exchangeTotal);
    setDiscountAmount(d.discountAmount);
    setPaymentSplits(d.paymentSplits);
    setPaymentSplitsTouched(d.paymentSplitsTouched);
    setStage(d.stage);
    // Held bills saved before the GST switch existed have no flag -> GST on.
    setGstEnabled((d as any).gstEnabled !== false);
    setActiveHeldId(h.id);

    // Already billed -> locked, print only.
    const isBilled = Boolean(h.billedInvoiceNumber);
    setReadOnly(isBilled);
    setBilledNumber(h.billedInvoiceNumber ?? null);
    if (isBilled) setStage('estimate'); // show the full bill with payments
  };

  // Opened from the Invoices page "Held Bills" list.
  useEffect(() => {
    if (!heldIdParam) return;
    let cancelled = false;
    (async () => {
      const h = await getHeldEstimate(heldIdParam);
      if (cancelled) return;
      if (h) applyHeld(h);
      else Alert.alert('Not found', 'This held bill has expired or was deleted.');
    })();
    return () => {
      cancelled = true;
    };
  }, [heldIdParam]);

  // Opened from the dashboard "Scan & Bill" quick action:
  // open the barcode scanner straight away once master data is ready.
  useEffect(() => {
    if (scanParam !== '1' || loadingMaster || readOnly) return;
    setScannerOpen(true);
    // clear the params so the scanner doesn't reopen on refocus / back
    router.setParams({ scan: undefined, ts: undefined });
  }, [scanParam, scanTs, loadingMaster, readOnly]);


  // =========================================================
  // Stage transitions
  // =========================================================

  const handleGenerateEstimate = () => {
    if (items.length === 0) {
      setErrorTitle('No items');
      setErrorMessage('Add at least one item before generating an estimate.');
      return;
    }

    setStage('estimate');

    if (!paymentSplitsTouched) {
      setPaymentSplits([{ id: genRowId(), mode: '', amountText: String(netFinalAmount) }]);
    }
  };

  const handleBackToEditing = () => {
    setStage('building');
  };


  // =========================================================
  // Estimate: build once, use for both Print and WhatsApp share
  // =========================================================

  const metalNameFor = (id: string | null) => metals.find((m) => m.id === id)?.name ?? 'Unknown';
  const purityNameFor = (id: string | null) => purities.find((p) => p.id === id)?.name ?? 'Unknown';

  const prepareEstimate = async () => {
    const [companySettings, invoiceSettings] = await Promise.all([
      getCompanySettings(),
      getInvoiceSettings().catch(() => null),
    ]);
    const shop = companyToShopDetails(companySettings);
    const display = invoiceSettings
      ? {
        show_logo: invoiceSettings.show_logo,
        show_huid: invoiceSettings.show_huid,
        show_weight: invoiceSettings.show_weight,
        show_making_charges: invoiceSettings.show_making_charges,
        show_value_added_charges: invoiceSettings.show_value_added_charges,
        invoice_footer: invoiceSettings.invoice_footer,
        terms_and_conditions: invoiceSettings.terms_and_conditions,
      }
      : {};

    const charges: InvoiceCharge[] = [
      totals.makingTotal > 0 && { id: 'est-making', charge_name: 'Making Charges', amount: totals.makingTotal },
      totals.vaTotal > 0 && { id: 'est-va', charge_name: 'Value Added Charges', amount: totals.vaTotal },
      totals.cgstTotal > 0 && { id: 'est-cgst', charge_name: 'CGST', amount: totals.cgstTotal },
      totals.sgstTotal > 0 && { id: 'est-sgst', charge_name: 'SGST', amount: totals.sgstTotal },
      totals.igstTotal > 0 && { id: 'est-igst', charge_name: 'IGST', amount: totals.igstTotal },
    ].filter(Boolean) as InvoiceCharge[];

    const detailItems: InvoiceItemDetail[] = billItems.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      product_name: item.name,
      product_code: item.product_code ?? 'MANUAL',
      metal_name: metalNameFor(item.metal_id),
      purity_name: purityNameFor(item.purity_id),
      quantity: item.quantity,
      gross_weight: item.gross_weight,
      stone_weight: item.stone_weight,
      net_weight: item.net_weight,
      metal_rate: item.metal_rate,
      metal_value: item.metal_value,
      making_charge_type: item.making_charge_type,
      making_charge_value: item.making_charge_value,
      making_charge_amount: item.making_charge_amount,
      value_added_total: item.value_added_charges.reduce((s, c) => s + c.amount, 0),
      discount: item.item_discount,
      tax_amount: item.tax_amount,
      total: item.total_amount,
      remark: items.find((i) => i.id === item.id)?.remark ?? null,
      value_added_charges: item.value_added_charges.map((c) => ({
        id: c.id,
        charge_name: c.name,
        calculation_type: c.calculation_type,
        value: c.value,
        amount: c.amount,
      })),
    }));

    const detailExchangeItems: ExchangeItemDetail[] = exchangeItems.map((e) => ({
      ...e,
      invoice_id: 'estimate',
      created_at: new Date().toISOString(),
    }));

    const splitsForPrint: PaymentSplitEntry[] = paymentSplits
      .filter((row) => (parseFloat(row.amountText) || 0) > 0 && row.mode)
      .map((row) => ({
        id: row.id,
        mode: row.mode as PaymentMode,
        amount: round2(parseFloat(row.amountText) || 0),
      }));

    const estimateInvoice: InvoiceDetail = {
      id: 'estimate',
      invoice_number: 'ESTIMATE',
      invoice_date: new Date().toISOString(),
      customer_id: '',
      customer_name: customerName.trim() || 'Walk-in Customer',
      customer_mobile: customerPhone.trim() || null,
      customer_address: null,
      customer_gstin: null,
      subtotal: totals.taxableTotal,
      invoice_discount: totals.discount,
      tax_amount: totals.taxTotal,
      grand_total: totals.grandTotal,
      paid_amount: stage === 'estimate' ? totalReceived : 0,
      balance_amount: stage === 'estimate' ? netBalanceDue : netFinalAmount,
      payment_status: 'unpaid',
      payment_mode: splitsForPrint.length > 1 ? 'split' : (splitsForPrint[0]?.mode ?? 'cash'),
      status: 'unpaid',
      items: detailItems,
      charges,
      created_at: new Date().toISOString(),
      exchange_total: exchangeTotal,
      exchange_items: detailExchangeItems,
      payment_splits: splitsForPrint,
      remark: combinedRemark || null,
    };

    return { estimateInvoice, shop, display };
  };


  // =========================================================
  // Print estimate (thermal printer)
  // =========================================================

  const handlePrintEstimate = async () => {
    if (items.length === 0) {
      setErrorTitle('No items');
      setErrorMessage('Add at least one item before printing an estimate.');
      return;
    }

    setPrintingEstimate(true);

    try {
      const { estimateInvoice, shop, display } = await prepareEstimate();

      const printer = await getConnectedPrinter();
      try {
        await printThermalReceiptDirect(printer, estimateInvoice, shop, display);
      } finally {
        await disconnectActive();
      }
    } catch (e: any) {
      setErrorTitle('Could not print estimate');
      setErrorMessage(e?.message ?? 'Unknown error');
    } finally {
      setPrintingEstimate(false);
    }
  };


  // =========================================================
  // Share estimate on WhatsApp (thermal-style PDF)
  // =========================================================

  // Same rows as the on-screen Receipt Preview, as plain lines for the slip.
  const buildEstimateSlipLines = (): SlipLine[] => {
    const L: SlipLine[] = [];
    const row = (label: string, value: string, bold = false) =>
      L.push({ type: 'row', label, value, bold });
    const full = () => L.push({ type: 'divider' });
    const thin = () => L.push({ type: 'divider', thin: true });

    billItems.forEach((item, idx) => {
      const gross = item.gross_weight * item.quantity;
      const less = (item.stone_weight + item.other_weight) * item.quantity;
      const net = item.net_weight * item.quantity;

      const vaLine = item.value_added_charges.find((c) => c.name === VA_CHARGE);
      const stoneLine = item.value_added_charges.find((c) => c.name === STONE_CHARGE);
      const diamondLines = item.value_added_charges.filter(
        (c) => isDiamondCharge(c.name) && c.amount > 0
      );
      const otherLines = item.value_added_charges.filter(
        (c) => c.name !== VA_CHARGE && c.name !== STONE_CHARGE && !isDiamondCharge(c.name)
      );

      const cgst = item.cgst_percentage > 0 ? round2((item.taxable_amount * item.cgst_percentage) / 100) : 0;
      const sgst = item.sgst_percentage > 0 ? round2((item.taxable_amount * item.sgst_percentage) / 100) : 0;
      const igst =
        item.cgst_percentage === 0 && item.sgst_percentage === 0 && item.igst_percentage > 0
          ? round2((item.taxable_amount * item.igst_percentage) / 100)
          : 0;
      const hasTax = cgst > 0 || sgst > 0 || igst > 0 || item.tax_amount > 0;

      if (idx > 0) full();
      L.push({
        type: 'heading',
        text: `ITEM ${idx + 1}: ${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ''}`,
      });
      thin();

      row('Weight', `${gross.toFixed(3)} gms`);
      row('Stone/Less(wt)', less.toFixed(3));
      row('Nett Weight', net.toFixed(3));
      row('Rate/gm', plain(item.metal_rate));
      if (vaLine) {
        row(
          'V.ADNV',
          vaLine.calculation_type === 'percentage'
            ? `${vaLine.value.toFixed(1)} %`
            : plain(vaLine.amount * item.quantity)
        );
      }
      thin();

      if (item.making_charge_amount > 0) row('MC', plain(item.making_charge_amount));
      if (item.stone_name) row('Stone Name', String(item.stone_name));
      if (stoneLine) row('Stone Charges', plain(stoneLine.amount * item.quantity));
      diamondLines.forEach((c) => {
        row('Diamond Wt', `${diamondWeightText(c.name)} ct`);
        row('Diamond Amt', plain(c.amount * item.quantity));
      });
      otherLines.forEach((c) => row(c.name, plain(c.amount * item.quantity)));
      thin();

      if (hasTax) {
        row('Total', money(item.taxable_amount), true);
        thin();
      }
      if (cgst > 0) row(withRate('CGST', item.cgst_percentage), money(cgst));
      if (sgst > 0) row(withRate('SGST', item.sgst_percentage), money(sgst));
      if (igst > 0) row(withRate('GST', item.igst_percentage), money(igst));
      if (cgst === 0 && sgst === 0 && igst === 0 && item.tax_amount > 0) {
        row('Tax', money(item.tax_amount));
      }
      row('Gross', money(item.total_amount), true);
    });

    if (exchangeItems.length > 0) {
      full();
      exchangeItems.forEach((e, idx) => {
        L.push({ type: 'heading', text: `OLD ITEM ${idx + 1}: ${e.description}` });
        thin();
        row('Weight', e.gross_weight.toFixed(3));
        if (e.stone_weight > 0) {
          row('Dust/Stone', e.stone_weight.toFixed(3));
          row('Gross Weight', displayNetWeight(e).toFixed(3));
        }
        row('Old Percentage', `* ${e.old_percent.toFixed(2)}%`);
        row('Old Rate/Gm', `* ${plain(e.rate_per_gram)}`);
        thin();
        row('Gross', money(e.amount), true);
        if (idx < exchangeItems.length - 1) thin();
      });
      thin();
      row('OLD TOTAL', money(exchangeTotal), true);
    }

    full();
    if (totals.discount > 0) {
      row('Discount', `-${money(totals.discount)}`, true);
      full();
    }
    row('Nett RS', money(netFinalAmount), true);

    // Only when the payment has actually been entered
    if (stage === 'estimate' && totalReceived > 0) {
      full();
      row('FINAL AMOUNT', money(totalReceived), true);
    }

    return L;
  };

  const handleShareEstimate = async () => {
    if (items.length === 0) {
      setErrorTitle('No items');
      setErrorMessage('Add at least one item before sharing an estimate.');
      return;
    }

    setSharingEstimate(true);

    try {
      const company = await getCompanySettings();
      const shop = companyToShopDetails(company);

      // "ROUGH ESTIMATE" slip: shop name only in the header, no footer.
      const { html, heightPt } = buildEstimateSlip(buildEstimateSlipLines(), {
        shopName: (shop as any)?.name ?? null,
        title: 'ROUGH ESTIMATE',
      });

      await shareEstimateOnWhatsApp({
        html,
        customerName: customerName.trim() || null,
        customerPhone: customerPhone.trim() || null,
        shopName: (shop as any)?.name ?? null,
        amount: netFinalAmount,
        heightPt,
      });
    } catch (e: any) {
      setErrorTitle('Could not share estimate');
      setErrorMessage(e?.message ?? 'Unknown error');
    } finally {
      setSharingEstimate(false);
    }
  };


  // =========================================================
  // Save final invoice
  //
  // The estimate is NOT deleted here. After the invoice is created the
  // estimate stays in "Held Bills" (tagged with the bill number) until
  // its 4 hours are up or it is deleted manually. From then on it opens
  // read-only: print only, no editing, no second invoice.
  // If the cashier never pressed Hold, a snapshot is saved now so the
  // estimate still exists for 4 hours after the sale.
  // =========================================================

  const handleSaveInvoice = async () => {
    if (readOnly) return; // billed estimates can never be invoiced again

    if (items.length === 0) {
      setErrorTitle('No items');
      setErrorMessage('Add at least one item before saving.');
      return;
    }

    if (round2(totalReceived + creditAmount - netFinalAmount) > 0.01) {
      setErrorTitle('Overpayment');
      setErrorMessage('Received + credit is more than the bill amount.');
      return;
    }

    if (creditAmount > 0 && (!customerName.trim() || customerPhone.trim().length < 10)) {
      setErrorTitle('Customer required for credit');
      setErrorMessage('Enter the customer name and a valid phone number for a credit sale.');
      return;
    }

    // LOC / Remark is mandatory for EVERY item
    const missingIdx = items.findIndex((i) => !i.remark?.trim());
    if (missingIdx !== -1) {
      setErrorTitle('Missing details');
      setErrorMessage(`LOC / Remark is mandatory for item ${missingIdx + 1}.`);
      return;
    }

    const rowMissingMode = paymentSplits.some(
      (row) => (parseFloat(row.amountText) || 0) > 0 && !row.mode
    );
    if (rowMissingMode) {
      setErrorTitle('Payment mode required');
      setErrorMessage('Please select a payment mode for every payment row that has an amount.');
      return;
    }

    const splitsToSave: PaymentSplitEntry[] = paymentSplits
      .filter((row) => (parseFloat(row.amountText) || 0) > 0 && row.mode)
      .map((row) => ({
        id: row.id,
        mode: row.mode as PaymentMode,
        amount: round2(parseFloat(row.amountText) || 0),
      }));

    setSaving(true);

    try {
      if (activeHeldId) {
        const latest = await getHeldEstimate(activeHeldId);
        if (latest?.billedInvoiceNumber) {
          setErrorTitle('Already billed');
          setErrorMessage(`This estimate was already billed as ${latest.billedInvoiceNumber} on another device.`);
          return;
        }

      }
      const invoice = await createInvoice({
        customerId: resolvedCustomerId,
        customerName: customerName.trim() || 'Walk-in Customer',
        customerMobile: customerPhone.trim() || null,
        // withoutGst may drop `remark`, so re-attach it from the editable items
        items: billItems.map((b) => ({
          ...b,
          remark: items.find((i) => i.id === b.id)?.remark ?? null,
        })),
        metals,
        purities,
        subtotal: totals.taxableTotal,
        invoiceDiscount: totals.discount,
        taxAmount: totals.taxTotal,
        grandTotal: totals.grandTotal,
        paidAmount: totals.paid,
        balanceAmount: netBalanceDue,
        cgstTotal: totals.cgstTotal,
        sgstTotal: totals.sgstTotal,
        igstTotal: totals.igstTotal,
        makingTotal: totals.makingTotal,
        vaChargesTotal: totals.vaTotal,
        paymentSplits: splitsToSave,
        exchangeItems,
        exchangeTotal,
        // Invoice-level column keeps a combined text of all item remarks
        remark: combinedRemark,
      });

      // Keep the estimate for its 4 hours, tagged as billed (read-only).
      try {
        await saveHeldEstimate({
          id: activeHeldId,
          label: customerName.trim() || 'Walk-in Customer',
          grandTotal: netFinalAmount,
          keepExpiry: true,
          billedInvoiceId: invoice.id,
          billedInvoiceNumber: invoice.invoice_number,
          data: { ...buildHeldData(), stage: 'estimate' },
        });
      } catch (heldError) {
        console.warn('Failed to keep estimate after billing', heldError);
      }

      try {
        await notify(
          'invoice',
          creditAmount > 0 ? 'Credit invoice billed' : 'New invoice billed',
          `Invoice for ${customerName.trim() || 'Walk-in'} — ₹${totals.grandTotal.toLocaleString('en-IN')}` +
          (netBalanceDue > 0 ? ` (credit ₹${netBalanceDue.toLocaleString('en-IN')})` : '')
        );
      } catch (notifyError) {
        console.warn('Failed to send invoice notification', notifyError);
      }

      if (fromOrder && orderId) {
        try {
          await completeCustomerOrderWithInvoice(orderId, invoice.id);
        } catch (linkError) {
          console.warn('Failed to link order to invoice', linkError);
        }
      }

      router.replace(`/invoices/${invoice.id}`);
    } catch (e: any) {
      setErrorTitle('Could not save invoice');
      setErrorMessage(e?.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  };


  // =========================================================
  // Loading screen
  // =========================================================

  if (loadingMaster) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }


  // Reusable "Share Estimate on WhatsApp" button
  const shareEstimateButton = (
    <Pressable
      style={[
        styles.printEstimateBtn,
        (sharingEstimate || items.length === 0) && styles.footerBtnDisabled,
      ]}
      onPress={handleShareEstimate}
      disabled={sharingEstimate || items.length === 0}
    >
      <Text style={styles.printEstimateBtnText}>
        {sharingEstimate ? 'Preparing…' : 'Share Estimate on WhatsApp'}
      </Text>
    </Pressable>
  );


  // =========================================================
  // Screen
  // =========================================================

  return (
    <View style={styles.screen}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
      >

        {/* =================================================
            Billed banner — only for a held estimate that has
            already been billed (print only).
        ================================================= */}

        {readOnly && (
          <View style={styles.billedBanner}>
            <Text style={styles.billedBannerTitle}>
              ✓ Already billed{billedNumber ? ` · ${billedNumber}` : ''}
            </Text>
          </View>
        )}

        {/* =================================================
            Customer (with autocomplete by name / phone)
        ================================================= */}

        <TextInput
          style={styles.input}
          placeholder="Customer Name"
          placeholderTextColor={colors.textMuted}
          value={customerName}
          onChangeText={onNameChange}
          onFocus={onNameFocus}
          editable={!readOnly}
        />

        <TextInput
          style={styles.input}
          placeholder="Phone Number"
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
          value={customerPhone}
          onChangeText={onPhoneChange}
          onFocus={onPhoneFocus}
          editable={!readOnly}
        />

        {suggestions.length > 0 && (
          <View style={styles.suggestBox}>
            {suggestions.map((c) => (
              <Pressable key={c.id} style={styles.suggestRow} onPress={() => selectCustomer(c)}>
                <Text style={styles.suggestName}>{c.name}</Text>
                <Text style={styles.suggestPhone}>{c.phone ?? '—'}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {resolvedCustomerId && !readOnly && (
          <Text style={styles.matchedText}>✓ Existing customer</Text>
        )}

        <View style={styles.divider} />


        {/* =================================================
            Products / Services
            Each item has its own LOC / Remark field.
        ================================================= */}

        <Text style={styles.sectionTitle}>Products / Services</Text>

        <Card padded={false} style={{ marginBottom: spacing.md }}>
          {items.length === 0 ? (
            <Text style={styles.emptyText}>
              No items yet. Scan a barcode or add manually.
            </Text>
          ) : (
            billItems.map((item, idx) => (
              <View key={item.id}>
                <InvoiceItemRow
                  item={item}
                  metals={metals}
                  purities={purities}
                  onPress={() => {
                    if (readOnly) return;
                    if (stage === 'estimate') {
                      Alert.alert('Editing locked', 'Go back to editing to change items.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Go back', onPress: handleBackToEditing },
                      ]);
                      return;
                    }
                    setEditingItem(item);
                    setSheetOpen(true);
                  }}
                  onRemove={() => {
                    if (readOnly) return;
                    if (stage === 'estimate') {
                      Alert.alert('Editing locked', 'Go back to editing to remove items.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Go back', onPress: handleBackToEditing },
                      ]);
                      return;
                    }
                    removeItem(item.id);
                  }}
                />
                <View style={styles.itemRemarkWrap}>
                  <TextInput
                    style={styles.itemRemarkInput}
                    placeholder={`LOC / Remark for item ${idx + 1}`}
                    placeholderTextColor={colors.textMuted}
                    value={items.find((i) => i.id === item.id)?.remark ?? ''}
                    onChangeText={(t) => updateItemRemark(item.id, t)}
                    editable={!readOnly}
                  />
                </View>
              </View>
            ))
          )}
        </Card>

        {stage === 'building' && !readOnly && (
          <View style={styles.linkRow}>
            <Pressable
              style={styles.linkBtn}
              onPress={() => {
                setEditingItem(null);
                setSheetOpen(true);
              }}
            >
              <Plus size={16} color={colors.primary} />
              <Text style={styles.linkText}>Add another item</Text>
            </Pressable>

            <Pressable
              style={styles.linkBtn}
              onPress={() => setScannerOpen(true)}
              disabled={scanBusy}
            >
              <Barcode size={16} color={colors.primary} />
              <Text style={styles.linkText}>
                {scanBusy ? 'Fetching…' : 'Scan to add'}
              </Text>
            </Pressable>

          </View>
        )}

        {/* =================================================
            Old Gold Exchange
        ================================================= */}

        <ExchangeGoldSection
          items={exchangeItems}
          onChange={(list, total) => {
            setExchangeItems(list);
            setExchangeTotal(total);
          }}
          metals={metals}
          purities={purities}
          fetchRate={getCurrentRate}
          locked={stage === 'estimate' || readOnly}
          onLockedAttempt={() => {
            if (readOnly) return;
            Alert.alert('Editing locked', 'Go back to editing to change old gold items.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Go back', onPress: handleBackToEditing },
            ]);
          }}
        />

        <View style={styles.divider} />


        {/* =================================================
            Receipt Preview
        ================================================= */}

        {items.length > 0 && (
          <Card style={{ marginTop: spacing.md }}>
            {/* Header row: title on the left, Apply GST checkbox on the right */}
            <View style={styles.previewHeader}>
              <Text style={[styles.totalsHeader, { marginBottom: 0 }]}>
                {stage === 'estimate' ? 'Payment Details' : 'Receipt Preview'}
              </Text>

              <Pressable
                style={[styles.gstToggle, (readOnly || stage === 'estimate') && styles.gstToggleLocked]}
                onPress={handleToggleGst}
                hitSlop={8}
              >
                <View style={[styles.checkbox, gstEnabled && styles.checkboxOn]}>
                  {gstEnabled && <Check size={14} color="#fff" strokeWidth={3} />}
                </View>
                <Text style={styles.gstLabel}>Apply GST</Text>
              </Pressable>
            </View>

            {billItems.map((item, idx) => {
              const itemGrossWeight = item.gross_weight * item.quantity;
              const itemLessWeight = (item.stone_weight + item.other_weight) * item.quantity;
              const itemNetWeight = item.net_weight * item.quantity;

              const vaLine = item.value_added_charges.find((c) => c.name === VA_CHARGE);
              const stoneLine = item.value_added_charges.find((c) => c.name === STONE_CHARGE);
              const diamondLines = item.value_added_charges.filter(
                (c) => isDiamondCharge(c.name) && c.amount > 0
              );
              const otherLines = item.value_added_charges.filter(
                (c) => c.name !== VA_CHARGE && c.name !== STONE_CHARGE && !isDiamondCharge(c.name)
              );

              const itemCgst = item.cgst_percentage > 0 ? round2((item.taxable_amount * item.cgst_percentage) / 100) : 0;
              const itemSgst = item.sgst_percentage > 0 ? round2((item.taxable_amount * item.sgst_percentage) / 100) : 0;
              const itemIgst =
                item.cgst_percentage === 0 && item.sgst_percentage === 0 && item.igst_percentage > 0
                  ? round2((item.taxable_amount * item.igst_percentage) / 100)
                  : 0;

              const itemHasTax = itemCgst > 0 || itemSgst > 0 || itemIgst > 0 || item.tax_amount > 0;

              return (
                <View key={item.id}>
                  <Text style={styles.itemSlipName}>
                    ITEM {idx + 1}: {item.name}
                    {item.quantity > 1 ? `  ×${item.quantity}` : ''}
                  </Text>
                  <View style={styles.dividerThin} />

                  <SlipRow label="Weight" value={`${itemGrossWeight.toFixed(3)} gms`} />
                  <SlipRow label="Stone/Less(wt)" value={itemLessWeight.toFixed(3)} />

                  <SlipRow label="Nett Weight" value={itemNetWeight.toFixed(3)} />
                  <SlipRow label="Rate/gm" value={plain(item.metal_rate)} />
                  {vaLine && (
                    <SlipRow
                      label="V.ADNV"
                      value={
                        vaLine.calculation_type === 'percentage'
                          ? `${vaLine.value.toFixed(1)} %`
                          : plain(vaLine.amount * item.quantity)
                      }
                    />
                  )}
                  <View style={styles.dividerThin} />

                  {item.making_charge_amount > 0 && (
                    <SlipRow label="MC" value={plain(item.making_charge_amount)} />
                  )}

                  {/* Stone name picked in the item sheet (if any) */}
                  {item.stone_name ? <SlipRow label="Stone Name" value={item.stone_name} /> : null}

                  {stoneLine && (
                    <SlipRow label="Stone Charges" value={plain(stoneLine.amount * item.quantity)} />
                  )}

                  {/* Diamond weight (e.g. 0.25 ct) + amount */}
                  {diamondLines.map((c) => (
                    <View key={c.id}>
                      <SlipRow label="Diamond Wt" value={`${diamondWeightText(c.name)} ct`} />
                      <SlipRow label="Diamond Amt" value={plain(c.amount * item.quantity)} />
                    </View>
                  ))}

                  {otherLines.map((c) => (
                    <SlipRow key={c.id} label={c.name} value={plain(c.amount * item.quantity)} />
                  ))}
                  <View style={styles.dividerThin} />

                  {/* Total BEFORE GST */}
                  {itemHasTax && (
                    <>
                      <SlipRow label="Total" value={money(item.taxable_amount)} bold />
                      <View style={styles.dividerThin} />
                    </>
                  )}

                  {itemCgst > 0 && (
                    <SlipRow label={withRate('CGST', item.cgst_percentage)} value={money(itemCgst)} />
                  )}
                  {itemSgst > 0 && (
                    <SlipRow label={withRate('SGST', item.sgst_percentage)} value={money(itemSgst)} />
                  )}
                  {itemIgst > 0 && (
                    <SlipRow label={withRate('GST', item.igst_percentage)} value={money(itemIgst)} />
                  )}
                  {itemCgst === 0 && itemSgst === 0 && itemIgst === 0 && item.tax_amount > 0 && (
                    <SlipRow label="Tax" value={money(item.tax_amount)} />
                  )}

                  <SlipRow label="Gross " value={money(item.total_amount)} bold />

                  {idx < items.length - 1 && <View style={styles.divider} />}
                </View>
              );
            })}

            {exchangeItems.length > 0 && (
              <>
                <View style={styles.divider} />
                {exchangeItems.map((e, idx) => (
                  <View key={e.id}>
                    <Text style={styles.itemSlipName}>
                      OLD ITEM {idx + 1} : {e.description}
                    </Text>
                    <View style={styles.dividerThin} />

                    <SlipRow label="Weight" value={e.gross_weight.toFixed(3)} />
                    {e.stone_weight > 0 && (
                      <>
                        <SlipRow label="Dust/Stone" value={e.stone_weight.toFixed(3)} />
                        <SlipRow label="Gross Weight" value={displayNetWeight(e).toFixed(3)} />
                      </>
                    )}
                    <SlipRow label="Old Percentage" value={`* ${e.old_percent.toFixed(2)}%`} />
                    <View style={styles.dividerThin} />

                    <SlipRow label="Old Rate/Gm" value={`* ${plain(e.rate_per_gram)}`} />
                    <View style={styles.dividerThin} />

                    <SlipRow label="Gross" value={money(e.amount)} bold />

                    {idx < exchangeItems.length - 1 && <View style={styles.dividerThin} />}
                  </View>
                ))}
                <View style={styles.dividerThin} />
                <SlipRow label="OLD TOTAL" value={money(exchangeTotal)} bold />
              </>
            )}

            <View style={styles.divider} />

            {/* Discount (only when one is given) — shown before the final amount */}
            {totals.discount > 0 && (
              <>
                <SlipRow label="Discount" value={`-${money(totals.discount)}`} bold />
                <View style={styles.divider} />
              </>
            )}

            <SlipRow label="Nett RS" value={money(netFinalAmount)} bold />
            <View style={styles.divider} />
            <SlipRow
              label="FINAL AMOUNT"
              value={stage === 'estimate' && totalReceived > 0 ? money(totalReceived) : ''}
              bold
            />

            {stage === 'estimate' && (
              <View style={styles.paymentSection}>
                <Text style={styles.label}>Payment</Text>

                {paymentSplits.map((row) => (
                  <View key={row.id} style={styles.splitRow}>
                    <View style={{ flex: 1.3 }} pointerEvents={readOnly ? 'none' : 'auto'}>
                      <SelectField
                        label="Mode"
                        value={row.mode}
                        options={PAYMENT_MODES}
                        placeholder="Select mode"
                        onChange={(id) => updatePaymentSplitMode(row.id, id as PaymentMode)}
                      />
                    </View>
                    <View style={{ flex: 1, marginLeft: spacing.sm }}>
                      <Text style={styles.label}>Amount (₹)</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="decimal-pad"
                        value={row.amountText}
                        onChangeText={(text) => updatePaymentSplitAmount(row.id, text)}
                        placeholder="0"
                        placeholderTextColor={colors.textMuted}
                        editable={!readOnly}
                      />
                    </View>
                    {!readOnly && paymentSplits.length > 1 && (
                      <Pressable
                        style={styles.removeSplitBtn}
                        onPress={() => removePaymentSplit(row.id)}
                        hitSlop={8}
                      >
                        <X size={18} color={colors.textMuted} />
                      </Pressable>
                    )}
                  </View>
                ))}

                {!readOnly && (
                  <Pressable style={styles.linkBtn} onPress={addPaymentSplit}>
                    <Plus size={16} color={colors.primary} />
                    <Text style={styles.linkText}>Add payment method</Text>
                  </Pressable>
                )}

                {!readOnly && totalReceived === 0 && exchangeTotal === 0 ? (
                  <Text style={styles.warningText}>
                    ⚠ No amount entered here — this invoice will be saved as Unpaid.
                  </Text>
                ) : null}

                {!readOnly && (paymentSplits.length > 1 || creditAmount > 0) && Math.abs(splitMismatch) > 0.01 && (
                  <Text style={styles.warningText}>
                    {splitMismatch > 0
                      ? `⚠ Splits are short by ₹${splitMismatch.toLocaleString('en-IN')} of the total due.`
                      : `⚠ Splits exceed the total due by ₹${Math.abs(splitMismatch).toLocaleString('en-IN')}.`}
                  </Text>
                )}

                <View style={{ marginTop: spacing.sm }}>
                  {paymentSplits.length > 1 && <Row label="Total Received" value={totalReceived} />}
                  {creditAmount > 0 && <Row label="On Credit" value={creditAmount} bold />}
                  <Row label="Balance Due" value={netBalanceDue} bold={netBalanceDue > 0} />
                </View>
              </View>
            )}
          </Card>
        )}

        {/* =================================================
            Bottom buttons
            readOnly (billed)  -> Print Estimate + Share
            building           -> Generate / Print / Share / Hold
            estimate           -> banner + discount + Share + Hold
        ================================================= */}

        {readOnly ? (
          <>
            <Pressable
              style={[styles.estimateBtn, printingEstimate && styles.footerBtnDisabled]}
              onPress={handlePrintEstimate}
              disabled={printingEstimate}
            >
              <Text style={styles.estimateBtnText}>
                {printingEstimate ? 'Preparing…' : 'Print Estimate'}
              </Text>
            </Pressable>

            {shareEstimateButton}
          </>
        ) : stage === 'building' ? (
          <View style={styles.gridWrap}>
            {/* Row 1: Generate | Print */}
            <View style={styles.gridRow}>
              <Pressable style={[styles.gridBtn, styles.gridBtnPrimary]} onPress={handleGenerateEstimate}>
                <Text style={[styles.gridBtnText, styles.gridBtnTextPrimary]}>Generate</Text>
              </Pressable>

              <Pressable
                style={[styles.gridBtn, (printingEstimate || items.length === 0) && styles.footerBtnDisabled]}
                onPress={handlePrintEstimate}
                disabled={printingEstimate || items.length === 0}
              >
                <Text style={styles.gridBtnText}>
                  {printingEstimate ? 'Preparing…' : 'Print'}
                </Text>
              </Pressable>
            </View>

            {/* Row 2: Share | Hold */}
            <View style={styles.gridRow}>
              <Pressable
                style={[styles.gridBtn, (sharingEstimate || items.length === 0) && styles.footerBtnDisabled]}
                onPress={handleShareEstimate}
                disabled={sharingEstimate || items.length === 0}
              >
                <Text style={styles.gridBtnText}>
                  {sharingEstimate ? 'Preparing…' : 'Share'}
                </Text>
              </Pressable>

              <Pressable
                style={[styles.gridBtn, items.length === 0 && styles.footerBtnDisabled]}
                onPress={handleHoldEstimate}
                disabled={items.length === 0}
              >
                <Text style={styles.gridBtnText}>Hold</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.estimateBanner}>
              <Text style={styles.estimateBannerText}>ESTIMATE — review before confirming</Text>
              <Pressable onPress={handleBackToEditing}>
                <Text style={styles.editLink}>← Edit items</Text>
              </Pressable>
            </View>

            <Text style={styles.label}>Discount Amount (₹)</Text>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              value={discountAmount}
              onChangeText={setDiscountAmount}
            />

            {shareEstimateButton}

            <Pressable
              style={[styles.printEstimateBtn, { marginTop: spacing.sm }]}
              onPress={handleHoldEstimate}
            >
              <Text style={styles.printEstimateBtnText}>Hold Estimate (4 hrs)</Text>
            </Pressable>
          </>
        )}
      </ScrollView>


      {/* ===================================================
          Footer
      =================================================== */}

      <View style={styles.footer}>
        {stage === 'estimate' && !readOnly && (
          <Button
            label={saving ? 'Saving…' : 'Confirm & Save Final Invoice'}
            onPress={handleSaveInvoice}
            disabled={saving || items.length === 0}
          />
        )}
      </View>


      {/* ===================================================
          Barcode Scanner
      =================================================== */}

      <BarcodeScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={handleScanned}
      />


      {/* ===================================================
          Jewelry Item Sheet
      =================================================== */}

      <JewelryItemSheet
        visible={sheetOpen}
        initial={editingItem}
        metals={metals}
        purities={purities}
        categories={categories}
        taxSettings={taxSettings}
        vaChargeTypes={vaChargeTypes}
        onClose={() => {
          setSheetOpen(false);
          setEditingItem(null);
        }}
        onSave={handleItemSave}
      />


      {/* ===================================================
          Validation error
      =================================================== */}

      <ErrorModal
        visible={!!errorMessage}
        title={errorTitle}
        message={errorMessage}
        onClose={() => setErrorMessage(null)}
      />
    </View>
  );
}


// ===========================================================
// Reusable Row Components
// ===========================================================

function Row({
  label,
  value,
  bold,
  rate,
}: {
  label: string;
  value: number;
  bold?: boolean;
  rate?: number | null;
}) {
  const sign = value < 0 ? '-' : '';
  const rateSuffix = rate != null && rate > 0 ? ` (${Number(rate.toFixed(2))}%)` : '';
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && styles.rowBold]}>{label}{rateSuffix}</Text>
      <Text style={[styles.rowValue, bold && styles.rowBold]}>
        {sign}₹{Math.abs(value).toLocaleString('en-IN')}
      </Text>
    </View>
  );
}

function SlipRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.slipRow}>
      <Text style={[styles.slipLabel, bold && styles.rowBold]}>{label}</Text>
      <Text style={[styles.slipColon, bold && styles.rowBold]}>:</Text>
      <Text style={[styles.slipValue, bold && styles.rowBold]}>{value}</Text>
    </View>
  );
}


// ===========================================================
// Styles
// ===========================================================

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius?.md ?? 10, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 15, color: colors.textPrimary, marginBottom: spacing.md, backgroundColor: colors.surface },
  remarkInput: { minHeight: 56 },
  label: { fontSize: 13, color: colors.textMuted, marginBottom: 6 },
  warningText: { fontSize: 12, color: '#B00020', marginTop: -6, marginBottom: spacing.md },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  dividerThin: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  estimateBtn: { backgroundColor: colors.primary, borderRadius: radius?.md ?? 10, paddingVertical: 14, alignItems: 'center', marginTop: spacing.xxl },
  estimateBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  printEstimateBtn: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius?.md ?? 10, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  printEstimateBtnText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  footerBtnDisabled: { opacity: 0.5 },
  estimateBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF4E5', borderRadius: 8, padding: spacing.sm, marginTop: spacing.xxl },
  estimateBannerText: { fontSize: 12, fontWeight: '700', color: '#8A5300' },
  editLink: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  totalsHeader: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  itemSlipName: { fontSize: 14, fontWeight: '800', color: colors.primary, marginBottom: 4, marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { color: colors.textSecondary, fontSize: 14 },
  rowValue: { color: colors.textPrimary, fontSize: 14 },
  rowBold: { fontWeight: '800', fontSize: 16 },
  slipRow: { flexDirection: 'row', paddingVertical: 4 },
  slipLabel: { flex: 1, textAlign: 'right', color: colors.textSecondary, fontSize: 14 },
  slipColon: { width: 20, textAlign: 'center', color: colors.textSecondary, fontSize: 14 },
  slipValue: { flex: 1, color: colors.textPrimary, fontSize: 14, fontVariant: ['tabular-nums'] },
  paymentSection: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  splitRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: spacing.sm },
  removeSplitBtn: { marginLeft: spacing.sm, marginBottom: 12, padding: 4 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.background, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  orderBanner: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: radius?.md ?? 10,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  orderBannerTitle: { fontSize: 13, fontWeight: '700', color: '#1D4ED8' },
  orderBannerText: { fontSize: 12, color: '#1E3A8A', marginTop: 4 },

  // Customer autocomplete
  suggestBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius?.md ?? 10,
    backgroundColor: colors.surface,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  suggestRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  suggestName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  suggestPhone: { fontSize: 14, color: colors.textMuted },
  matchedText: { fontSize: 12, color: '#137333', marginTop: -spacing.sm, marginBottom: spacing.md },

  // Billed (read-only) banner
  billedBanner: { backgroundColor: '#E6F4EA', borderWidth: 1, borderColor: '#CEEAD6', borderRadius: radius?.md ?? 10, padding: spacing.md, marginBottom: spacing.md },
  billedBannerTitle: { fontSize: 14, fontWeight: '800', color: '#137333' },
  billedBannerText: { fontSize: 12, color: '#137333', marginTop: 4 },

  // Receipt Preview header + Apply GST checkbox
  previewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  gstToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gstToggleLocked: { opacity: 0.55 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  gstLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  gridWrap: { marginTop: spacing.xxl, gap: spacing.sm },
  gridRow: { flexDirection: 'row', gap: spacing.sm },
  gridBtn: {
    flex: 1,
    minHeight: 52,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius?.md ?? 10,
  },
  gridBtnPrimary: { backgroundColor: colors.primary },
  gridBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14, textAlign: 'center' },
  gridBtnTextPrimary: { color: '#fff' },

  // Per-item LOC / Remark
  itemRemarkWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemRemarkInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius?.md ?? 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
});