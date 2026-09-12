// src/components/product/ProductBarcodeLabel.tsx
import { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, Alert } from 'react-native';
import ViewShot from 'react-native-view-shot';
import * as Print from 'expo-print';
import { colors, spacing } from '../../theme';
import { uploadBarcodeImage } from '../../lib/storage';
import { updateProductQr } from '../../lib/products';
import { Code128Barcode } from './Code128Barcode';

interface Props {
  productId: string;
  productCode: string;
  barcode: string;
  productName: string;
  // Pricing is calculated only at billing time now, so the label shows the
  // item's physical details instead of a frozen MRP.
  netWeight: number;
  purity: string;
  staffId: string;
  itemLabel?: string;
  businessName?: string;
}

export function ProductBarcodeLabel({
  productId,
  productCode,
  barcode,
  productName,
  netWeight,
  purity,
  staffId,
  itemLabel = 'JEWL',
  businessName = 'MY STORE',
}: Props) {
  const shotRef = useRef<ViewShot>(null);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [copies, setCopies] = useState('4');

  async function captureBase64() {
    if (!shotRef.current?.capture) throw new Error('Barcode not ready');
    return await shotRef.current.capture();
  }

  async function handleSaveToStorage() {
    try {
      setSaving(true);
      const base64 = await captureBase64();
      const { publicUrl } = await uploadBarcodeImage(productId, base64);
      await updateProductQr(productId, publicUrl, staffId);
      setSavedUrl(publicUrl);
      Alert.alert('Saved', 'Barcode label saved to product.');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save barcode');
    } finally {
      setSaving(false);
    }
  }

  async function handlePrint() {
    const n = Math.max(1, Math.min(100, parseInt(copies, 10) || 1));
    try {
      setPrinting(true);
      const base64 = await captureBase64();
      const labelHtml = `<div class="label"><img src="data:image/png;base64,${base64}" /></div>`;
      const html = `
        <html>
          <head>
            <style>
              @page { margin: 8px; }
              body { font-family: -apple-system, sans-serif; }
              .sheet { display: flex; flex-wrap: wrap; gap: 6px; }
              .label { width: 220px; }
              .label img { width: 100%; }
            </style>
          </head>
          <body><div class="sheet">${labelHtml.repeat(n)}</div></body>
        </html>`;
      await Print.printAsync({ html });
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not print barcode label');
    } finally {
      setPrinting(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <ViewShot ref={shotRef} options={{ format: 'png', quality: 1, result: 'base64' }} style={styles.labelBox}>
        <View style={styles.labelRow}>
          <View style={styles.labelLeft}>
            {/* <Text style={styles.businessName} numberOfLines={1}>{businessName}</Text> */}
            <View style={styles.barcodeBox}>
              <Code128Barcode value={barcode} height={40} barWidth={1.6} />
            </View>
            <Text style={styles.code}>{barcode}</Text>
          </View>
          <View style={styles.labelRight}>
            <Text style={styles.meta}>ITEM : {itemLabel}</Text>
            <Text style={styles.meta}>WT : {netWeight.toFixed(3)}g</Text>
            <Text style={styles.meta}>PUR : {purity}</Text>
          </View>
        </View>
      </ViewShot>

      <Text style={styles.productName} numberOfLines={1}>{productName}</Text>
      <Text style={styles.productCode}>Code: {productCode}</Text>

      <View style={styles.copiesRow}>
        <Text style={styles.copiesLabel}>Copies to print</Text>
        <TextInput style={styles.copiesInput} value={copies} onChangeText={setCopies} keyboardType="number-pad" />
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.btn} onPress={handleSaveToStorage} disabled={saving}>
          <Text style={styles.btnText}>{saving ? 'Saving...' : savedUrl ? 'Saved ✓' : 'Save Barcode'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={handlePrint} disabled={printing}>
          <Text style={[styles.btnText, styles.btnOutlineText]}>{printing ? 'Preparing...' : 'Print Labels'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: spacing.lg },
  labelBox: { padding: spacing.sm, backgroundColor: '#fff', borderRadius: 6, borderWidth: 1, borderColor: '#ddd' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  labelLeft: { alignItems: 'flex-start' },
  labelRight: { justifyContent: 'center' },
  barcodeBox: { width: 150, height: 40, overflow: 'hidden' },
  businessName: { fontSize: 11, fontWeight: '800', color: '#000' },
  code: { fontSize: 10, fontWeight: '700', color: '#000', marginTop: 2 },
  meta: { fontSize: 11, fontWeight: '700', color: '#000' },
  productName: { marginTop: spacing.sm, fontSize: 13, color: colors.textMuted },
  productCode: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  copiesRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  copiesLabel: { fontSize: 13, color: colors.textMuted },
  copiesInput: { width: 56, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 6, textAlign: 'center', color: colors.text },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: { backgroundColor: colors.primary, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
  btnOutlineText: { color: colors.primary },
});