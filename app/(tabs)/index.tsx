import { useCallback, useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Card, SummaryCard, Button } from '../../src/components/ui';
import { DateFilter, DateFilterValue } from '../../src/components/ui/DateFilter';
import { colors, spacing } from '../../src/theme';
import { listMetals, listPurities, listCurrentRates } from '../../src/lib/api/settings';
import { getDashboardSummary } from '../../src/lib/api/invoices';
import { resolveRange, getSalesReport, ReportSummary } from '../../src/lib/api/reports';
import { getTodayPanchangam, PanchangamDay } from '../../src/lib/api/panchangam';
import { downloadSalesReportPdf } from '../../src/lib/pdfReport';
import type { Metal, Purity, CurrentMetalRate } from '../../src/types/settings';
import { PaymentBreakdownChart } from '../../src/components/ui/PaymentBreakdownChart';

const RATE_ROWS: { label: string; metalMatch: string; purityMatch: string }[] = [
  { label: '24K Gold', metalMatch: 'gold', purityMatch: '24k' },
  { label: '22K Gold', metalMatch: 'gold', purityMatch: '22k' },
  { label: '18K Gold', metalMatch: 'gold', purityMatch: '18k' },
  { label: 'Silver', metalMatch: 'silver', purityMatch: '999' },
];

function getIndianDateTimeLabel(): { date: string; time: string } {
  const now = new Date();
  
  const day = now.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit' });
  const month = now.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', month: 'short' });
  const year = now.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric' });
  const date = `${day}-${month}-${year}`;

  const time = now
    .toLocaleTimeString('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
    .toLowerCase();

  return { date, time };
}

export default function DashboardScreen() {
  const router = useRouter();

  // ---- Real-time IST Clock ----
  const [istDateTime, setIstDateTime] = useState(getIndianDateTimeLabel());

  useEffect(() => {
    const timer = setInterval(() => {
      setIstDateTime(getIndianDateTimeLabel());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // ---- Gold rate strip ----
  const [metals, setMetals] = useState<Metal[]>([]);
  const [purities, setPurities] = useState<Purity[]>([]);
  const [rates, setRates] = useState<CurrentMetalRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(true);
  const [ratesError, setRatesError] = useState<string | null>(null);

  // ---- Static counts, not date-dependent ----
  const [totalCustomers, setTotalCustomers] = useState(0);
  const [totalProducts, setTotalProducts] = useState(0);

  // ---- Panchangam — always "today", never affected by the filter below ----
  const [panchangam, setPanchangam] = useState<PanchangamDay | null>(null);
  const [panchangamLoading, setPanchangamLoading] = useState(true);
  const [panchangamError, setPanchangamError] = useState<string | null>(null);

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

  const loadPanchangam = useCallback(() => {
    setPanchangamLoading(true);
    getTodayPanchangam()
      .then((p) => {
        setPanchangam(p);
        setPanchangamError(null);
      })
      .catch(() => setPanchangamError('Could not load panchangam.'))
      .finally(() => setPanchangamLoading(false));
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
      loadPanchangam();
      loadReport(filter);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadRates, loadCounts, loadPanchangam, loadReport])
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
      {/* Filter sits at the top and drives every card below it (except Panchangam) */}
      <DateFilter value={filter} onChange={handleFilterChange} />

      {reportError && <Text style={styles.errorText}>{reportError}</Text>}

      <View style={styles.grid}>
        <SummaryCard icon="cash-outline" label="Sales" value={reportLoading ? '…' : inr(report?.totalSales ?? 0)} tone="primary" />
        <SummaryCard icon="receipt-outline" label="Invoices" value={reportLoading ? '…' : String(report?.totalInvoices ?? 0)} tone="primary" />
        <SummaryCard icon="people-outline" label="Customers" value={String(totalCustomers)} tone="primary" />
        <SummaryCard icon="diamond-outline" label="Products" value={String(totalProducts)} tone="primary" />
        <SummaryCard icon="time-outline" label="Pending Payments" value={reportLoading ? '…' : inr(report?.totalPending ?? 0)} tone="primary" />
        <SummaryCard icon="checkmark-circle-outline" label="Collection" value={reportLoading ? '…' : inr(report?.totalCollected ?? 0)} tone="primary" />
      </View>

      {/* Jewel Rate Header with Live Indicator */}
      <View style={styles.ratesHeader}>
        <Text style={styles.sectionTitle}>Jewel Rate</Text>
        <View style={styles.liveIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>Live</Text>
        </View>
      </View>

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

      {/* Panchangam — date and real-time IST placed directly next to each other */}
      <View style={styles.panchangamHeader}>
        <Text style={styles.sectionTitle}>
          Panchangam · {istDateTime.date} - {istDateTime.time}
        </Text>
      </View>

      <Card style={styles.ratesCard}>
        {panchangamLoading ? (
          <Text style={styles.emptyText}>Loading…</Text>
        ) : panchangamError ? (
          <Text style={styles.errorText}>{panchangamError}</Text>
        ) : !panchangam ? (
          <Text style={styles.emptyText}>No panchangam entry for today.</Text>
        ) : (
          <>
            {(panchangam.tithi || panchangam.nakshatra) && (
              <View style={styles.rateRow}>
                <Text style={styles.rateLabel}>
                  {panchangam.tithi ?? '—'}
                  {panchangam.nakshatra ? ` · ${panchangam.nakshatra}` : ''}
                </Text>
              </View>
            )}
            {panchangam.goodTimes.map((period, i) => (
              <View key={`good-${i}`} style={styles.rateRow}>
                <Text style={[styles.rateLabel, styles.goodLabel]}>{period.label}</Text>
                <Text style={styles.rateValue}>
                  {period.start} – {period.end}
                </Text>
              </View>
            ))}
            {panchangam.badTimes.map((period, i) => (
              <View key={`bad-${i}`} style={styles.rateRow}>
                <Text style={[styles.rateLabel, styles.badLabel]}>{period.label}</Text>
                <Text style={styles.rateValue}>
                  {period.start} – {period.end}
                </Text>
              </View>
            ))}
            {panchangam.goodTimes.length === 0 && panchangam.badTimes.length === 0 && (
              <Text style={styles.emptyText}>No timing details added for today.</Text>
            )}
          </>
        )}
      </Card>

      <View style={styles.panchangamHeader}>
        <Text style={styles.sectionTitle}>Payment Breakdown</Text>
      </View>

      <Card style={styles.ratesCard}>
        {reportLoading ? (
          <Text style={styles.emptyText}>Loading…</Text>
        ) : (
          <PaymentBreakdownChart data={report?.paymentBreakdown ?? []} />
        )}
      </Card>

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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  ratesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  panchangamHeader: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E6F4EA',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#1E8E3E',
  },
  liveText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E8E3E',
  },
  ratesCard: { marginHorizontal: spacing.lg },
  rateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rateLabel: { fontSize: 13, color: colors.textSecondary },
  rateValue: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  goodLabel: { color: '#1E8E3E', fontWeight: '600' },
  badLabel: { color: '#B00020', fontWeight: '600' },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md },
  errorText: { fontSize: 13, color: colors.error, textAlign: 'center', paddingVertical: spacing.md },
  downloadWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
});