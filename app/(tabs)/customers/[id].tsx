// app\(tabs)\customers\[id].tsx

import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  // FlatList,          // invoice history disabled - page is now a ScrollView
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  // TouchableOpacity,  // only used by the invoice cards (disabled)
  Pressable,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import {
  Phone,
  Mail,
  MapPin,
  ChevronRight,
  Plus,
  Check,
  MessageCircle,
  // FileText,          // only used by the "No invoices yet" empty state (disabled)
  Gem,
} from 'lucide-react-native';
import { Card /*, SummaryCard */ } from '../../../src/components/ui'; // SummaryCard only used by the invoice summary (disabled)
import { colors, spacing } from '../../../src/theme';
import {
  getCustomerById,
  // getCustomerInvoices,   // invoice history disabled
  CustomerListItem,
  // CustomerInvoiceRow,    // invoice history disabled
} from '../../../src/lib/api/customers';
import {
  listCustomerOrders,
  subscribeToCustomerOrders,
  getOrderImageUrl,
  CustomerOrder,
  OrderStatus,
} from '../../../src/lib/api/customerOrders';
import { getCompanySettings } from '../../../src/lib/api/settings';
import { companyToShopDetails } from '../../../src/lib/invoicePdf';
import { buildEstimateSlip } from '../../../src/lib/estimateSlip';
import { buildCombinedOrderEstimate } from '../../../src/lib/orderEstimate';
import {
  shareEstimateOnWhatsApp,
  shareOrderWithGoldsmithOnWhatsApp,
} from '../../../src/lib/whatsappShare';

const WHATSAPP_GREEN = '#25D366';

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

// Used by the invoice history cards (disabled)
// const PAYMENT_COLOR: Record<string, string> = {
//   paid: '#16A34A',
//   partial: '#D97706',
//   unpaid: '#DC2626',
// };

