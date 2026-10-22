// app/(tabs)/customers/orders/[orderId].tsx

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, ScrollView, Pressable, TouchableOpacity, Image, Modal, Linking,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { MessageCircle, Phone, X } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Button } from '../../../../src/components/ui';
import { colors, spacing } from '../../../../src/theme';
import {
  getCustomerOrderById,
  updateCustomerOrderStatus,
  subscribeToOrderStatus,
  getOrderImageUrl,
  CustomerOrder,
  OrderStatus,
} from '../../../../src/lib/api/customerOrders';
import { getCustomerById } from '../../../../src/lib/api/customers';
import { getCompanySettings } from '../../../../src/lib/api/settings';
import { companyToShopDetails } from '../../../../src/lib/invoicePdf';
import { buildEstimateSlip } from '../../../../src/lib/estimateSlip';
import { buildOrderEstimate } from '../../../../src/lib/orderEstimate';
import {
  shareOrderReadyOnWhatsApp,
  shareOrderWithGoldsmithOnWhatsApp,
  shareEstimateOnWhatsApp,
  shopInfoFromCompany,
} from '../../../../src/lib/whatsappShare';
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

const rupees = (n: number) =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function OrderDetailScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [sharingEstimate, setSharingEstimate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);

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
        weightMax: order.weight_max != null ? String(order.weight_max) : '',
        stoneWeight: order.stone_weight != null ? String(order.stone_weight) : '',
        stoneName: order.stone_name ?? '',
        notes: order.notes ?? '',
        // Charges + advance, so the invoice screen can prefill them
        vacPercent: order.vac_percent != null ? String(order.vac_percent) : '',
        makingCharge: order.making_charge != null ? String(order.making_charge) : '',
        stoneCharge: order.stone_charge != null ? String(order.stone_charge) : '',
        advanceAmount: order.advance_amount != null ? String(order.advance_amount) : '',
        paymentMode: order.payment_mode ?? '',
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

  // ---------------------------------------------------------
  // Share the design (picture, category, metal, purity, remarks)
  // with the goldsmith.
  // ---------------------------------------------------------
  const shareWithSmith = async () => {
    if (!order) return;
    setSharing(true);
    setError(null);
    try {
      await shareOrderWithGoldsmithOnWhatsApp({
        order,
        imageUrls: (order.reference_images ?? []).map(getOrderImageUrl),
      });
    } catch (e: any) {
      setError(e?.message ?? 'Could not open WhatsApp.');
    } finally {
      setSharing(false);
    }
  };

  // ---------------------------------------------------------
  // Share the ROUGH ESTIMATE slip (same PDF slip as the invoice
  // page) with the customer on WhatsApp.
  // ---------------------------------------------------------
  const shareEstimate = async () => {
    if (!order) return;
    setSharingEstimate(true);
    setError(null);
    try {
      const [customer, company, estimate] = await Promise.all([
        getCustomerById(order.customer_id).catch(() => null),
        getCompanySettings(),
        buildOrderEstimate(order),
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
      setError(e?.message ?? 'Could not share estimate.');
    } finally {
      setSharingEstimate(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (error && !order) return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>;
  if (!order) return <View style={styles.center}><Text style={styles.error}>Order not found.</Text></View>;

  const overdue = !!order.due_date && order.status !== 'completed' && isOverdue(order.due_date);

  const weightText =
    order.weight_max != null ? `${order.weight_min}g – ${order.weight_max}g` : `${order.weight_min}g`;

  const hasCharges =
    order.vac_percent != null || order.making_charge != null || order.stone_charge != null;
  const hasGoldsmith = !!order.goldsmith_name || !!order.goldsmith_phone;
  const hasAdvance = order.advance_amount != null && order.advance_amount > 0;
  const imageUrls = (order.reference_images ?? []).map(getOrderImageUrl);
  const activeUrl = imageUrls[activeIdx] ?? imageUrls[0] ?? null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}>
      {/* Reference picture (same behaviour as the product page: tap for full screen) */}
      <TouchableOpacity activeOpacity={activeUrl ? 0.85 : 1} onPress={() => activeUrl && setPreviewOpen(true)}>
        {activeUrl ? (
          <Image source={{ uri: activeUrl }} style={styles.heroImage} />
        ) : (
          <View style={[styles.heroImage, styles.heroPlaceholder]}>
            <Ionicons name="image-outline" size={32} color={colors.textMuted} />
            <Text style={styles.heroPlaceholderText}>No reference picture</Text>
          </View>
        )}
      </TouchableOpacity>

      {imageUrls.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageStrip}>
          {imageUrls.map((uri, i) => (
            <Pressable key={uri} onPress={() => setActiveIdx(i)}>
              <Image source={{ uri }} style={[styles.thumb, i === activeIdx && styles.thumbActive]} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Card>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[order.status] }]} />
          <Text style={[styles.statusText, { color: STATUS_COLOR[order.status] }]}>{STATUS_LABEL[order.status]}</Text>
        </View>

        {/* Order details */}
        <Text style={styles.row}>Order No: <Text style={styles.value}>{order.order_number}</Text></Text>
        <Text style={styles.row}>Category: <Text style={styles.value}>{order.category}</Text></Text>
        <Text style={styles.row}>Metal: <Text style={styles.value}>{order.metal} ({order.purity})</Text></Text>
        <Text style={styles.row}>
          {order.weight_max != null ? 'Weight Range' : 'Weight'}: <Text style={styles.value}>{weightText}</Text>
        </Text>
        {order.stone_weight != null && (
          <Text style={styles.row}>Stone Weight: <Text style={styles.value}>{order.stone_weight} ct</Text></Text>
        )}
        {/* Orders created before the stone-name field was removed still show it */}
        {order.stone_name && (
          <Text style={styles.row}>Stone: <Text style={styles.value}>{order.stone_name}</Text></Text>
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

        {/* Charges */}
        {hasCharges && (
          <Section title="Charges">
            {order.vac_percent != null && (
              <Text style={styles.row}>Value Added: <Text style={styles.value}>{order.vac_percent}%</Text></Text>
            )}
            {order.making_charge != null && (
              <Text style={styles.row}>Making Charge: <Text style={styles.value}>{rupees(order.making_charge)}</Text></Text>
            )}
            {order.stone_charge != null && (
              <Text style={styles.row}>Stone Charge: <Text style={styles.value}>{rupees(order.stone_charge)}</Text></Text>
            )}
          </Section>
        )}

        {/* Goldsmith */}
        {hasGoldsmith && (
          <Section title="Issued to Goldsmith">
            <View style={styles.smithCard}>
              <View style={styles.smithAvatar}>
                <Text style={styles.smithAvatarText}>
                  {(order.goldsmith_name?.trim()?.[0] ?? 'G').toUpperCase()}
                </Text>
              </View>

              <View style={{ flex: 1 }}>
                {!!order.goldsmith_name && (
                  <Text style={styles.smithName} numberOfLines={1}>{order.goldsmith_name}</Text>
                )}
                {!!order.goldsmith_phone && (
                  <Text style={styles.smithPhone}>{order.goldsmith_phone}</Text>
                )}
              </View>

              {!!order.goldsmith_phone && (
                <Pressable
                  style={styles.smithCallBtn}
                  hitSlop={8}
                  onPress={() => Linking.openURL(`tel:${order.goldsmith_phone}`)}
                >
                  <Phone size={16} color={colors.primary} />
                </Pressable>
              )}
            </View>

            {!!order.goldsmith_phone && (
              <Pressable
                style={({ pressed }) => [styles.smithBtn, (pressed || sharing) && styles.whatsappBtnPressed]}
                onPress={shareWithSmith}
                disabled={sharing}
              >
                {sharing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <MessageCircle size={18} color="#fff" />
                    <Text style={styles.smithBtnText}>Share with Goldsmith</Text>
                  </>
                )}
              </Pressable>
            )}
          </Section>
        )}

        {/* Advance */}
        {hasAdvance && (
          <Section title="Advance Payment">
            <Text style={styles.row}>Amount: <Text style={styles.value}>{rupees(order.advance_amount!)}</Text></Text>
            {order.payment_mode && (
              <Text style={styles.row}>Payment Mode: <Text style={styles.value}>{order.payment_mode}</Text></Text>
            )}
          </Section>
        )}
      </Card>

      {error && <Text style={styles.error}>{error}</Text>}

      {/* Rough estimate slip for the customer (same slip as the invoice page) */}
      {order.status !== 'completed' && (
        <Pressable
          style={({ pressed }) => [
            styles.estimateBtn,
            (pressed || sharingEstimate) && styles.whatsappBtnPressed,
          ]}
          onPress={shareEstimate}
          disabled={sharingEstimate}
        >
          {sharingEstimate ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <MessageCircle size={18} color="#fff" />
              <Text style={styles.estimateBtnText}>Share Estimate</Text>
            </>
          )}
        </Pressable>
      )}

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
                  <Text style={styles.whatsappBtnText}>Share Order Confirmation</Text>
                </>
              )}
            </Pressable>
          </>
        )}

        {order.status === 'completed' && (
          <Text style={styles.doneText}>✓ Invoiced{order.invoice_id ? '' : ' (no invoice linked)'}</Text>
        )}
      </View>

      {/* Full-screen picture preview */}
      <Modal visible={previewOpen} transparent animationType="fade" onRequestClose={() => setPreviewOpen(false)}>
        <View style={styles.previewOverlay}>
          {/* Tapping outside the image also closes it */}
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPreviewOpen(false)} />
          <Pressable style={styles.previewClose} onPress={() => setPreviewOpen(false)} hitSlop={12}>
            <X size={26} color="#fff" />
          </Pressable>
          {activeUrl && <Image source={{ uri: activeUrl }} style={styles.previewImage} resizeMode="contain" />}
        </View>
      </Modal>
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

  section: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },

  heroImage: { width: '100%', height: 220, borderRadius: 16, backgroundColor: colors.border, marginBottom: spacing.md },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 6 },
  heroPlaceholderText: { fontSize: 12, color: colors.textMuted },
  imageStrip: { marginBottom: spacing.md, marginTop: -spacing.xs },
  thumb: { width: 64, height: 64, borderRadius: 10, marginRight: 8, backgroundColor: colors.border, borderWidth: 2, borderColor: 'transparent' },
  thumbActive: { borderColor: colors.primary },

  // Goldsmith card
  smithCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: spacing.sm,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
  },
  smithAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smithAvatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  smithName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  smithPhone: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  smithCallBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
  },
  smithBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: spacing.sm,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: WHATSAPP_GREEN,
  },
  smithBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Share Estimate button (outlined)
  estimateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: spacing.lg,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: WHATSAPP_GREEN,
  },
  estimateBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
 

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

  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  previewClose: { position: 'absolute', top: 56, right: 24, zIndex: 2 },
  previewImage: { width: '100%', height: '80%' },
});