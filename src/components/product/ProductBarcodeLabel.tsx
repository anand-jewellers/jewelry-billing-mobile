// src/components/product/ProductBarcodeLabel.tsx
import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, Alert } from 'react-native';
import Svg, { Rect, Path, Text as SvgText } from 'react-native-svg';
import { colors, spacing } from '../../theme';
import { printHtml } from '../../lib/invoicePdf';
import { buildLabelsHtml } from '../../lib/barcodeLabelHtml';
import {
  LabelData,
  buildLabelLayout,
  productToLabelData,
  LABEL_W_MM,
  LABEL_H_MM,
  TAIL_X_MM,
  TAIL_W_MM,
} from '../../lib/labelLayout';

interface Props {
  /** Preferred: pass the full product record (same shape getProductById returns). */
  product?: any;

  // Legacy props, used only when `product` is not passed.
  productId?: string;
  productCode: string;
  barcode?: string;
  productName: string;
  category?: string;
  grossWeight?: number;
  netWeight?: number;
  purity?: string;
  huid?: string | null;
  vaPercent?: number;
  makingCharge?: number;
  stoneCharge?: number;
  diamondWeight?: number | string;
  diamondCharge?: number;
  staffId?: string;
  businessName?: string;
}

export function ProductBarcodeLabel({
  product,
  productCode,
  barcode = '',
  productName,
  category = '',
  grossWeight = 0,
  netWeight = 0,
  purity = '',
  huid = null,
  vaPercent = 0,
  makingCharge = 0,
  stoneCharge = 0,
  diamondWeight = '',
  diamondCharge = 0,
}: Props) {
  const [printing, setPrinting] = useState(false);
  const [copies, setCopies] = useState('1');

  const data: LabelData = useMemo(() => {
    // Same mapper the bulk-print screen uses
    const fromProduct = product ? productToLabelData(product) : null;
    if (fromProduct) return fromProduct;
    return {
      barcode, purity, huid, category, grossWeight, netWeight,
      vaPercent, makingCharge, stoneCharge, diamondWeight, diamondCharge,
    };
  }, [
    product, barcode, purity, huid, category, grossWeight, netWeight,
    vaPercent, makingCharge, stoneCharge, diamondWeight, diamondCharge,
  ]);
  const layout = useMemo(() => buildLabelLayout(data), [data]);

  async function handlePrint() {
    const n = Math.max(1, Math.min(100, parseInt(copies, 10) || 1));
    try {
      setPrinting(true);
      await printHtml(buildLabelsHtml(Array.from({ length: n }, () => data)));
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not print barcode label');
    } finally {
      setPrinting(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.previewFrame}>
        <Svg viewBox={`0 0 ${LABEL_W_MM} ${LABEL_H_MM}`} style={styles.svg}>
          <Rect x={0} y={0} width={LABEL_W_MM} height={LABEL_H_MM} fill="#fff" />
          {/* Non-printing tail, shaded in the preview only */}
          <Rect x={TAIL_X_MM} y={0} width={TAIL_W_MM} height={LABEL_H_MM} fill="#F1F5F9" />
          <Path d={layout.barsPath} fill="#000" shapeRendering="crispEdges" />
          {layout.texts.map((t, i) => (
            <SvgText
              key={i}
              x={t.x}
              y={t.y}
              fontSize={t.size}
              fontFamily="Arial, Helvetica, sans-serif"
              fontWeight="700"
              fill="#000"
              textAnchor={t.anchor}
            >
              {t.text}
            </SvgText>
          ))}
        </Svg>
      </View>

      <Text style={styles.productName} numberOfLines={1}>{productName}</Text>
      <Text style={styles.productCode}>Code: {productCode}</Text>

      <View style={styles.copiesRow}>
        <Text style={styles.copiesLabel}>Copies to print</Text>
        <TextInput style={styles.copiesInput} value={copies} onChangeText={setCopies} keyboardType="number-pad" />
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={handlePrint} disabled={printing}>
          <Text style={[styles.btnText, styles.btnOutlineText]}>{printing ? 'Preparing...' : 'Print Labels'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: spacing.lg },
  previewFrame: { width: '100%', maxWidth: 560, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff' },
  svg: { width: '100%', aspectRatio: LABEL_W_MM / LABEL_H_MM },
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