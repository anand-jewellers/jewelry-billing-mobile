// app/(tabs)/invoices/[id].tsx

import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable, Alert, Platform } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { ArrowLeft, Printer, Receipt, MessageCircle } from 'lucide-react-native';
import { Card } from '../../../src/components/ui';
import { colors, spacing, radius } from '../../../src/theme';
import { getInvoiceById } from '../../../src/lib/api/invoices';
import { getCompanySettings, getInvoiceSettings } from '../../../src/lib/api/settings';
import {
  buildInvoiceHtml,
  // buildThermalReceiptHtml,
  companyToShopDetails,
  printHtml,
  printInvoice,
  sharePdfFromHtml,
  type ShopDetails,
} from '../../../src/lib/invoicePdf';
import {
  shareInvoiceOnWhatsApp,
  reviewUrlFromCompany,
  createInvoicePdfFile,
  createInvoicePdfBlobWeb,
  preloadHtml2PdfWeb,
} from '../../../src/lib/whatsappShare';
import type { InvoiceDetail } from '../../../src/types/invoices';
import { HeaderFooterModal } from '../../../src/components/invoice/HeaderFooterModal';
import { displayNetWeight } from '../../../src/lib/exchangeGold';
// import { getSavedPrinter } from '../../../src/lib/thermalPrint/printerStore';
import { getConnectedPrinter, disconnectActive } from '../../../src/lib/thermalPrint/printerService';
import { printThermalReceiptDirect } from '../../../src/lib/thermalPrint/escposReceipt';

const WHATSAPP_GREEN = '#25D366';

function money(n: number): string {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

// Appends "(x%)" to a tax label, derived from amount / base. Returns ''
// when there's nothing meaningful to show (zero base or zero amount).
function formatRate(amount: number, base: number): string {
  if (!base || amount <= 0) return '';
  const rate = (amount / base) * 100;
  return ` (${rate % 1 === 0 ? rate.toFixed(0) : rate.toFixed(1)}%)`;
}

// Charge names that should show a "(x%)" rate suffix, derived from that
// line's own amount ÷ subtotal — these are the GST-style charges.
const RATE_LABELED_CHARGE_NAMES = new Set(['CGST', 'SGST', 'IGST', 'GST']);

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  upi: 'UPI',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
  credit: 'Due',
  advance: 'Advance',
  chit_fund: 'Chit Fund',
  split: 'Split',
};

