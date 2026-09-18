import { useCallback, useState } from 'react';
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
import { Search, Calendar, X } from 'lucide-react-native';
import { Card, Button } from '../../../src/components/ui';
import { CalendarModal } from '../../../src/components/ui/DateFilter';
import { colors, spacing, radius } from '../../../src/theme';
import { listInvoices, type InvoiceListItem } from '../../../src/lib/api/invoices';

function money(n: number): string {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function statusColor(status: string) {
  switch (status) {
    case 'paid':
      return '#1E8E3E';
    case 'unpaid':
      return '#B00020';
    case 'partial':
      return '#B26A00';
    default:
      return colors.textMuted;
  }
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shortDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export default function InvoiceListScreen() {
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search
  const [searchText, setSearchText] = useState('');

  // Custom date range only — no filter applied means the full record list.
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Working selection while the calendar is open, committed on "Apply".
  const [tempStart, setTempStart] = useState<Date | undefined>(undefined);
  const [tempEnd, setTempEnd] = useState<Date | undefined>(undefined);

  const load = useCallback((search: string, start: Date | null, end: Date | null) => {
    setLoading(true);
    setError(null);
    listInvoices({
      search: search.trim() || undefined,
      fromDate: start ? toISODate(start) : undefined,
      toDate: end ? toISODate(end) : undefined,
    })
      .then(setInvoices)
      .catch(() => setError('Could not load invoices.'))
      .finally(() => setLoading(false));
  }, []);

  // Reload whenever the screen refocuses, using the current filters
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

  // Tap once for start, tap again for end — same behaviour as the dashboard's
  // custom-range picker.
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

  return (
    <View style={styles.screen}>
      {/* Search and date range filter share one row */}
      <View style={styles.topRow}>
        <View style={styles.searchBar}>
          <Search size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search invoice no. or customer"
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

      {/* Custom range picker — no today/week/month presets, just start + end */}
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
            data={invoices}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable style={styles.row} onPress={() => router.push(`/invoices/${item.id}`)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.invoiceNumber}>{item.invoice_number}</Text>
                  <Text style={styles.meta}>
                    {item.customer_name} · {new Date(item.invoice_date).toLocaleDateString('en-IN')}
                  </Text>
                </View>
                <View style={styles.right}>
                  <Text style={styles.amount}>{money(item.grand_total)}</Text>
                  <Text style={[styles.status, { color: statusColor(item.payment_status) }]}>
                    {item.payment_status}
                  </Text>
                </View>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {hasFilters ? 'No invoices match your search.' : 'No invoices yet.'}
              </Text>
            }
          />
        </Card>
      )}

      <View style={styles.addButton}>
        <Button label="New Invoice" onPress={() => router.push('/invoices/new')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  error: { fontSize: 13, color: colors.error, textAlign: 'center', marginTop: spacing.md },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', padding: spacing.lg },
  addButton: { padding: spacing.lg },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },

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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  invoiceNumber: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  amount: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  status: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize', marginTop: 2 },
});