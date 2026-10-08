// app/(tabs)/index.tsx
import { useCallback, useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card, Button } from '../../src/components/ui';
import { DateFilter, DateFilterValue } from '../../src/components/ui/DateFilter';
import { colors, spacing } from '../../src/theme';
import { listMetals, listPurities, listCurrentRates } from '../../src/lib/api/settings';
import { getDashboardSummary } from '../../src/lib/api/invoices';
import { resolveRange, getSalesReport, ReportSummary } from '../../src/lib/api/reports';
import { downloadSalesReportPdf } from '../../src/lib/pdfReport';
import type { Metal, Purity, CurrentMetalRate } from '../../src/types/settings';
import { PaymentBreakdownChart } from '../../src/components/ui/PaymentBreakdownChart';
import { PageGuard } from '../../src/components/PageGuard';

// ---- Navigation targets (change these if your routes are named differently) ----
const ROUTE_INVOICES = '/invoices';
const ROUTE_CUSTOMERS = '/customers';
const ROUTE_PRODUCTS = '/products';
const ROUTE_NEW_INVOICE = '/invoices/new'; // new invoice screen (opens scanner when scan=1)
const ROUTE_ADD_PRODUCT = '/products/add'; // add product screen

const RATE_ROWS: { label: string; metalMatch: string; purityMatch: string }[] = [
  { label: '24K Gold', metalMatch: 'gold', purityMatch: '24k' },
  { label: '22K Gold', metalMatch: 'gold', purityMatch: '22k' },
  { label: '18K Gold', metalMatch: 'gold', purityMatch: '18k' },
  { label: '925 Silver', metalMatch: 'silver', purityMatch: '925' },
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

// Exported screen: only renders the dashboard (and runs its data fetching)
// when the user has the 'dashboard' permission.
export default function DashboardScreen() {
  return (
    <PageGuard pageKey="dashboard">
      <DashboardScreenInner />
    </PageGuard>
  );
}

const NAVY = '#12337A'; // value / icon colour - change to match your theme if needed

type StatCardProps = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  compact?: boolean; // true on desktop/tablet -> shorter card
  onPress?: () => void; // tap the card to open the matching screen
};

