import { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Card, SummaryCard, Button } from '../../src/components/ui';
import { DateFilter, DateFilterValue } from '../../src/components/ui/DateFilter';
import { colors, spacing } from '../../src/theme';
import { listMetals, listPurities, listCurrentRates } from '../../src/lib/api/settings';
import { getDashboardSummary } from '../../src/lib/api/invoices';
import { resolveRange, getSalesReport, ReportSummary } from '../../src/lib/api/reports';
import { downloadSalesReportPdf } from '../../src/lib/pdfReport';
import type { Metal, Purity, CurrentMetalRate } from '../../src/types/settings';
import { PaymentBreakdownChart } from '../../src/components/ui/PaymentBreakdownChart';

const RATE_ROWS: { label: string; metalMatch: string; purityMatch: string }[] = [
  { label: '24K Gold', metalMatch: 'gold', purityMatch: '24k' },
  { label: '22K Gold', metalMatch: 'gold', purityMatch: '22k' },
  { label: '18K Gold', metalMatch: 'gold', purityMatch: '18k' },
  { label: 'Silver', metalMatch: 'silver', purityMatch: '999' },
];

export default function DashboardScreen() {
  const router = useRouter();

  // ---- Gold rate strip ----
  const [metals, setMetals] = useState<Metal[]>([]);
  const [purities, setPurities] = useState<Purity[]>([]);
  const [rates, setRates] = useState<CurrentMetalRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(true);
  const [ratesError, setRatesError] = useState<string | null>(null);

  // ---- Static counts, not date-dependent ----
  const [totalCustomers, setTotalCustomers] = useState(0);
  const [totalProducts, setTotalProducts] = useState(0);

  // ---- Date filter drives everything below ----
  const [filter, setFilter] = useState<DateFilterValue>({ mode: 'today' });
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const loadRates = useCallback(() => {
    setRatesLoading(true);
    Promise.all([listMetals(), listPurities(), listCurrentRates()])
      .then(([m, p, r]) => {
        setMetals(m);
        setPurities(p);
        setRates(r);
        setRatesError(null);
      })
      .catch(() => setRatesError('Could not load gold rates.'))
      .finally(() => setRatesLoading(false));
  }, []);

  const loadCounts = useCallback(() => {
    getDashboardSummary()
      .then((s) => {
        setTotalCustomers(s.totalCustomers);
        setTotalProducts(s.totalProducts);
      })
      .catch(() => {
        // non-critical, leave counts as-is
      });
  }, []);

  const loadReport = useCallback((value: DateFilterValue) => {
    setReportLoading(true);
    const range = resolveRange(value);
    getSalesReport(range)
      .then((r) => {
        setReport(r);
        setReportError(null);
      })
      .catch((e) => setReportError(e.message ?? 'Could not load dashboard data.'))
      .finally(() => setReportLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRates();
      loadCounts();
      loadReport(filter);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadRates, loadCounts, loadReport])
  );

  function handleFilterChange(value: DateFilterValue) {
    setFilter(value);
    loadReport(value);
  }

  async function handleDownload() {
    if (!report) return;
    setDownloading(true);
    try {
      await downloadSalesReportPdf(report);
    } catch (e: any) {
      setReportError(e.message ?? 'Could not generate PDF.');
    } finally {
      setDownloading(false);
    }
  }

  function findRateValue(metalMatch: string, purityMatch: string): string {
    const metal = metals.find((m) => m.name.toLowerCase().includes(metalMatch));
    if (!metal) return '—';
    const purity = purityMatch
      ? purities.find((p) => p.metal_id === metal.id && p.name.toLowerCase().includes(purityMatch))
      : purities.find((p) => p.metal_id === metal.id);
    if (!purity) return '—';
    const rate = rates.find((r) => r.metal_id === metal.id && r.purity_id === purity.id);
    if (!rate) return '—';
    return `₹${rate.rate_per_gram.toLocaleString('en-IN')}/g`;
  }

  const goldRates = RATE_ROWS.map((row) => ({
    label: row.label,
    value: findRateValue(row.metalMatch, row.purityMatch),
  }));

  const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingTop: spacing.lg, paddingBottom: spacing.xxl }}>
      {/* Filter sits at the top and drives every card below it */}
      <DateFilter value={filter} onChange={handleFilterChange} />

      {reportError && <Text style={styles.errorText}>{reportError}</Text>}

      <View style={styles.grid}>
        <SummaryCard label="Sales" value={reportLoading ? '…' : inr(report?.totalSales ?? 0)} tone="primary" />
        <SummaryCard label="Invoices" value={reportLoading ? '…' : String(report?.totalInvoices ?? 0)} />
        <SummaryCard label="Customers" value={String(totalCustomers)} />
        <SummaryCard label="Products" value={String(totalProducts)} />
        <SummaryCard label="Pending Payments" value={reportLoading ? '…' : inr(report?.totalPending ?? 0)} tone="gold" />
        <SummaryCard label="Collection" value={reportLoading ? '…' : inr(report?.totalCollected ?? 0)} tone="primary" />
      </View>

      <Text style={styles.sectionTitle}>Jewel Rate</Text>
      <Card style={styles.ratesCard}>
        {ratesLoading ? (
          <Text style={styles.emptyText}>Loading rates…</Text>
        ) : ratesError ? (
          <Text style={styles.errorText}>{ratesError}</Text>
        ) : (
          goldRates.map((rate) => (
            <View key={rate.label} style={styles.rateRow}>
              <Text style={styles.rateLabel}>{rate.label}</Text>
              <Text style={styles.rateValue}>{rate.value}</Text>
            </View>
          ))
        )}
      </Card>

      <Text style={styles.sectionTitle}>Payment Breakdown</Text>
      <Card style={styles.ratesCard}>
        {reportLoading ? (
          <Text style={styles.emptyText}>Loading…</Text>
        ) : (
          <PaymentBreakdownChart data={report?.paymentBreakdown ?? []} />
        )}
      </Card>

      {/* <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsRow}>
        <View style={styles.actionButton}>
          <Button label="New Invoice" variant="primary" onPress={() => router.push('/invoices/new')} />
        </View>
        <View style={styles.actionButton}>
          <Button label="Add Product" variant="outline" onPress={() => router.push('/products/add')} />
        </View>
      </View>
      <View style={styles.actionsRow}>
        <View style={styles.actionButton}>
          <Button label="View Invoices" variant="outline" onPress={() => router.push('/invoices')} />
        </View>
      </View>

      <Text style={styles.sectionTitle}>
        {report ? `Invoices — ${report.range.label}` : 'Recent Invoices'}
      </Text>
      <Card style={styles.ratesCard}>
        {reportLoading ? (
          <Text style={styles.emptyText}>Loading…</Text>
        ) : report && report.invoices.length > 0 ? (
          report.invoices.slice(0, 5).map((inv) => (
            <View key={inv.id} style={styles.rateRow}>
              <View>
                <Text style={styles.rateLabel}>{inv.invoice_number}</Text>
                <Text style={styles.emptyText}>{inv.customer_name}</Text>
              </View>
              <Text style={styles.rateValue}>{inr(inv.grand_total)}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.emptyText}>No invoices in this period.</Text>
        )}
      </Card> */}

      {/* Download sits at the very bottom, acting on whatever range is selected above */}
      <View style={styles.downloadWrap}>
        <Button
          label={downloading ? 'Generating PDF…' : `Download PDF (${report?.range.label ?? ''})`}
          variant="primary"
          onPress={handleDownload}
          disabled={downloading || reportLoading || !report || report.totalInvoices === 0}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
  ratesCard: { marginHorizontal: spacing.lg },
  rateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  rateLabel: { fontSize: 13, color: colors.textSecondary },
  rateValue: { fontSize: 14, fontWeight: '700', color: colors.gold },
  actionsRow: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  actionButton: { flex: 1 },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md },
  errorText: { fontSize: 13, color: colors.error, textAlign: 'center', paddingVertical: spacing.md },
  downloadWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
});