import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Trash2, ChevronRight } from 'lucide-react-native';
import { colors, spacing } from '../../theme';
import type { InvoiceItem } from '../../types/invoices';
import type { Metal, Purity } from '../../types/settings';

interface Props {
  item: InvoiceItem;
  metals: Metal[];
  purities: Purity[];
  onPress: () => void;
  onRemove: () => void;
}

export function InvoiceItemRow({ item, metals, purities, onPress, onRemove }: Props) {
  const metal = metals.find((m) => m.id === item.metal_id)?.name;
  const purity = purities.find((p) => p.id === item.purity_id)?.name;
  const vaCount = item.value_added_charges.length;

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>
          {item.name || 'Unnamed item'}
          {item.quantity > 1 ? `  ×${item.quantity}` : ''}
        </Text>
        <Text style={styles.meta}>
          {[metal, purity].filter(Boolean).join(' · ')}
          {metal || purity ? ' · ' : ''}
          {item.net_weight}g · ₹{item.metal_rate}/g
          {vaCount ? ` · ${vaCount} charge${vaCount > 1 ? 's' : ''}` : ''}
        </Text>
        {item.tax_percentage > 0 && (
          <Text style={styles.taxMeta}>GST {item.tax_percentage}% · ₹{item.tax_amount}</Text>
        )}
      </View>
      <View style={styles.right}>
        <Text style={styles.amount}>₹{item.total_amount.toLocaleString('en-IN')}</Text>
        <View style={styles.iconRow}>
          <ChevronRight size={16} color={colors.textMuted} />
          <Pressable onPress={onRemove} hitSlop={8}>
            <Trash2 size={16} color={colors.error ?? 'crimson'} />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  name: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  taxMeta: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  right: { alignItems: 'flex-end', gap: 6, marginLeft: spacing.md },
  amount: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});