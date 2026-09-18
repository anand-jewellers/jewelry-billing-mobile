// app/(tabs)/products/index.tsx
import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  Pressable,
  TextInput,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Search, X } from 'lucide-react-native';
import { Button } from '../../../src/components/ui';
import { colors, spacing, radius } from '../../../src/theme';
import { getProducts } from '../../../src/lib/products';
import { getProductImageUrl } from '../../../src/lib/storage';
import { shareProductOnWhatsApp, shareProductsOnWhatsApp } from '../../../src/lib/share';

interface ProductRow {
  id: string;
  product_name: string;
  product_code: string;
  net_weight: number;
  status?: string;
  metal_id: string | null;
  purity_id: string | null;
  metals?: { name?: string } | null;
  purities?: { name?: string } | null;
  product_images: { storage_path: string; is_primary: boolean }[];
}

export default function ProductListScreen() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [searchText, setSearchText] = useState('');
  const [selectedMetal, setSelectedMetal] = useState<string | null>(null);
  const [selectedPurity, setSelectedPurity] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // --- multi-select state ---
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSharing, setBulkSharing] = useState(false);

  async function load() {
    try {
      const data = await getProducts();
      setProducts((data as ProductRow[]) ?? []);
    } catch (e) {
      console.error('Failed to load products', e);
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

  function primaryImageUrl(row: ProductRow) {
    const primary = row.product_images?.find((img) => img.is_primary) ?? row.product_images?.[0];
    return primary ? getProductImageUrl(primary.storage_path) : null;
  }

  const metalOptions = useMemo(() => {
    const names = products.map((p) => p.metals?.name).filter((n): n is string => !!n);
    return Array.from(new Set(names));
  }, [products]);

  const purityOptions = useMemo(() => {
    const relevant = selectedMetal ? products.filter((p) => p.metals?.name === selectedMetal) : products;
    const names = relevant.map((p) => p.purities?.name).filter((n): n is string => !!n);
    return Array.from(new Set(names));
  }, [products, selectedMetal]);

  function handleSelectMetal(name: string) {
    const next = selectedMetal === name ? null : name;
    setSelectedMetal(next);
    if (next && selectedPurity) {
      const stillValid = products.some((p) => p.metals?.name === next && p.purities?.name === selectedPurity);
      if (!stillValid) setSelectedPurity(null);
    }
  }

  function handleSelectPurity(name: string) {
    setSelectedPurity(selectedPurity === name ? null : name);
  }

  function clearFilters() {
    setSearchText('');
    setSelectedMetal(null);
    setSelectedPurity(null);
  }

  const filteredProducts = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return products.filter((p) => {
      const matchesSearch =
        !q || p.product_name.toLowerCase().includes(q) || p.product_code.toLowerCase().includes(q);
      const matchesMetal = !selectedMetal || p.metals?.name === selectedMetal;
      const matchesPurity = !selectedPurity || p.purities?.name === selectedPurity;
      return matchesSearch && matchesMetal && matchesPurity;
    });
  }, [products, searchText, selectedMetal, selectedPurity]);

  const hasActiveFilters = !!searchText || !!selectedMetal || !!selectedPurity;

  async function handleShare(item: ProductRow) {
    const imageUrl = primaryImageUrl(item);
    try {
      await shareProductOnWhatsApp(item, imageUrl);
    } catch (e) {
      console.error('Failed to open WhatsApp', e);
    }
  }

  // --- selection helpers ---
  function toggleSelectionMode() {
    setSelectionMode((prev) => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleRowPress(item: ProductRow) {
    if (selectionMode) {
      toggleSelect(item.id);
    } else {
      router.push(`/products/${item.id}` as never);
    }
  }

  function handleRowLongPress(item: ProductRow) {
    if (!selectionMode) {
      setSelectionMode(true);
      setSelectedIds(new Set([item.id]));
    }
  }

  async function handleShareSelected() {
    const selected = products.filter((p) => selectedIds.has(p.id));
    if (!selected.length) return;
    setBulkSharing(true);
    try {
      await shareProductsOnWhatsApp(
        selected.map((p) => ({ ...p, imageUrl: primaryImageUrl(p) }))
      );
      setSelectionMode(false);
      setSelectedIds(new Set());
    } catch (e) {
      console.error('Failed to share selected products', e);
    } finally {
      setBulkSharing(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Search — matches the invoice list screen's search bar exactly */}
      <View style={styles.searchBar}>
        <Search size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or code"
          placeholderTextColor={colors.textMuted}
          value={searchText}
          onChangeText={setSearchText}
        />
        {searchText.length > 0 && (
          <Pressable onPress={() => setSearchText('')} hitSlop={8}>
            <X size={16} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      <View style={styles.toolbarRow}>
        <TouchableOpacity
          style={[styles.filterToggle, (filtersOpen || hasActiveFilters) && styles.filterToggleActive]}
          onPress={() => setFiltersOpen((v) => !v)}
        >
          <Ionicons
            name="filter"
            size={16}
            color={filtersOpen || hasActiveFilters ? '#fff' : colors.textSecondary}
          />
          <Text style={[styles.filterToggleText, (filtersOpen || hasActiveFilters) && styles.filterToggleTextActive]}>
            Filter{hasActiveFilters ? ` (${[selectedMetal, selectedPurity].filter(Boolean).length + (searchText ? 1 : 0)})` : ''}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.selectToggle} onPress={toggleSelectionMode}>
          <Ionicons name={selectionMode ? 'close' : 'checkmark-circle-outline'} size={16} color={colors.primary} />
          <Text style={styles.selectToggleText}>{selectionMode ? 'Cancel' : 'Select'}</Text>
        </TouchableOpacity>
      </View>

      {filtersOpen && (metalOptions.length > 0 || purityOptions.length > 0) && (
        <View style={styles.filterPanel}>
          {metalOptions.length > 0 && (
            <View style={styles.filterWrap}>
              {metalOptions.map((name) => {
                const active = selectedMetal === name;
                return (
                  <TouchableOpacity
                    key={name}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => handleSelectMetal(name)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {purityOptions.length > 0 && (
            <View style={styles.filterWrap}>
              {purityOptions.map((name) => {
                const active = selectedPurity === name;
                return (
                  <TouchableOpacity
                    key={name}
                    style={[styles.chip, styles.chipPurity, active && styles.chipActive]}
                    onPress={() => handleSelectPurity(name)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {hasActiveFilters && (
            <TouchableOpacity onPress={clearFilters} style={styles.clearFilters}>
              <Text style={styles.clearFiltersText}>Clear filters</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <FlatList
        data={filteredProducts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={filteredProducts.length === 0 ? styles.emptyList : styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="cube-outline" size={40} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>{hasActiveFilters ? 'No products match' : 'No products yet'}</Text>
            <Text style={styles.emptySub}>
              {hasActiveFilters ? 'Try a different search or filter.' : 'Tap "Add Product" below to create your first one.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const uri = primaryImageUrl(item);
          const isSelected = selectedIds.has(item.id);
          const isSold = item.status === 'sold';
          return (
            <TouchableOpacity
              style={[styles.row, isSelected && styles.rowSelected, isSold && styles.rowSold]}
              onPress={() => handleRowPress(item)}
              onLongPress={() => handleRowLongPress(item)}
            >
              {selectionMode && (
                <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                  {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
              )}

              <View>
                {uri ? (
                  <Image source={{ uri }} style={[styles.thumb, isSold && styles.thumbSold]} />
                ) : (
                  <View style={[styles.thumb, styles.thumbPlaceholder, isSold && styles.thumbSold]}>
                    <Ionicons name="image-outline" size={22} color={colors.textMuted} />
                  </View>
                )}
                {isSold && (
                  <View style={styles.soldTag}>
                    <Text style={styles.soldTagText}>SOLD</Text>
                  </View>
                )}
              </View>

              <View style={styles.rowInfo}>
                <Text style={styles.name} numberOfLines={1}>{item.product_name}</Text>
                <Text style={styles.code}>{item.product_code}</Text>
                <Text style={styles.weight}>
                  {Number(item.net_weight).toFixed(3)} g
                  {item.metals?.name ? ` · ${item.metals.name}` : ''}
                  {item.purities?.name ? ` ${item.purities.name}` : ''}
                </Text>
              </View>
              {!selectionMode && (
                <View style={styles.rowRight}>
                  <TouchableOpacity style={styles.shareBtn} onPress={() => handleShare(item)}>
                    <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
                  </TouchableOpacity>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />

      <View style={styles.addButton}>
        {selectionMode ? (
          <TouchableOpacity
            style={[styles.shareSelectedBtn, selectedIds.size === 0 && styles.shareSelectedBtnDisabled]}
            onPress={handleShareSelected}
            disabled={selectedIds.size === 0 || bulkSharing}
          >
            {bulkSharing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="logo-whatsapp" size={18} color="#fff" />
                <Text style={styles.shareSelectedBtnText}>
                  Share {selectedIds.size > 0 ? `${selectedIds.size} ` : ''}Selected
                </Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <Button label="Add Product" onPress={() => router.push('/products/add')} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  list: { padding: spacing.lg, paddingBottom: spacing.xl },
  emptyList: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
  empty: { alignItems: 'center', gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginTop: spacing.sm },
  emptySub: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },

  // Search bar — identical to the invoice list screen's searchBar/searchInput
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius?.md ?? 10,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, padding: 0 },

  toolbarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterToggleActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterToggleText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  filterToggleTextActive: { color: '#fff' },

  selectToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: spacing.sm },
  selectToggleText: { fontSize: 12, fontWeight: '600', color: colors.primary },

  filterPanel: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chipPurity: { borderStyle: 'dashed' },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: '#fff' },

  clearFilters: { alignSelf: 'flex-end' },
  clearFiltersText: { fontSize: 12, color: colors.primary, fontWeight: '600' },

  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginBottom: spacing.sm,
  },
  rowSelected: { borderColor: colors.primary, backgroundColor: colors.background },
  checkbox: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  thumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.border },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1, marginLeft: spacing.md },
  name: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  code: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  weight: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowRight: { alignItems: 'center', gap: 8, flexDirection: 'row' },
  shareBtn: { padding: 4 },
  addButton: { padding: spacing.lg },
  shareSelectedBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#25D366', borderRadius: 12, paddingVertical: 14,
  },
  // shareSelectedBtnDisabled: { opacity: 0.5 },
  shareSelectedBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  // rowSold: { opacity: 0.6 },
  // thumbSold: { opacity: 0.6 },
  soldTag: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    right: -2,
    backgroundColor: '#B00020',
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    paddingVertical: 1,
    alignItems: 'center',
  },
  soldTagText: { color: '#fff', fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
});