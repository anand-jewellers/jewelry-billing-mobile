// app/(tabs)/products/index.tsx
import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  Pressable,
  TextInput,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Platform,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { PageGuard } from '../../../src/components/PageGuard';
import {
  Search,
  X,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Plus,
  SlidersHorizontal,
  Check,
  Weight as WeightIcon,
} from 'lucide-react-native';
import { colors, spacing } from '../../../src/theme';
import { getProducts, getProductById } from '../../../src/lib/products';
import { printHtml } from '../../../src/lib/invoicePdf';
import { buildLabelsHtml } from '../../../src/lib/barcodeLabelHtml';
import { LabelData, productToLabelData } from '../../../src/lib/labelLayout';
import { getProductImageUrl } from '../../../src/lib/storage';
import {
  shareProductOnWhatsApp,
  shareProductsOnWhatsApp,
  getShopShareInfo,
} from '../../../src/lib/whatsappShare';

const PAGE_SIZE = 15;
const BULK_GAP = 10;

interface ProductRow {
  id: string;
  product_name: string;
  product_code: string;
  net_weight: number;
  status?: string;
  metal_id: string | null;
  purity_id: string | null;
  category_id: string | null;
  metals?: { name?: string } | null;
  purities?: { name?: string } | null;
  categories?: { name?: string } | null;
  product_images: { storage_path: string; is_primary: boolean }[];
}

export default function ProductListScreen() {
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();

  // Exact, equal width for the Print and Share buttons:
  // (screen width - left/right padding - gap between buttons) / 2
  const bulkBtnWidth = Math.floor((screenWidth - spacing.lg * 2 - BULK_GAP) / 2);

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters & Search
  const [searchText, setSearchText] = useState('');
  const [selectedMetal, setSelectedMetal] = useState<string | null>(null);
  const [selectedPurity, setSelectedPurity] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  // Weight range filter (net weight, grams), as free-text so the user can
  // type a decimal freely; parsed to numbers only when applying the filter.
  const [minWeight, setMinWeight] = useState('');
  const [maxWeight, setMaxWeight] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  // Multi-select state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSharing, setBulkSharing] = useState(false);
  const [bulkPrinting, setBulkPrinting] = useState(false);

  const bulkBusy = bulkSharing || bulkPrinting;

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

  const categoryOptions = useMemo(() => {
    const names = products.map((p) => p.categories?.name).filter((n): n is string => !!n);
    return Array.from(new Set(names));
  }, [products]);

  function handleSelectMetal(name: string) {
    const next = selectedMetal === name ? null : name;
    setSelectedMetal(next);
    setCurrentPage(1);
    if (next && selectedPurity) {
      const stillValid = products.some(
        (p) => p.metals?.name === next && p.purities?.name === selectedPurity
      );
      if (!stillValid) setSelectedPurity(null);
    }
  }

  function handleSelectPurity(name: string) {
    setSelectedPurity(selectedPurity === name ? null : name);
    setCurrentPage(1);
  }

  function handleSelectCategory(name: string) {
    setSelectedCategory(selectedCategory === name ? null : name);
    setCurrentPage(1);
  }

  function clearFilters() {
    setSearchText('');
    setSelectedMetal(null);
    setSelectedPurity(null);
    setSelectedCategory(null);
    setMinWeight('');
    setMaxWeight('');
    setCurrentPage(1);
  }

  const minWeightNum = minWeight.trim() ? parseFloat(minWeight) : null;
  const maxWeightNum = maxWeight.trim() ? parseFloat(maxWeight) : null;
  const hasWeightFilter =
    (minWeightNum !== null && !isNaN(minWeightNum)) || (maxWeightNum !== null && !isNaN(maxWeightNum));

  const filteredProducts = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return products.filter((p) => {
      const matchesSearch =
        !q ||
        p.product_name.toLowerCase().includes(q) ||
        p.product_code.toLowerCase().includes(q);
      const matchesMetal = !selectedMetal || p.metals?.name === selectedMetal;
      const matchesPurity = !selectedPurity || p.purities?.name === selectedPurity;
      const matchesCategory = !selectedCategory || p.categories?.name === selectedCategory;
      const weight = Number(p.net_weight);
      const matchesMinWeight = minWeightNum === null || isNaN(minWeightNum) || weight >= minWeightNum;
      const matchesMaxWeight = maxWeightNum === null || isNaN(maxWeightNum) || weight <= maxWeightNum;
      return (
        matchesSearch &&
        matchesMetal &&
        matchesPurity &&
        matchesCategory &&
        matchesMinWeight &&
        matchesMaxWeight
      );
    });
  }, [products, searchText, selectedMetal, selectedPurity, selectedCategory, minWeightNum, maxWeightNum]);

  const hasActiveFilters =
    !!searchText || !!selectedMetal || !!selectedPurity || !!selectedCategory || hasWeightFilter;

  const activeFilterCount =
    [selectedMetal, selectedPurity, selectedCategory].filter(Boolean).length +
    (searchText ? 1 : 0) +
    (hasWeightFilter ? 1 : 0);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));

  const paginatedProducts = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredProducts.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredProducts, currentPage]);

  const handlePrevPage = () => {
    if (currentPage > 1) setCurrentPage((prev) => prev - 1);
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) setCurrentPage((prev) => prev + 1);
  };

  async function handleShare(item: ProductRow) {
    const imageUrl = primaryImageUrl(item);
    try {
      const shop = await getShopShareInfo();
      await shareProductOnWhatsApp(item as any, imageUrl, shop);
    } catch (e) {
      console.error('Failed to open WhatsApp', e);
    }
  }

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
      const shop = await getShopShareInfo();
      await shareProductsOnWhatsApp(
        selected.map((p) => ({ ...(p as any), imageUrl: primaryImageUrl(p) })),
        shop
      );
      setSelectionMode(false);
      setSelectedIds(new Set());
    } catch (e) {
      console.error('Failed to share selected products', e);
    } finally {
      setBulkSharing(false);
    }
  }
