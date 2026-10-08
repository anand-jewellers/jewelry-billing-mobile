// app/(tabs)/products/weight.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl,
  Pressable, Modal, TextInput, KeyboardAvoidingView, Platform, TouchableOpacity,
} from 'react-native';
import { useFocusEffect, Stack } from 'expo-router';
import { Boxes, Gem, Layers, Clock } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing } from '../../../src/theme';
import { getProducts, getMetals } from '../../../src/lib/products';

interface ProductRow {
  id: string;
  net_weight: number;
  status?: string;
  category_id: string | null;
  metals?: { name?: string; type?: string } | null;
  categories?: { name?: string } | null;
}

interface StockOverride {
  expiresAt: number;                 // epoch ms
  values: Record<string, number>;    // metal name -> temporary weight (g)
}

const SOLD_STATUS = 'sold';
const OVERRIDE_KEY = 'stock_weight_override_v1';
const OVERRIDE_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours
const TAP_WINDOW_MS = 1500;
const TAPS_REQUIRED = 3;

function formatRemaining(ms: number) {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function ProductWeightScreen() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [metalNames, setMetalNames] = useState<string[]>([]);
  const [override, setOverride] = useState<StockOverride | null>(null);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // hidden editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const tapTimes = useRef<number[]>([]);

  async function load() {
    try {
      const [data, metals, rawOverride] = await Promise.all([
        getProducts(),
        getMetals(),
        AsyncStorage.getItem(OVERRIDE_KEY),
      ]);
      setProducts((data as ProductRow[]) ?? []);
      setMetalNames(((metals as { name: string }[]) ?? []).map((m) => m.name));

      if (rawOverride) {
        const parsed: StockOverride = JSON.parse(rawOverride);
        if (parsed.expiresAt > Date.now()) setOverride(parsed);
        else {
          setOverride(null);
          AsyncStorage.removeItem(OVERRIDE_KEY);
        }
      } else {
        setOverride(null);
      }
    } catch (e) {
      console.error('Failed to load products for weight summary', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setNow(Date.now());
    }
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  // Tick so an override reverts on its own while the screen is open.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  const activeOverride = override && override.expiresAt > now ? override : null;

  useEffect(() => {
    if (override && override.expiresAt <= now) {
      setOverride(null);
      AsyncStorage.removeItem(OVERRIDE_KEY);
    }
  }, [override, now]);

  function onRefresh() {
    setRefreshing(true);
    load();
  }

  const inStock = useMemo(() => products.filter((p) => p.status !== SOLD_STATUS), [products]);

  // REAL weight per metal (every active metal listed, even if 0).
  const realByMetal = useMemo(() => {
    const totals = new Map<string, number>();
    metalNames.forEach((n) => totals.set(n, 0));
    for (const p of inStock) {
      const name = p.metals?.name || 'Unknown';
      totals.set(name, (totals.get(name) || 0) + Number(p.net_weight || 0));
    }
    return Array.from(totals.entries()).map(([name, weight]) => ({ name, weight }));
  }, [inStock, metalNames]);

  // DISPLAYED weight = temporary override if active, else real.
  const byMetal = useMemo(
    () =>
      realByMetal.map((m) => ({
        name: m.name,
        weight: activeOverride?.values[m.name] ?? m.weight,
        adjusted: activeOverride?.values[m.name] !== undefined,
      })),
    [realByMetal, activeOverride]
  );

  const grandTotal = useMemo(() => byMetal.reduce((s, m) => s + m.weight, 0), [byMetal]);

  // Category breakdown (always real figures).
  const byCategory = useMemo(() => {
    const cats = new Map<string, { total: number; byMetal: Map<string, number> }>();
    for (const p of inStock) {
      const catName = p.categories?.name || 'Uncategorized';
      const metal = p.metals?.name || 'Unknown';
      const weight = Number(p.net_weight || 0);
      if (!cats.has(catName)) cats.set(catName, { total: 0, byMetal: new Map() });
      const entry = cats.get(catName)!;
      entry.total += weight;
      entry.byMetal.set(metal, (entry.byMetal.get(metal) || 0) + weight);
    }
    return Array.from(cats.entries())
      .map(([name, { total, byMetal }]) => ({
        name,
        total,
        breakdown: Array.from(byMetal.entries())
          .map(([metal, weight]) => ({ metal, weight }))
          .sort((a, b) => b.weight - a.weight),
      }))
      .sort((a, b) => b.total - a.total);
  }, [inStock]);

  // ---- Hidden editor: triple-tap on "Total Stock" ----
  function onTotalPress() {
    const t = Date.now();
    tapTimes.current = [...tapTimes.current.filter((x) => t - x < TAP_WINDOW_MS), t];
    if (tapTimes.current.length >= TAPS_REQUIRED) {
      tapTimes.current = [];
      const initial: Record<string, string> = {};
      byMetal.forEach((m) => (initial[m.name] = m.weight.toFixed(3)));
      setDrafts(initial);
      setEditorOpen(true);
    }
  }

  async function saveOverride() {
    const values: Record<string, number> = {};
    for (const m of realByMetal) {
      const n = parseFloat(drafts[m.name]);
      if (!Number.isFinite(n) || n < 0) continue;
      if (Math.abs(n - m.weight) > 0.0005) values[m.name] = n; // only store real changes
    }
    if (Object.keys(values).length === 0) {
      await resetOverride();
      return;
    }
    const next: StockOverride = { expiresAt: Date.now() + OVERRIDE_DURATION_MS, values };
    await AsyncStorage.setItem(OVERRIDE_KEY, JSON.stringify(next));
    setOverride(next);
    setNow(Date.now());
    setEditorOpen(false);
  }

  async function resetOverride() {
    await AsyncStorage.removeItem(OVERRIDE_KEY);
    setOverride(null);
    setEditorOpen(false);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Stock Weights', headerShown: false }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.headerTitle}>Current Stock Weight</Text>
        <Text style={styles.headerSubtitle}>Live totals from every product not marked as sold.</Text>


        <View style={styles.summaryGrid}>
          <Pressable onPress={onTotalPress} style={[styles.summaryCard, styles.summaryCardTotal]}>
            <Boxes size={18} color="#fff" />
            <Text style={styles.summaryCardTotalLabel}>Total Stock</Text>
            <Text style={styles.summaryCardTotalValue}>{grandTotal.toFixed(3)} g</Text>
          </Pressable>

          {byMetal.map((m) => (
            <View key={m.name} style={styles.summaryCard}>
              <Gem size={18} color={colors.primary} />
              <Text style={styles.summaryCardLabel}>{m.name}</Text>
              <Text style={styles.summaryCardValue}>{m.weight.toFixed(3)} g</Text>
            </View>
          ))}
          {byMetal.length === 0 && <Text style={styles.emptyText}>No metals found.</Text>}
        </View>

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
                <Text key={b.metal} style={styles.categoryCardBreakdownItem}>
                  {b.metal}: {b.weight.toFixed(3)} g
                </Text>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Hidden temporary-edit modal */}
      <Modal visible={editorOpen} transparent animationType="slide" onRequestClose={() => setEditorOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Edit Stock (Temporary)</Text>
            <Text style={styles.modalSubtitle}>
              Changes apply for 4 hours, then the real totals return automatically.
            </Text>

            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              {realByMetal.map((m) => (
                <View key={m.name} style={styles.editRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.editLabel}>{m.name}</Text>
                    <Text style={styles.editReal}>Real: {m.weight.toFixed(3)} g</Text>
                  </View>
                  <TextInput
                    style={styles.editInput}
                    keyboardType="decimal-pad"
                    value={drafts[m.name] ?? ''}
                    onChangeText={(v) => setDrafts((d) => ({ ...d, [m.name]: v }))}
                    selectTextOnFocus
                  />
                  <Text style={styles.editUnit}>g</Text>
                </View>
              ))}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setEditorOpen(false)}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={resetOverride}>
                <Text style={styles.btnGhostText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={saveOverride}>
                <Text style={styles.btnPrimaryText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#0F172A' },
  headerSubtitle: { fontSize: 13, color: '#64748B', marginTop: 4, marginBottom: spacing.lg },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEF3C7', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12,
    marginBottom: spacing.md,
  },
  bannerText: { color: '#92400E', fontSize: 12, fontWeight: '600' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: spacing.xl },
  summaryCard: {
    flexBasis: '47%', backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1,
    borderColor: '#E2E8F0', padding: 14, gap: 6,
  },
  summaryCardTotal: {
    flexBasis: '100%', backgroundColor: '#0F172A', borderColor: '#0F172A',
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  summaryCardTotalLabel: { color: '#CBD5E1', fontSize: 13, fontWeight: '600', flex: 1 },
  summaryCardTotalValue: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  summaryCardLabel: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  summaryCardValue: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#0F172A', marginBottom: spacing.sm },
  categoryCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#F1F5F9',
    padding: 12, marginBottom: 10,
  },
  categoryCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  categoryCardName: { flex: 1, fontSize: 14, fontWeight: '700', color: '#0F172A' },
  categoryCardTotal: { fontSize: 14, fontWeight: '800', color: colors.primary },
  categoryCardBreakdown: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6, paddingLeft: 24 },
  categoryCardBreakdownItem: { fontSize: 12, color: '#64748B', fontWeight: '500' },
  emptyText: { color: '#94A3B8', fontSize: 13, fontStyle: 'italic', paddingVertical: spacing.md },

  // modal
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.5)' },
  modalSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: spacing.lg, paddingBottom: spacing.xl,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  modalSubtitle: { fontSize: 12, color: '#64748B', marginTop: 4, marginBottom: spacing.md },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  editLabel: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  editReal: { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  editInput: {
    width: 110, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, fontWeight: '700',
    color: '#0F172A', textAlign: 'right',
  },
  editUnit: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: spacing.md },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  btnGhost: { backgroundColor: '#F1F5F9' },
  btnGhostText: { color: '#334155', fontWeight: '700' },
  btnPrimary: { backgroundColor: '#0F172A' },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
});