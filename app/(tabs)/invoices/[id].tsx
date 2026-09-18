import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Share2, ArrowLeft, Printer, Receipt } from 'lucide-react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Card } from '../../../src/components/ui';
import { colors, spacing, radius } from '../../../src/theme';
import { getInvoiceById } from '../../../src/lib/api/invoices';
import { getCompanySettings, getInvoiceSettings } from '../../../src/lib/api/settings';
import { buildInvoiceHtml, buildThermalReceiptHtml, companyToShopDetails, type ShopDetails } from '../../../src/lib/invoicePdf';
import type { InvoiceDetail } from '../../../src/types/invoices';

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

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [shop, setShop] = useState<ShopDetails | undefined>(undefined);
  const [displayConfig, setDisplayConfig] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);

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

  // Top-bar share icon still generates/shares the full A4 PDF.
  const handleShare = async () => {
    if (!invoice) return;
    setSharing(true);
    try {
      const html = buildInvoiceHtml(invoice, shop, displayConfig);
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Invoice ${invoice.invoice_number}` });
      } else {
        Alert.alert('Sharing unavailable', 'PDF generated but sharing is not supported on this device.');
      }
    } catch (e: any) {
      Alert.alert('Could not generate PDF', e.message ?? 'Unknown error');
    } finally {
      setSharing(false);
    }
  };

  const handlePrint = async () => {
    if (!invoice) return;
    try {
      const html = buildInvoiceHtml(invoice, shop, displayConfig);
      await Print.printAsync({ html });
    } catch (e: any) {
      Alert.alert('Could not print', e.message ?? 'Unknown error');
    }
  };

  const handleThermalPrint = async () => {
    if (!invoice) return;
    try {
      const html = buildThermalReceiptHtml(invoice, shop, displayConfig);
      await Print.printAsync({ html });
    } catch (e: any) {
      Alert.alert('Could not print receipt', e.message ?? 'Unknown error');
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

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <ArrowLeft size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.topBarTitle}>{invoice.invoice_number}</Text>
        <Pressable onPress={handleShare} hitSlop={8} disabled={sharing}>
          <Share2 size={20} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}>
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
            <Text style={[styles.metaValue, styles.statusBadge]}>{invoice.status} · {invoice.payment_status}</Text>
          </View>
        </Card>

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

        <View style={styles.totalsCard}>
          <Row label="Subtotal" value={invoice.subtotal} />
          {invoice.charges.map((c) => {
            const label = RATE_LABELED_CHARGE_NAMES.has(c.charge_name)
              ? `${c.charge_name}${formatRate(c.amount, invoice.subtotal)}`
              : c.charge_name;
            return <Row key={c.id} label={label} value={c.amount} />;
          })}
          <Row label="Discount" value={-invoice.invoice_discount} />
          <View style={styles.dividerThin} />
          <Row label="Grand Total" value={invoice.grand_total} bold />
          <Row label="Amount Paid" value={invoice.paid_amount} />
          {invoice.balance_amount > 0 && <Row label="Balance Due" value={invoice.balance_amount} bold negative />}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.footerBtn} onPress={handlePrint}>
          <Printer size={18} color="#fff" />
          <Text style={styles.footerBtnText}>Print A4</Text>
        </Pressable>
        <Pressable style={styles.footerBtn} onPress={handleThermalPrint}>
          <Receipt size={18} color="#fff" />
          <Text style={styles.footerBtnText}>Print Receipt</Text>
        </Pressable>
      </View>
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
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
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
  footer: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
  footerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    backgroundColor: colors.primary,
    borderRadius: radius?.md ?? 10,
  },
  footerBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});