// app/(tabs)/customers/orders/combined.tsx
//
// ONE bill for several jewel orders of the same customer.
// Works exactly like the invoice estimate on the New Invoice screen:
// every order is an ITEM, old gold is subtracted once, GST can be switched
// off, a discount can be given, and the bill can be shared on WhatsApp or
// printed. It does NOT create an invoice.

import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Card, ErrorModal } from '../../../../src/components/ui';
import { colors, spacing, radius } from '../../../../src/theme';

import { getCustomerById } from '../../../../src/lib/api/customers';
import { getCustomerOrderById } from '../../../../src/lib/api/customerOrders';
import {
  listMetals,
  listPurities,
  getCompanySettings,
  getInvoiceSettings,
} from '../../../../src/lib/api/settings';
import { companyToShopDetails } from '../../../../src/lib/invoicePdf';
import { buildEstimateSlip } from '../../../../src/lib/estimateSlip';
import { shareEstimateOnWhatsApp } from '../../../../src/lib/whatsappShare';
import { getConnectedPrinter, disconnectActive } from '../../../../src/lib/thermalPrint/printerService';
import { printThermalReceiptDirect } from '../../../../src/lib/thermalPrint/escposReceipt';
import { displayNetWeight } from '../../../../src/lib/exchangeGold';
import {
  buildOrderBill,
  computeBill,
  buildBillSlipLines,
  VA_CHARGE,
  STONE_CHARGE,
  type OrderBill,
} from '../../../../src/lib/orderEstimate';

import type { Metal, Purity } from '../../../../src/types/settings';
import type {
  InvoiceItemDetail,
  ExchangeItemDetail,
  InvoiceCharge,
  InvoiceDetail,
} from '../../../../src/types/invoices';

// ===========================================================
// Helpers (same as the invoice screen)
// ===========================================================

const DIAMOND_CHARGE_PREFIX = 'Diamond';
const isDiamondCharge = (name: unknown) => String(name ?? '').startsWith(DIAMOND_CHARGE_PREFIX);
const diamondWeightText = (name: unknown) => String(name ?? '').replace(/^Diamond\s*/i, '').trim();

const money = (n: number) => n.toFixed(2);
const plain = (n: number) => String(Number(n.toFixed(2)));
const withRate = (label: string, rate?: number | null) =>
  rate != null && rate > 0 ? `${label} @ ${Number(rate.toFixed(2))}%` : label;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ===========================================================
// Screen
// ===========================================================

