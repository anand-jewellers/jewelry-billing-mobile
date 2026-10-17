// app/(tabs)/products/[id].tsx
import { useCallback, useState } from 'react';
import { View, Text, Image, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Alert, Modal, Pressable } from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../../../src/theme';
import { getProductById, setProductStatus } from '../../../src/lib/products';
import { listTaxSettings } from '../../../src/lib/api/settings';
import { getProductImageUrl } from '../../../src/lib/storage';
import { ProductBarcodeLabel } from '../../../src/components/product/ProductBarcodeLabel';
import { useStaff } from '../../../src/context/StaffContext';
import { shareProductOnWhatsApp, getShopShareInfo } from '../../../src/lib/whatsappShare';

// Same helpers the invoice uses -> product page and invoice can never disagree.
import {
  parseCarat,
  diamondChargeAmount,
  DIAMOND_AMOUNT_IS_RATE_PER_CARAT,
} from '../../../src/lib/invoiceCalc';

export default function ProductDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { currentStaff } = useStaff();
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [gstPercent, setGstPercent] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      setLoading(true);
      getProductById(id)
        .then(async (p) => {
          setProduct(p);
          if (p?.tax_settings?.tax_percentage != null) {
            // Product was saved with a specific GST slab — use that.
            setGstPercent(p.tax_settings.tax_percentage);
          } else {
            // Older product saved before tax_setting_id existed — fall
            // back to whatever the current default active rate is.
            try {
              const rates = await listTaxSettings();
              const active = (rates ?? []).filter((t) => t.is_active);
              setGstPercent(active[0]?.tax_percentage ?? null);
            } catch {
              setGstPercent(null);
            }
          }
        })
        .catch((e) => console.error('Failed to load product', e))
        .finally(() => setLoading(false));
    }, [id])
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!product) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFound}>Product not found.</Text>
      </View>
    );
  }

  const isSold = product.status === 'sold';
  const primary = product.product_images?.find((i: any) => i.is_primary) ?? product.product_images?.[0];
  const imageUrl = primary ? getProductImageUrl(primary.storage_path) : null;
  const charges = product.product_value_added_charges ?? [];

  // ---- Values for the barcode label ----
  const chargeVal = (name: string) =>
    Number(charges.find((c: any) => c.charge_name === name)?.value) || 0;
  const diamonds: any[] = [...(product.product_diamonds ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );

  // A product counts as a "diamond product" when its metal OR category
  // contains "diamond" (e.g. Gold + "Diamond Tops"). Used to show the
  // Diamond card even before any size/rate has been entered.
  const isDiamondProduct =
    /diamond/i.test(product.metals?.name ?? '') ||
    /diamond/i.test(product.categories?.name ?? '');

  // ---- Diamond maths: identical to the invoice (src/lib/invoiceCalc.ts) ----
  // `size`   = diamond weight in carats
  // `amount` = RATE PER CARAT (when DIAMOND_AMOUNT_IS_RATE_PER_CARAT is true)
  // charge   = weight × rate
  const diamondWt = (d: any) => parseCarat(d.size);
  const diamondAmt = (d: any) => diamondChargeAmount(d.size, d.amount);
  const diamondRate = (d: any) =>
    DIAMOND_AMOUNT_IS_RATE_PER_CARAT
      ? Number(d.amount) || 0
      : diamondWt(d) > 0
        ? (Number(d.amount) || 0) / diamondWt(d)
        : 0;
  const totalDiamondWt = diamonds.reduce((s, d) => s + diamondWt(d), 0);
  const totalDiamondAmt = diamonds.reduce((s, d) => s + diamondAmt(d), 0);

  async function handleShare() {
    setSharing(true);
    try {
      const shop = await getShopShareInfo();
      await shareProductOnWhatsApp(product, imageUrl, shop);
    } catch (e) {
      console.error('Failed to open WhatsApp', e);
    } finally {
      setSharing(false);
    }
  }

  function handleEdit() {
    router.push(`/products/edit/${product.id}` as never);
  }

  async function handleToggleSold() {
    const nextStatus = isSold ? 'active' : 'sold';
    const label = isSold ? 'mark this product available again' : 'mark this product as sold';

    Alert.alert(
      isSold ? 'Mark as available?' : 'Mark as sold?',
      `This will ${label}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setUpdatingStatus(true);
            try {
              const updated = await setProductStatus(product.id, nextStatus);
              setProduct((prev: any) => ({ ...prev, status: updated.status }));
            } catch (e: any) {
              Alert.alert('Error', e.message ?? 'Could not update product status');
            } finally {
              setUpdatingStatus(false);
            }
          },
        },
      ]
    );
  }

  function formatCharge(c: any) {
    return c.calculation_type === 'percentage' ? `${c.value}%` : `₹${Number(c.value).toFixed(2)}`;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <TouchableOpacity
        activeOpacity={imageUrl ? 0.85 : 1}
        onPress={() => {
          if (imageUrl) setPreviewOpen(true);
        }}
      >
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.image} />
        ) : (
          <View style={[styles.image, styles.imagePlaceholder]}>
            <Ionicons name="image-outline" size={32} color={colors.textMuted} />
          </View>
        )}
        {isSold && (
          <View style={styles.soldRibbon}>
            <Text style={styles.soldRibbonText}>SOLD OUT</Text>
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{product.product_name}</Text>
            {isSold && (
              <View style={styles.soldBadge}>
                <Text style={styles.soldBadgeText}>SOLD</Text>
              </View>
            )}
          </View>
          <Text style={styles.code}>{product.product_code}</Text>
        </View>
        <View style={styles.titleActions}>
          <TouchableOpacity style={styles.editBtn} onPress={handleEdit}>
            <Ionicons name="create-outline" size={20} color={colors.textPrimary} />
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} disabled={sharing}>
            {sharing ? (
              <ActivityIndicator size="small" color="#25D366" />
            ) : (
              <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
            )}
            <Text style={styles.shareBtnText}>Share</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.statusBtn, isSold ? styles.statusBtnAvailable : styles.statusBtnSold]}
        onPress={handleToggleSold}
        disabled={updatingStatus}
      >
        {updatingStatus ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <Ionicons name={isSold ? 'refresh' : 'checkmark-done'} size={16} color="#fff" />
            <Text style={styles.statusBtnText}>
              {isSold ? 'Mark as Available' : 'Mark as Sold'}
            </Text>
          </>
        )}
      </TouchableOpacity>

      <View style={styles.card}>
        <Row label="Category" value={product.categories?.name ?? '—'} />
        <Row label="Subcategory" value={product.subcategories?.name ?? '—'} />
        <Row label="Metal" value={product.metals?.name ?? '—'} />
        <Row label="Purity" value={product.purities?.name ?? '—'} />
        {product.size ? <Row label="Size" value={product.size} /> : null}
        {product.huid ? <Row label="HUID" value={product.huid} /> : null}
        {product.barcode ? <Row label="Barcode" value={product.barcode} /> : null}
        {product.design_number ? <Row label="Design No." value={product.design_number} /> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Weight</Text>
        <Row label="Gross" value={`${Number(product.gross_weight).toFixed(3)} g`} />
        <Row label="Stone" value={`${Number(product.stone_weight).toFixed(3)} g`} />
        <Row label="Other" value={`${Number(product.other_weight).toFixed(3)} g`} />
        <Row label="Net" value={`${Number(product.net_weight).toFixed(3)} g`} bold />
      </View>

      {/* Diamond card: shown when diamond rows exist, OR when the product's
          metal/category is Diamond but no size/rate has been entered yet. */}
      {(diamonds.length > 0 || isDiamondProduct) && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Diamond</Text>

          {diamonds.length === 0 && (
            <Text style={styles.helperNote}>
              No diamond size/rate added yet. Tap Edit to add them.
            </Text>
          )}

          {diamonds.map((d: any, i: number) => (
            <View key={d.id ?? i}>
              {diamonds.length > 1 && <Text style={styles.subTitle}>Diamond {i + 1}</Text>}
              <Row
                label="Diamond Weight"
                value={diamondWt(d) > 0 ? `${diamondWt(d).toFixed(3)} ct` : '—'}
              />
              <Row
                label="Diamond Rate"
                value={diamondRate(d) > 0 ? `₹${diamondRate(d).toFixed(2)} / ct` : '—'}
              />
              <Row label="Diamond Charge" value={`₹${diamondAmt(d).toFixed(2)}`} />
            </View>
          ))}
          {diamonds.length > 1 && (
            <>
              <View style={styles.divider} />
              <Row label="Total Weight" value={`${totalDiamondWt.toFixed(3)} ct`} />
              <Row label="Total Charge" value={`₹${totalDiamondAmt.toFixed(2)}`} bold />
            </>
          )}
        </View>
      )}

      {charges.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Charges</Text>
          {charges.map((c: any) => (
            <Row key={c.id} label={c.charge_name} value={formatCharge(c)} />
          ))}
          <Text style={styles.helperNote}>
            Applied against the metal rate at invoice time — not a frozen amount.
          </Text>
        </View>
      )}

      {gstPercent !== null && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tax</Text>
          <Row
            label={product.tax_settings ? 'GST' : 'GST (default, not set on this product)'}
            value={`${gstPercent}%`}
          />
        </View>
      )}

      {!currentStaff ? (
        <Text style={styles.notFound}>Log in again to generate a barcode label.</Text>
      ) : !product.barcode ? (
        <Text style={styles.notFound}>No barcode value saved for this product yet.</Text>
      ) : (
        <ProductBarcodeLabel
          product={product}
          productId={product.id}
          productCode={product.product_code}
          productName={product.product_name}
          staffId={currentStaff.id}
        />
      )}

      {/* ===================================================
          Full-screen image preview
      =================================================== */}

      <Modal
        visible={previewOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewOpen(false)}
      >
        <View style={styles.previewBackdrop}>
          {/* Tapping anywhere outside the image also closes it */}
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPreviewOpen(false)} />

          <TouchableOpacity style={styles.previewCloseBtn} onPress={() => setPreviewOpen(false)} hitSlop={12}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>

          {imageUrl && (
            <Image source={{ uri: imageUrl }} style={styles.previewImage} resizeMode="contain" />
          )}
        </View>
      </Modal>
    </ScrollView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && styles.rowBold]}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.rowBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  notFound: { color: colors.textMuted, fontSize: 14 },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  image: { width: '100%', height: 220, borderRadius: radius.lg, backgroundColor: colors.border },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  soldRibbon: {
    position: 'absolute',
    top: spacing.md,
    right: -spacing.xl,
    backgroundColor: '#B00020',
    paddingVertical: 4,
    paddingHorizontal: spacing.xl * 1.5,
    transform: [{ rotate: '40deg' }],
  },
  soldRibbonText: { color: '#fff', fontWeight: '800', fontSize: 12, letterSpacing: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.md, marginBottom: spacing.sm },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  code: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  soldBadge: { backgroundColor: '#B00020', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  soldBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  titleActions: { flexDirection: 'row', gap: spacing.sm },
  editBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    minWidth: 64,
  },
  editBtnText: { fontSize: 10, color: colors.textPrimary, fontWeight: '700', marginTop: 2 },
  shareBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#25D366',
    borderRadius: radius.md,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    minWidth: 64,
  },
  shareBtnText: { fontSize: 10, color: '#25D366', fontWeight: '700', marginTop: 2 },
  statusBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.md,
    paddingVertical: 12,
    marginBottom: spacing.md,
  },
  statusBtnSold: { backgroundColor: '#B00020' },
  statusBtnAvailable: { backgroundColor: '#1E8E3E' },
  statusBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  cardTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  subTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: spacing.xs, marginBottom: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { fontSize: 13, color: colors.textMuted },
  rowValue: { fontSize: 13, color: colors.textPrimary },
  rowBold: { fontWeight: '700', fontSize: 14, color: colors.textPrimary },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  helperNote: { color: colors.textMuted, fontSize: 11, marginTop: spacing.xs, fontStyle: 'italic' },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCloseBtn: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.lg,
    zIndex: 1,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: {
    width: '100%',
    height: '80%',
  },
});