// app/(tabs)/invoices/new.tsx

import { useCallback, useState } from 'react';
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
import { useFocusEffect, router } from 'expo-router';
import { Plus, Barcode } from 'lucide-react-native';
import { Button, Card } from '../../../src/components/ui';
import { SelectField } from '../../../src/components/master';
import { colors, spacing, radius } from '../../../src/theme';

import {
  listMetals,
  listPurities,
  listCategories,
  listTaxSettings,
  listValueAddedChargeTypes,
} from '../../../src/lib/api/settings';

import {
  getProductByCode,
  getCurrentRate,
  getMakingChargeRule,
  getDefaultTaxSetting,
  createInvoice,
} from '../../../src/lib/api/invoices';

import { buildInvoiceItemFromProduct, invoiceTotals } from '../../../src/lib/invoiceCalc';

import { BarcodeScannerModal } from '../../../src/components/invoice/BarcodeScannerModal';
import { InvoiceItemRow } from '../../../src/components/invoice/InvoiceItemRow';
import { JewelryItemSheet } from '../../../src/components/invoice/JewelryItemSheet';

import type { Metal, Purity, Category, TaxSetting, ValueAddedChargeType } from '../../../src/types/settings';
import type { InvoiceItem, PaymentMode } from '../../../src/types/invoices';


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

type Stage = 'building' | 'estimate';