// Small tinted pill used for order status
function StatusPill({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: `${color}1A` }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

function SectionHeader({
  title,
  count,
  actionLabel,
  onAction,
}: {
  title: string;
  count?: number;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleWrap}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {count != null && count > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{count}</Text>
          </View>
        )}
      </View>
      {actionLabel && onAction && (
        <Pressable style={styles.actionBtn} onPress={onAction} hitSlop={8}>
          <Plus size={14} color={colors.primary} />
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function CustomerDetailsScreen() {
  const { id, orderFailed } = useLocalSearchParams<{ id: string; orderFailed?: string }>();
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerListItem | null>(null);
  // const [invoices, setInvoices] = useState<CustomerInvoiceRow[]>([]);   // invoice history disabled
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Orders the cashier has UNticked. Every open order is ticked by default,
  // so a freshly created order is included without any extra tap.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [sharingEstimate, setSharingEstimate] = useState(false);
  const [sharingSmithId, setSharingSmithId] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    // Invoices are no longer fetched on this screen.
    // Promise.all([getCustomerById(id), getCustomerInvoices(id), listCustomerOrders(id)])
    //   .then(([c, inv, ord]) => {
    //     setCustomer(c);
    //     setInvoices(inv);
    //     setOrders(ord);
    //   })
    Promise.all([getCustomerById(id), listCustomerOrders(id)])
      .then(([c, ord]) => {
        setCustomer(c);
        setOrders(ord);
      })
      .catch(() => setError('Could not load customer details.'))
      .finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Live sync — if an order's status changes elsewhere (or a new one is
  // created) while this screen is open, it updates here without a refresh.
  useEffect(() => {
    if (!id) return;
    return subscribeToCustomerOrders(id, (order, eventType) => {
      setOrders((prev) => {
        if (eventType === 'DELETE') return prev.filter((o) => o.id !== order.id);
        const exists = prev.some((o) => o.id === order.id);
        return exists ? prev.map((o) => (o.id === order.id ? order : o)) : [order, ...prev];
      });
    });
  }, [id]);

  const toggleOrder = (orderId: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });

  // Orders that can go into an estimate (not yet invoiced) and are ticked
  const openOrders = orders.filter((o) => o.status !== 'completed');
  const selectedOrders = openOrders.filter((o) => !excluded.has(o.id));

  // ---------------------------------------------------------
  // ONE estimate slip with every ticked order as an item
  // ---------------------------------------------------------
  const shareCombinedEstimate = async () => {
    if (selectedOrders.length === 0) return;
    setSharingEstimate(true);
    setShareError(null);
    try {
      // Oldest order first, so ORD-001 is ITEM 1
      const ordered = [...selectedOrders].sort((a, b) => a.created_at.localeCompare(b.created_at));

      const [company, estimate] = await Promise.all([
        getCompanySettings(),
        buildCombinedOrderEstimate(ordered),
      ]);
      const shop = companyToShopDetails(company);

      const { html, heightPt } = buildEstimateSlip(estimate.lines, {
        shopName: (shop as any)?.name ?? null,
        title: 'ROUGH ESTIMATE',
      });

      await shareEstimateOnWhatsApp({
        html,
        customerName: customer?.name ?? null,
        customerPhone: customer?.phone ?? null,
        shopName: (shop as any)?.name ?? null,
        amount: estimate.netAmount,
        heightPt,
      });
    } catch (e: any) {
      setShareError(e?.message ?? 'Could not share estimate.');
    } finally {
      setSharingEstimate(false);
    }
  };

  // ---------------------------------------------------------
  // Each order goes to ITS OWN goldsmith (design + pictures)
  // ---------------------------------------------------------
  const shareWithSmith = async (order: CustomerOrder) => {
    setSharingSmithId(order.id);
    setShareError(null);
    try {
      await shareOrderWithGoldsmithOnWhatsApp({
        order,
        imageUrls: (order.reference_images ?? []).map(getOrderImageUrl),
      });
    } catch (e: any) {
      setShareError(e?.message ?? 'Could not open WhatsApp.');
    } finally {
      setSharingSmithId(null);
    }
  };

  // ---------------------------------------------------------
  // Open ONE combined bill for every ticked order
  // (same receipt preview, GST, old gold and discount as the invoice screen)
  // ---------------------------------------------------------
  const openCombinedBill = () => {
    if (selectedOrders.length === 0) return;
    const ordered = [...selectedOrders].sort((a, b) => a.created_at.localeCompare(b.created_at));
    router.push({
      pathname: '/customers/orders/combined',
      params: { customerId: id, orderIds: ordered.map((o) => o.id).join(',') },
    });
  };

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

  // const totalSpent = invoices.reduce((s, i) => s + i.grand_total, 0);   // invoice summary disabled
  const initial = (customer.name?.trim()?.[0] ?? '?').toUpperCase();

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        {/* ---------------- Customer card ---------------- */}
        <Card style={styles.customerCard}>
          <View style={styles.customerTop}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{customer.name}</Text>
              {customer.gstin ? <Text style={styles.gstin}>GSTIN: {customer.gstin}</Text> : null}
            </View>
          </View>

          {(customer.phone || customer.email || customer.address) && <View style={styles.hairline} />}

          {customer.phone ? (
            <View style={styles.detailRow}>
              <Phone size={15} color={colors.textMuted} />
              <Text style={styles.detail}>{customer.phone}</Text>
            </View>
          ) : null}
          {customer.email ? (
            <View style={styles.detailRow}>
              <Mail size={15} color={colors.textMuted} />
              <Text style={styles.detail}>{customer.email}</Text>
            </View>
          ) : null}
          {customer.address ? (
            <View style={styles.detailRow}>
              <MapPin size={15} color={colors.textMuted} />
              <Text style={styles.detail}>{customer.address}</Text>
            </View>
          ) : null}
        </Card>

        {/* Invoice summary (Total Invoices / Total Spent) - DISABLED
        <View style={styles.summaryRow}>
          <View style={{ flex: 1 }}>
            <SummaryCard label="Total Invoices" value={String(invoices.length)} />
          </View>
          <View style={{ flex: 1 }}>
            <SummaryCard label="Total Spent" value={`₹${totalSpent.toLocaleString('en-IN')}`} tone="primary" />
          </View>
        </View>
        */}

        {/* ---------------- Jewel orders ---------------- */}
        <SectionHeader
          title="Jewel Orders"
          count={orders.length}
          actionLabel="New Order"
          onAction={() => router.push(`/customers/orders/new?customerId=${id}`)}
        />

        {orderFailed === '1' && (
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>
              Customer saved, but the jewel order could not be created. Tap "New Order" to try again.
            </Text>
          </View>
        )}

        <Card padded={false} style={styles.listCard}>
          {orders.length === 0 ? (
            <View style={styles.emptyState}>
              <Gem size={22} color={colors.textMuted} />
              <Text style={styles.emptyText}>No jewel orders yet</Text>
            </View>
          ) : (
            orders.map((o, index) => {
              const canSelect = o.status !== 'completed';
              const checked = canSelect && !excluded.has(o.id);
              const hasSmith = !!o.goldsmith_phone;

              return (
                <View key={o.id}>
                  <Pressable
                    style={({ pressed }) => [styles.orderRow, pressed && styles.rowPressed]}
                    onPress={() => router.push(`/customers/orders/${o.id}`)}
                  >
                    {/* Tick = include this order in the combined estimate */}
                    {canSelect && (
                      <Pressable
                        style={[styles.checkbox, checked && styles.checkboxOn]}
                        onPress={() => toggleOrder(o.id)}
                        hitSlop={10}
                      >
                        {checked && <Check size={14} color="#fff" strokeWidth={3} />}
                      </Pressable>
                    )}

                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {o.category} · {o.metal} · {o.purity}
                      </Text>
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {o.order_number} · {o.weight_max != null ? `${o.weight_min}g – ${o.weight_max}g` : `${o.weight_min}g`}
                      </Text>
                      {o.stone_name ? (
                        <Text style={styles.rowSub} numberOfLines={1}>
                          Stone: {o.stone_name}
                        </Text>
                      ) : null}

                      {/* This order's own goldsmith */}
                      {hasSmith && (
                        <Pressable
                          style={[styles.smithChip, sharingSmithId === o.id && styles.smithChipBusy]}
                          onPress={() => shareWithSmith(o)}
                          disabled={sharingSmithId !== null}
                          hitSlop={6}
                        >
                          {sharingSmithId === o.id ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <MessageCircle size={13} color="#fff" />
                          )}
                          <Text style={styles.smithChipText} numberOfLines={1}>
                            Share with {o.goldsmith_name?.trim() || 'Goldsmith'}
                          </Text>
                        </Pressable>
                      )}
                    </View>

                    <StatusPill label={ORDER_STATUS_LABEL[o.status]} color={ORDER_STATUS_COLOR[o.status]} />
                    <ChevronRight size={18} color={colors.textMuted} style={{ marginLeft: 6 }} />
                  </Pressable>
                  {index < orders.length - 1 && <View style={styles.separator} />}
                </View>
              );
            })
          )}
        </Card>

        {/* One bill for all ticked orders */}
        {openOrders.length > 1 && (
          <View style={styles.shareWrap}>
            <Pressable
              style={({ pressed }) => [
                styles.shareBtn,
                (selectedOrders.length < 1 || sharingEstimate) && styles.shareBtnDisabled,
                pressed && { opacity: 0.8 },
              ]}
              onPress={shareCombinedEstimate}
              disabled={selectedOrders.length < 1 || sharingEstimate}
            >
              {sharingEstimate ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <MessageCircle size={18} color="#fff" />
                  <Text style={styles.shareBtnText}>
                    Share Combined Estimate ({selectedOrders.length} {selectedOrders.length === 1 ? 'order' : 'orders'})
                  </Text>
                </>
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.invoiceBtn,
                selectedOrders.length < 1 && styles.shareBtnDisabled,
                pressed && { opacity: 0.8 },
              ]}
              onPress={openCombinedBill}
              disabled={selectedOrders.length < 1}
            >
              <Text style={styles.invoiceBtnText}>
                View Combined Bill ({selectedOrders.length} {selectedOrders.length === 1 ? 'order' : 'orders'})
              </Text>
            </Pressable>
            <Text style={styles.shareHint}>
              One bill with every ticked order as an item, old gold included. Untick an order to leave it out.
            </Text>
          </View>
        )}

        {shareError && (
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>{shareError}</Text>
          </View>
        )}

        {/* Invoice History - DISABLED (previous invoices are no longer shown here)
        <SectionHeader title="Invoice History" count={invoices.length} />

        {invoices.length === 0 ? (
          <View style={[styles.emptyState, styles.emptyInvoices]}>
            <FileText size={22} color={colors.textMuted} />
            <Text style={styles.emptyText}>No invoices yet</Text>
          </View>
        ) : (
          invoices.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.invoiceCard}
              activeOpacity={0.7}
              onPress={() => router.push(`/invoices/${item.id}`)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.invoice_number}</Text>
                <Text style={styles.rowSub}>{item.invoice_date}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={styles.invoiceTotal}>₹{item.grand_total.toLocaleString('en-IN')}</Text>
                <StatusPill
                  label={item.payment_status.charAt(0).toUpperCase() + item.payment_status.slice(1)}
                  color={PAYMENT_COLOR[item.payment_status] ?? colors.textMuted}
                />
              </View>
            </TouchableOpacity>
          ))
        )}
        */}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  error: { fontSize: 13, color: colors.error },

  // Customer card
  customerCard: { margin: spacing.lg, marginBottom: spacing.md },
  customerTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  name: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  gstin: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  hairline: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  detail: { flex: 1, fontSize: 14, color: colors.textSecondary },

  // Summary (kept for when the invoice summary is turned back on)
  summaryRow: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, marginBottom: spacing.lg },

  // Section headers
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  countBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  actionText: { fontSize: 13, fontWeight: '700', color: colors.primary },

  // Warning
  warningBox: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: 10,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  warningText: { fontSize: 12.5, color: '#B91C1C' },

  // Orders list
  listCard: { marginHorizontal: spacing.lg, marginBottom: spacing.lg },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  rowPressed: { backgroundColor: '#F8FAFC' },
  rowTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  separator: { height: 1, backgroundColor: colors.border },

  // Order tick box (include in combined estimate)
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },

  // Per-order goldsmith share
  smithChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: WHATSAPP_GREEN,
    maxWidth: '100%',
  },
  smithChipBusy: { opacity: 0.7 },
  smithChipText: { fontSize: 12, fontWeight: '700', color: '#fff', flexShrink: 1 },

  // Combined estimate button
  shareWrap: { marginHorizontal: spacing.lg, marginBottom: spacing.lg },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: WHATSAPP_GREEN,
  },
  shareBtnDisabled: { opacity: 0.5 },
  shareBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  invoiceBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  invoiceBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  shareHint: { fontSize: 11.5, color: colors.textMuted, textAlign: 'center', marginTop: 6 },

  // Invoice cards (kept for when invoice history is turned back on)
  invoiceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },
  invoiceTotal: { fontSize: 15, fontWeight: '800', color: colors.gold },

  // Pills
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  pillText: { fontSize: 11.5, fontWeight: '700' },

  // Empty states
  emptyState: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: spacing.xl },
  emptyInvoices: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },
  emptyText: { fontSize: 13, color: colors.textMuted },
});