// Card whose number auto-shrinks as it gets longer (works on web + native).
// Tapping the card navigates to its screen.
function StatCard({ icon, label, value, compact, onPress }: StatCardProps) {
  const [valueWidth, setValueWidth] = useState(0);

  const maxSize = compact ? 22 : 26;
  const minSize = 12;
  // average bold digit is ~0.62em wide, so fit the text into the available width
  const fitted = valueWidth > 0 ? Math.floor(valueWidth / (Math.max(value.length, 1) * 0.62)) : maxSize;
  const fontSize = Math.max(minSize, Math.min(maxSize, fitted));

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${label}`}
      style={({ pressed }) => [pressed && styles.cardPressed]}
    >
      <Card style={[styles.statCard, compact && styles.statCardCompact]}>
        <View style={styles.statHeader}>
          <View style={styles.statIconWrap}>
            <Ionicons name={icon} size={16} color={NAVY} />
          </View>
          <Text style={styles.statLabel} numberOfLines={1}>
            {label}
          </Text>
          {onPress && <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />}
        </View>
        <View style={styles.statValueWrap} onLayout={(e) => setValueWidth(e.nativeEvent.layout.width)}>
          <Text
            style={[styles.statValue, { fontSize }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {value}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

type QuickActionProps = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  variant?: 'solid' | 'outline';
};

function QuickAction({ icon, label, onPress, variant = 'solid' }: QuickActionProps) {
  const solid = variant === 'solid';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.quickBtn,
        solid ? styles.quickBtnSolid : styles.quickBtnOutline,
        pressed && styles.cardPressed,
      ]}
    >
      <Ionicons name={icon} size={20} color={solid ? '#fff' : colors.primary} />
      <Text style={[styles.quickBtnText, { color: solid ? '#fff' : colors.primary }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function DashboardScreenInner() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isSideBySide = width >= 768;

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
    }, [loadRates, loadCounts, loadReport, filter])
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

  const go = (route: string) => router.push(route as never);

  // ---- Quick actions ----

  // Opens the new invoice screen and tells it to launch the barcode scanner
  // immediately. `ts` makes the params unique on every tap so the invoice
  // screen reacts even if it is already mounted.
  const openScanner = () =>
    router.push({
      pathname: ROUTE_NEW_INVOICE,
      params: { scan: '1', ts: String(Date.now()) },
    } as never);

  // Opens the add product screen directly.
  const openAddProduct = () => router.push(ROUTE_ADD_PRODUCT as never);

  // ---- Summary cards (rendered in a 2-column grid on every device) ----
  // `route` is where the card takes the user when tapped.
  const summaryCards = [
    {
      icon: 'cash-outline',
      label: 'Sales',
      value: reportLoading ? '…' : inr(report?.totalSales ?? 0),
      route: ROUTE_INVOICES,
    },
    {
      icon: 'receipt-outline',
      label: 'Invoices',
      value: reportLoading ? '…' : String(report?.totalInvoices ?? 0),
      route: ROUTE_INVOICES,
    },
    {
      icon: 'people-outline',
      label: 'Customers',
      value: String(totalCustomers),
      route: ROUTE_CUSTOMERS,
    },
    {
      icon: 'diamond-outline',
      label: 'Products',
      value: String(totalProducts),
      route: ROUTE_PRODUCTS,
    },
    {
      icon: 'pricetag-outline',
      label: 'Discount',
      value: reportLoading ? '…' : inr(report?.totalDiscount ?? 0),
      route: ROUTE_INVOICES,
    },
    {
      icon: 'checkmark-circle-outline',
      label: 'Collection',
      value: reportLoading ? '…' : inr(report?.totalCollected ?? 0),
      route: ROUTE_INVOICES,
    },
  ];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingTop: spacing.lg, paddingBottom: spacing.xxl }}>
      {/* Filter sits at the top */}
      <DateFilter value={filter} onChange={handleFilterChange} />

      {reportError && <Text style={styles.errorText}>{reportError}</Text>}

      {/* Quick actions */}
      <View style={styles.quickRow}>
        <QuickAction icon="barcode-outline" label="Scan & Bill" onPress={openScanner} />
        <QuickAction
          icon="add-circle-outline"
          label="Add Product"
          variant="outline"
          onPress={openAddProduct}
        />
      </View>

      {/* 2 cards per row on phones (left / right), 3 per row on tablets */}
      <View style={styles.grid}>
        {summaryCards.map((item) => (
          <View key={item.label} style={[styles.gridCell, isSideBySide && styles.gridCellTablet]}>
            <StatCard
              icon={item.icon as any}
              label={item.label}
              value={item.value}
              compact={isSideBySide}
              onPress={() => go(item.route)}
            />
          </View>
        ))}
      </View>

      {/* Side-by-side Row: Jewel Rate & Payment Breakdown */}
      <View style={[styles.sideBySideContainer, isSideBySide && styles.sideBySideRow]}>
        {/* Left Column: Jewel Rate */}
        <View style={[styles.columnWrapper, isSideBySide && styles.columnFlex]}>
          <View style={styles.ratesHeader}>
            <View>
              <Text style={styles.sectionTitle}>Jewel Rate</Text>
              <Text style={styles.sectionSubtitle}>
                {istDateTime.date} · {istDateTime.time}
              </Text>
            </View>
            <View style={styles.liveIndicator}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live</Text>
            </View>
          </View>

          <Card style={[styles.ratesCard, styles.matchedCard]}>
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
        </View>

        {/* Right Column: Payment Breakdown */}
        <View style={[styles.columnWrapper, isSideBySide && styles.columnFlex]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Payment Breakdown</Text>
          </View>

          <Card style={[styles.ratesCard, styles.matchedCard, styles.chartCardAlign]}>
            {reportLoading ? (
              <Text style={styles.emptyText}>Loading…</Text>
            ) : (
              <PaymentBreakdownChart data={report?.paymentBreakdown ?? []} />
            )}
          </Card>
        </View>
      </View>

      {/* Download PDF */}
      <View style={styles.downloadWrap}>
        <Button
          label={downloading ? 'Generating PDF…' : `Download PDF`}
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

  // Quick actions
  quickRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  quickBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  quickBtnSolid: { backgroundColor: colors.primary },
  quickBtnOutline: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  quickBtnText: { fontSize: 15, fontWeight: '700' },

  // Pressed feedback for tappable cards / buttons
  cardPressed: { opacity: 0.7 },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between', // left card / right card
    rowGap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  gridCell: {
    width: '48%', // always 2 per row, on every phone size
  },
  gridCellTablet: {
    width: '32%', // 3 per row on tablets / desktop
  },
  statCard: {
    marginHorizontal: 0,
    padding: spacing.md,
    minHeight: 96,
    justifyContent: 'space-between',
  },
  statCardCompact: {
    minHeight: 100,
    paddingVertical: spacing.sm,
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF1F8',
  },
  statLabel: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
  },
  statValueWrap: {
    width: '100%',
    marginTop: spacing.sm,
  },
  statValue: {
    fontWeight: '700',
    color: NAVY,
  },
  sideBySideContainer: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    flexDirection: 'column',
    gap: spacing.lg,
  },
  sideBySideRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  columnWrapper: {
    width: '100%',
  },
  columnFlex: {
    flex: 1,
  },
  ratesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    minHeight: 38,
  },
  sectionHeader: {
    justifyContent: 'center',
    marginBottom: spacing.sm,
    minHeight: 38,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
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
  ratesCard: {
    marginHorizontal: 0,
  },
  matchedCard: {
    flex: 1,
    justifyContent: 'center',
  },
  chartCardAlign: {
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md },
  errorText: { fontSize: 13, color: colors.error, textAlign: 'center', paddingVertical: spacing.md },
  downloadWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
});