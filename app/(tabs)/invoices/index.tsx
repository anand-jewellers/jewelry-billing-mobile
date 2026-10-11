//app\(tabs)\invoices\index.tsx

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Alert,
  ScrollView,
} from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { PageGuard } from '../../../src/components/PageGuard';
import {
  Search,
  // Calendar,            // date filter disabled - only today's invoices are shown
  X,
  CalendarDays,
  FileText,
  Footprints,
  ChevronRight,
  ChevronLeft,
  Check,
  Plus,
  Clock,
  Trash2,
} from 'lucide-react-native';
// import { CalendarModal } from '../../../src/components/ui/DateFilter'; // date filter disabled
import { colors, spacing } from '../../../src/theme';
import { useStaff } from '../../../src/context/StaffContext';
import {
  listInvoices,
  deleteInvoices,
  type InvoiceListItem,
  type ListInvoicesResult,
} from '../../../src/lib/api/invoices';
import {
  listHeldEstimates,
  deleteHeldEstimate,
  deleteAllHeldEstimates,
  timeLeftText,
  type HeldEstimate,
} from '../../../src/lib/heldEstimates';

// Lives outside the component so it survives navigating away and back.
// Lets the list render instantly from the last result while a fresh
// copy loads in the background (same feel as the products screen).
const listCache = new Map<string, ListInvoicesResult>();

