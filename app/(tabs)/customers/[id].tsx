import { useCallback, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Card, SummaryCard } from '../../../src/components/ui';
import { colors, spacing } from '../../../src/theme';
import { getCustomerById, getCustomerInvoices, CustomerListItem, CustomerInvoiceRow } from '../../../src/lib/api/customers';

export default function CustomerDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerListItem | null>(null);
  const [invoices, setInvoices] = useState<CustomerInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([getCustomerById(id), getCustomerInvoices(id)])
      .then(([c, inv]) => {
        setCustomer(c);
        setInvoices(inv);
      })
      .catch(() => setError('Could not load customer details.'))
      .finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error || !customer) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Customer not found.'}</Text>
      </View>
    );
  }

  const totalSpent = invoices.reduce((s, i) => s + i.grand_total, 0);
  const totalDue = invoices.reduce((s, i) => s + i.balance_amount, 0);

  return (
    <View style={styles.screen}>
      <Card style={{ margin: spacing.lg }}>
        <Text style={styles.name}>{customer.name}</Text>
        {customer.phone && <Text style={styles.detail}>📞 {customer.phone}</Text>}
        {customer.email && <Text style={styles.detail}>✉️ {customer.email}</Text>}
        {customer.address && <Text style={styles.detail}>{customer.address}</Text>}
        {customer.gstin && <Text style={styles.detail}>GSTIN: {customer.gstin}</Text>}
      </Card>

      <View style={styles.summaryRow}>
        <SummaryCard label="Total Invoices" value={String(invoices.length)} />
        <SummaryCard label="Total Spent" value={`₹${totalSpent.toLocaleString('en-IN')}`} tone="primary" />
        <SummaryCard label="Balance Due" value={`₹${totalDue.toLocaleString('en-IN')}`} tone="gold" />
      </View>

      <Text style={styles.sectionTitle}>Invoice History</Text>
      <Card padded={false} style={{ flex: 1, marginHorizontal: spacing.lg }}>
        <FlatList
          data={invoices}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.invoiceRow}
              onPress={() => router.push(`/invoices/${item.id}`)}
            >
              <View>
                <Text style={styles.invoiceTotal}>₹{item.grand_total.toLocaleString('en-IN')}</Text>
                <Text style={styles.invoiceStatus}>{item.payment_status}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.invoiceNumber}>{item.invoice_number}</Text>
                <Text style={styles.invoiceDate}>{item.invoice_date}</Text>
              </View>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={<Text style={styles.emptyText}>No invoices yet.</Text>}
        />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  error: { fontSize: 13, color: colors.error },
  name: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  detail: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  summaryRow: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
  invoiceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: spacing.lg },
  invoiceNumber: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  invoiceDate: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  invoiceTotal: { fontSize: 14, fontWeight: '700', color: colors.gold },
  invoiceStatus: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  separator: { height: 1, backgroundColor: colors.border },
});