// "Advance" rows from a customer order keep their cash/upi mode and are
// tagged with reference "Advance", so label them "Advance (Cash)".
function splitLabel(mode: string, reference?: string | null): string {
  const base = PAYMENT_LABELS[mode] ?? mode.replace('_', ' ');
  if (reference === 'Advance' && mode !== 'advance') return `Advance (${base})`;
  return base;
}

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [shop, setShop] = useState<ShopDetails | undefined>(undefined);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [displayConfig, setDisplayConfig] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [waSharing, setWaSharing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);

  // Web: load the PDF library early so the share tap stays within the browser's user-gesture window
  useEffect(() => {
    preloadHtml2PdfWeb();
  }, []);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getInvoiceById(id),
      getCompanySettings(),
      getInvoiceSettings().catch(() => null),
    ])
      .then(([invoiceData, companySettings, invoiceSettings]) => {
        setInvoice(invoiceData);
        setShop(companyToShopDetails(companySettings));
        setReviewUrl(reviewUrlFromCompany(companySettings));
        if (invoiceSettings) {
          setDisplayConfig({
            show_logo: invoiceSettings.show_logo,
            show_huid: invoiceSettings.show_huid,
            show_weight: invoiceSettings.show_weight,
            show_making_charges: invoiceSettings.show_making_charges,
            show_value_added_charges: invoiceSettings.show_value_added_charges,
            invoice_footer: invoiceSettings.invoice_footer,
            terms_and_conditions: invoiceSettings.terms_and_conditions,
          });
        }
      })
      .catch((e) => Alert.alert('Error', e.message ?? 'Could not load invoice.'))
      .finally(() => setLoading(false));
  }, [id]);

  // Single share button: sends the invoice PDF + thank-you note + Google
  // review link as ONE WhatsApp message (PDF with the note as its caption).
  //  - Native: react-native-share straight into the customer's WhatsApp chat.
  //  - Web: browser share sheet with the PDF attached; if the browser can't
  //    share files, the PDF is downloaded and WhatsApp opens with the note.
  //  - Expo Go / WhatsApp missing: clipboard + normal share sheet.
  const handleWhatsAppShare = async () => {
    if (!invoice || waSharing) return;
    setWaSharing(true);
    try {
      const html = buildInvoiceHtml(invoice, shop, displayConfig);
      await shareInvoiceOnWhatsApp({
        invoice,
        shopName: shop?.name ?? null,
        reviewUrl,
        getPdfUri: () => createInvoicePdfFile(html, invoice.invoice_number),
        getPdfBlob: () => createInvoicePdfBlobWeb(html),
        sharePdfFallback: async () => {
          // Last resort on web: open the print dialog.
          if (Platform.OS === 'web') {
            await printHtml(html);
            return;
          }
          await sharePdfFromHtml(html, invoice.invoice_number, 'a4');
        },
      });
    } catch (e: any) {
      Alert.alert('Could not share on WhatsApp', e?.message ?? 'Unknown error');
    } finally {
      setWaSharing(false);
    }
  };

  // Print A4: the button opens the "Do you want header and footer?" popup.
  //   Yes -> header + footer printed, No -> neither, X -> nothing is printed.
  const runPrintA4 = async (showHeaderFooter: boolean) => {
    setPrintModalOpen(false);
    if (!id || printing) return;
    setPrinting(true);
    try {
      await printInvoice(id, 'a4', { showHeaderFooter });
    } catch (e: any) {
      Alert.alert('Could not generate PDF', e?.message ?? 'Unknown error');
    } finally {
      setPrinting(false);
    }
  };

  const handleThermalPrint = async () => {
    if (!invoice || printingReceipt) return;

    // Bluetooth thermal printing only works in the native app.
    // On web, keep the old browser print dialog.
    if (Platform.OS === 'web') {
      Alert.alert('Not available', 'Receipt printing works only in the mobile app.');
      return;
    }

    setPrintingReceipt(true);
    try {
      const printer = await getConnectedPrinter();
      try {
        await printThermalReceiptDirect(
          printer,
          invoice,
          shop ?? companyToShopDetails(null),
          displayConfig
        );
      } finally {
        await disconnectActive();
      }
    } catch (e: any) {
      Alert.alert('Could not print receipt', e?.message ?? 'Unknown error');
    } finally {
      setPrintingReceipt(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!invoice) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Invoice not found.</Text>
      </View>
    );
  }

  // Only one GST scheme is actually charged: CGST + SGST together, or IGST alone.
  // A tax setting can carry all three rates, so older invoices may have an IGST
  // charge saved next to CGST/SGST — hide it when the split scheme is present.
  const hasSplitGst =
    invoice.charges.some((c) => c.charge_name === 'CGST' && c.amount > 0) &&
    invoice.charges.some((c) => c.charge_name === 'SGST' && c.amount > 0);
  const visibleCharges = invoice.charges.filter(
    (c) => !(hasSplitGst && (c.charge_name === 'IGST' || c.charge_name === 'GST'))
  );

  const exchangeItems = invoice.exchange_items ?? [];
  const exchangeTotal = invoice.exchange_total ?? 0;

  // ---- Payment breakdown ----
  const splits = invoice.payment_splits ?? [];
  // Advance / Chit Fund: deducted from the bill
  const prepaidRows = splits.filter(
    (s) => s.amount > 0 && (s.mode === 'advance' || s.mode === 'chit_fund' || s.reference === 'Advance')
  );
  // Money received at billing (cash / card / upi ...)
  const paidNowRows = splits.filter(
    (s) =>
      s.amount > 0 &&
      s.mode !== 'credit' &&
      s.mode !== 'advance' &&
      s.mode !== 'chit_fund' &&
      s.reference !== 'Advance'
  );

  const balanceDue = Number(invoice.balance_amount) || 0;
  const paidTotal = Number(invoice.paid_amount) || 0;
  const payState = balanceDue <= 0.01 ? 'paid' : paidTotal > 0 ? 'partial' : 'unpaid';
  const netPayable = invoice.grand_total - exchangeTotal;
  const prepaidSum = prepaidRows.reduce((t, s) => t + s.amount, 0);
  const payoutToCustomer = Math.max(0, Math.round((prepaidSum - netPayable) * 100) / 100);

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <ArrowLeft size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.topBarTitle}>{invoice.invoice_number}</Text>
        {/* Spacer keeps the title centered now that the share icon is gone */}
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 200 }}>
        {/* Company / shop details — same data used to build the PDF, shown here too */}
        {shop && (
          <Card style={styles.companyCard}>
            <Text style={styles.companyName}>{shop.name}</Text>
            {(shop.address || shop.city || shop.state || shop.pincode) && (
              <Text style={styles.companyDetail}>
                {[shop.address, shop.city, shop.state, shop.pincode].filter(Boolean).join(', ')}
              </Text>
            )}
            {(shop.phone || shop.email) && (
              <Text style={styles.companyDetail}>
                {[shop.phone ? `Ph: ${shop.phone}` : '', shop.email].filter(Boolean).join('  ·  ')}
              </Text>
            )}
            {(shop.gstin || shop.pan) && (
              <Text style={styles.companyDetail}>
                {[shop.gstin ? `GSTIN: ${shop.gstin}` : '', shop.pan ? `PAN: ${shop.pan}` : '']
                  .filter(Boolean)
                  .join('  ·  ')}
              </Text>
            )}
            {shop.website && <Text style={styles.companyDetail}>{shop.website}</Text>}
          </Card>
        )}

        <Card style={styles.metaCard}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Customer</Text>
            <Text style={styles.metaValue}>{invoice.customer_name}</Text>
          </View>
          {invoice.customer_mobile && (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Mobile</Text>
              <Text style={styles.metaValue}>{invoice.customer_mobile}</Text>
            </View>
          )}
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Date</Text>
            <Text style={styles.metaValue}>{new Date(invoice.invoice_date).toLocaleDateString('en-IN')}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Status</Text>
            <Text style={[styles.metaValue, styles.statusBadge]}>
              {invoice.status} · {payState}
              {balanceDue > 0.01 ? ` (due ₹${balanceDue.toLocaleString('en-IN')})` : ''}
            </Text>
          </View>
        </Card>

        {invoice.remark && (
          <Card style={styles.remarkCard}>
            <Text style={styles.remarkLabel}>Remark</Text>
            <Text style={styles.remarkText}>{invoice.remark}</Text>
          </Card>
        )}

        <Text style={styles.sectionTitle}>Items</Text>
        <Card padded={false}>
          {invoice.items.map((item, idx) => (
            <View key={item.id} style={[styles.itemRow, idx === invoice.items.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{item.product_name}{item.quantity > 1 ? `  ×${item.quantity}` : ''}</Text>
                <Text style={styles.itemMeta}>
                  {item.product_code} · {item.metal_name} {item.purity_name} · {item.net_weight}g · ₹{item.metal_rate}/g
                </Text>
                {item.value_added_charges.length > 0 && (
                  <Text style={styles.itemMeta}>
                    {item.value_added_charges.map((c) => `${c.charge_name} ₹${c.amount}`).join(' · ')}
                  </Text>
                )}
              </View>
              <Text style={styles.itemAmount}>{money(item.total)}</Text>
            </View>
          ))}
        </Card>

        {exchangeItems.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Old Gold Exchange</Text>
            <Card padded={false}>
              {exchangeItems.map((item, idx) => (
                <View key={item.id} style={[styles.itemRow, idx === exchangeItems.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{item.description}</Text>
                    <Text style={styles.itemMeta}>
                      {item.gross_weight}g gross · {item.purity_percent}% purity · {item.deduction_percent}% deduction · net {displayNetWeight(item)}g · ₹{item.rate_per_gram}/g
                    </Text>
                  </View>
                  <Text style={styles.itemAmount}>{money(item.amount)}</Text>
                </View>
              ))}
            </Card>
          </>
        )}

        <View style={styles.totalsCard}>
          <Row label="Subtotal" value={invoice.subtotal} />
          {visibleCharges.map((c) => {
            const label = RATE_LABELED_CHARGE_NAMES.has(c.charge_name)
              ? `${c.charge_name}${formatRate(c.amount, invoice.subtotal)}`
              : c.charge_name;
            return <Row key={c.id} label={label} value={c.amount} />;
          })}
          <Row label="Discount" value={-invoice.invoice_discount} />
          <View style={styles.dividerThin} />
          <Row label="Grand Total" value={invoice.grand_total} bold />
          {exchangeTotal > 0 && (
            <>
              <Row label="Old Gold Exchange" value={-exchangeTotal} />
              <View style={styles.dividerThin} />
              <Row label="Net Payable" value={netPayable} bold />
            </>
          )}

          {(prepaidRows.length > 0 || paidNowRows.length > 0) && <View style={styles.dividerThin} />}

          {/* Advance / Chit Fund: deducted from the bill */}
          {prepaidRows.map((s) => (
            <Row key={s.id} label={splitLabel(s.mode, s.reference)} value={-s.amount} />
          ))}

          {/* Money received at billing (cash / card / upi) */}
          {paidNowRows.map((s) => (
            <Row key={s.id} label={`Paid · ${splitLabel(s.mode, s.reference)}`} value={s.amount} />
          ))}

          <View style={styles.dividerThin} />
          <Row label="Total Received" value={invoice.paid_amount} bold />
          {payoutToCustomer > 0.01 ? (
            <Row label="Pay to Customer" value={payoutToCustomer} bold negative />
          ) : balanceDue > 0.01 ? (
            <Row label="Balance Due" value={balanceDue} bold negative />
          ) : (
            <Row label="Balance Due" value={0} />
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.whatsappBtn, (pressed || waSharing) && styles.footerBtnDisabled]}
          onPress={handleWhatsAppShare}
          disabled={waSharing}
        >
          {waSharing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <MessageCircle size={18} color="#fff" />
              <Text style={styles.footerBtnText}>Share on WhatsApp</Text>
            </>
          )}
        </Pressable>

        <View style={styles.footerRow}>
          <Pressable
            style={[styles.footerBtn, printing && styles.footerBtnDisabled]}
            onPress={() => setPrintModalOpen(true)}
            disabled={printing}
          >
            <Printer size={18} color="#fff" />
            <Text style={styles.footerBtnText}>Print A4</Text>
          </Pressable>
          <Pressable
            style={[styles.footerBtn, printingReceipt && styles.footerBtnDisabled]}
            onPress={handleThermalPrint}
            disabled={printingReceipt}
          >
            <Receipt size={18} color="#fff" />
            <Text style={styles.footerBtnText}>
              {printingReceipt ? 'Printing…' : 'Print Receipt'}
            </Text>
          </Pressable>
        </View>
      </View>

      <HeaderFooterModal
        visible={printModalOpen}
        onYes={() => runPrintA4(true)}
        onNo={() => runPrintA4(false)}
        onClose={() => setPrintModalOpen(false)}
      />
    </View>
  );
}

