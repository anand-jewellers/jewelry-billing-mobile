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
  Phone,
  CalendarDays,
  ChevronRight,
  ChevronLeft,
  Sparkles,
} from 'lucide-react-native';
import { CalendarModal } from '../../../src/components/ui/DateFilter';
import { colors, spacing } from '../../../src/theme';
import { listCustomers, CustomerListItem } from '../../../src/lib/api/customers';

const PAGE_SIZE = 15;

function invoiceSortValue(invoiceNumber: string | null | undefined): number | null {
  if (!invoiceNumber) return null;
  const matches = invoiceNumber.match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  return parseInt(matches[matches.length - 1], 10);
}

function compareByInvoiceNumber(a: CustomerListItem, b: CustomerListItem): number {
  const aValue = invoiceSortValue(a.latest_invoice_number);
  const bValue = invoiceSortValue(b.latest_invoice_number);

  if (aValue === null && bValue === null) return 0;
  if (aValue === null) return 1;
  if (bValue === null) return -1;

  return bValue - aValue;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shortDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

const AVATAR_PALETTES = [
  { bg: '#E0F2FE', text: '#0284C7' },
  { bg: '#F3E8FF', text: '#9333EA' },
  { bg: '#FEF3C7', text: '#D97706' },
  { bg: '#FFE4E6', text: '#E11D48' },
  { bg: '#DCFCE7', text: '#16A34A' },
  { bg: '#FCE7F3', text: '#DB2777' },
];

function getAvatarColors(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[index];
}

export default function CustomerListScreen() {
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // Date range filter states
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tempStart, setTempStart] = useState<Date | undefined>(undefined);
  const [tempEnd, setTempEnd] = useState<Date | undefined>(undefined);

  const load = useCallback((q: string, start: Date | null, end: Date | null) => {
    setLoading(true);
    setError(null);
    setCurrentPage(1);
    listCustomers({
      search: q,
      fromDate: start ? toISODate(start) : undefined,
      toDate: end ? toISODate(end) : undefined,
    })
      .then(setCustomers)
      .catch(() => setError('Could not load customers.'))
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

  const sortedCustomers = useMemo(
    () => [...customers].sort(compareByInvoiceNumber),
    [customers]
  );

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(sortedCustomers.length / PAGE_SIZE));

  const paginatedCustomers = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return sortedCustomers.slice(startIndex, startIndex + PAGE_SIZE);
  }, [sortedCustomers, currentPage]);

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
      {/* Header Section: Title & Subtitle + Ring & Quote Graphic */}
      <View style={styles.headerSection}>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Customers</Text>
          <Text style={styles.headerSubtitle}>Manage your customers and their invoices</Text>
        </View>

        <View style={styles.quoteGraphicContainer}>
          {/* Linked Rings Graphic with Sparkles */}
          <View style={styles.ringGraphic}>
            <View style={styles.ringBandFront} />
            <View style={styles.ringBandBack} />
            <Sparkles size={11} color="#EAB308" style={styles.sparkleOne} />
            <Sparkles size={8} color="#FACC15" style={styles.sparkleTwo} />
          </View>

          {/* Golden Cursive Quote */}
          <View style={styles.quoteTextWrap}>
            <Text style={styles.quoteLine1}>Our Customers</Text>
            <Text style={styles.quoteLine2}>Our Value</Text>
            <View style={styles.goldSeparator}>
              <View style={styles.goldLine} />
              <View style={styles.goldGemDot} />
              <View style={styles.goldLine} />
            </View>
          </View>
        </View>
      </View>

      {/* Filter Toolbar */}
      <View style={styles.toolbar}>
        <View style={styles.searchBar}>
          <Search size={18} color="#94A3B8" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, phone or invoice no."
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

      {/* Active Range Pill */}
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

      {/* Customer List */}
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={paginatedCustomers}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={({ item }) => {
            const avatarColor = getAvatarColors(item.name || 'C');
            const initial = (item.name?.trim()?.[0] || 'C').toUpperCase();

            return (
              <Pressable
                style={styles.customerCard}
                onPress={() => router.push(`/customers/${item.id}`)}
              >
                {/* Avatar */}
                <View style={[styles.avatarCircle, { backgroundColor: avatarColor.bg }]}>
                  <Text style={[styles.avatarText, { color: avatarColor.text }]}>
                    {initial}
                  </Text>
                </View>

                {/* Info */}
                <View style={styles.infoCol}>
                  <Text style={styles.customerName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View style={styles.metaRow}>
                    <Phone size={13} color="#94A3B8" />
                    <Text style={styles.phoneText}>
                      {item.phone ?? 'No phone'}
                    </Text>
                  </View>
                </View>

                {/* Invoice Metadata */}
                <View style={styles.invoiceCol}>
                  {item.latest_invoice_number ? (
                    <>
                      <Text style={styles.invoiceNumber} numberOfLines={1}>
                        {item.latest_invoice_number}
                      </Text>
                      <View style={styles.metaRowEnd}>
                        <CalendarDays size={13} color="#94A3B8" />
                        <Text style={styles.dateText}>
                          {item.latest_invoice_date ?? '—'}
                        </Text>
                      </View>
                    </>
                  ) : (
                    <Text style={styles.noInvoiceText}>No invoices</Text>
                  )}
                </View>

                <ChevronRight size={18} color="#94A3B8" style={styles.chevron} />
              </Pressable>
            );
          }}
          ListFooterComponent={
            sortedCustomers.length > 0 ? (
              <View style={styles.paginationContainer}>
                <Pressable
                  style={[styles.pageButton, currentPage === 1 && styles.pageButtonDisabled]}
                  onPress={handlePrevPage}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft size={16} color={currentPage === 1 ? '#CBD5E1' : '#0F172A'} />
                  <Text style={[styles.pageButtonText, currentPage === 1 && styles.pageButtonTextDisabled]}>
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
                  style={[styles.pageButton, currentPage === totalPages && styles.pageButtonDisabled]}
                  onPress={handleNextPage}
                  disabled={currentPage === totalPages}
                >
                  <Text style={[styles.pageButtonText, currentPage === totalPages && styles.pageButtonTextDisabled]}>
                    Next
                  </Text>
                  <ChevronRight size={16} color={currentPage === totalPages ? '#CBD5E1' : '#0F172A'} />
                </Pressable>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {hasFilters
                ? 'No customers match your filters.'
                : 'No customers yet. Customers are created automatically when you save an invoice.'}
            </Text>
          }
        />
      )}
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
    width: 42,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  ringBandFront: {
    width: 25,
    height: 25,
    borderRadius: 12.5,
    borderWidth: 3,
    borderColor: '#EAB308',
    backgroundColor: 'transparent',
    position: 'absolute',
    left: 2,
    top: 6,
    zIndex: 2,
  },
  ringBandBack: {
    width: 25,
    height: 25,
    borderRadius: 12.5,
    borderWidth: 3,
    borderColor: '#FACC15',
    backgroundColor: 'transparent',
    position: 'absolute',
    right: 3,
    top: 4,
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
    bottom: 2,
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
    paddingBottom: spacing.xxl,
  },
  customerCard: {
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
  avatarCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
  },
  infoCol: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  customerName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  phoneText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '400',
  },
  invoiceCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: 8,
  },
  invoiceNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  metaRowEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  dateText: {
    fontSize: 12,
    color: '#64748B',
  },
  noInvoiceText: {
    fontSize: 12,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  chevron: {
    marginLeft: 6,
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