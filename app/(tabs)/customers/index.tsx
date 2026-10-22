// app\(tabs)\customers\index.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { PageGuard } from '../../../src/components/PageGuard';
import {
  Search,
  Calendar,
  X,
  Phone,
  CalendarDays,
  ChevronRight,
  ChevronLeft,
  Plus,
  ClipboardList,
} from 'lucide-react-native';
import { CalendarModal } from '../../../src/components/ui/DateFilter';
import { colors, spacing } from '../../../src/theme';
import { listCustomers, CustomerListItem } from '../../../src/lib/api/customers';
import type { OrderStatus } from '../../../src/lib/api/customerOrders';

const PAGE_SIZE = 15;
const SEARCH_DEBOUNCE_MS = 300;

const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  ready: 'Ready',
  completed: 'Delivered',
};

const ORDER_STATUS_COLOR: Record<OrderStatus, string> = {
  pending: '#D97706',
  ready: '#0284C7',
  completed: '#16A34A',
};

// Builds YYYY-MM-DD from LOCAL date parts (not UTC), so "today" in IST
// doesn't shift to yesterday's date the way toISOString() would.
function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function ItemSeparator() {
  return <View style={{ height: 12 }} />;
}

export default function CustomerListScreen() {
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // Date range filter states — default is always today's date (local time)
  const [rangeStart, setRangeStart] = useState<Date | null>(new Date());
  const [rangeEnd, setRangeEnd] = useState<Date | null>(new Date());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tempStart, setTempStart] = useState<Date | undefined>(undefined);
  const [tempEnd, setTempEnd] = useState<Date | undefined>(undefined);

  // Always-current copy of the filters, so the focus effect can read them
  // without re-subscribing every time the user types or picks a date.
  const filtersRef = useRef({ searchText, rangeStart, rangeEnd });
  filtersRef.current = { searchText, rangeStart, rangeEnd };

  // Used to ignore responses that arrive after a newer request was fired.
  const requestId = useRef(0);
  // After the first successful load we refresh silently (no full-screen spinner).
  const hasLoadedOnce = useRef(false);
  // Skip the debounced effect on first mount — the focus effect handles that.
  const isFirstRun = useRef(true);

  const load = useCallback(
    (q: string, start: Date | null, end: Date | null, resetPage: boolean) => {
      const id = ++requestId.current;
      if (!hasLoadedOnce.current) setLoading(true);
      setError(null);
      if (resetPage) setCurrentPage(1);

      listCustomers({
        search: q,
        fromDate: start ? toISODate(start) : undefined,
        toDate: end ? toISODate(end) : undefined,
      })
        .then((data) => {
          if (id !== requestId.current) return;
          hasLoadedOnce.current = true;
          setCustomers(data);
        })
        .catch(() => {
          if (id !== requestId.current) return;
          setError('Could not load customers.');
        })
        .finally(() => {
          if (id !== requestId.current) return;
          setLoading(false);
        });
    },
    []
  );

  // Refresh whenever the tab gains focus (e.g. after saving an invoice or
  // completing an order). Silent after the first load, and keeps the page.
  useFocusEffect(
    useCallback(() => {
      const f = filtersRef.current;
      load(f.searchText, f.rangeStart, f.rangeEnd, false);
    }, [load])
  );

  // Debounced reload when the search text or date range changes.
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const t = setTimeout(() => {
      load(searchText, rangeStart, rangeEnd, true);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchText, rangeStart, rangeEnd, load]);

  const handleSearchChange = (text: string) => {
    setSearchText(text);
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
  };

  // Clearing a custom range always falls back to TODAY, never to "everyone".
  const clearRange = () => {
    const today = new Date();
    setRangeStart(today);
    setRangeEnd(today);
    setPickerOpen(false);
  };

  const isDefaultToday =
    rangeStart !== null &&
    rangeEnd !== null &&
    toISODate(rangeStart) === toISODate(new Date()) &&
    toISODate(rangeEnd) === toISODate(new Date());

  const hasRange = rangeStart !== null && rangeEnd !== null;
  const hasFilters = searchText.trim() !== '' || (hasRange && !isDefaultToday);

  // listCustomers() already returns customers pre-sorted (active orders
  // first, then by invoice number), so no local re-sort is needed here.
  const sortedCustomers = customers;

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(sortedCustomers.length / PAGE_SIZE));

  const paginatedCustomers = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return sortedCustomers.slice(startIndex, startIndex + PAGE_SIZE);
  }, [sortedCustomers, currentPage]);

  // If a silent refresh shrinks the list, don't leave the user on a page that no longer exists.
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

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
    <PageGuard pageKey="customers">
      <View style={styles.screen}>
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
            style={[styles.calendarButton, hasRange && !isDefaultToday && styles.calendarButtonActive]}
            onPress={openPicker}
          >
            <Calendar size={20} color={hasRange && !isDefaultToday ? colors.primary : '#334155'} />
          </Pressable>

          <Pressable
            style={styles.calendarButton}
            onPress={() => router.push('/customers/orders' as never)}
            hitSlop={4}
          >
            <ClipboardList size={20} color="#334155" />
          </Pressable>
        </View>

        {/* Active Range Pill */}
        {hasRange && !isDefaultToday && (
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
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={ItemSeparator}
            initialNumToRender={PAGE_SIZE}
            renderItem={({ item }) => {
              const avatarColor = getAvatarColors(item.name || 'C');
              const initial = (item.name?.trim()?.[0] || 'C').toUpperCase();
              const hasActiveOrder =
                item.latest_order_status && item.latest_order_status !== 'completed';

              return (
                <Pressable
                  style={styles.customerCard}
                  onPress={() => router.push(`/customers/${item.id}`)}
                >
                  {/* Avatar */}
                  <View style={[styles.avatarCircle, { backgroundColor: avatarColor.bg }]}>
                    <Text style={[styles.avatarText, { color: avatarColor.text }]}>{initial}</Text>
                  </View>

                  {/* Info */}
                  <View style={styles.infoCol}>
                    <Text style={styles.customerName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <View style={styles.metaRow}>
                      <Phone size={13} color="#94A3B8" />
                      <Text style={styles.phoneText}>{item.phone ?? 'No phone'}</Text>
                    </View>
                  </View>

                  {/* Invoice / Order Metadata */}
                  <View style={styles.invoiceCol}>
                    {hasActiveOrder ? (
                      // Customer has a jewel order in progress — surface it
                      // as a queue item instead of (or ahead of) invoice info.
                      <>
                        <Text style={styles.invoiceNumber} numberOfLines={1}>
                          {item.latest_order_metal ?? 'Jewel Order'}
                        </Text>
                        <View style={styles.metaRowEnd}>
                          <View
                            style={[
                              styles.orderStatusDot,
                              {
                                backgroundColor:
                                  ORDER_STATUS_COLOR[item.latest_order_status as OrderStatus],
                              },
                            ]}
                          />
                          <Text
                            style={[
                              styles.orderStatusText,
                              { color: ORDER_STATUS_COLOR[item.latest_order_status as OrderStatus] },
                            ]}
                          >
                            {ORDER_STATUS_LABEL[item.latest_order_status as OrderStatus]}
                          </Text>
                        </View>
                      </>
                    ) : item.latest_invoice_number ? (
                      <>
                        <Text style={styles.invoiceNumber} numberOfLines={1}>
                          {item.latest_invoice_number}
                        </Text>
                        <View style={styles.metaRowEnd}>
                          <CalendarDays size={13} color="#94A3B8" />
                          <Text style={styles.dateText}>{item.latest_invoice_date ?? '—'}</Text>
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
                {hasFilters
                  ? 'No customers match your filters.'
                  : 'No customers yet. Customers are created automatically when you save an invoice.'}
              </Text>
            }
          />
        )}

        {/* Floating Add Customer button — same pattern as the Products tab */}
        <Pressable style={styles.fab} onPress={() => router.push('/customers/add')} hitSlop={8}>
          <Plus size={26} color="#FFFFFF" />
        </Pressable>
      </View>
    </PageGuard>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F8FAFC',
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
  orderStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  orderStatusText: {
    fontSize: 12,
    fontWeight: '700',
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
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
});