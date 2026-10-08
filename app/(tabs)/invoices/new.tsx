// app/(tabs)/invoices/new.tsx

import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { Plus, Barcode, X } from 'lucide-react-native';
import { Button, Card, ErrorModal } from '../../../src/components/ui';
import { SelectField } from '../../../src/components/master';
import { colors, spacing, radius } from '../../../src/theme';

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
} from '../../../src/lib/api/invoices';

import { getCustomerById } from '../../../src/lib/api/customers';
import { completeCustomerOrderWithInvoice } from '../../../src/lib/api/customerOrders';

import { buildInvoiceItemFromProduct, invoiceTotals, recalcItem, withoutGst } from '../../../src/lib/invoiceCalc';
import { buildThermalReceiptHtml, companyToShopDetails, printHtml } from '../../../src/lib/invoicePdf';

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
} from '../../../src/types/invoices';
import { getSavedPrinter } from '../../../src/lib/thermalPrint/printerStore';
import { getConnectedPrinter, disconnectActive } from '../../../src/lib/thermalPrint/printerService';
import { printThermalReceiptDirect } from '../../../src/lib/thermalPrint/escposReceipt';
import ReactNativePosPrinter from 'react-native-thermal-pos-printer';
import { displayNetWeight } from '../../../src/lib/exchangeGold';

// import RNBluetoothClassic from 'react-native-bluetooth-classic';
import { ensureBluetoothPermissions } from '../../../src/lib/thermalPrint/bluetoothPermissions';

// ===========================================================
// Constants
// ===========================================================