export default function NewInvoiceScreen() {
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

  // ---------------------------------------------------------
  // Invoice items
  // ---------------------------------------------------------

  const [items, setItems] = useState<InvoiceItem[]>([]);

  // ---------------------------------------------------------
  // Estimate / final stage
  // ---------------------------------------------------------

  const [stage, setStage] = useState<Stage>('building');

  // ---------------------------------------------------------
  // Discount / payment
  // ---------------------------------------------------------

  const [discountAmount, setDiscountAmount] = useState('0');
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>('cash');
  const [amountPaid, setAmountPaid] = useState('');
  // Tracks whether the cashier has manually edited the "Amount Received" field.
  // Used so we don't clobber their edit if totals recompute (e.g. discount change)
  // after they've already typed a custom (partial) payment amount.
  const [amountPaidTouched, setAmountPaidTouched] = useState(false);

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
  // Totals
  // =========================================================

  const totals = invoiceTotals(
    items,
    stage === 'estimate' ? parseFloat(discountAmount) || 0 : 0,
    stage === 'estimate' ? parseFloat(amountPaid) || 0 : 0
  );


  // =========================================================
  // Stage transitions
  // =========================================================

  const handleGenerateEstimate = () => {
    if (items.length === 0) {
      Alert.alert('No items', 'Add at least one item before generating an estimate.');
      return;
    }
    setStage('estimate');

    // FIX: previously `amountPaid` state was left as '' and the grand total
    // only appeared as a greyed-out TextInput `placeholder`. Placeholders are
    // NOT form values — if the cashier never typed into the field,
    // parseFloat('') -> NaN -> `totals.paid` fell back to 0, so the invoice
    // was saved with paid_amount = 0 and the server correctly (but
    // surprisingly) marked it "Unpaid" even though the bill looked settled
    // on screen.
    //
    // Default the real state to the grand total so "didn't touch the field"
    // means "paid in full" by default. The cashier can still edit it down
    // for a partial payment.
    if (!amountPaidTouched) {
      setAmountPaid(String(totals.grandTotal));
    }
  };

  const handleBackToEditing = () => {
    setStage('building');
  };

  const handleAmountPaidChange = (text: string) => {
    setAmountPaidTouched(true);
    setAmountPaid(text);
  };


  // =========================================================
  // Save final invoice
  // =========================================================

  const handleSaveInvoice = async () => {
    if (items.length === 0) {
      Alert.alert('No items', 'Add at least one item before saving.');
      return;
    }

    setSaving(true);

    try {
      const invoice = await createInvoice({
        customerId: null, // RPC resolves/creates the customer by name+mobile
        customerName: customerName.trim(),
        customerMobile: customerPhone.trim() || null,
        items,
        metals,
        purities,
        subtotal: totals.taxableTotal,
        invoiceDiscount: totals.discount,
        taxAmount: totals.taxTotal,
        grandTotal: totals.grandTotal,
        paidAmount: totals.paid,
        balanceAmount: totals.balanceDue,
        cgstTotal: totals.cgstTotal,
        sgstTotal: totals.sgstTotal,
        igstTotal: totals.igstTotal,
        makingTotal: totals.makingTotal,
        vaChargesTotal: totals.vaTotal,
        paymentMode: paymentMode ?? 'cash',
      });

      router.replace(`/invoices/${invoice.id}`);
    } catch (e: any) {
      Alert.alert('Could not save invoice', e?.message ?? 'Unknown error');
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
            Customer
        ================================================= */}

        <TextInput
          style={styles.input}
          placeholder="Customer Name"
          placeholderTextColor={colors.textMuted}
          value={customerName}
          onChangeText={setCustomerName}
        />

        <TextInput
          style={styles.input}
          placeholder="Phone Number"
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
          value={customerPhone}
          onChangeText={setCustomerPhone}
        />

        <View style={styles.divider} />


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
            items.map((item) => (
              <InvoiceItemRow
                key={item.id}
                item={item}
                metals={metals}
                purities={purities}
                onPress={() => {
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

        {stage === 'building' && (
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

        <View style={styles.divider} />


        {/* =================================================
            Stage: building -> Generate Estimate button
            Stage: estimate -> banner + discount field
        ================================================= */}

        {stage === 'building' ? (
          <Pressable style={styles.estimateBtn} onPress={handleGenerateEstimate}>
            <Text style={styles.estimateBtnText}>Generate Estimate</Text>
          </Pressable>
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
          </>
        )}


        {/* =================================================
            Totals / Payment Details
        ================================================= */}

        <View style={styles.totalsCard}>
          <Text style={styles.totalsHeader}>
            {stage === 'estimate' ? 'Payment Details' : 'Estimate Summary'}
          </Text>

          <Row label="Metal Value" value={totals.metalTotal} />
          <Row label="Making Charges" value={totals.makingTotal} />
          {totals.vaTotal > 0 && <Row label="Value Added Charges" value={totals.vaTotal} />}

          <View style={styles.dividerThin} />

          <Row label="Taxable Amount" value={totals.taxableTotal} />
          {totals.cgstTotal > 0 && <Row label="CGST" value={totals.cgstTotal} />}
          {totals.sgstTotal > 0 && <Row label="SGST" value={totals.sgstTotal} />}
          {totals.igstTotal > 0 && <Row label="IGST" value={totals.igstTotal} />}
          {totals.taxTotal > 0 && <Row label="Total Tax" value={totals.taxTotal} />}

          {stage === 'estimate' && <Row label="Discount" value={-totals.discount} />}

          <Row label="Round Off" value={totals.roundOff} />

          <View style={styles.dividerThin} />

          <Row
            label={stage === 'estimate' ? 'Grand Total' : 'Estimated Total'}
            value={totals.grandTotal}
            bold
          />

          {stage === 'estimate' && (
            <View style={styles.paymentSection}>
              <SelectField
                label="Payment Mode"
                value={paymentMode}
                options={PAYMENT_MODES}
                onChange={(id) => setPaymentMode(id as PaymentMode)}
              />

              <Text style={styles.label}>Amount Received (₹)</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                value={amountPaid}
                onChangeText={handleAmountPaidChange}
                placeholder={String(totals.grandTotal)}
                placeholderTextColor={colors.textMuted}
              />
              {parseFloat(amountPaid) === 0 || amountPaid.trim() === '' ? (
                <Text style={styles.warningText}>
                  ⚠ No amount entered here — this invoice will be saved as Unpaid.
                </Text>
              ) : null}

              <View style={{ marginTop: spacing.sm }}>
                <Row label="Balance Due" value={totals.balanceDue} bold={totals.balanceDue > 0} />
              </View>
            </View>
          )}
        </View>
      </ScrollView>


      {/* ===================================================
          Footer
      =================================================== */}

      <View style={styles.footer}>
        {stage === 'estimate' && (
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
    </View>
  );
}


// ===========================================================
// Reusable Row Component
// ===========================================================

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  const sign = value < 0 ? '-' : '';
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && styles.rowBold]}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.rowBold]}>
        {sign}₹{Math.abs(value).toLocaleString('en-IN')}
      </Text>
    </View>
  );
}


// ===========================================================
// Styles
// ===========================================================

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius?.md ?? 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  label: { fontSize: 13, color: colors.textMuted, marginBottom: 6 },
  warningText: {
    fontSize: 12,
    color: '#B00020',
    marginTop: -6,
    marginBottom: spacing.md,
  },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  dividerThin: { height: 1, backgroundColor: colors.border, marginVertical: 6 },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', padding: spacing.lg },

  linkRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkText: { color: colors.primary, fontWeight: '700', fontSize: 15 },

  estimateBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius?.md ?? 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  estimateBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  estimateBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF4E5',
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  estimateBannerText: { fontSize: 12, fontWeight: '700', color: '#8A5300' },
  editLink: { fontSize: 12, color: colors.primary, fontWeight: '600' },

  totalsCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius?.md ?? 10,
    padding: spacing.md,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
  },
  totalsHeader: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },

  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { color: colors.textSecondary, fontSize: 14 },
  rowValue: { color: colors.textPrimary, fontSize: 14 },
  rowBold: { fontWeight: '800', fontSize: 16 },

  paymentSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.background,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});