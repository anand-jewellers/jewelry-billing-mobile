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
import { Plus, Barcode, Check, X } from 'lucide-react-native';
import { Button, Card, ErrorModal } from '../../../src/components/ui';
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
import { completeCustomerOrderWithInvoice, getCustomerOrderById } from '../../../src/lib/api/customerOrders';
import { buildOrderBill } from '../../../src/lib/orderEstimate';

import { buildInvoiceItemFromProduct, invoiceTotals, recalcItem, withoutGst } from '../../../src/lib/invoiceCalc';
import { companyToShopDetails, printHtml } from '../../../src/lib/invoicePdf';
import { buildEstimateSlip, type SlipLine } from '../../../src/lib/estimateSlip';

import { BarcodeScannerModal } from '../../../src/components/invoice/BarcodeScannerModal';
import { InvoiceItemRow } from '../../../src/components/invoice/InvoiceItemRow';
import { JewelryItemSheet, isPiecePurity } from '../../../src/components/invoice/JewelryItemSheet';
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

// share the estimate on WhatsApp as a thermal-style PDF
import { shareEstimateOnWhatsApp } from '../../../src/lib/whatsappShare';


import { ShakeErrorCard } from '../../../src/components/ui/ShakeErrorCard';
import { ConfirmModal } from '../../../src/components/ui/ConfirmModal';


// ===========================================================
// Constants
// ===========================================================

// Modes that can actually receive money.
type SimpleMode = 'cash' | 'card' | 'upi';

// What the cashier taps in the "Payment Mode" radio list.
//  cash / card / upi : the whole amount is paid with that one mode
//  multi             : several rows, each with its own mode + amount
//  part              : pay some now (mode + amount), the rest stays DUE
type PayChoice = SimpleMode | 'multi' | 'part';

const SIMPLE_MODES: { id: SimpleMode; label: string }[] = [
  { id: 'cash', label: 'CASH' },
  { id: 'upi', label: 'UPI' },
  { id: 'card', label: 'CARD' },

];

const PAY_CHOICES: { id: PayChoice; label: string }[] = [
  ...SIMPLE_MODES,
  { id: 'multi', label: 'MULTI PAYMENT' },
  { id: 'part', label: 'PART PAYMENT' },
];

// Used only to map the advance paid on a customer order to a mode name.
const ADVANCE_MODE_IDS = ['CASH', 'UPI', 'CARD', 'BANK TRANSFER', 'CHEQUE', 'CREDIT'];

// Set to true if you want an "Are you sure?" popup before the final bill is saved.
const CONFIRM_BEFORE_GENERATE = true;

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

// One row of a Multi Payment. `amountText` stays a raw string so the cashier
// can type "1" -> "12" -> "12." without the field fighting them.
interface MultiRow {
  id: string;
  mode: SimpleMode | '';
  amountText: string;
}

const genRowId = () => Math.random().toString(36).slice(2, 10);
// Multi Payment is always the same three columns: CASH | CARD | UPI
const makeMultiRows = (): MultiRow[] =>
  SIMPLE_MODES.map((m) => ({ id: m.id, mode: m.id, amountText: '' }));