function money(n: number): string {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

// UTC based (kept for the date filter below, which is currently disabled)
// function toISODate(d: Date): string {
//   return d.toISOString().slice(0, 10);
// }

// Today's date in the DEVICE's local time zone (YYYY-MM-DD).
// toISOString() is UTC, which would give "yesterday" between 12:00 AM and
// 5:30 AM in India, so the local parts are used instead.
function getTodayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// function shortDate(d: Date): string {
//   return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
// }

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
  // Today's date. Refreshed whenever the screen gains focus, so if the app
  // stays open past midnight the list rolls over to the new day.
  const [todayISO, setTodayISO] = useState(getTodayISO());

  // Start from the cached first page (if any) so there's no spinner on revisit.
  // Key format must match cacheKey below: search | from | to | page
  const initial = listCache.get(`|${todayISO}|${todayISO}|1`);
  const [invoices, setInvoices] = useState<InvoiceListItem[]>(initial?.rows ?? []);
  const [hasMore, setHasMore] = useState(initial?.hasMore ?? false);
  const [totalPages, setTotalPages] = useState(initial?.totalPages ?? 1);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);

  // Admin + bulk delete (select mode)
  const { currentStaff } = useStaff();
  const isAdmin = currentStaff?.role === 'admin';
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Search & Pagination
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Date range filter states - DISABLED (only today's invoices are shown)
  // const [rangeStart, setRangeStart] = useState<Date | null>(null);
  // const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  // const [pickerOpen, setPickerOpen] = useState(false);
  // const [tempStart, setTempStart] = useState<Date | undefined>(undefined);
  // const [tempEnd, setTempEnd] = useState<Date | undefined>(undefined);

  // Held bills (4-hour temporary estimates)
  const [heldList, setHeldList] = useState<HeldEstimate[]>([]);
  const [heldOpen, setHeldOpen] = useState(false);

  // Debounce typing
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchText.trim());
      setCurrentPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchText]);

  // Ignore stale responses
  const reqId = useRef(0);

  // Always today -> today (replaces the date range filter)
  const fromISO = todayISO;
  const toISO = todayISO;
  // const fromISO = rangeStart ? toISODate(rangeStart) : '';
  // const toISO = rangeEnd ? toISODate(rangeEnd) : '';
  const cacheKey = `${debouncedSearch}|${fromISO}|${toISO}|${currentPage}`;

  // Selection only makes sense for the page/filter currently on screen,
  // so it resets whenever the page, search or date changes.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [cacheKey]);

  const fetchPage = useCallback(async () => {
    const id = ++reqId.current;

    // Show cached data immediately if we have it; otherwise show the spinner.
    const cached = listCache.get(cacheKey);
    if (cached) {
      setInvoices(cached.rows);
      setHasMore(cached.hasMore);
      setTotalPages(cached.totalPages);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      const t0 = Date.now();
      const res = await listInvoices({
        search: debouncedSearch || undefined,
        fromDate: fromISO || undefined,
        toDate: toISO || undefined,
        page: currentPage,
      });
      if (__DEV__) console.log('[invoices] listInvoices ms', Date.now() - t0);

      listCache.set(cacheKey, res);
      if (id !== reqId.current) return;
      setInvoices(res.rows);
      setHasMore(res.hasMore);
      setTotalPages(res.totalPages);
      setError(null);
    } catch {
      if (id === reqId.current) setError('Could not load invoices.');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [cacheKey, debouncedSearch, fromISO, toISO, currentPage]);

  // One fetch whenever a filter or page changes
  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  // Refresh when returning to this screen (e.g. after creating an invoice).
  // Cached rows show instantly, then the fresh copy replaces them.
  // Also re-checks today's date so the list rolls over after midnight.
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      setTodayISO(getTodayISO()); // changes cacheKey (and refetches) only if the day changed
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      fetchRef.current();
    }, [])
  );

  // Held bills: refresh on focus + every 30 seconds (this also permanently
  // deletes anything older than 4 hours).
  const refreshHeld = useCallback(async () => {
    try {
      setHeldList(await listHeldEstimates());
    } catch (e) {
      console.warn('Could not load held bills', e); // keep the last list shown
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshHeld();
      const t = setInterval(refreshHeld, 30 * 1000); // pick up bills held on other devices
      return () => clearInterval(t);
    }, [refreshHeld])
  );

  // ---------------------------------------------------------
  // Date range picker handlers - DISABLED (only today's invoices are shown)
  // ---------------------------------------------------------

  // const openPicker = () => {
  //   setTempStart(rangeStart ?? undefined);
  //   setTempEnd(rangeEnd ?? undefined);
  //   setPickerOpen(true);
  // };

  // const handleDayPress = (day: Date) => {
  //   if (!tempStart || (tempStart && tempEnd)) {
  //     setTempStart(day);
  //     setTempEnd(undefined);
  //     return;
  //   }
  //   if (day.getTime() < tempStart.getTime()) {
  //     setTempStart(day);
  //     setTempEnd(undefined);
  //     return;
  //   }
  //   setTempEnd(day);
  // };

  // const applyRange = () => {
  //   setRangeStart(tempStart ?? null);
  //   setRangeEnd(tempEnd ?? tempStart ?? null);
  //   setCurrentPage(1);
  //   setPickerOpen(false);
  // };

  // const clearRange = () => {
  //   setRangeStart(null);
  //   setRangeEnd(null);
  //   setCurrentPage(1);
  //   setPickerOpen(false);
  // };

  // const hasRange = rangeStart !== null && rangeEnd !== null;
  // const hasFilters = debouncedSearch !== '' || hasRange;
  const hasFilters = debouncedSearch !== '';

  const handlePrevPage = () => {
    if (currentPage > 1) setCurrentPage((p) => p - 1);
  };

  const handleNextPage = () => {
    if (hasMore) setCurrentPage((p) => p + 1);
  };

  // ---------------------------------------------------------
  // Select mode / bulk delete (admin only)
  // ---------------------------------------------------------

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = invoices.length > 0 && invoices.every((i) => selectedIds.has(i.id));

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(invoices.map((i) => i.id)));
  };

  const handleDeleteSelected = () => {
    if (!isAdmin || !currentStaff || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);

    Alert.alert(
      `Delete ${ids.length} invoice${ids.length > 1 ? 's' : ''}?`,
      'The billed products will be marked available again and all details of ' +
        'these invoices (items, charges, payments, exchange) will be permanently ' +
        'removed. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBulkDeleting(true);
            try {
              await deleteInvoices(ids, currentStaff.id);
              listCache.clear(); // cached pages still contain the deleted invoices
              const wholePageGone = ids.length >= invoices.length;
              exitSelectMode();
              if (wholePageGone && currentPage > 1) {
                setCurrentPage((p) => p - 1); // triggers its own fetch
              } else {
                await fetchRef.current();
              }
            } catch (e: any) {
              Alert.alert('Could not delete', e?.message ?? 'Unknown error');
            } finally {
              setBulkDeleting(false);
            }
          },
        },
      ]
    );
  };

  // ---------------------------------------------------------
  // Held bills handlers
  //
  // Not billed yet -> Resume: opens fully editable.
  // Already billed -> Print: opens locked (print only), handled by
  // new.tsx via the saved billedInvoiceNumber.
  // ---------------------------------------------------------

  const openHeld = (h: HeldEstimate) => {
    setHeldOpen(false);
    router.push(`/invoices/new?heldId=${h.id}`);
  };

  const handleDeleteHeld = (h: HeldEstimate) => {
    Alert.alert('Delete held bill?', `${h.label} — ₹${h.grandTotal.toLocaleString('en-IN')}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteHeldEstimate(h.id);
          } catch (e: any) {
            Alert.alert('Could not delete', e?.message ?? 'Unknown error');
          }
          await refreshHeld();
        },
      },
    ]);
  };

  const handleDeleteAllHeld = () => {
    Alert.alert(
      'Delete all held bills?',
      `All ${heldList.length} held bill(s) will be permanently removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete all',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAllHeldEstimates();
            } catch (e: any) {
              Alert.alert('Could not delete', e?.message ?? 'Unknown error');
            }
            await refreshHeld();
          },
        },
      ]
    );
  };

  return (
    <PageGuard pageKey="invoices">
      <View style={styles.screen}>
        {/* Search Bar (the calendar button next to it is disabled below) */}
        <View style={styles.toolbar}>
          <View style={styles.searchBar}>
            <Search size={18} color="#94A3B8" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search invoice no. or customer name"
              placeholderTextColor="#94A3B8"
              value={searchText}
              onChangeText={setSearchText}
            />
            {searchText.length > 0 && (
              <Pressable onPress={() => setSearchText('')} hitSlop={8}>
                <X size={16} color="#94A3B8" />
              </Pressable>
            )}
          </View>

          {/* Date filter button - DISABLED
          <Pressable
            style={[styles.calendarButton, hasRange && styles.calendarButtonActive]}
            onPress={openPicker}
          >
            <Calendar size={20} color={hasRange ? colors.primary : '#334155'} />
          </Pressable>
          */}
        </View>

        {/* Active date filter pill - DISABLED
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
        */}

        {/* Held Bills + Delete buttons */}
        <View style={styles.heldBtnRow}>
          <Pressable
            style={styles.heldBtn}
            onPress={() => {
              refreshHeld();
              setHeldOpen(true);
            }}
          >
            <Clock size={16} color={colors.primary} />
            <Text style={styles.heldBtnText}>Held Bills</Text>
            {heldList.length > 0 && (
              <View style={styles.heldBadge}>
                <Text style={styles.heldBadgeText}>{heldList.length}</Text>
              </View>
            )}
          </Pressable>

          {isAdmin && !selectMode && (
            <Pressable style={styles.deleteModeBtn} onPress={() => setSelectMode(true)}>
              <Trash2 size={16} color="#C5221F" />
              <Text style={styles.deleteModeText}>Delete</Text>
            </Pressable>
          )}
        </View>

        {/* Selection bar (admin, in delete mode) */}
        {isAdmin && selectMode && (
          <View style={styles.selectBar}>
            <Pressable style={styles.selectAllBtn} onPress={toggleSelectAll}>
              <View style={[styles.checkbox, allSelected && styles.checkboxOn]}>
                {allSelected && <Check size={13} color="#FFFFFF" strokeWidth={3} />}
              </View>
              <Text style={styles.selectAllText}>Select All</Text>
            </Pressable>

            <View style={{ flex: 1 }} />

            <Pressable style={styles.cancelBtn} onPress={exitSelectMode} disabled={bulkDeleting}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>

            <Pressable
              style={[styles.confirmDeleteBtn, selectedIds.size === 0 && { opacity: 0.4 }]}
              onPress={handleDeleteSelected}
              disabled={selectedIds.size === 0 || bulkDeleting}
            >
              {bulkDeleting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Trash2 size={15} color="#FFFFFF" />
                  <Text style={styles.confirmDeleteText}>Delete ({selectedIds.size})</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {/* Held Bills list */}
        <Modal
          visible={heldOpen}
          animationType="slide"
          transparent
          onRequestClose={() => setHeldOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Held Bills ({heldList.length})</Text>
                <Pressable onPress={() => setHeldOpen(false)} hitSlop={8}>
                  <X size={22} color="#0F172A" />
                </Pressable>
              </View>

              {heldList.length > 0 && (
                <Pressable style={styles.deleteAllBtn} onPress={handleDeleteAllHeld}>
                  <Trash2 size={16} color="#C5221F" />
                  <Text style={styles.deleteAllText}>Delete All</Text>
                </Pressable>
              )}

              <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
                {heldList.length === 0 ? (
                  <Text style={styles.emptyText}>No held bills.</Text>
                ) : (
                  heldList.map((h) => (
                    <View key={h.id} style={styles.heldCard}>
                      <Pressable style={{ flex: 1 }} onPress={() => openHeld(h)}>
                        <Text style={styles.heldName}>{h.label}</Text>
                        <Text style={styles.heldMeta}>
                          ₹{h.grandTotal.toLocaleString('en-IN')} · {h.data.items.length} item
                          {h.data.items.length > 1 ? 's' : ''} · {timeLeftText(h.expiresAt)}
                        </Text>
                        {h.billedInvoiceNumber ? (
                          <Text style={styles.heldBilled}>
                            ✓ Billed · {h.billedInvoiceNumber} · print only
                          </Text>
                        ) : null}
                      </Pressable>
                      <Pressable style={styles.heldResumeBtn} onPress={() => openHeld(h)}>
                        <Text style={styles.heldResumeText}>
                          {h.billedInvoiceNumber ? 'Print' : 'Resume'}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleDeleteHeld(h)}
                        hitSlop={8}
                        style={{ marginLeft: 10 }}
                      >
                        <Trash2 size={18} color="#94A3B8" />
                      </Pressable>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Date Range Modal - DISABLED
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
        */}

        {error && <Text style={styles.errorText}>{error}</Text>}

        {/* Invoice List (today only) */}
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : (
          <FlatList
            data={invoices}
            extraData={{ selectMode, selectedIds }}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
            renderItem={({ item }) => {
              const badgeTheme = getBadgeColors(item.invoice_number || item.id);
              const isWalkIn = item.customer_name?.toLowerCase().includes('walk-in');
              const statusTheme = getStatusBadgeStyle(item.payment_status);
              const isSelected = selectedIds.has(item.id);

              return (
                <Pressable
                  style={[
                    styles.invoiceCard,
                    selectMode && isSelected && styles.invoiceCardSelected,
                  ]}
                  onPress={() =>
                    selectMode ? toggleSelect(item.id) : router.push(`/invoices/${item.id}`)
                  }
                >
                  {/* Checkbox (select mode only) */}
                  {selectMode && (
                    <View
                      style={[
                        styles.checkbox,
                        { marginRight: 12 },
                        isSelected && styles.checkboxOn,
                      ]}
                    >
                      {isSelected && <Check size={13} color="#FFFFFF" strokeWidth={3} />}
                    </View>
                  )}

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

                  {!selectMode && (
                    <ChevronRight size={18} color="#94A3B8" style={styles.chevron} />
                  )}
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
                    style={[styles.pageButton, !hasMore && styles.pageButtonDisabled]}
                    onPress={handleNextPage}
                    disabled={!hasMore}
                  >
                    <Text
                      style={[
                        styles.pageButtonText,
                        !hasMore && styles.pageButtonTextDisabled,
                      ]}
                    >
                      Next
                    </Text>
                    <ChevronRight size={16} color={!hasMore ? '#CBD5E1' : '#0F172A'} />
                  </Pressable>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {hasFilters ? 'No invoices match your search.' : 'No invoices today.'}
              </Text>
            }
          />
        )}

        {/* Floating "+ New Invoice" Button (hidden while selecting) */}
        {!selectMode && (
          <View style={styles.fabWrapper}>
            <Pressable style={styles.fabButton} onPress={() => router.push('/invoices/new')}>
              <Plus size={24} color="#FFFFFF" strokeWidth={2.5} />
            </Pressable>
            <Text style={styles.fabLabel}>New Invoice</Text>
          </View>
        )}
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
  // Date filter styles - kept for when the date filter is turned back on
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

  // Held bills + delete mode row
  heldBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.lg,
    marginTop: 10,
  },
  heldBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  heldBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  heldBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  heldBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },

  // Delete mode (admin)
  deleteModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FCE8E6',
    borderWidth: 1,
    borderColor: '#FAD2CF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  deleteModeText: { color: '#C5221F', fontWeight: '700', fontSize: 14 },
  selectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.lg,
    marginTop: 10,
  },
  selectAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectAllText: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#C5221F', borderColor: '#C5221F' },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: '#0F172A' },
  confirmDeleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: '#C5221F',
  },
  confirmDeleteText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#F8FAFC',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: spacing.lg,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  deleteAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#FAD2CF',
    backgroundColor: '#FCE8E6',
    borderRadius: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  deleteAllText: { color: '#C5221F', fontWeight: '700', fontSize: 14 },
  heldCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    padding: 12,
    marginBottom: 10,
  },
  heldName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  heldMeta: { fontSize: 12, color: '#64748B', marginTop: 2 },
  heldBilled: { fontSize: 12, fontWeight: '700', color: '#137333', marginTop: 2 },
  heldResumeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    marginLeft: 10,
  },
  heldResumeText: { color: colors.primary, fontWeight: '700', fontSize: 13 },

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
  invoiceCardSelected: {
    borderColor: '#C5221F',
    backgroundColor: '#FFF5F5',
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