export default function CombinedOrderBillScreen() {
  const { customerId, orderIds } = useLocalSearchParams<{ customerId?: string; orderIds?: string }>();

  const [loading, setLoading] = useState(true);
  const [bill, setBill] = useState<OrderBill | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [metals, setMetals] = useState<Metal[]>([]);
  const [purities, setPurities] = useState<Purity[]>([]);

  // Same switches as the invoice screen
  const [gstEnabled, setGstEnabled] = useState(true);
  const [discountAmount, setDiscountAmount] = useState('0');

  const [sharing, setSharing] = useState(false);
  const [printing, setPrinting] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState('Something went wrong');

  const showError = (title: string, message: string) => {
    setErrorTitle(title);
    setErrorMessage(message);
  };

  // ---------------------------------------------------------
  // Load the orders, the customer and build the bill
  // ---------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ids = (orderIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        if (ids.length === 0) throw new Error('No orders selected.');

        const orders = await Promise.all(ids.map((id) => getCustomerOrderById(id)));
        const [built, customer, m, p] = await Promise.all([
          buildOrderBill(orders),
          getCustomerById(customerId ?? orders[0].customer_id).catch(() => null),
          listMetals(),
          listPurities(),
        ]);
        if (cancelled) return;

        setBill(built);
        setMetals(m);
        setPurities(p);
        setCustomerName(customer?.name ?? '');
        setCustomerPhone(customer?.phone ?? '');
      } catch (e: any) {
        if (!cancelled) showError('Could not load bill', e?.message ?? 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderIds, customerId]);

  // ---------------------------------------------------------
  // Totals — recalculated when GST / discount change
  // ---------------------------------------------------------

  const computed = useMemo(
    () => (bill ? computeBill(bill, { gst: gstEnabled, discount: parseFloat(discountAmount) || 0 }) : null),
    [bill, gstEnabled, discountAmount]
  );

  const metalNameFor = (id: string | null) => metals.find((m) => m.id === id)?.name ?? 'Unknown';
  const purityNameFor = (id: string | null) => purities.find((p) => p.id === id)?.name ?? 'Unknown';

  // ---------------------------------------------------------
  // Share on WhatsApp (same slip as the invoice estimate)
  // ---------------------------------------------------------

  const handleShare = async () => {
    if (!bill || !computed) return;
    setSharing(true);
    try {
      const company = await getCompanySettings();
      const shop = companyToShopDetails(company);

      const { html, heightPt } = buildEstimateSlip(buildBillSlipLines(bill, computed), {
        shopName: (shop as any)?.name ?? null,
        title: 'ROUGH ESTIMATE',
      });

      await shareEstimateOnWhatsApp({
        html,
        customerName: customerName.trim() || null,
        customerPhone: customerPhone.trim() || null,
        shopName: (shop as any)?.name ?? null,
        amount: computed.netFinalAmount,
        heightPt,
      });
    } catch (e: any) {
      showError('Could not share estimate', e?.message ?? 'Unknown error');
    } finally {
      setSharing(false);
    }
  };

  // ---------------------------------------------------------
  // Print on the thermal printer (same as the invoice estimate)
  // ---------------------------------------------------------

  const handlePrint = async () => {
    if (!bill || !computed) return;
    setPrinting(true);
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

      const { billItems, totals, netFinalAmount } = computed;

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

      const detailExchangeItems: ExchangeItemDetail[] = bill.exchangeItems.map((e) => ({
        ...e,
        invoice_id: 'estimate',
        created_at: new Date().toISOString(),
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
        paid_amount: 0,
        balance_amount: netFinalAmount,
        payment_status: 'unpaid',
        payment_mode: 'cash',
        status: 'unpaid',
        items: detailItems,
        charges,
        created_at: new Date().toISOString(),
        exchange_total: bill.exchangeTotal,
        exchange_items: detailExchangeItems,
        payment_splits: [],
        remark: `Orders ${bill.orders.map((o) => o.order_number).join(', ')}`,
      };

      const printer = await getConnectedPrinter();
      try {
        await printThermalReceiptDirect(printer, estimateInvoice, shop, display);
      } finally {
        await disconnectActive();
      }
    } catch (e: any) {
      showError('Could not print estimate', e?.message ?? 'Unknown error');
    } finally {
      setPrinting(false);
    }
  };

  // ---------------------------------------------------------
  // Render
  // ---------------------------------------------------------

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!bill || !computed) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Could not build the bill.</Text>
        <ErrorModal
          visible={!!errorMessage}
          title={errorTitle}
          message={errorMessage}
          onClose={() => setErrorMessage(null)}
        />
      </View>
    );
  }

  const { billItems, totals, netFinalAmount, balance } = computed;
  const { exchangeItems, exchangeTotal, advanceTotal, paymentModes } = bill;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        {/* Customer + the orders in this bill */}
        <Card style={{ marginBottom: spacing.md }}>
          <Text style={styles.customerName}>{customerName || 'Walk-in Customer'}</Text>
          {!!customerPhone && <Text style={styles.customerSub}>{customerPhone}</Text>}
          <Text style={[styles.customerSub, { marginTop: 6 }]}>
            {bill.orders.map((o) => o.order_number).join('  ·  ')}
          </Text>
        </Card>

        {/* =================================================
            Receipt Preview (same layout as the invoice screen)
        ================================================= */}
        <Card>
          <View style={styles.previewHeader}>
            <Text style={[styles.totalsHeader, { marginBottom: 0 }]}>Receipt Preview</Text>

            <Pressable style={styles.gstToggle} onPress={() => setGstEnabled((v) => !v)} hitSlop={8}>
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
                {(item as any).stone_name ? (
                  <SlipRow label="Stone Name" value={String((item as any).stone_name)} />
                ) : null}
                {stoneLine && (
                  <SlipRow label="Stone Charges" value={plain(stoneLine.amount * item.quantity)} />
                )}
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

                {idx < billItems.length - 1 && <View style={styles.divider} />}
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

          {totals.discount > 0 && (
            <>
              <SlipRow label="Discount" value={`-${money(totals.discount)}`} bold />
              <View style={styles.divider} />
            </>
          )}

          <SlipRow label="Nett RS" value={money(netFinalAmount)} bold />

          {/* Advance already paid on the orders */}
          {advanceTotal > 0 && (
            <>
              <View style={styles.divider} />
              <SlipRow label="Advance" value={`-${money(advanceTotal)}`} />
              {paymentModes.length > 0 && <SlipRow label="Paid By" value={paymentModes.join(', ')} />}
              <SlipRow label="BALANCE" value={money(balance)} bold />
            </>
          )}
        </Card>

        {/* Discount */}
        <Text style={[styles.label, { marginTop: spacing.lg }]}>Discount Amount (₹)</Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          value={discountAmount}
          onChangeText={setDiscountAmount}
        />

        {/* Share / Print */}
        <Pressable
          style={[styles.primaryBtn, sharing && styles.btnDisabled]}
          onPress={handleShare}
          disabled={sharing}
        >
          <Text style={styles.primaryBtnText}>{sharing ? 'Preparing…' : 'Share Estimate on WhatsApp'}</Text>
        </Pressable>

        <Pressable
          style={[styles.outlineBtn, printing && styles.btnDisabled]}
          onPress={handlePrint}
          disabled={printing}
        >
          <Text style={styles.outlineBtnText}>{printing ? 'Preparing…' : 'Print Estimate'}</Text>
        </Pressable>
      </ScrollView>

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
// Row component (same as the invoice screen)
// ===========================================================

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
  errorText: { fontSize: 13, color: colors.error },

  customerName: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  customerSub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },

  label: { fontSize: 13, color: colors.textMuted, marginBottom: 6 },
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

  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  dividerThin: { height: 1, backgroundColor: colors.border, marginVertical: 6 },

  totalsHeader: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  itemSlipName: { fontSize: 14, fontWeight: '800', color: colors.primary, marginBottom: 4, marginTop: 4 },
  rowBold: { fontWeight: '800', fontSize: 16 },
  slipRow: { flexDirection: 'row', paddingVertical: 4 },
  slipLabel: { flex: 1, textAlign: 'right', color: colors.textSecondary, fontSize: 14 },
  slipColon: { width: 20, textAlign: 'center', color: colors.textSecondary, fontSize: 14 },
  slipValue: { flex: 1, color: colors.textPrimary, fontSize: 14, fontVariant: ['tabular-nums'] },

  previewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  gstToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  gstLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },

  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius?.md ?? 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  outlineBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius?.md ?? 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  outlineBtnText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
});