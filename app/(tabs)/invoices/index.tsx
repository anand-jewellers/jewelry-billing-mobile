import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import {
  Search,
  Calendar,
  X,
  CalendarDays,
  FileText,
  Footprints,
  ChevronRight,
  ChevronLeft,
  Check,
  Plus,
  Sparkles,
} from 'lucide-react-native';
import { CalendarModal } from '../../../src/components/ui/DateFilter';
import { colors, spacing } from '../../../src/theme';
import { listInvoices, type InvoiceListItem } from '../../../src/lib/api/invoices';

const PAGE_SIZE = 15;

function money(n: number): string {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shortDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function formatInvoiceDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const BADGE_PALETTES = [
  { bg: '#FFF7ED', icon: '#EA580C' },
  { bg: '#EFF6FF', icon: '#2563EB' },
  { bg: '#FDF2F8', icon: '#DB2777' },
  { bg: '#F0FDF4', icon: '#16A34A' },
  { bg: '#FAF5FF', icon: '#9333EA' },
];

function getBadgeColors(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % BADGE_PALETTES.length;
  return BADGE_PALETTES[index];
}

function getStatusBadgeStyle(status: string) {
  switch (status?.toLowerCase()) {
    case 'paid':
      return { bg: '#E6F4EA', text: '#137333', border: '#CEEAD6' };
    case 'unpaid':
    case 'cancelled':
      return { bg: '#FCE8E6', text: '#C5221F', border: '#FAD2CF' };
    case 'partial':
    case 'pending':
    default:
      return { bg: '#FEF7E0', text: '#B06000', border: '#FEEFC3' };
  }
}

export default function InvoiceListScreen() {
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Pagination
  const [searchText, setSearchText] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Date range filter states
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tempStart, setTempStart] = useState<Date | undefined>(undefined);
  const [tempEnd, setTempEnd] = useState<Date | undefined>(undefined);

  const load = useCallback((search: string, start: Date | null, end: Date | null) => {
    setLoading(true);
    setError(null);
    setCurrentPage(1);
    listInvoices({
      search: search.trim() || undefined,
      fromDate: start ? toISODate(start) : undefined,
      toDate: end ? toISODate(end) : undefined,
    })
      .then(setInvoices)
      .catch(() => setError('Could not load invoices.'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(searchText, rangeStart, rangeEnd);
    }, [load, searchText, rangeStart, rangeEnd])
  );

  const handleSearchChange = (text: string) => {
    setSearchText(text);
    load(text, rangeStart, rangeEnd);
  };

  const openPicker = () => {
    setTempStart(rangeStart ?? undefined);
    setTempEnd(rangeEnd ?? undefined);
    setPickerOpen(true);
  };

  const handleDayPress = (day: Date) => {
    if (!tempStart || (tempStart && tempEnd)) {
      setTempStart(day);
      setTempEnd(undefined);
      return;
    }
    if (day.getTime() < tempStart.getTime()) {
      setTempStart(day);
      setTempEnd(undefined);
      return;
    }
    setTempEnd(day);
  };

  const applyRange = () => {
    const start = tempStart ?? null;
    const end = tempEnd ?? tempStart ?? null;
    setRangeStart(start);
    setRangeEnd(end);
    setPickerOpen(false);
    load(searchText, start, end);
  };

  const clearRange = () => {
    setRangeStart(null);
    setRangeEnd(null);
    setPickerOpen(false);
    load(searchText, null, null);
  };

  const hasRange = rangeStart !== null && rangeEnd !== null;
  const hasFilters = searchText.trim() !== '' || hasRange;

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(invoices.length / PAGE_SIZE));

  const paginatedInvoices = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return invoices.slice(startIndex, startIndex + PAGE_SIZE);
  }, [invoices, currentPage]);

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage((prev) => prev - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage((prev) => prev + 1);
    }
  };

  return (
    <View style={styles.screen}>
      {/* Header Section: Title on left, Quote & Ring on right */}
      <View style={styles.headerSection}>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Invoices</Text>
          <Text style={styles.headerSubtitle}>View and manage all your invoices</Text>
        </View>

        <View style={styles.quoteGraphicContainer}>
          {/* Ring Graphic with Sparkles */}
          <View style={styles.ringGraphic}>
            <View style={styles.diamondCrown} />
            <View style={styles.ringBand} />
            <Sparkles size={11} color="#EAB308" style={styles.sparkleOne} />
            <Sparkles size={8} color="#FACC15" style={styles.sparkleTwo} />
          </View>

          {/* Golden Cursive Quote */}
          <View style={styles.quoteTextWrap}>
            <Text style={styles.quoteLine1}>Every Purchase</Text>
            <Text style={styles.quoteLine2}>A Precious Memory</Text>
            <View style={styles.goldSeparator}>
              <View style={styles.goldLine} />
              <View style={styles.goldGemDot} />
              <View style={styles.goldLine} />
            </View>
          </View>
        </View>
      </View>

      {/* Filter Toolbar: Search Bar + Calendar Button */}
      <View style={styles.toolbar}>
        <View style={styles.searchBar}>
          <Search size={18} color="#94A3B8" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search invoice no. or customer name"
            placeholderTextColor="#94A3B8"
            value={searchText}
            onChangeText={handleSearchChange}
          />
          {searchText.length > 0 && (
            <Pressable onPress={() => handleSearchChange('')} hitSlop={8}>
              <X size={16} color="#94A3B8" />
            </Pressable>
          )}
        </View>

        <Pressable
          style={[styles.calendarButton, hasRange && styles.calendarButtonActive]}
          onPress={openPicker}
        >
          <Calendar size={20} color={hasRange ? colors.primary : '#334155'} />
        </Pressable>
      </View>

      {/* Active Filter Pill */}
      {hasRange && (
        <View style={styles.activeFilterRow}>
          <View style={styles.activeFilterPill}>
            <Text style={styles.activeFilterText}>
              {shortDate(rangeStart as Date)} - {shortDate(rangeEnd as Date)}
            </Text>
            <Pressable onPress={clearRange} hitSlop={8}>
              <X size={14} color="#0F172A" />
            </Pressable>
          </View>
        </View>
      )}

      {/* Date Range Modal */}
      <CalendarModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        mode="range"
        rangeStart={tempStart}
        rangeEnd={tempEnd}
        onDayPress={handleDayPress}
        onApplyRange={applyRange}
        title="Select date range"
        maximumDate={new Date()}
      />

      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Invoice List */}
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={paginatedInvoices}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={({ item }) => {
            const badgeTheme = getBadgeColors(item.invoice_number || item.id);
            const isWalkIn = item.customer_name?.toLowerCase().includes('walk-in');
            const statusTheme = getStatusBadgeStyle(item.payment_status);

            return (
              <Pressable
                style={styles.invoiceCard}
                onPress={() => router.push(`/invoices/${item.id}`)}
              >
                {/* Left Badge Icon */}
                <View style={[styles.iconBox, { backgroundColor: badgeTheme.bg }]}>
                  {isWalkIn ? (
                    <Footprints size={16} color={badgeTheme.icon} />
                  ) : (
                    <FileText size={16} color={badgeTheme.icon} />
                  )}
                </View>

                {/* Middle Information */}
                <View style={styles.infoCol}>
                  <Text style={styles.invoiceNumber} numberOfLines={1}>
                    {item.invoice_number}
                  </Text>

                  {/* Date Metadata */}
                  <View style={styles.metaRowInline}>
                    <View style={styles.metaItem}>
                      <CalendarDays size={13} color="#94A3B8" />
                      <Text style={styles.metaText}>
                        {formatInvoiceDate(item.invoice_date)}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Right: Amount & Payment Status Pill */}
                <View style={styles.rightCol}>
                  <Text style={styles.amountText}>{money(item.grand_total)}</Text>
                  <View
                    style={[
                      styles.statusPill,
                      {
                        backgroundColor: statusTheme.bg,
                        borderColor: statusTheme.border,
                      },
                    ]}
                  >
                    {item.payment_status?.toLowerCase() === 'paid' && (
                      <Check size={11} color={statusTheme.text} strokeWidth={3} />
                    )}
                    <Text style={[styles.statusText, { color: statusTheme.text }]}>
                      {item.payment_status}
                    </Text>
                  </View>
                </View>

                <ChevronRight size={18} color="#94A3B8" style={styles.chevron} />
              </Pressable>
            );
          }}
          ListFooterComponent={
            invoices.length > 0 ? (
              <View style={styles.paginationContainer}>
                <Pressable
                  style={[styles.pageButton, currentPage === 1 && styles.pageButtonDisabled]}
                  onPress={handlePrevPage}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft size={16} color={currentPage === 1 ? '#CBD5E1' : '#0F172A'} />
                  <Text
                    style={[
                      styles.pageButtonText,
                      currentPage === 1 && styles.pageButtonTextDisabled,
                    ]}
                  >
                    Previous
                  </Text>
                </Pressable>

                <View style={styles.pageInfoWrap}>
                  <Text style={styles.pageInfoText}>
                    Page <Text style={styles.pageInfoBold}>{currentPage}</Text> of{' '}
                    <Text style={styles.pageInfoBold}>{totalPages}</Text>
                  </Text>
                </View>

                <Pressable
                  style={[
                    styles.pageButton,
                    currentPage === totalPages && styles.pageButtonDisabled,
                  ]}
                  onPress={handleNextPage}
                  disabled={currentPage === totalPages}
                >
                  <Text
                    style={[
                      styles.pageButtonText,
                      currentPage === totalPages && styles.pageButtonTextDisabled,
                    ]}
                  >
                    Next
                  </Text>
                  <ChevronRight
                    size={16}
                    color={currentPage === totalPages ? '#CBD5E1' : '#0F172A'}
                  />
                </Pressable>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {hasFilters ? 'No invoices match your search.' : 'No invoices yet.'}
            </Text>
          }
        />
      )}

      {/* Floating "+ New Invoice" Button */}
      <View style={styles.fabWrapper}>
        <Pressable
          style={styles.fabButton}
          onPress={() => router.push('/invoices/new')}
        >
          <Plus size={24} color="#FFFFFF" strokeWidth={2.5} />
        </Pressable>
        <Text style={styles.fabLabel}>New Invoice</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  headerSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  headerTitleContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '400',
  },
  quoteGraphicContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 12,
  },
  ringGraphic: {
    width: 38,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  diamondCrown: {
    width: 14,
    height: 14,
    borderRadius: 2,
    backgroundColor: '#FDE047',
    borderWidth: 1.5,
    borderColor: '#CA8A04',
    transform: [{ rotate: '45deg' }],
    position: 'absolute',
    top: 4,
    zIndex: 2,
  },
  ringBand: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 3,
    borderColor: '#EAB308',
    backgroundColor: 'transparent',
    marginTop: 10,
    zIndex: 1,
  },
  sparkleOne: {
    position: 'absolute',
    top: 0,
    right: -2,
    zIndex: 3,
  },
  sparkleTwo: {
    position: 'absolute',
    bottom: 4,
    left: -2,
    zIndex: 3,
  },
  quoteTextWrap: {
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  quoteLine1: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400E',
    fontStyle: 'italic',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  quoteLine2: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B45309',
    fontStyle: 'italic',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  goldSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
    width: '100%',
  },
  goldLine: {
    height: 1,
    flex: 1,
    backgroundColor: '#F59E0B',
    opacity: 0.6,
  },
  goldGemDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#D97706',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 48,
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    padding: 0,
  },
  calendarButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  calendarButtonActive: {
    borderColor: colors.primary,
    backgroundColor: '#FFFBEB',
  },
  activeFilterRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    marginTop: 10,
  },
  activeFilterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  activeFilterText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 100,
  },
  invoiceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCol: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  invoiceNumber: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  metaRowInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  metaText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '400',
  },
  rightCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: 8,
  },
  amountText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  chevron: {
    marginLeft: 8,
  },
  paginationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  pageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  pageButtonDisabled: {
    backgroundColor: '#F8FAFC',
    borderColor: '#F1F5F9',
    elevation: 0,
    shadowOpacity: 0,
  },
  pageButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  pageButtonTextDisabled: {
    color: '#CBD5E1',
  },
  pageInfoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageInfoText: {
    fontSize: 13,
    color: '#64748B',
  },
  pageInfoBold: {
    fontWeight: '700',
    color: '#0F172A',
  },
  fabWrapper: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    alignItems: 'center',
  },
  fabButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1E3A8A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1E3A8A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  fabLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1E3A8A',
    marginTop: 3,
  },
  errorText: {
    fontSize: 13,
    color: colors.error,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  emptyText: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    padding: spacing.xl,
  },
});