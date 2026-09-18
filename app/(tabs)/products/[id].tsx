// app/(tabs)/products/[id].tsx
import { useCallback, useState } from 'react';
import { View, Text, Image, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Alert, Modal, Pressable } from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../../../src/theme';
import { getProductById, setProductStatus } from '../../../src/lib/products';
import { getProductImageUrl } from '../../../src/lib/storage';
import { ProductBarcodeLabel } from '../../../src/components/product/ProductBarcodeLabel';
import { useStaff } from '../../../src/context/StaffContext';
import { shareProductOnWhatsApp } from '../../../src/lib/share';

export default function ProductDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { currentStaff } = useStaff();
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      setLoading(true);
      getProductById(id)
        .then(setProduct)
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

  async function handleShare() {
    setSharing(true);
    try {
      await shareProductOnWhatsApp(product, imageUrl);
    } catch (e) {
      console.error('Failed to open WhatsApp', e);
    } finally {
      setSharing(false);
    }
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
        <TouchableOpacity style={styles.shareBtn} onPress={handleShare} disabled={sharing}>
          {sharing ? (
            <ActivityIndicator size="small" color="#25D366" />
          ) : (
            <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
          )}
          <Text style={styles.shareBtnText}>Share</Text>
        </TouchableOpacity>
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

      {!currentStaff ? (
        <Text style={styles.notFound}>Log in again to generate a barcode label.</Text>
      ) : !product.barcode ? (
        <Text style={styles.notFound}>No barcode value saved for this product yet.</Text>
      ) : (
        <ProductBarcodeLabel
          productId={product.id}
          productCode={product.product_code}
          barcode={product.barcode}
          productName={product.product_name}
          netWeight={Number(product.net_weight)}
          purity={product.purities?.name ?? '—'}
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
  // imageSold: { opacity: 0.5 },
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
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { fontSize: 13, color: colors.textMuted },
  rowValue: { fontSize: 13, color: colors.textPrimary },
  rowBold: { fontWeight: '700', fontSize: 14, color: colors.textPrimary },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
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