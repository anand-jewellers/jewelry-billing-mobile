// app/(tabs)/customers/orders/[orderId].tsx

import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, Pressable } from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { MessageCircle } from 'lucide-react-native';
import { Card, Button } from '../../../../src/components/ui';
import { colors, spacing } from '../../../../src/theme';
import {
  getCustomerOrderById,
  updateCustomerOrderStatus,
  subscribeToOrderStatus,
  CustomerOrder,
  OrderStatus,
} from '../../../../src/lib/api/customerOrders';
import { getCustomerById } from '../../../../src/lib/api/customers';
import { getCompanySettings } from '../../../../src/lib/api/settings';
import { shareOrderReadyOnWhatsApp, shopInfoFromCompany } from '../../../../src/lib/whatsappShare';
import { formatDisplayDate, isOverdue } from '../../../../src/lib/dateUtils';

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  ready: 'Ready for Invoice',
  completed: 'Invoiced & Delivered',
};

const STATUS_COLOR: Record<OrderStatus, string> = {
  pending: '#D97706',
  ready: '#0284C7',
  completed: '#16A34A',
};

const WHATSAPP_GREEN = '#25D366';

export default function OrderDetailScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!orderId) return;
    setLoading(true);
    getCustomerOrderById(orderId)
      .then(setOrder)
      .catch(() => setError('Could not load order.'))
      .finally(() => setLoading(false));
  }, [orderId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Live updates — if staff on another device changes the status, this
  // screen reflects it instantly without a manual refresh.
  useEffect(() => {
    if (!orderId) return;
    return subscribeToOrderStatus(orderId, setOrder);
  }, [orderId]);

  const markReady = async () => {
    if (!order) return;
    setUpdating(true);
    setError(null);
    try {
      setOrder(await updateCustomerOrderStatus(order.id, 'ready'));
    } catch (e: any) {
      setError(e.message ?? 'Could not update status.');
    } finally {
      setUpdating(false);
    }
  };

  // Doesn't touch the order's status directly — the order only becomes
  // 'completed' once an invoice is actually saved for it. That happens on
  // the invoice-creation screen, which should call
  // completeCustomerOrderWithInvoice(orderId, invoice.id) after a
  // successful save.
  const goToCreateInvoice = () => {
    if (!order) return;
    router.push({
      pathname: '/invoices/new',
      params: {
        customerId: order.customer_id,
        orderId: order.id,
        orderNumber: order.order_number,
        category: order.category,
        metal: order.metal,
        purity: order.purity,
        weightMin: String(order.weight_min),
        weightMax: String(order.weight_max),
        stoneWeight: order.stone_weight != null ? String(order.stone_weight) : '',
        stoneName: order.stone_name ?? '',
        notes: order.notes ?? '',
      },
    });
  };

  // ---------------------------------------------------------
  // Share "your jewel is ready" on WhatsApp — straight to the
  // customer's number, with shop name, order details and location.
  // ---------------------------------------------------------
  const shareOnWhatsApp = async () => {
    if (!order) return;
    setSharing(true);
    setError(null);
    try {
      const [customer, company] = await Promise.all([
        getCustomerById(order.customer_id).catch(() => null),
        getCompanySettings().catch(() => null),
      ]);

      await shareOrderReadyOnWhatsApp({
        order,
        customerName: customer?.name ?? null,
        customerPhone: customer?.phone ?? null,
        shop: shopInfoFromCompany(company),
      });
    } catch (e: any) {
      setError(e?.message ?? 'Could not open WhatsApp.');
    } finally {
      setSharing(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (error && !order) return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>;
  if (!order) return <View style={styles.center}><Text style={styles.error}>Order not found.</Text></View>;

  const overdue = !!order.due_date && order.status !== 'completed' && isOverdue(order.due_date);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.lg }}>
      <Card>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[order.status] }]} />
          <Text style={[styles.statusText, { color: STATUS_COLOR[order.status] }]}>{STATUS_LABEL[order.status]}</Text>
        </View>

        <Text style={styles.row}>Order No: <Text style={styles.value}>{order.order_number}</Text></Text>
        <Text style={styles.row}>Category: <Text style={styles.value}>{order.category}</Text></Text>
        <Text style={styles.row}>Metal: <Text style={styles.value}>{order.metal} ({order.purity})</Text></Text>
        <Text style={styles.row}>Weight Range: <Text style={styles.value}>{order.weight_min}g – {order.weight_max}g</Text></Text>
        {order.stone_name && (
          <Text style={styles.row}>Stone: <Text style={styles.value}>{order.stone_name} ({order.stone_weight ?? '—'} ct)</Text></Text>
        )}
        {order.due_date && (
          <Text style={styles.row}>
            Due Date:{' '}
            <Text style={[styles.value, overdue && { color: colors.error }]}>
              {formatDisplayDate(order.due_date)}
              {overdue ? '  (Overdue)' : ''}
            </Text>
          </Text>
        )}
        {order.notes && <Text style={styles.row}>Notes: <Text style={styles.value}>{order.notes}</Text></Text>}
      </Card>

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        {order.status === 'pending' && (
          <Button label={updating ? 'Updating…' : 'Mark as Ready'} onPress={markReady} disabled={updating} />
        )}

        {order.status === 'ready' && (
          <>
            <Button label="Create Invoice" onPress={goToCreateInvoice} />

            <Pressable
              style={({ pressed }) => [
                styles.whatsappBtn,
                (pressed || sharing) && styles.whatsappBtnPressed,
              ]}
              onPress={shareOnWhatsApp}
              disabled={sharing}
            >
              {sharing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <MessageCircle size={18} color="#fff" />
                  <Text style={styles.whatsappBtnText}>Share on WhatsApp</Text>
                </>
              )}
            </Pressable>
          </>
        )}

        {order.status === 'completed' && (
          <Text style={styles.doneText}>✓ Invoiced{order.invoice_id ? '' : ' (no invoice linked)'}</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  error: { fontSize: 13, color: colors.error, textAlign: 'center', marginTop: spacing.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 15, fontWeight: '700' },
  row: { fontSize: 13, color: colors.textSecondary, marginTop: 6 },
  value: { color: colors.textPrimary, fontWeight: '600' },
  doneText: { fontSize: 14, fontWeight: '700', color: '#16A34A', textAlign: 'center' },
  whatsappBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: WHATSAPP_GREEN,
    borderRadius: 12,
    paddingVertical: 14,
  },
  whatsappBtnPressed: { opacity: 0.8 },
  whatsappBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});