async function handlePrintSelected() {
  const selected = products.filter((p) => selectedIds.has(p.id));
  if (!selected.length) return;
  setBulkPrinting(true);
  try {
    // List rows don't carry gross/stone weight, HUID or barcode, so load full records
    const full = await Promise.all(selected.map((p) => getProductById(p.id)));

    const labels: LabelData[] = [];
    const skipped: string[] = [];

    full.forEach((p: any, i: number) => {
      // Same mapper as the product detail screen, so labels are identical
      const label = productToLabelData(p);
      if (!label) {
        skipped.push(selected[i].product_name);
        return;
      }
      labels.push(label);
    });

    if (!labels.length) {
      Alert.alert('Nothing to print', 'None of the selected products have a barcode value saved.');
      return;
    }

    await printHtml(buildLabelsHtml(labels));

    if (skipped.length) {
      Alert.alert('Some products skipped', `No barcode saved for: ${skipped.join(', ')}`);
    }
  } catch (e: any) {
    Alert.alert('Error', e?.message ?? 'Could not print barcode labels');
  } finally {
    setBulkPrinting(false);
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
    <PageGuard pageKey="products">
      <View style={styles.screen}>
        {/* Header Section: Title + Jewelry Quote Illustration */}
        {/* <View style={styles.headerSection}>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Products</Text>
          <Text style={styles.headerSubtitle}>Manage and showcase your collection</Text>
        </View>

        <View style={styles.quoteGraphicContainer}>
          <View style={styles.ringGraphic}>
            <View style={styles.ringBandFront} />
            <View style={styles.ringBandBack} />
            <Sparkles size={11} color="#EAB308" style={styles.sparkleOne} />
            <Sparkles size={8} color="#FACC15" style={styles.sparkleTwo} />
          </View>

          <View style={styles.quoteTextWrap}>
            <Text style={styles.quoteLine1}>Pure Elegance</Text>
            <Text style={styles.quoteLine2}>Crafted for You</Text>
            <View style={styles.goldSeparator}>
              <View style={styles.goldLine} />
              <View style={styles.goldGemDot} />
              <View style={styles.goldLine} />
            </View>
          </View>
        </View>
      </View> */}

        {/* Search Toolbar */}
        <View style={styles.searchToolbar}>
          <View style={styles.searchBar}>
            <Search size={18} color="#94A3B8" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name or code"
              placeholderTextColor="#94A3B8"
              value={searchText}
              onChangeText={(text) => {
                setSearchText(text);
                setCurrentPage(1);
              }}
            />
            {searchText.length > 0 && (
              <Pressable
                onPress={() => {
                  setSearchText('');
                  setCurrentPage(1);
                }}
                hitSlop={8}
              >
                <X size={16} color="#94A3B8" />
              </Pressable>
            )}
          </View>
        </View>

        {/* Filter and Selection Toolbar Row */}
        <View style={styles.toolbarRow}>
          <Pressable
            style={[styles.filterToggle, (filtersOpen || hasActiveFilters) && styles.filterToggleActive]}
            onPress={() => setFiltersOpen((v) => !v)}
          >
            <SlidersHorizontal
              size={15}
              color={filtersOpen || hasActiveFilters ? '#FFFFFF' : '#475569'}
            />
            <Text
              style={[
                styles.filterToggleText,
                (filtersOpen || hasActiveFilters) && styles.filterToggleTextActive,
              ]}
            >
              Filter
              {hasActiveFilters ? ` (${activeFilterCount})` : ''}
            </Text>
          </Pressable>

          <Pressable style={styles.weightToggle} onPress={() => router.push('/products/weight')}>
            <WeightIcon size={15} color="#475569" />
            <Text style={styles.weightToggleText}>Weight</Text>
          </Pressable>

          <Pressable
            style={[styles.selectToggle, selectionMode && styles.selectToggleActive]}
            onPress={toggleSelectionMode}
          >
            {selectionMode ? (
              <X size={15} color="#DC2626" />
            ) : (
              <Check size={15} color={colors.primary} />
            )}
            <Text style={[styles.selectToggleText, selectionMode && styles.selectToggleTextActive]}>
              {selectionMode ? 'Cancel' : 'Select'}
            </Text>
          </Pressable>
        </View>

        {/* Filter Dropdown Tray */}
        {filtersOpen && (
          <View style={styles.filterPanel}>
            {categoryOptions.length > 0 && (
              <>
                <Text style={styles.filterGroupLabel}>Category</Text>
                <View style={styles.filterWrap}>
                  {categoryOptions.map((name) => {
                    const active = selectedCategory === name;
                    return (
                      <Pressable
                        key={name}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => handleSelectCategory(name)}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {metalOptions.length > 0 && (
              <>
                <Text style={styles.filterGroupLabel}>Metal</Text>
                <View style={styles.filterWrap}>
                  {metalOptions.map((name) => {
                    const active = selectedMetal === name;
                    return (
                      <Pressable
                        key={name}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => handleSelectMetal(name)}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {purityOptions.length > 0 && (
              <>
                <Text style={styles.filterGroupLabel}>Purity</Text>
                <View style={styles.filterWrap}>
                  {purityOptions.map((name) => {
                    const active = selectedPurity === name;
                    return (
                      <Pressable
                        key={name}
                        style={[styles.chip, styles.chipPurity, active && styles.chipActive]}
                        onPress={() => handleSelectPurity(name)}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            <Text style={styles.filterGroupLabel}>Net Weight (g)</Text>
            <View style={styles.weightRangeRow}>
              <TextInput
                style={styles.weightInput}
                placeholder="Min"
                placeholderTextColor="#94A3B8"
                keyboardType="decimal-pad"
                value={minWeight}
                onChangeText={(v) => {
                  setMinWeight(v);
                  setCurrentPage(1);
                }}
              />
              <Text style={styles.weightRangeSeparator}>–</Text>
              <TextInput
                style={styles.weightInput}
                placeholder="Max"
                placeholderTextColor="#94A3B8"
                keyboardType="decimal-pad"
                value={maxWeight}
                onChangeText={(v) => {
                  setMaxWeight(v);
                  setCurrentPage(1);
                }}
              />
            </View>

            <View style={styles.filterFooter}>
              {hasActiveFilters ? (
                <Pressable onPress={clearFilters} style={styles.clearFiltersBtn}>
                  <Text style={styles.clearFiltersText}>Clear filters</Text>
                </Pressable>
              ) : (
                <View />
              )}
              <Pressable onPress={() => setFiltersOpen(false)} style={styles.applyFiltersBtn}>
                <Text style={styles.applyFiltersBtnText}>OK</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Product List */}
        <FlatList
          data={paginatedProducts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="cube-outline" size={42} color="#94A3B8" />
              <Text style={styles.emptyTitle}>
                {hasActiveFilters ? 'No products match' : 'No products yet'}
              </Text>
              <Text style={styles.emptySub}>
                {hasActiveFilters
                  ? 'Try adjusting your search or active filters.'
                  : 'Tap "+ Add Product" below to list your first item.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const uri = primaryImageUrl(item);
            const isSelected = selectedIds.has(item.id);
            const isSold = item.status === 'sold';

            return (
              <Pressable
                style={[
                  styles.productCard,
                  isSelected && styles.productCardSelected,
                  isSold && styles.productCardSold,
                ]}
                onPress={() => handleRowPress(item)}
                onLongPress={() => handleRowLongPress(item)}
              >
                {selectionMode && (
                  <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                    {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>
                )}

                {/* Product Thumbnail Container */}
                <View style={styles.thumbWrapper}>
                  {uri ? (
                    <Image source={{ uri }} style={[styles.thumb, isSold && styles.thumbSold]} />
                  ) : (
                    <View style={[styles.thumb, styles.thumbPlaceholder, isSold && styles.thumbSold]}>
                      <Ionicons name="image-outline" size={24} color="#94A3B8" />
                    </View>
                  )}
                  {isSold && (
                    <View style={styles.soldBadge}>
                      <Text style={styles.soldBadgeText}>SOLD</Text>
                    </View>
                  )}
                </View>

                {/* Product Metadata Info */}
                <View style={styles.infoCol}>
                  <Text style={styles.productName} numberOfLines={1}>
                    {item.product_name}
                  </Text>
                  <Text style={styles.productCode}>{item.product_code}</Text>
                  <Text style={styles.productWeight}>
                    {Number(item.net_weight).toFixed(3)} g
                    {item.metals?.name ? ` · ${item.metals.name}` : ''}
                    {item.purities?.name ? ` ${item.purities.name}` : ''}
                  </Text>
                </View>

                {/* Actions: WhatsApp + Chevron */}
                {!selectionMode && (
                  <View style={styles.actionRow}>
                    <Pressable
                      style={styles.whatsAppBtn}
                      onPress={() => handleShare(item)}
                      hitSlop={8}
                    >
                      <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
                    </Pressable>
                    <ChevronRight size={18} color="#94A3B8" style={styles.chevron} />
                  </View>
                )}
              </Pressable>
            );
          }}
          ListFooterComponent={
            filteredProducts.length > 0 ? (
              <View style={styles.paginationContainer}>
                <Pressable
                  style={[styles.pageButton, currentPage === 1 && styles.pageButtonDisabled]}
                  onPress={handlePrevPage}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft size={16} color={currentPage === 1 ? '#CBD5E1' : '#0F172A'} />
                  <Text
                    style={[
                      styles.pageButtonText,
                      currentPage === 1 && styles.pageButtonTextDisabled,
                    ]}
                  >
                    Previous
                  </Text>
                </Pressable>

                <View style={styles.pageInfoWrap}>
                  <Text style={styles.pageInfoText}>
                    Page <Text style={styles.pageInfoBold}>{currentPage}</Text> of{' '}
                    <Text style={styles.pageInfoBold}>{totalPages}</Text>
                  </Text>
                </View>

                <Pressable
                  style={[
                    styles.pageButton,
                    currentPage === totalPages && styles.pageButtonDisabled,
                  ]}
                  onPress={handleNextPage}
                  disabled={currentPage === totalPages}
                >
                  <Text
                    style={[
                      styles.pageButtonText,
                      currentPage === totalPages && styles.pageButtonTextDisabled,
                    ]}
                  >
                    Next
                  </Text>
                  <ChevronRight
                    size={16}
                    color={currentPage === totalPages ? '#CBD5E1' : '#0F172A'}
                  />
                </Pressable>
              </View>
            ) : null
          }
        />

        {/* Action Footer: Bulk Print/Share or Floating "+ Add Product" Button */}
        {selectionMode ? (
          <View style={styles.bulkActionContainer}>
            <Pressable
              style={[
                styles.bulkBtn,
                { width: bulkBtnWidth },
                styles.printSelectedBtn,
                (selectedIds.size === 0 || bulkBusy) && styles.bulkBtnDisabled,
              ]}
              onPress={handlePrintSelected}
              disabled={selectedIds.size === 0 || bulkBusy}
            >
              {bulkPrinting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="print-outline" size={20} color="#fff" />
                  <Text style={styles.bulkBtnText}>Print</Text>
                </>
              )}
            </Pressable>

            <Pressable
              style={[
                styles.bulkBtn,
                { width: bulkBtnWidth },
                styles.shareSelectedBtn,
                (selectedIds.size === 0 || bulkBusy) && styles.bulkBtnDisabled,
              ]}
              onPress={handleShareSelected}
              disabled={selectedIds.size === 0 || bulkBusy}
            >
              {bulkSharing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="logo-whatsapp" size={20} color="#fff" />
                  <Text style={styles.bulkBtnText}>Share</Text>
                </>
              )}
            </Pressable>
          </View>
        ) : (
          <View style={styles.fabWrapper}>
            <Pressable style={styles.fabButton} onPress={() => router.push('/products/add')}>
              <Plus size={24} color="#FFFFFF" strokeWidth={2.5} />
            </Pressable>
            <Text style={styles.fabLabel}>Add Product</Text>
          </View>
        )}
      </View>
    </PageGuard>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  headerSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  headerTitleContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '400',
  },
  quoteGraphicContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 12,
  },
  ringGraphic: {
    width: 42,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  ringBandFront: {
    width: 25,
    height: 25,
    borderRadius: 12.5,
    borderWidth: 3,
    borderColor: '#EAB308',
    backgroundColor: 'transparent',
    position: 'absolute',
    left: 2,
    top: 6,
    zIndex: 2,
  },
  ringBandBack: {
    width: 25,
    height: 25,
    borderRadius: 12.5,
    borderWidth: 3,
    borderColor: '#FACC15',
    backgroundColor: 'transparent',
    position: 'absolute',
    right: 3,
    top: 4,
    zIndex: 1,
  },
  sparkleOne: {
    position: 'absolute',
    top: 0,
    right: -2,
    zIndex: 3,
  },
  sparkleTwo: {
    position: 'absolute',
    bottom: 2,
    left: -2,
    zIndex: 3,
  },
  quoteTextWrap: {
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  quoteLine1: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400E',
    fontStyle: 'italic',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  quoteLine2: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B45309',
    fontStyle: 'italic',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  goldSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
    width: '100%',
  },
  goldLine: {
    height: 1,
    flex: 1,
    backgroundColor: '#F59E0B',
    opacity: 0.6,
  },
  goldGemDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#D97706',
  },
  searchToolbar: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 48,
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    padding: 0,
  },
  weightToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  weightToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  toolbarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: 10,
  },
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  filterToggleActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  filterToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  filterToggleTextActive: {
    color: '#FFFFFF',
  },
  selectToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  selectToggleActive: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  selectToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  selectToggleTextActive: {
    color: '#DC2626',
  },
  filterPanel: {
    marginHorizontal: spacing.lg,
    marginTop: 10,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  filterGroupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
    marginTop: 4,
  },
  filterWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  chipPurity: {
    borderStyle: 'dashed',
  },
  chipActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  weightRangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  weightInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    fontSize: 13,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  weightRangeSeparator: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '600',
  },
  filterFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  clearFiltersBtn: {
    paddingVertical: 6,
  },
  clearFiltersText: {
    fontSize: 12,
    color: '#B45309',
    fontWeight: '700',
  },
  applyFiltersBtn: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 28,
  },
  applyFiltersBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 110,
  },
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
  productCardSelected: {
    borderColor: colors.primary,
    backgroundColor: '#FFFBEB',
  },
  productCardSold: {
    opacity: 0.85,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  thumbWrapper: {
    position: 'relative',
  },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbSold: {
    opacity: 0.65,
  },
  soldBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#DC2626',
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    paddingVertical: 2,
    alignItems: 'center',
  },
  soldBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  infoCol: {
    flex: 1,
    marginLeft: 14,
    justifyContent: 'center',
  },
  productName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  productCode: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  productWeight: {
    fontSize: 12,
    fontWeight: '500',
    color: '#475569',
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 8,
  },
  whatsAppBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    marginLeft: 2,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 8,
  },
  emptySub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    maxWidth: 240,
  },
  paginationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  pageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  pageButtonDisabled: {
    backgroundColor: '#F8FAFC',
    borderColor: '#F1F5F9',
    elevation: 0,
    shadowOpacity: 0,
  },
  pageButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  pageButtonTextDisabled: {
    color: '#CBD5E1',
  },
  pageInfoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageInfoText: {
    fontSize: 13,
    color: '#64748B',
  },
  pageInfoBold: {
    fontWeight: '700',
    color: '#0F172A',
  },
  fabWrapper: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    alignItems: 'center',
  },
  fabButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1E3A8A',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1E3A8A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  fabLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1E3A8A',
    marginTop: 3,
  },
  bulkActionContainer: {
    position: 'absolute',
    bottom: 20,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Shared by both buttons. Width is set inline (bulkBtnWidth) so both are
  // exactly equal; height is fixed so the spinner never changes the size.
  bulkBtn: {
    height: 52,
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  shareSelectedBtn: {
    backgroundColor: '#25D366',
    shadowColor: '#25D366',
  },
  printSelectedBtn: {
    backgroundColor: '#1E3A8A',
    shadowColor: '#1E3A8A',
  },
  bulkBtnDisabled: {
    opacity: 0.5,
  },
  bulkBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});