const PAYMENT_MODES = [
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Card' },
  { id: 'upi', label: 'UPI' },
  { id: 'bank_transfer', label: 'Bank Transfer' },
  { id: 'cheque', label: 'Cheque' },
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


export default function NewInvoiceScreen() {
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
  // ---------------------------------------------------------

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [remark, setRemark] = useState('');

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
  // const [gstEnabled, setGstEnabled] = useState(true);
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

      if (orderNumberParam) {
        setRemark((prev) => prev || `Order ${orderNumberParam}${orderCategory ? ` — ${orderCategory}` : ''}`);
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

      const netWeight = orderWeightMax ? parseFloat(orderWeightMax) : 0;
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
      };

      if (!matchedMetal || !matchedPurity) {
        console.warn(
          `Order prefill: could not match metal "${orderMetal}" / purity "${orderPurity}" against master data — item opened with rate ₹0, select metal/purity manually.`
        );
      }

      setEditingItem(draftItem);
      setSheetOpen(true);
    })();
  }, [fromOrder, loadingMaster, orderPrefillApplied, orderCustomerId, orderMetal, orderPurity, orderCategory, orderWeightMax, orderStoneWeight, orderNumberParam, metals, purities, categories]);


  // =========================================================
  // Barcode scan -> auto-fetch product -> build priced item
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

      const [rate, makingRule, taxSetting] = await Promise.all([
        getCurrentRate(product.metal_id, product.purity_id),
        getMakingChargeRule(product.metal_id, product.purity_id, product.category_id),
        getDefaultTaxSetting(),
      ]);

      const item = buildInvoiceItemFromProduct(product, rate, makingRule, taxSetting);
      setItems((prev) => [...prev, item]);
      setScannerOpen(false);
    } catch (e: any) {
      Alert.alert('Lookup error', e?.message ?? 'Could not fetch product.');
    } finally {
      setScanBusy(false);
    }
  };


  // =========================================================
  // Item sheet save / remove
  // =========================================================

  const handleItemSave = (item: InvoiceItem) => {
    setItems((prev) => {
      const exists = prev.some((i) => i.id === item.id);
      return exists ? prev.map((i) => (i.id === item.id ? item : i)) : [...prev, item];
    });
    setSheetOpen(false);
    setEditingItem(null);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
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

  const totalReceived = paymentSplits.reduce(
    (sum, row) => sum + (parseFloat(row.amountText) || 0),
    0
  );

  // When GST is unticked every item is stripped of tax, so all totals,
  // the preview, the print and the saved invoice are GST-free.
  // const billItems = gstEnabled ? items : items.map(withoutGst);
  // GST is now decided per item inside the Edit Item sheet.
  const billItems = items;

  const totals = invoiceTotals(
    billItems,
    stage === 'estimate' ? parseFloat(discountAmount) || 0 : 0,
    stage === 'estimate' ? totalReceived : 0
  );


  const netFinalAmount = round2(Math.max(0, totals.grandTotal - exchangeTotal));
  const netBalanceDue = round2(Math.max(0, netFinalAmount - totalReceived));
  const splitMismatch = round2(netFinalAmount - totalReceived);

  const vaAmount = totals.vaBreakdown[VA_CHARGE] ?? 0;
  const vaRate = totals.vaRates[VA_CHARGE];
  const stoneAmount = totals.vaBreakdown[STONE_CHARGE] ?? 0;

  const otherCharges = Object.entries(totals.vaBreakdown)
    .filter(([name, amount]) => name !== VA_CHARGE && name !== STONE_CHARGE && amount > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  const hasTax = totals.cgstTotal > 0 || totals.sgstTotal > 0 || totals.igstTotal > 0;


  // =========================================================
  // Held estimates: hold / load
  //
  // The list itself lives on the Invoices page ("Held Bills").
  // This screen only holds the current bill, and loads one back
  // when opened with ?heldId=...
  // =========================================================

  // Everything needed to rebuild the screen later.
  const buildHeldData = () => ({
    customerName,
    customerPhone,
    remark,
    resolvedCustomerId,
    items,
    exchangeItems,
    exchangeTotal,
    discountAmount,
    paymentSplits,
    paymentSplitsTouched,
    stage,
    // gstEnabled,
  });

  const resetForm = () => {
    setItems([]);
    setExchangeItems([]);
    setExchangeTotal(0);
    setCustomerName('');
    setCustomerPhone('');
    setRemark('');
    setDiscountAmount('0');
    setPaymentSplits([]);
    setPaymentSplitsTouched(false);
    setResolvedCustomerId(null);
    setStage('building');
    setActiveHeldId(null);
    setReadOnly(false);
    setBilledNumber(null);
    // setGstEnabled(true);
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
    setRemark(d.remark);
    setResolvedCustomerId(d.resolvedCustomerId);
    // Older held bills stored a bill-wide "GST off" flag instead of a per-item one.
    // If it's set, strip the tax from the items when loading.
    const legacyNoGst = (d as any).gstEnabled === false;
    setItems(legacyNoGst ? d.items.map(withoutGst) : d.items);
    setExchangeItems(d.exchangeItems);
    setExchangeTotal(d.exchangeTotal);
    setDiscountAmount(d.discountAmount);
    setPaymentSplits(d.paymentSplits);
    setPaymentSplitsTouched(d.paymentSplitsTouched);
    setStage(d.stage);
    // setGstEnabled((d as any).gstEnabled !== false);
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

    if (!customerName.trim() || !customerPhone.trim()) {
      setErrorTitle('Missing details');
      setErrorMessage('Customer name and phone number are mandatory.');
      return;
    }

    if (!remark.trim()) {
      setErrorTitle('Missing details');
      setErrorMessage('Remark is mandatory.');
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
  // Print estimate
  // =========================================================

  const metalNameFor = (id: string | null) => metals.find((m) => m.id === id)?.name ?? 'Unknown';
  const purityNameFor = (id: string | null) => purities.find((p) => p.id === id)?.name ?? 'Unknown';

  const handlePrintEstimate = async () => {
    if (items.length === 0) {
      setErrorTitle('No items');
      setErrorMessage('Add at least one item before printing an estimate.');
      return;
    }

    setPrintingEstimate(true);

    try {
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
        remark: remark.trim() || null,
      };

      const html = buildThermalReceiptHtml(estimateInvoice, shop, display, { showHeaderFooter: true });
      void html; // kept only so buildThermalReceiptHtml's shape stays validated; not used for direct print

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

    if (!customerName.trim() || !customerPhone.trim()) {
      setErrorTitle('Missing details');
      setErrorMessage('Customer name and phone number are mandatory.');
      return;
    }

    if (!remark.trim()) {
      setErrorTitle('Missing details');
      setErrorMessage('Remark is mandatory.');
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
        customerName: customerName.trim(),
        customerMobile: customerPhone.trim() || null,
        items: billItems,
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
        remark: remark.trim(),
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
          'New invoice billed',
          `Invoice for ${customerName.trim()} — ₹${totals.grandTotal.toLocaleString('en-IN')}`
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


  // =========================================================
  // Screen
  // =========================================================

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}>

        {/* =================================================
            Billed banner — only for a held estimate that has
            already been billed (print only).
        ================================================= */}

        {readOnly && (
          <View style={styles.billedBanner}>
            <Text style={styles.billedBannerTitle}>
              ✓ Already billed{billedNumber ? ` · ${billedNumber}` : ''}
            </Text>
            {/* <Text style={styles.billedBannerText}>
              This estimate is locked. It can only be printed, not edited or billed again.
            </Text> */}
          </View>
        )}

        {/* =================================================
            Customer
        ================================================= */}

        <TextInput
          style={styles.input}
          placeholder="Customer Name *"
          placeholderTextColor={colors.textMuted}
          value={customerName}
          onChangeText={setCustomerName}
          editable={!readOnly}
        />

        <TextInput
          style={styles.input}
          placeholder="Phone Number *"
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
          value={customerPhone}
          onChangeText={setCustomerPhone}
          editable={!readOnly}
        />

        <TextInput
          style={[styles.input, styles.input]}
          placeholder="Remark *"
          placeholderTextColor={colors.textMuted}
          value={remark}
          onChangeText={setRemark}
          multiline
          numberOfLines={2}
          editable={!readOnly}
        />

        <View style={styles.divider} />

        {/* <Pressable
          style={styles.gstRow}
          onPress={() => {
            if (readOnly) return;
            if (stage === 'estimate') {
              Alert.alert('Editing locked', 'Go back to editing to change GST.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Go back', onPress: handleBackToEditing },
              ]);
              return;
            }
            setGstEnabled((v) => !v);
          }}
        >
          <View style={[styles.checkbox, gstEnabled && styles.checkboxOn]}>
            {gstEnabled && <Check size={14} color="#fff" strokeWidth={3} />}
          </View>
          <Text style={styles.gstLabel}>Apply GST</Text>
        </Pressable> */}


        {/* =================================================
            Products / Services
        ================================================= */}

        <Text style={styles.sectionTitle}>Products / Services</Text>

        <Card padded={false} style={{ marginBottom: spacing.md }}>
          {items.length === 0 ? (
            <Text style={styles.emptyText}>
              No items yet. Scan a barcode or add manually.
            </Text>
          ) : (
            billItems.map((item) => (
              <InvoiceItemRow
                key={item.id}
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
            <Text style={styles.totalsHeader}>
              {stage === 'estimate' ? 'Payment Details' : 'Receipt Preview'}
            </Text>

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

                {!readOnly && paymentSplits.length > 1 && Math.abs(splitMismatch) > 0.01 && (
                  <Text style={styles.warningText}>
                    {splitMismatch > 0
                      ? `⚠ Splits are short by ₹${splitMismatch.toLocaleString('en-IN')} of the total due.`
                      : `⚠ Splits exceed the total due by ₹${Math.abs(splitMismatch).toLocaleString('en-IN')}.`}
                  </Text>
                )}

                <View style={{ marginTop: spacing.sm }}>
                  {paymentSplits.length > 1 && <Row label="Total Received" value={totalReceived} />}
                  <Row label="Balance Due" value={netBalanceDue} bold={netBalanceDue > 0} />
                </View>
              </View>
            )}
          </Card>
        )}

        {/* =================================================
            Bottom buttons
            readOnly (billed)  -> Print Estimate only
            building           -> Generate / Print / Hold
            estimate           -> banner + discount + Hold
        ================================================= */}

        {readOnly ? (
          <Pressable
            style={[styles.estimateBtn, printingEstimate && styles.footerBtnDisabled]}
            onPress={handlePrintEstimate}
            disabled={printingEstimate}
          >
            <Text style={styles.estimateBtnText}>
              {printingEstimate ? 'Preparing…' : 'Print Estimate'}
            </Text>
          </Pressable>
        ) : stage === 'building' ? (
          <>
            <Pressable style={styles.estimateBtn} onPress={handleGenerateEstimate}>
              <Text style={styles.estimateBtnText}>Generate Estimate</Text>
            </Pressable>

            <Pressable
              style={[
                styles.printEstimateBtn,
                (printingEstimate || items.length === 0) && styles.footerBtnDisabled,
              ]}
              onPress={handlePrintEstimate}
              disabled={printingEstimate || items.length === 0}
            >
              <Text style={styles.printEstimateBtnText}>
                {printingEstimate ? 'Preparing…' : 'Print Estimate'}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.printEstimateBtn, items.length === 0 && styles.footerBtnDisabled]}
              onPress={handleHoldEstimate}
              disabled={items.length === 0}
            >
              <Text style={styles.printEstimateBtnText}>Hold Estimate (4 hrs)</Text>
            </Pressable>
          </>
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

  // Billed (read-only) banner
  billedBanner: { backgroundColor: '#E6F4EA', borderWidth: 1, borderColor: '#CEEAD6', borderRadius: radius?.md ?? 10, padding: spacing.md, marginBottom: spacing.md },
  billedBannerTitle: { fontSize: 14, fontWeight: '800', color: '#137333' },
  billedBannerText: { fontSize: 12, color: '#137333', marginTop: 4 },
  gstRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.md },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  gstLabel: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
});