import { useCallback, useState } from 'react';
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
import { Search, Calendar, X } from 'lucide-react-native';
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Card, Button } from '../../../src/components/ui';
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

function formatDisplay(d: Date | null): string {
  if (!d) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function InvoiceListScreen() {
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search
  const [searchText, setSearchText] = useState('');

  // Date range filter
  const [fromDate, setFromDate] = useState<Date | null>(null);
  const [toDate, setToDate] = useState<Date | null>(null);
  const [pickerTarget, setPickerTarget] = useState<'from' | 'to' | null>(null);

  const load = useCallback((search: string, from: Date | null, to: Date | null) => {
    setLoading(true);
    setError(null);
    listInvoices({
      search: search.trim() || undefined,
      fromDate: from ? toISODate(from) : undefined,
      toDate: to ? toISODate(to) : undefined,
    })
      .then(setInvoices)
      .catch(() => setError('Could not load invoices.'))
      .finally(() => setLoading(false));
  }, []);

  // Reload whenever the screen refocuses, using the current filters
  useFocusEffect(
    useCallback(() => {
      load(searchText, fromDate, toDate);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load])
  );

  const handleSearchChange = (text: string) => {
    setSearchText(text);
    load(text, fromDate, toDate);
  };

  // Native (iOS/Android) picker handler — new event-based API.
  // `event.type` is 'set' | 'dismissed' on Android; iOS inline picker
  // fires continuously while scrubbing, so we just trust `selected`.
  const handleDatePicked = (event: DateTimePickerEvent, selected?: Date) => {
    const target = pickerTarget;

    if (Platform.OS === 'android') {
      setPickerTarget(null);
      if (event.type === 'dismissed' || !selected || !target) return;
    } else {
      // iOS inline picker stays open until the user taps away/closes it;
      // only dismiss + commit here since this screen has no separate "Done" button.
      if (!selected || !target) return;
    }

    if (target === 'from') {
      setFromDate(selected);
      load(searchText, selected, toDate);
    } else {
      setToDate(selected);
      load(searchText, fromDate, selected);
    }

    if (Platform.OS === 'ios') setPickerTarget(null);
  };

  // Web fallback: native <input type="date"> since the community
  // datetimepicker package has no web renderer.
  const handleWebDateChange = (target: 'from' | 'to', value: string) => {
    setPickerTarget(null);
    if (!value) return;
    const selected = new Date(`${value}T00:00:00`);
    if (target === 'from') {
      setFromDate(selected);
      load(searchText, selected, toDate);
    } else {
      setToDate(selected);
      load(searchText, fromDate, selected);
    }
  };

  const clearDateFilter = () => {
    setFromDate(null);
    setToDate(null);
    load(searchText, null, null);
  };

  const hasFilters = searchText.trim() !== '' || fromDate !== null || toDate !== null;

  return (
    <View style={styles.screen}>
      {/* Search */}
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

      {/* Date range filter */}
      <View style={styles.dateRow}>
        <Pressable style={styles.dateChip} onPress={() => setPickerTarget('from')}>
          <Calendar size={14} color={colors.primary} />
          <Text style={styles.dateChipText}>{fromDate ? formatDisplay(fromDate) : 'From date'}</Text>
        </Pressable>

        <Text style={styles.dateSeparator}>–</Text>

        <Pressable style={styles.dateChip} onPress={() => setPickerTarget('to')}>
          <Calendar size={14} color={colors.primary} />
          <Text style={styles.dateChipText}>{toDate ? formatDisplay(toDate) : 'To date'}</Text>
        </Pressable>

        {(fromDate || toDate) && (
          <Pressable onPress={clearDateFilter} hitSlop={8} style={styles.clearDateBtn}>
            <X size={16} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {/* Web: native HTML date input, rendered invisibly and clicked programmatically
          isn't reliable cross-browser, so instead we render it directly under the
          chip row only while a target is selected. */}
      {Platform.OS === 'web' && pickerTarget && (
        <View style={styles.webDateWrap}>
          <Text style={styles.webDateLabel}>
            {pickerTarget === 'from' ? 'From date' : 'To date'}
          </Text>
          {/* @ts-ignore - raw HTML input, web-only */}
          <input
            type="date"
            autoFocus
            defaultValue={
              pickerTarget === 'from'
                ? fromDate ? toISODate(fromDate) : ''
                : toDate ? toISODate(toDate) : ''
            }
            max={toISODate(new Date())}
            onChange={(e: any) => handleWebDateChange(pickerTarget, e.target.value)}
            onBlur={() => setPickerTarget(null)}
            style={{
              fontSize: 14,
              padding: 8,
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              color: colors.textPrimary,
              backgroundColor: colors.surface,
            }}
          />
        </View>
      )}

      {Platform.OS !== 'web' && pickerTarget && (
        <DateTimePicker
          value={(pickerTarget === 'from' ? fromDate : toDate) ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={handleDatePicked}
          maximumDate={new Date()}
        />
      )}

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

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius?.md ?? 10,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, padding: 0 },

  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius?.md ?? 10,
    backgroundColor: colors.surface,
  },
  dateChipText: { fontSize: 13, color: colors.textPrimary },
  dateSeparator: { color: colors.textMuted },
  clearDateBtn: { marginLeft: 'auto' },

  webDateWrap: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  webDateLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 4 },

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