// app/(tabs)/products/weight.tsx
//
// Read-only summary screen: total weight currently on hand, broken down by
// metal type (Gold / Silver / Platinum / Other) and by category. Reuses
// getProducts() rather than a separate query — the product list already
// needs the same joined data, so this stays in sync with whatever's shown
// there.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, Stack } from 'expo-router';
import { Boxes, Gem, Layers } from 'lucide-react-native';
import { colors, spacing } from '../../../src/theme';
import { getProducts } from '../../../src/lib/products';

interface ProductRow {
  id: string;
  net_weight: number;
  status?: string;
  category_id: string | null;
  metals?: { name?: string; type?: string } | null;
  categories?: { name?: string } | null;
}

// A product with this status has left the shop, so it's excluded from
// "current stock" weight — everything else (active, inactive, or any other
// status) is assumed to still be physically on hand and counts toward the
// totals below. Adjust this if "in stock" should mean something narrower.
const SOLD_STATUS = 'sold';

const METAL_TYPE_LABEL: Record<string, string> = {
  gold: 'Gold',
  silver: 'Silver',
  platinum: 'Platinum',
  other: 'Other',
};

export default function ProductWeightScreen() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const data = await getProducts();
      setProducts((data as ProductRow[]) ?? []);
    } catch (e) {
      console.error('Failed to load products for weight summary', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  function onRefresh() {
    setRefreshing(true);
    load();
  }

  const inStock = useMemo(
    () => products.filter((p) => p.status !== SOLD_STATUS),
    [products]
  );

  // Overall totals per metal type, summed across every category.
  const byMetalType = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of inStock) {
      const type = p.metals?.type || 'other';
      totals.set(type, (totals.get(type) || 0) + Number(p.net_weight || 0));
    }
    return Array.from(totals.entries())
      .map(([type, weight]) => ({ type, label: METAL_TYPE_LABEL[type] ?? type, weight }))
      .sort((a, b) => b.weight - a.weight);
  }, [inStock]);

  const grandTotal = useMemo(
    () => inStock.reduce((sum, p) => sum + Number(p.net_weight || 0), 0),
    [inStock]
  );

  // Per-category totals, each with its own metal-type split so a category
  // like "Necklace" shows e.g. "Gold 120.500 g · Silver 40.000 g" rather
  // than one opaque number.
  const byCategory = useMemo(() => {
    const cats = new Map<string, { total: number; byMetal: Map<string, number> }>();
    for (const p of inStock) {
      const catName = p.categories?.name || 'Uncategorized';
      const type = p.metals?.type || 'other';
      const weight = Number(p.net_weight || 0);
      if (!cats.has(catName)) cats.set(catName, { total: 0, byMetal: new Map() });
      const entry = cats.get(catName)!;
      entry.total += weight;
      entry.byMetal.set(type, (entry.byMetal.get(type) || 0) + weight);
    }
    return Array.from(cats.entries())
      .map(([name, { total, byMetal }]) => ({
        name,
        total,
        breakdown: Array.from(byMetal.entries())
          .map(([type, weight]) => ({ type, label: METAL_TYPE_LABEL[type] ?? type, weight }))
          .sort((a, b) => b.weight - a.weight),
      }))
      .sort((a, b) => b.total - a.total);
  }, [inStock]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Stock Weight', headerShown: true }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.headerTitle}>Current Stock Weight</Text>
        <Text style={styles.headerSubtitle}>Live totals from every product not marked as sold.</Text>

        {/* Overall totals */}
        <View style={styles.summaryGrid}>
          <View style={[styles.summaryCard, styles.summaryCardTotal]}>
            <Boxes size={18} color="#fff" />
            <Text style={styles.summaryCardTotalLabel}>Total Stock</Text>
            <Text style={styles.summaryCardTotalValue}>{grandTotal.toFixed(3)} g</Text>
          </View>
          {byMetalType.map((m) => (
            <View key={m.type} style={styles.summaryCard}>
              <Gem size={18} color={colors.primary} />
              <Text style={styles.summaryCardLabel}>{m.label}</Text>
              <Text style={styles.summaryCardValue}>{m.weight.toFixed(3)} g</Text>
            </View>
          ))}
          {byMetalType.length === 0 && (
            <Text style={styles.emptyText}>No products in stock yet.</Text>
          )}
        </View>

        {/* Category breakdown */}
        <Text style={styles.sectionTitle}>By Category</Text>
        {byCategory.length === 0 && (
          <Text style={styles.emptyText}>No categorized products in stock yet.</Text>
        )}
        {byCategory.map((cat) => (
          <View key={cat.name} style={styles.categoryCard}>
            <View style={styles.categoryCardHeader}>
              <Layers size={16} color={colors.primary} />
              <Text style={styles.categoryCardName}>{cat.name}</Text>
              <Text style={styles.categoryCardTotal}>{cat.total.toFixed(3)} g</Text>
            </View>
            <View style={styles.categoryCardBreakdown}>
              {cat.breakdown.map((b) => (
                <Text key={b.type} style={styles.categoryCardBreakdownItem}>
                  {b.label}: {b.weight.toFixed(3)} g
                </Text>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#0F172A' },
  headerSubtitle: { fontSize: 13, color: '#64748B', marginTop: 4, marginBottom: spacing.lg },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: spacing.xl,
  },
  summaryCard: {
    flexBasis: '47%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    gap: 6,
  },
  summaryCardTotal: {
    flexBasis: '100%',
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  summaryCardTotalLabel: { color: '#CBD5E1', fontSize: 13, fontWeight: '600', flex: 1 },
  summaryCardTotalValue: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  summaryCardLabel: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  summaryCardValue: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#0F172A', marginBottom: spacing.sm },
  categoryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    padding: 12,
    marginBottom: 10,
  },
  categoryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryCardName: { flex: 1, fontSize: 14, fontWeight: '700', color: '#0F172A' },
  categoryCardTotal: { fontSize: 14, fontWeight: '800', color: colors.primary },
  categoryCardBreakdown: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
    paddingLeft: 24,
  },
  categoryCardBreakdownItem: { fontSize: 12, color: '#64748B', fontWeight: '500' },
  emptyText: { color: '#94A3B8', fontSize: 13, fontStyle: 'italic', paddingVertical: spacing.md },
});