function Row({ label, value, bold, negative }: { label: string; value: number; bold?: boolean; negative?: boolean }) {
  const sign = value < 0 ? '-' : '';
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && styles.rowBold]}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.rowBold, negative && styles.rowNegative]}>
        {sign}₹{Math.abs(value).toLocaleString('en-IN')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  emptyText: { color: colors.textMuted, fontSize: 14 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  topBarTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  companyCard: { padding: spacing.md, marginBottom: spacing.md },
  companyName: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  companyDetail: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  metaCard: { padding: spacing.md, marginBottom: spacing.lg },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  metaLabel: { fontSize: 13, color: colors.textMuted },
  metaValue: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
  statusBadge: { textTransform: 'capitalize' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm, marginTop: spacing.lg },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  itemName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  itemMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  itemAmount: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginLeft: spacing.md },
  totalsCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius?.md ?? 10, padding: spacing.md, marginTop: spacing.lg, backgroundColor: colors.surface },
  dividerThin: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { color: colors.textSecondary, fontSize: 14 },
  rowValue: { color: colors.textPrimary, fontSize: 14 },
  rowBold: { fontWeight: '800', fontSize: 16 },
  rowNegative: { color: colors.error ?? 'crimson' },
  footer: { gap: spacing.sm, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
  footerRow: { flexDirection: 'row', gap: spacing.md },
  footerBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, backgroundColor: colors.primary, borderRadius: radius?.md ?? 10 },
  whatsappBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, backgroundColor: WHATSAPP_GREEN, borderRadius: radius?.md ?? 10 },
  footerBtnDisabled: { opacity: 0.6 },
  footerBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  remarkCard: { padding: spacing.md, marginBottom: spacing.lg, backgroundColor: colors.surface },
  remarkLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase' },
  remarkText: { fontSize: 13, color: colors.textPrimary },
});