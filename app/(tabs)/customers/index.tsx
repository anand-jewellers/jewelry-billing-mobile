import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { Search, Calendar, X } from 'lucide-react-native';
import { Card } from '../../../src/components/ui';
import { CalendarModal } from '../../../src/components/ui/DateFilter';
import { colors, spacing, radius } from '../../../src/theme';
import { listCustomers, CustomerListItem } from '../../../src/lib/api/customers';

/**
 * Extracts a comparable numeric value from an invoice number for sorting.
 * Handles plain numbers ("104") as well as prefixed formats
 * ("INV-0104", "2024/104") by pulling out the last run of digits, which
 * is normally the sequential part of the number. Falls back to a plain
 * string comparison if no digits are found (e.g. fully non-numeric
 * invoice numbers), so sorting still degrades gracefully.
 */
function invoiceSortValue(invoiceNumber: string | null | undefined): number | null {
  if (!invoiceNumber) return null;
  const matches = invoiceNumber.match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  return parseInt(matches[matches.length - 1], 10);
}

function compareByInvoiceNumber(a: CustomerListItem, b: CustomerListItem): number {
  const aValue = invoiceSortValue(a.latest_invoice_number);
  const bValue = invoiceSortValue(b.latest_invoice_number);

  // Customers with no invoice (or an unparseable invoice number) sort to
  // the bottom, regardless of sort direction.
  if (aValue === null && bValue === null) return 0;
  if (aValue === null) return 1;
  if (bValue === null) return -1;

  // Highest/newest invoice number first.
  return bValue - aValue;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shortDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export default function CustomerListScreen() {
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Custom date range only — no filter applied means the full customer list.
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Working selection while the calendar is open, committed on "Apply".
  const [tempStart, setTempStart] = useState<Date | undefined>(undefined);
  const [tempEnd, setTempEnd] = useState<Date | undefined>(undefined);

  const load = useCallback((q: string, start: Date | null, end: Date | null) => {
    setLoading(true);
    setError(null);
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load])
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

  // Tap once for start, tap again for end — same behaviour as the invoice
  // list's custom-range picker.
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

  return (
    <View style={styles.screen}>
      {/* Search and date range filter share one row — matches the invoice list screen */}
      <View style={styles.topRow}>
        <View style={styles.searchBar}>
          <Search size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or phone"
            placeholderTextColor={colors.textMuted}
            value={searchText}
            onChangeText={handleSearchChange}
          />
          {searchText.length > 0 && (
            <Pressable onPress={() => handleSearchChange('')} hitSlop={8}>
              <X size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        <Pressable style={styles.dateChip} onPress={openPicker}>
          <Calendar size={16} color={colors.primary} />
          {hasRange && (
            <Text style={styles.dateChipText}>
              {shortDate(rangeStart as Date)} - {shortDate(rangeEnd as Date)}
            </Text>
          )}
          {hasRange && (
            <Pressable onPress={clearRange} hitSlop={8}>
              <X size={14} color={colors.textMuted} />
            </Pressable>
          )}
        </Pressable>
      </View>

      {/* Custom range picker — filters customers by their (latest) invoice date */}
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

      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <Card padded={false} style={{ flex: 1, margin: spacing.lg, marginTop: spacing.sm }}>
          <FlatList
            data={sortedCustomers}
            keyExtractor={(c) => c.id}
            renderItem={({ item }) => (
              <Pressable style={styles.row} onPress={() => router.push(`/customers/${item.id}`)}>
                <View>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.phone}>{item.phone ?? 'No phone'}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {item.latest_invoice_number ? (
                    <>
                      <Text style={styles.invoiceNumber}>{item.latest_invoice_number}</Text>
                      <Text style={styles.invoiceDate}>{item.latest_invoice_date}</Text>
                    </>
                  ) : (
                    <Text style={styles.noInvoice}>No invoices</Text>
                  )}
                </View>
              </Pressable>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {hasFilters
                  ? 'No customers match your filters.'
                  : 'No customers yet. Customers are created automatically when you save an invoice.'}
              </Text>
            }
          />
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  error: { fontSize: 13, color: colors.error, textAlign: 'center', marginTop: spacing.md },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },

  // Search bar — identical to the invoice list screen's searchBar/searchInput
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius?.md ?? 10,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, padding: 0 },

  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius?.md ?? 10,
    backgroundColor: colors.surface,
  },
  dateChipText: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  name: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  phone: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  invoiceNumber: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  invoiceDate: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  noInvoice: { fontSize: 12, color: colors.textMuted },
  separator: { height: 1, backgroundColor: colors.border },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
});