const multiAmount = (r: MultiRow) => parseFloat(r.amountText) || 0;


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
  //    The order itself is re-loaded from the database using orderId,
  //    so its charges, old gold and advance are always exact.
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
  const [linkedOrderId, setLinkedOrderId] = useState<string | null>(orderId ?? null);

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
  // (LOC / Remark is stored PER ITEM, on each InvoiceItem.remark)
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
  // Final amount (edited directly in the Receipt Preview)
  //
  //  - The cashier types the FINAL AMOUNT the customer agrees to pay.
  //    Discount = Nett RS − Final amount (calculated automatically).
  //  - Until the cashier types something, the final amount simply follows
  //    the bill (no discount).
  // ---------------------------------------------------------

  const [finalAmountText, setFinalAmountText] = useState('');
  const [finalTouched, setFinalTouched] = useState(false);

  // ---------------------------------------------------------
  // Payment
  // ---------------------------------------------------------

  const [paymentChoice, setPaymentChoice] = useState<PayChoice | ''>('');

  // Multi Payment rows
  const [multiRows, setMultiRows] = useState<MultiRow[]>([]);

  // Part Payment: mode + amount paid now. The DUE is worked out from the
  // final amount, and editing it changes the final amount (the cut becomes discount).
  const [partMode, setPartMode] = useState<SimpleMode | ''>('');
  const [partPaidText, setPartPaidText] = useState('');
  const [dueText, setDueText] = useState('');
  const [dueTouched, setDueTouched] = useState(false);

  // Bill-wide "Apply GST" switch (shown in the Receipt Preview header).
  const [gstEnabled, setGstEnabled] = useState(true);

  // Advance already paid on the customer order (a fixed line, not editable)
  const [advance, setAdvance] = useState<{ amount: number; mode: PaymentMode }>({
    amount: 0,
    mode: 'cash',
  });
  // Extra prepaid amounts typed by the cashier (checkbox + amount)
  const [advanceOn, setAdvanceOn] = useState(false);
  const [advanceText, setAdvanceText] = useState('');
  const [chitOn, setChitOn] = useState(false);
  const [chitText, setChitText] = useState('');

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
  // Saving / printing / sharing
  // ---------------------------------------------------------

  const [saving, setSaving] = useState(false);
  const [printingEstimate, setPrintingEstimate] = useState(false);
  const [sharingEstimate, setSharingEstimate] = useState(false);

  // ---------------------------------------------------------
  // Inline validation error
  // ---------------------------------------------------------

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState<string>('Missing details');

  // ---- paste here ----
  const afterErrorRef = useRef<(() => void) | null>(null);
  const [inlineError, setInlineError] = useState<{ id: number; text: string } | null>(null);

  // Blocking error (modal)
  const showError = (title: string, message: string, afterClose?: () => void) => {
    afterErrorRef.current = afterClose ?? null;
    setErrorTitle(title);
    setErrorMessage(message);
  };



  // Inline error (shake card)
  const showInlineError = (text: string) => setInlineError({ id: Date.now(), text });

  // Auto-hide after 5 seconds
  useEffect(() => {
    if (!inlineError) return;
    const t = setTimeout(() => setInlineError(null), 5000);
    return () => clearTimeout(t);
  }, [inlineError]);

  const [confirmGenerateOpen, setConfirmGenerateOpen] = useState(false);
  const [heldNoticeOpen, setHeldNoticeOpen] = useState(false);
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
  //
  // The order is loaded from the database and turned into a bill with
  // buildOrderBill() — the SAME function the order's "Share Estimate"
  // slip uses — so the invoice carries the order's value added %,
  // making charge, stone charge, old gold and advance.
  // =========================================================

  useEffect(() => {
    if (!fromOrder || !orderId || loadingMaster || orderPrefillApplied) return;
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

      try {
        const order = await getCustomerOrderById(orderId);
        const bill = await buildOrderBill([order]);

        setItems(
          bill.items.map((it) => ({
            ...it,
            remark: `Order ${order.order_number}${order.category ? ` — ${order.category}` : ''}`,
          }))
        );

        // Old gold given when the order was placed
        setExchangeItems(bill.exchangeItems);
        setExchangeTotal(bill.exchangeTotal);

        // Advance paid on the order
        if (bill.advanceTotal > 0) {
          const id = (bill.paymentModes[0] ?? 'cash').trim().toLowerCase().replace(/\s+/g, '_');
          setAdvance({
            amount: bill.advanceTotal,
            mode: (ADVANCE_MODE_IDS.includes(id) ? id : 'cash') as PaymentMode,
          });
        }
      } catch (e: any) {
        showError('Could not load order details', e?.message ?? 'Add the item manually.', () => {
          setEditingItem(null);
          setSheetOpen(true);
        });
      }
    })();
  }, [fromOrder, orderId, loadingMaster, orderPrefillApplied, orderCustomerId]);


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
        setScannerOpen(false);
        showError(
          'Product not found',
          `No product matches "${trimmed}". Check the barcode, or use "Add Manually".`
        );
        return;
      }

      if (product.status === 'sold') {
        setScannerOpen(false);
        showError('Already sold', 'This product has already been sold.');
        return;
      }

      if (items.some((i) => i.product_id === product.id)) {
        setScannerOpen(false);
        showError('Already added', 'This product is already in the current bill.');
        return;
      }


      const [rate, makingRule, taxSetting] = await Promise.all([
        getCurrentRate(product.metal_id, product.purity_id),
        getMakingChargeRule(product.metal_id, product.purity_id, product.category_id),
        getDefaultTaxSetting(),
      ]);

      const item = buildInvoiceItemFromProduct(product, rate, makingRule, taxSetting);
      setItems((prev) => [...prev, { ...item, remark: '' }]);
      setFinalAmountText('');
      setFinalTouched(false);
      setDueText('');
      setDueTouched(false);
      setScannerOpen(false);
    } catch (e: any) {
      setScannerOpen(false);
      showError('Lookup error', e?.message ?? 'Could not fetch product.');
    } finally {
      setScanBusy(false);
    }
  };


  // =========================================================
  // Item sheet save / remove / per-item remark
  // =========================================================

  // Puts one item on the bill. Does NOT open/close the sheet.
  const addItemToBill = (item: InvoiceItem) => {
    // The sheet's "Apply GST" drives the bill-wide checkbox.
    const gstOn = item.gst_enabled !== false;
    setGstEnabled(gstOn);

    // The sheet saves tax-free numbers when GST is off. Store the item WITH its
    // tax instead; the bill-wide switch strips it (withoutGst) while off, so
    // ticking GST on again brings the tax back.
    const taxSetting = taxSettings.find((t) => t.id === item.tax_setting_id) ?? null;

    const isPieceItem = isPiecePurity(purities.find((p) => p.id === item.purity_id));

    let taxed: InvoiceItem;

    if (isPieceItem) {
      // Piece rate: no weight or rate. The cashier typed the amount in the sheet.
      // GST on  -> the typed amount already includes GST (tax is taken out of it).
      // GST off -> the typed amount is the final total (tax is kept only so that
      //            ticking GST on later can add it back).
      const typed = Math.max(Number(item.total_amount) || 0, 0);
      const pct = Number(taxSetting?.tax_percentage) || 0;
      const base = gstOn && pct > 0 ? round2(typed / (1 + pct / 100)) : typed;

      const calc = recalcItem({
        netWeight: 1,
        rate: base,
        quantity: 1,
        makingType: 'fixed',
        makingValue: 0,
        vaCharges: [],
        itemDiscount: 0,
        taxSetting,
      });

      taxed = {
        ...item,
        gst_enabled: true,
        quantity: 1,
        net_weight: 0,
        metal_rate: 0,
        metal_value: base,
        making_charge_amount: 0,
        value_added_charges: [],
        taxable_amount: gstOn ? round2(typed - calc.tax_amount) : typed,
        tax_percentage: calc.tax_percentage,
        cgst_percentage: calc.cgst_percentage,
        sgst_percentage: calc.sgst_percentage,
        igst_percentage: calc.igst_percentage,
        tax_amount: calc.tax_amount,
        total_amount: gstOn ? typed : calc.total_amount,
      };
    } else {
      const calc = recalcItem({
        netWeight: item.net_weight,
        rate: item.metal_rate,
        quantity: item.quantity,
        makingType: item.making_charge_type,
        makingValue: item.making_charge_value,
        vaCharges: item.value_added_charges,
        itemDiscount: item.item_discount,
        taxSetting,
      });
      taxed = {
        ...item,
        gst_enabled: true,
        metal_value: calc.metal_value,
        making_charge_amount: calc.making_charge_amount,
        taxable_amount: calc.taxable_amount,
        tax_percentage: calc.tax_percentage,
        cgst_percentage: calc.cgst_percentage,
        sgst_percentage: calc.sgst_percentage,
        igst_percentage: calc.igst_percentage,
        tax_amount: calc.tax_amount,
        total_amount: calc.total_amount,
      };
    }

    setItems((prev) => {
      const existing = prev.find((i) => i.id === taxed.id);
      const merged: InvoiceItem = { ...taxed, remark: taxed.remark ?? existing?.remark ?? '' };
      return existing ? prev.map((i) => (i.id === taxed.id ? merged : i)) : [...prev, merged];
    });

    // Item added or edited: the old typed final amount no longer matches the bill
    setFinalAmountText('');
    setFinalTouched(false);
    setDueText('');
    setDueTouched(false);
  };

  // Save: add the item and close the sheet.
  const handleItemSave = (item: InvoiceItem) => {
    addItemToBill(item);
    setSheetOpen(false);
    setEditingItem(null);
  };

  // Add New: add the item and keep the sheet open for the next product.
  const handleItemSaveAndNext = (item: InvoiceItem) => {
    addItemToBill(item);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    // The typed final amount belonged to the old bill: start fresh
    setFinalAmountText('');
    setFinalTouched(false);
    setDueText('');
    setDueTouched(false);
  };

  const updateItemRemark = (id: string, text: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, remark: text } : i)));
  };


  // =========================================================
  // Totals
  //
  // 1. baseTotals   : the bill with NO discount  -> "Nett RS" (baseNet)
  // 2. discountValue: baseNet − the FINAL AMOUNT the cashier typed
  //                   (editing the DUE in Part Payment also changes the
  //                   final amount, so it ends up here as discount too)
  // 3. netFinalAmount: what the customer finally owes (after discount)
  // 4. amountDueNow : netFinalAmount − advance already paid
  // 5. the payment choice decides how amountDueNow is received / left due
  // =========================================================

  // When "Apply GST" is unticked every item is stripped of tax, so all totals,
  // the preview, the print and the saved invoice are GST-free.
  const billItems = gstEnabled ? items : items.map(withoutGst);

  // Bill with no discount
  const baseTotals = invoiceTotals(billItems, 0, 0);

  // New items total (before old gold and discount) — shown as "NEW TOTAL".
  const newItemsTotal = round2(baseTotals.grandTotal);

  // Nett = new items − old gold, before discount. NOT clamped: when the old gold
  // is worth more than the new items this goes NEGATIVE (shop owes the customer).
  const baseNet = round2(baseTotals.grandTotal - exchangeTotal);

  // Final amount typed by the cashier (NaN when empty / not a number)
  const finalTyped = finalAmountText.trim() === '' ? NaN : parseFloat(finalAmountText);
  const finalIsSet = !Number.isNaN(finalTyped);
  const finalTooHigh = baseNet > 0 && finalIsSet && finalTyped > baseNet + 0.01;
  const finalNegative = baseNet > 0 && finalIsSet && finalTyped < 0;

  // Discount is simply the difference. Only applies when the customer owes money.
  const discountValue =
    baseNet > 0 && finalIsSet
      ? round2(Math.min(Math.max(baseNet - finalTyped, 0), baseNet))
      : 0;

  const preTotals = invoiceTotals(billItems, discountValue, 0);

  // What the customer finally owes (negative = shop pays the customer)
  const netFinalAmount = round2(preTotals.grandTotal - exchangeTotal);
  const customerGetsMoney = netFinalAmount < 0;


  const advanceExtra = advanceOn ? round2(Math.max(0, parseFloat(advanceText) || 0)) : 0;
  const chitExtra = chitOn ? round2(Math.max(0, parseFloat(chitText) || 0)) : 0;

  // Order advance + typed Advance + Chit Fund
  const prepaidTotal = round2(advance.amount + advanceExtra + chitExtra);

  // Balance after advance + chit fund. NEGATIVE = the shop pays the customer.
  const balanceAfterPrepaid = round2(netFinalAmount - prepaidTotal);
  const shopPays = balanceAfterPrepaid < -0.01;
  const payoutAmount = shopPays ? round2(-balanceAfterPrepaid) : 0;

  // Only the part of advance / chit fund that actually goes against the bill
  const prepaidApplied = round2(Math.min(prepaidTotal, Math.max(netFinalAmount, 0)));

  // What the customer still has to pay now (never negative)
  const amountDueNow = round2(Math.max(0, balanceAfterPrepaid));

  // ----- Multi Payment -----
  const multiReceived = round2(
    multiRows.reduce((sum, r) => sum + (r.mode ? multiAmount(r) : 0), 0)
  );
  const multiRemaining = round2(amountDueNow - multiReceived);

  // ----- Part Payment -----
  const partPaid = round2(Math.max(0, parseFloat(partPaidText) || 0));
  const partReceived = round2(Math.min(partPaid, amountDueNow));
  // Automatic due = what is left after the part payment
  const partDue = round2(Math.max(0, amountDueNow - partPaid));
  const dueFieldValue = dueTouched ? dueText : String(partDue);

  // ----- What happens to amountDueNow -----
  const isSimpleChoice =
    paymentChoice === 'cash' || paymentChoice === 'card' || paymentChoice === 'upi';

  const rowsReceived = isSimpleChoice
    ? amountDueNow
    : paymentChoice === 'multi'
      ? multiReceived
      : paymentChoice === 'part'
        ? partReceived
        : 0;

  // Amount the customer will pay later (Part Payment only)
  const creditAmount = paymentChoice === 'part' ? partDue : 0;

  // Advance already paid on the order + money received now
  const totalReceived = round2(prepaidApplied + rowsReceived);

  // True once a payment has been chosen / filled for an amount that is due.
  // Until then, Print / Share produce a plain ESTIMATE (no "paid" figures).
  const paymentEntered =
    amountDueNow > 0 &&
    (isSimpleChoice ||
      (paymentChoice === 'multi' && multiReceived > 0) ||
      (paymentChoice === 'part' && partReceived > 0));

  const totals = invoiceTotals(billItems, discountValue, totalReceived);

  // Balance the customer still owes — never negative.
  const netBalanceDue = round2(Math.max(0, netFinalAmount - totalReceived));

  // Payment list used by Print and Save: the order advance (if any) first,
  // then what the cashier chose.
  const buildSplits = (): PaymentSplitEntry[] => {
    const advanceRows: PaymentSplitEntry[] =
      advance.amount > 0
        ? [{ id: 'advance', mode: advance.mode, amount: advance.amount, reference: 'Advance' }]
        : [];

    const extraRows: PaymentSplitEntry[] = [];
    if (advanceExtra > 0)
      extraRows.push({ id: 'adv-extra', mode: 'advance', amount: advanceExtra, reference: 'Advance' });
    if (chitExtra > 0)
      extraRows.push({ id: 'chit', mode: 'chit_fund', amount: chitExtra, reference: 'Chit Fund' });

    let rows: PaymentSplitEntry[] = [];

    if (isSimpleChoice && amountDueNow > 0) {
      rows = [{ id: 'payment', mode: paymentChoice as PaymentMode, amount: amountDueNow }];
    } else if (paymentChoice === 'multi') {
      rows = multiRows
        .filter((r) => r.mode && multiAmount(r) > 0)
        .map((r) => ({ id: r.id, mode: r.mode as PaymentMode, amount: round2(multiAmount(r)) }));
    } else if (paymentChoice === 'part') {
      if (partMode && partReceived > 0) {
        rows.push({ id: 'payment', mode: partMode as PaymentMode, amount: partReceived });
      }
      // The unpaid part is saved as a credit line (same as a credit sale before)
      if (partDue > 0) {
        rows.push({ id: 'due', mode: 'credit' as PaymentMode, amount: partDue });
      }
    }

    return [...advanceRows, ...extraRows, ...rows];
  };

  // Billed (read-only) bills always print as a plain ESTIMATE: never show payments.
  const showPaid = paymentEntered && !readOnly;

  // Balance shown on the printed estimate.
  const balanceShown = showPaid ? netBalanceDue : amountDueNow;

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

  // What the FINAL AMOUNT box shows: the typed text once the cashier touches it,
  // otherwise the bill amount (so it always starts filled in).
  const finalFieldValue = finalTouched ? finalAmountText : String(baseNet);

  // Typing a final amount: the due goes back to "automatic".
  const onFinalAmountChange = (text: string) => {
    setFinalTouched(true);
    setFinalAmountText(text);
    setDueTouched(false);
  };

  // Typing the part-payment amount: the due goes back to "automatic".
  const onPartPaidChange = (text: string) => {
    setPartPaidText(text);
    setDueTouched(false);
  };

  // Editing the DUE changes the final amount:  final = advance + paid now + due.
  // Cutting the due therefore lowers the final amount, and the cut shows up as
  // discount (Nett RS − Final amount).
  const onDueChange = (text: string) => {
    setDueTouched(true);
    setDueText(text);
    const dueNum = parseFloat(text);
    if (!Number.isNaN(dueNum) && dueNum >= 0) {
      setFinalTouched(true);
      setFinalAmountText(String(round2(prepaidTotal + partPaid + dueNum)));
    }
  };

  // ----- Payment choice helpers -----
  const selectChoice = (c: PayChoice) => {
    if (readOnly) return;
    setPaymentChoice(c);
    if (c === 'multi' && multiRows.length !== SIMPLE_MODES.length) {
      setMultiRows(makeMultiRows());
    }
  };

  // const addMultiRow = () => {
  //   setMultiRows((prev) => [...prev, { id: genRowId(), mode: '', amountText: '' }]);
  // };

  // const removeMultiRow = (id: string) => {
  //   setMultiRows((prev) => prev.filter((r) => r.id !== id));
  // };

  // const updateMultiMode = (id: string, mode: SimpleMode) => {
  //   setMultiRows((prev) => prev.map((r) => (r.id === id ? { ...r, mode } : r)));
  // };

  const updateMultiAmount = (id: string, text: string) => {
    setMultiRows((prev) => prev.map((r) => (r.id === id ? { ...r, amountText: text } : r)));
  };


  // =========================================================
  // Apply GST toggle (Receipt Preview header)
  // Locked only when the bill is already billed (read-only).
  // =========================================================

  const handleToggleGst = () => {
    if (readOnly) return;
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
  // `remark`, `paymentMode`, `paymentSplits`, `paymentSplitsTouched` and `stage`
  // are kept only so the HeldEstimate type is still satisfied / older code can read them.
  const buildHeldData = () => ({
    customerName,
    customerPhone,
    remark: '',
    resolvedCustomerId,
    items,
    exchangeItems,
    exchangeTotal,
    discountAmount: String(discountValue),
    paymentChoice,
    multiRows,
    partMode,
    partPaidText,
    paymentMode: isSimpleChoice ? paymentChoice : '',
    paymentSplits: isSimpleChoice
      ? [{ id: 'payment', mode: paymentChoice, amountText: String(amountDueNow) }]
      : paymentChoice === 'multi'
        ? multiRows
        : paymentChoice === 'part' && partMode
          ? [{ id: 'payment', mode: partMode, amountText: String(partReceived) }]
          : [],
    paymentSplitsTouched: Boolean(paymentChoice),
    stage: 'building' as const,
    gstEnabled,
    advanceAmount: advance.amount,
    advanceMode: advance.mode,
    orderId: linkedOrderId,
    advanceOn, advanceText, chitOn, chitText,
  });

  const resetForm = () => {
    setItems([]);
    setExchangeItems([]);
    setExchangeTotal(0);
    setCustomerName('');
    setCustomerPhone('');
    setFinalAmountText('');
    setFinalTouched(false);
    setPaymentChoice('');
    setMultiRows([]);
    setPartMode('');
    setPartPaidText('');
    setDueText('');
    setDueTouched(false);
    setAdvance({ amount: 0, mode: 'cash' });
    setResolvedCustomerId(null);
    setSuggestions([]);
    setActiveField(null);
    setActiveHeldId(null);
    setReadOnly(false);
    setBilledNumber(null);
    setGstEnabled(true);
    prevPhoneDigits.current = 0;
    autoFillArmed.current = false;
    setLinkedOrderId(null);
    setAdvanceOn(false); setAdvanceText('');
    setChitOn(false); setChitText('');
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
      setHeldNoticeOpen(true);
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
    setAdvanceOn(Boolean((d as any).advanceOn));
    setAdvanceText((d as any).advanceText ?? '');
    setChitOn(Boolean((d as any).chitOn));
    setChitText((d as any).chitText ?? '');

    // Older held bills had ONE bill-wide remark: copy it onto each item
    // that has no remark of its own.
    const heldItems: InvoiceItem[] = d.items.map((i: InvoiceItem) => ({
      ...i,
      remark: i.remark ?? d.remark ?? '',
    }));
    setItems(heldItems);
    setExchangeItems(d.exchangeItems);
    setExchangeTotal(d.exchangeTotal);

    // Held bills saved before the GST switch existed have no flag -> GST on.
    const heldGstOn = (d as any).gstEnabled !== false;
    setGstEnabled(heldGstOn);

    // The saved discount is turned back into a FINAL AMOUNT (Nett RS − discount).
    const heldBillItems = heldGstOn ? heldItems : heldItems.map(withoutGst);
    const heldBaseNet = round2(invoiceTotals(heldBillItems, 0, 0).grandTotal - d.exchangeTotal);
    const heldDiscount = parseFloat(d.discountAmount) || 0;
    if (heldDiscount > 0 && heldBaseNet > 0) {
      setFinalAmountText(String(round2(heldBaseNet - heldDiscount)));
      setFinalTouched(true);
    } else {
      setFinalAmountText('');
      setFinalTouched(false);
    }
    setDueText('');
    setDueTouched(false);

    // Payment: new bills store the choice directly. Older bills stored one mode
    // (or payment rows), so use the first cash / card / upi one found.
    const isSimple = (m: any): m is SimpleMode => m === 'cash' || m === 'card' || m === 'upi';
    const legacyRow = (d.paymentSplits ?? []).find(
      (r: any) => isSimple(r.mode) && (parseFloat(r.amountText) || 0) > 0
    );
    const legacyMode = isSimple((d as any).paymentMode)
      ? (d as any).paymentMode
      : (legacyRow?.mode ?? '');
    setPaymentChoice((((d as any).paymentChoice ?? legacyMode) || '') as PayChoice | '');
    const heldMulti: MultiRow[] = (d as any).multiRows ?? [];
    setMultiRows(
      heldMulti.length
        ? makeMultiRows().map((r) => {
          const sum = heldMulti
            .filter((h) => h.mode === r.mode)
            .reduce((s, h) => s + (parseFloat(h.amountText) || 0), 0);
          return { ...r, amountText: sum > 0 ? String(round2(sum)) : '' };
        })
        : []
    );
    setPartMode((d as any).partMode ?? '');
    setPartPaidText((d as any).partPaidText ?? '');

    setLinkedOrderId((d as any).orderId ?? null);

    // Held bills saved before the advance existed have none -> no advance.
    setAdvance({
      amount: Number((d as any).advanceAmount) || 0,
      mode: (d as any).advanceMode ?? 'cash',
    });
    setActiveHeldId(h.id);

    // Already billed -> locked, print only.
    const isBilled = Boolean(h.billedInvoiceNumber);
    setReadOnly(isBilled);
    setBilledNumber(h.billedInvoiceNumber ?? null);
  };

  // Opened from the Invoices page "Held Bills" list.
  useEffect(() => {
    if (!heldIdParam) return;
    let cancelled = false;
    (async () => {
      const h = await getHeldEstimate(heldIdParam);
      if (cancelled) return;
      if (h) applyHeld(h);
      else showInlineError('This held bill has expired or was deleted.');
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
      stone_name: item.stone_name ?? null,   // NEW
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

    // Read-only (already billed): keep only the order advance (if any), drop the payment rows
    const splitsForPrint = readOnly
      ? buildSplits().filter((s) => s.id === 'advance' || s.id === 'adv-extra' || s.id === 'chit')
      : buildSplits();

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
      paid_amount: showPaid ? totalReceived : prepaidApplied,
      balance_amount: balanceShown,
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
  // Printing before a payment is chosen = a plain ESTIMATE.
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

    // Sum of all NEW items — only when there is more than one item
    if (billItems.length > 1) {
      full();
      row('NEW TOTAL', money(newItemsTotal), true);
    }

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

    // Nett RS (before discount) -> Discount (auto) -> FINAL AMOUNT
    full();
    row(customerGetsMoney && discountValue === 0 ? 'Nett (C.R)' : 'Nett RS', money(baseNet), true);
    if (discountValue > 0) {
      row('Discount', `-${money(discountValue)}`, true);
    }
    full();
    row('FINAL AMOUNT', money(netFinalAmount), true);

    // Advance already paid on the customer order
    if (prepaidTotal > 0) {
      full();
      if (advance.amount > 0) {
        row('Advance (Order)', `-${money(advance.amount)}`);
        row('Paid By', advance.mode.replace('_', ' '));
      }
      if (advanceExtra > 0) row('Advance', `-${money(advanceExtra)}`);
      if (chitExtra > 0) row('Chit Fund', `-${money(chitExtra)}`);
      row(shopPays ? 'PAY TO CUSTOMER' : 'BALANCE', money(shopPays ? payoutAmount : amountDueNow), true);
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
  // Save final invoice  (the "Generate" button)
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
    if (saving) return;

    if (items.length === 0) {
      setErrorTitle('No items');
      setErrorMessage('Add at least one item before generating the bill.');
      return;
    }

    // Final amount checks (only when the customer owes money)
    if (baseNet > 0 && finalTouched && finalAmountText.trim() !== '' && !finalIsSet) {
      setErrorTitle('Invalid final amount');
      setErrorMessage('Enter a valid number in the FINAL AMOUNT box.');
      return;
    }
    if (finalNegative) {
      setErrorTitle('Invalid final amount');
      setErrorMessage('Final amount cannot be less than zero.');
      return;
    }
    if (finalTooHigh) {
      setErrorTitle('Final amount too high');
      setErrorMessage(`Final amount cannot be more than the bill amount (₹${baseNet.toLocaleString('en-IN')}).`);
      return;
    }
    if ((advanceOn && advanceExtra <= 0) || (chitOn && chitExtra <= 0)) {
      setErrorTitle('Amount required');
      setErrorMessage('Enter the amount for the ticked Advance / Chit Fund, or untick it.');
      return;
    }

    // Payment checks (only when money is due now)
    if (amountDueNow > 0) {
      if (!paymentChoice) {
        setErrorTitle('Payment mode required');
        setErrorMessage('Please select a payment mode.');
        return;
      }

      if (paymentChoice === 'multi') {
        if (multiRows.some((r) => multiAmount(r) > 0 && !r.mode)) {
          setErrorTitle('Payment mode required');
          setErrorMessage('Please select a mode for every payment row that has an amount.');
          return;
        }
        if (Math.abs(multiRemaining) > 0.01) {
          setErrorTitle('Multi payment total does not match');
          setErrorMessage(
            multiRemaining > 0
              ? `Payments are short by ₹${multiRemaining.toLocaleString('en-IN')} of the amount due.`
              : `Payments exceed the amount due by ₹${Math.abs(multiRemaining).toLocaleString('en-IN')}.`
          );
          return;
        }
      }

      if (paymentChoice === 'part') {
        if (!partMode) {
          setErrorTitle('Payment mode required');
          setErrorMessage('Please select the payment mode for the amount paid now.');
          return;
        }
        if (partPaid <= 0) {
          setErrorTitle('Amount required');
          setErrorMessage('Enter the amount paid now for the part payment.');
          return;
        }
        if (partPaid > amountDueNow + 0.01) {
          setErrorTitle('Amount too high');
          setErrorMessage(`Amount paid cannot be more than the amount due (₹${amountDueNow.toLocaleString('en-IN')}).`);
          return;
        }
      }
    }

    // A due amount needs a customer to collect it from
    if (creditAmount > 0 && (!customerName.trim() || customerPhone.trim().length < 10)) {
      setErrorTitle('Customer required for due amount');
      setErrorMessage('Enter the customer name and a valid phone number when an amount is left due.');
      return;
    }

    const splitsToSave = buildSplits();

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
          data: buildHeldData(),
        });
      } catch (heldError) {
        console.warn('Failed to keep estimate after billing', heldError);
      }

      try {
        await notify(
          'invoice',
          creditAmount > 0 ? 'Part payment invoice billed' : 'New invoice billed',
          `Invoice for ${customerName.trim() || 'Walk-in'} — ₹${totals.grandTotal.toLocaleString('en-IN')}` +
          (netBalanceDue > 0 ? ` (due ₹${netBalanceDue.toLocaleString('en-IN')})` : '')
        );
      } catch (notifyError) {
        console.warn('Failed to send invoice notification', notifyError);
      }

      if (linkedOrderId) {
        try {
          await completeCustomerOrderWithInvoice(linkedOrderId, invoice.id);
        } catch (linkError: any) {
          console.warn('Failed to link order to invoice', linkError);
          showError(
            'Order not marked as invoiced',
            `Invoice ${invoice.invoice_number} was saved, but the order could not be updated: ${linkError?.message ?? 'unknown error'}`,
            () => router.replace(`/invoices/${invoice.id}`)
          );
          return;
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

  // "Generate" button: saves the final bill (optionally after a confirmation).
  // "Generate" button: saves the final bill (optionally after a confirmation).
  const handleGenerate = () => {
    if (!CONFIRM_BEFORE_GENERATE) {
      handleSaveInvoice();
      return;
    }
    setConfirmGenerateOpen(true);
  };



  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const keyboardTop = useRef<number | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);


  // Scrolls just enough so the focused input sits above the keyboard.
  const scrollFocusedIntoView = () => {
    const input = (TextInput as any).State?.currentlyFocusedInput?.();
    if (!input) return;
    setTimeout(() => {
      input.measureInWindow((_x: number, y: number, _w: number, h: number) => {
        const limit = keyboardTop.current;
        if (limit == null) return;
        const bottom = y + h + 16; // 16px breathing room
        if (bottom > limit) {
          scrollRef.current?.scrollTo({
            y: scrollY.current + (bottom - limit),
            animated: true,
          });
        }
      });
    }, 100);
  };

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      keyboardTop.current = e.endCoordinates.screenY;
      setKeyboardHeight(e.endCoordinates.height);
      scrollFocusedIntoView();
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);


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


  // Reusable "Share Estimate on WhatsApp" button (used in read-only mode)
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

  // The FINAL AMOUNT box is only typeable when the customer owes money.
  const finalEditable = !readOnly && baseNet > 0;


  // =========================================================
  // Screen
  // =========================================================

  return (
    <View style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 + keyboardHeight }}
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


        {inlineError && <ShakeErrorCard key={inlineError.id} message={inlineError.text} />}

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
                    setEditingItem(items.find((i) => i.id === item.id) ?? item);
                    setSheetOpen(true);
                  }}
                  onRemove={() => {
                    if (readOnly) return;
                    removeItem(item.id);
                  }}
                />
                <View style={styles.itemRemarkWrap}>
                  <TextInput
                    style={styles.itemRemarkInput}
                    placeholder={`LOC / Remark ${idx + 1}`}
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

        {!readOnly && (
          <View style={styles.linkRow}>
            <Pressable
              style={styles.linkBtn}
              onPress={() => {
                setEditingItem(null);
                setSheetOpen(true);
              }}
            >
              <Plus size={16} color={colors.primary} />
              <Text style={styles.linkText}>Add Manually</Text>
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
            setFinalAmountText('');
            setFinalTouched(false);
            setDueText('');
            setDueTouched(false);
          }}
          metals={metals}
          purities={purities}
          fetchRate={getCurrentRate}
          locked={readOnly}
          onLockedAttempt={() => { }}
        />

        <View style={styles.divider} />


        {/* =================================================
            Receipt Preview
            The FINAL AMOUNT row is a typeable box and the payment
            is picked with radio buttons.
        ================================================= */}

        {items.length > 0 && (
          <Card style={{ marginTop: spacing.md }}>
            {/* Header row: title on the left, Apply GST checkbox on the right */}
            <View style={styles.previewHeader}>
              <Text style={[styles.totalsHeader, { marginBottom: 0 }]}>Receipt Preview</Text>

              <Pressable
                style={[styles.gstToggle, readOnly && styles.gstToggleLocked]}
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

            {/* Sum of all NEW items — only when there is more than one item */}
            {billItems.length > 1 && (
              <>
                <View style={styles.divider} />
                <SlipRow label="NEW TOTAL" value={money(newItemsTotal)} bold />
              </>
            )}

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

            {/* Nett RS = bill amount before any discount.
                Negative = old gold is worth more than the new items (pay the customer) */}
            <SlipRow
              label={customerGetsMoney ? 'Nett (C.R)' : 'Nett RS'}
              value={money(baseNet)}
              bold
            />

            {/* Discount is worked out automatically from the FINAL AMOUNT */}
            {discountValue > 0 && (
              <SlipRow label="Discount" value={`-${money(discountValue)}`} bold />
            )}

            <View style={styles.divider} />

            {/* FINAL AMOUNT — type the amount the customer agrees to pay.
                The difference from Nett RS becomes the discount. */}
            {finalEditable ? (
              <SlipInputRow
                label="FINAL AMOUNT"
                value={finalFieldValue}
                placeholder={String(baseNet)}
                onChangeText={onFinalAmountChange}
                onFocus={scrollFocusedIntoView}
              />
            ) : (
              <SlipRow label="FINAL AMOUNT" value={money(netFinalAmount)} bold />
            )}

            {finalTooHigh && (
              <Text style={styles.warningText}>
                ⚠ Final amount is more than the bill amount (₹{baseNet.toLocaleString('en-IN')}).
              </Text>
            )}

            {/* Advance / Chit Fund: two checkboxes in one line, input boxes open below */}
            {!readOnly && (
              <View style={styles.paymentSection}>
                <View style={styles.prepaidChecks}>
                  <Pressable
                    style={styles.prepaidCheckItem}
                    hitSlop={8}
                    onPress={() => {
                      setAdvanceOn((v) => !v);
                      if (advanceOn) setAdvanceText('');
                    }}
                  >
                    <View style={[styles.checkbox, advanceOn && styles.checkboxOn]}>
                      {advanceOn && <Check size={14} color="#fff" strokeWidth={3} />}
                    </View>
                    <Text style={styles.gstLabel}>ADVANCE</Text>
                  </Pressable>

                  <Pressable
                    style={styles.prepaidCheckItem}
                    hitSlop={8}
                    onPress={() => {
                      setChitOn((v) => !v);
                      if (chitOn) setChitText('');
                    }}
                  >
                    <View style={[styles.checkbox, chitOn && styles.checkboxOn]}>
                      {chitOn && <Check size={14} color="#fff" strokeWidth={3} />}
                    </View>
                    <Text style={styles.gstLabel}>CHIT FUND</Text>
                  </Pressable>
                </View>

                {(advanceOn || chitOn) && (
                  <View style={styles.prepaidInputs}>
                    <View style={styles.multiCols}>
                      {advanceOn && (
                        <View style={styles.multiCol}>
                          <TextInput
                            style={[styles.input, styles.multiColInput]}
                            keyboardType="decimal-pad"
                            value={advanceText}
                            onChangeText={setAdvanceText}
                            placeholder="₹"
                            placeholderTextColor={colors.textMuted}
                            onFocus={scrollFocusedIntoView}
                          />
                        </View>
                      )}
                      {chitOn && (
                        <View style={styles.multiCol}>
                          <TextInput
                            style={[styles.input, styles.multiColInput]}
                            keyboardType="decimal-pad"
                            value={chitText}
                            onChangeText={setChitText}
                            placeholder="₹"
                            placeholderTextColor={colors.textMuted}
                            onFocus={scrollFocusedIntoView}
                          />
                        </View>
                      )}
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* Deductions + balance */}
            {prepaidTotal > 0 && (
              <>
                <View style={styles.divider} />
                {advance.amount > 0 && (
                  <>
                    <SlipRow label="Advance (Order)" value={`-${money(advance.amount)}`} />
                    <SlipRow label="Payment Mode" value={advance.mode.replace('_', ' ')} />
                  </>
                )}
                {advanceExtra > 0 && <SlipRow label="Advance" value={`-${money(advanceExtra)}`} />}
                {chitExtra > 0 && <SlipRow label="Chit Fund" value={`-${money(chitExtra)}`} />}
                <SlipRow
                  label={shopPays ? 'BALANCE (C.R)' : 'BALANCE'}
                  value={money(balanceAfterPrepaid)}
                  bold
                />
              </>
            )}

            {/* Payment — radio buttons */}
            <View style={styles.paymentSection}>
              <Text style={styles.label}>Payment Mode</Text>

              <View style={styles.radioWrap}>
                {PAY_CHOICES.map((m) => (
                  <RadioOption
                    key={m.id}
                    label={m.label}
                    selected={paymentChoice === m.id}
                    onPress={() => selectChoice(m.id)}
                  />
                ))}
              </View>

              {/* ---------- Multi Payment: mode + amount per row ---------- */}
              {/* ---------- Multi Payment: CASH | CARD | UPI in one line ---------- */}
              {paymentChoice === 'multi' && !customerGetsMoney && (
                <View style={styles.subSection}>
                  <View style={styles.multiCols}>
                    {multiRows.map((row) => (
                      <View key={row.id} style={styles.multiCol}>
                        <Text style={styles.multiColLabel}>{String(row.mode).toUpperCase()}</Text>
                        <TextInput
                          style={[styles.input, styles.multiColInput]}
                          keyboardType="decimal-pad"
                          value={row.amountText}
                          onChangeText={(t) => updateMultiAmount(row.id, t)}
                          placeholder="₹"
                          placeholderTextColor={colors.textMuted}
                          editable={!readOnly}
                          onFocus={scrollFocusedIntoView}
                        />
                      </View>
                    ))}
                  </View>

                  <View style={{ marginTop: spacing.sm }}>
                    <Row label="Received" value={multiReceived} />
                    <Row label="Remaining" value={multiRemaining} bold={Math.abs(multiRemaining) > 0.01} />
                  </View>
                </View>
              )}

              {/* ---------- Part Payment: mode, amount paid, due ---------- */}
              {paymentChoice === 'part' && !customerGetsMoney && (
                <View style={styles.subSection}>
                  <Text style={styles.subLabel}>Payment mode</Text>
                  <View style={styles.radioWrap}>
                    {SIMPLE_MODES.map((m) => (
                      <RadioOption
                        key={m.id}
                        label={m.label}
                        selected={partMode === m.id}
                        onPress={() => {
                          if (readOnly) return;
                          setPartMode(m.id);
                        }}
                      />
                    ))}
                  </View>

                  <View style={styles.partRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.subLabel}>Amount paid (₹)</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="decimal-pad"
                        value={partPaidText}
                        onChangeText={onPartPaidChange}
                        placeholder="0"
                        placeholderTextColor={colors.textMuted}
                        editable={!readOnly}
                        onFocus={scrollFocusedIntoView}
                      />
                    </View>

                    <View style={{ flex: 1, marginLeft: spacing.sm }}>
                      <Text style={styles.subLabel}>Due (₹)</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="decimal-pad"
                        value={dueFieldValue}
                        onChangeText={onDueChange}
                        placeholder="0"
                        placeholderTextColor={colors.textMuted}
                        editable={finalEditable}
                        onFocus={scrollFocusedIntoView}
                      />
                    </View>
                  </View>

                  {partPaid > amountDueNow + 0.01 && (
                    <Text style={styles.warningText}>
                      ⚠ Amount paid is more than the amount due (₹{amountDueNow.toLocaleString('en-IN')}).
                    </Text>
                  )}
                </View>
              )}

              {shopPays && (
                <Text style={styles.payoutText}>
                  Pay ₹{payoutAmount.toLocaleString('en-IN')} to the customer.
                </Text>
              )}
            </View>
          </Card>
        )}

        {/* =================================================
            Bottom buttons
            readOnly (billed)  -> Print Estimate + Share
            otherwise          -> Generate (saves final bill) | Print
                                  Share | Hold
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
        ) : (
          <View style={styles.gridWrap}>
            {/* Row 1: Generate | Print */}
            <View style={styles.gridRow}>
              <Pressable
                style={[
                  styles.gridBtn,
                  styles.gridBtnPrimary,
                  (saving || items.length === 0) && styles.footerBtnDisabled,
                ]}
                onPress={handleGenerate}
                disabled={saving || items.length === 0}
              >
                <Text style={[styles.gridBtnText, styles.gridBtnTextPrimary]}>
                  {saving ? 'Saving…' : 'Generate'}
                </Text>
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
        )}
      </ScrollView>


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
        billGstEnabled={gstEnabled}
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
        onSaveAndNext={handleItemSaveAndNext}
      />


      {/* ===================================================
          Validation error
      =================================================== */}

      <ErrorModal
        visible={!!errorMessage}
        title={errorTitle}
        message={errorMessage}
        onClose={() => {
          setErrorMessage(null);
          const cb = afterErrorRef.current;
          afterErrorRef.current = null;
          cb?.();
        }}
      />

      <ConfirmModal
        visible={confirmGenerateOpen}
        title="Generate final bill?"
        message="This will save the invoice."
        confirmText="Generate"
        cancelText="Cancel"
        onCancel={() => setConfirmGenerateOpen(false)}
        onConfirm={() => {
          setConfirmGenerateOpen(false);
          handleSaveInvoice();
        }}
      />

      <ConfirmModal
        visible={heldNoticeOpen}
        variant="success"
        title="Estimate held"
        message={'Saved for 4 hours. Find it under "Held Bills" on the Invoices page.'}
        confirmText="OK"
        cancelText={null}
        onCancel={() => setHeldNoticeOpen(false)}
        onConfirm={() => setHeldNoticeOpen(false)}
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

// Same layout as SlipRow, but the value column is a typeable box.
function SlipInputRow({
  label,
  value,
  placeholder,
  onChangeText,
  onFocus,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChangeText: (text: string) => void;
  onFocus?: () => void;
}) {
  return (
    <View style={[styles.slipRow, { alignItems: 'center' }]}>
      <Text style={[styles.slipLabel, styles.rowBold]}>{label}</Text>
      <Text style={[styles.slipColon, styles.rowBold]}>:</Text>
      <View style={{ flex: 1 }}>
        <TextInput
          style={styles.slipInput}
          keyboardType="decimal-pad"
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          onFocus={onFocus}
        />
      </View>
    </View>
  );
}

// Small radio button (no background) used for every payment option.
function RadioOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.radioItem} onPress={onPress} hitSlop={6}>
      <View style={[styles.radioOuter, selected && styles.radioOuterOn]}>
        {selected && <View style={styles.radioInner} />}
      </View>
      <Text style={styles.radioLabel}>{label}</Text>
    </Pressable>
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
  subLabel: { fontSize: 13, color: colors.textMuted, marginBottom: 6 },
  warningText: { fontSize: 12, color: '#B00020', marginTop: 10, marginBottom: spacing.md },
  hintText: { fontSize: 11, color: colors.textMuted, marginTop: 2, marginBottom: spacing.sm, textAlign: 'center' },
  payoutText: { fontSize: 13, fontWeight: '600', color: '#137333', marginTop: 10, marginBottom: spacing.md },
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
  slipInput: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius?.md ?? 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    fontVariant: ['tabular-nums'],
  },
  paymentSection: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },

  // Payment radio buttons (small, no background)
  radioWrap: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 20, rowGap: 14, marginTop: 2 },
  radioItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  radioOuter: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  radioOuterOn: { borderColor: colors.primary },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  radioLabel: { fontSize: 14, color: colors.textPrimary },

  // Multi Payment / Part Payment blocks
  subSection: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  multiCols: { flexDirection: 'row', gap: spacing.sm },
  multiCol: { flex: 1 },
  multiColLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 6, textAlign: 'center' },
  multiColInput: { marginBottom: 0, paddingHorizontal: spacing.sm, textAlign: 'center' },
  partRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.md },

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
    marginTop: spacing.sm,
  },
  prepaidCheckRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8 },
  prepaidChecks: { flexDirection: 'row', alignItems: 'center', columnGap: 32 },
  prepaidCheckItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prepaidInputs: { marginTop: spacing.md },
});