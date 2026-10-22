// app/(tabs)/products/add.tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, Pressable, StyleSheet,
  ActivityIndicator, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { CheckCircle2, ChevronDown, ChevronUp, Plus, X } from 'lucide-react-native';
import { colors, spacing } from '../../../src/theme';
import { SelectField, SelectOption } from '../../../src/components/ui/SelectField';
import { MultiSelectField } from '../../../src/components/ui/MultiSelectField';
import { ErrorModal } from '../../../src/components/ui/ErrorModal';
import { ImagePickerGrid, PickedImage } from '../../../src/components/product/ImagePickerGrid';
import {
  getMetals, getPurities, getCategories, getSubcategories, getStoneNames,
  createProduct, insertProductImages, saveProductCharges,
} from '../../../src/lib/products';
import {
  createCategory,
  createSubcategory,
  createPurity,
  createStoneName,
} from '../../../src/lib/api/settings';
import { uploadProductImageBase64 } from '../../../src/lib/storage';
import { useStaff } from '../../../src/context/StaffContext';
import { useNotifications } from '../../../src/context/NotificationContext';
import { PageGuard } from '../../../src/components/PageGuard';

// How long the "Product Saved" popup stays up before auto-navigating to the
// product list. A tap on "View Now" inside the popup skips the wait.
const SAVED_POPUP_AUTO_NAV_MS = 1500;

// Route to the product list screen.
const PRODUCT_LIST_ROUTE = '/products';

// One row of diamond size + amount (only used when the metal is Diamond).
type DiamondRow = { key: string; size: string; amount: string };

// ---------- Small layout helpers ----------

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        {hint ? <Text style={styles.cardHint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Field({ label, children, style }: { label: string; children: ReactNode; style?: any }) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

// Exported screen: only renders the form (and runs its data loading)
// when the user has the 'products.add' permission.
export default function AddProductScreen() {
  return (
    <PageGuard pageKey="products.add">
      <AddProductScreenInner />
    </PageGuard>
  );
}

function AddProductScreenInner() {
  const router = useRouter();
  const { currentStaff } = useStaff();
  const { notify } = useNotifications();
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedProduct, setSavedProduct] = useState<any>(null);
  const autoNavTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Error modal state. errorInfo is intentionally NOT cleared on close so the
  // message stays mounted while the modal fades out; errorVisible drives it.
  const [errorInfo, setErrorInfo] = useState<{ title: string; message: string } | null>(null);
  const [errorVisible, setErrorVisible] = useState(false);

  function showError(message: string, title = 'Something went wrong') {
    setErrorInfo({ title, message });
    setErrorVisible(true);
  }

  const [metals, setMetals] = useState<SelectOption[]>([]);
  const [purities, setPurities] = useState<SelectOption[]>([]);
  const [categories, setCategories] = useState<SelectOption[]>([]);
  const [subcategories, setSubcategories] = useState<SelectOption[]>([]);

  const [productName, setProductName] = useState('');
  const [metalId, setMetalId] = useState<string | null>(null);
  const [purityId, setPurityId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  const [brand, setBrand] = useState('');
  const [huid, setHuid] = useState('');
  const [designNumber, setDesignNumber] = useState('');
  const [hsnCode, setHsnCode] = useState('7113');
  const [size, setSize] = useState('');
  const [showMore, setShowMore] = useState(false);

  const [grossWeight, setGrossWeight] = useState('');
  const [stoneWeight, setStoneWeight] = useState('');
  const [otherWeight, setOtherWeight] = useState('');

  // Stones: a product can carry several (dropdown multi-select).
  const [stoneOptions, setStoneOptions] = useState<SelectOption[]>([]);
  const [stoneIds, setStoneIds] = useState<string[]>([]);

  // Amount (₹) per stone, keyed by stone id. Only shown when 2+ stones are
  // selected; the Stone Charge field then becomes the auto-calculated total.
  const [stoneAmounts, setStoneAmounts] = useState<Record<string, string>>({});

  // Diamond rows (size + amount). Shown only when the metal is Diamond.
  const [diamonds, setDiamonds] = useState<DiamondRow[]>([{ key: 'd0', size: '', amount: '' }]);

  // Per-product charges (rules, not frozen amounts — applied at invoice time).
  const [vacPercent, setVacPercent] = useState('');
  const [stoneChargeFixed, setStoneChargeFixed] = useState('');
  const [makingChargeFixed, setMakingChargeFixed] = useState('');

  const [images, setImages] = useState<PickedImage[]>([]);

  // Diamond detection: metal OR category whose name contains "diamond".
  // (e.g. Metal: Gold + Category: Diamond still shows the diamond size/rate rows.)
  const selectedMetalLabel = metals.find((m) => m.id === metalId)?.label ?? '';
  const selectedCategoryLabel = categories.find((c) => c.id === categoryId)?.label ?? '';
  const isDiamond =
    /diamond/i.test(selectedMetalLabel) || /diamond/i.test(selectedCategoryLabel);

  // ---------- Stone charge logic ----------
  // 0 or 1 stone  -> single "Stone Charge ₹" field, typed by the user.
  // 2+ stones     -> one amount field per stone name; Stone Charge = their sum.
  const multiStone = stoneIds.length >= 2;
  const stoneAmountTotal = stoneIds.reduce(
    (sum, id) => sum + (parseFloat(stoneAmounts[id]) || 0),
    0
  );
  const stoneChargeNum = multiStone ? stoneAmountTotal : parseFloat(stoneChargeFixed) || 0;

  useEffect(() => {
    (async () => {
      try {
        const [m, c, stones] = await Promise.all([
          getMetals(),
          getCategories(),
          getStoneNames(),
        ]);
        setMetals(m.map((x: any) => ({ id: x.id, label: x.name })));
        setCategories(c.map((x: any) => ({ id: x.id, label: x.name })));
        setStoneOptions((stones ?? []).map((x: any) => ({ id: x.id, label: x.name })));
      } catch (e: any) {
        showError(e.message ?? 'Failed to load master data');
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, []);

  useEffect(() => {
    setPurityId(null); setPurities([]);
    if (!metalId) return;
    getPurities(metalId)
      .then((p) => setPurities(p.map((x: any) => ({ id: x.id, label: x.name }))))
      .catch((e) => showError(e.message ?? 'Failed to load purities'));
  }, [metalId]);

  useEffect(() => {
    setSubcategoryId(null); setSubcategories([]);
    if (!categoryId) return;
    getSubcategories(categoryId)
      .then((s) => setSubcategories(s.map((x: any) => ({ id: x.id, label: x.name }))))
      .catch((e) => showError(e.message ?? 'Failed to load subcategories'));
  }, [categoryId]);

  useEffect(() => {
    return () => {
      if (autoNavTimer.current) clearTimeout(autoNavTimer.current);
    };
  }, []);

  const grossNum = parseFloat(grossWeight) || 0;
  const stoneNum = parseFloat(stoneWeight) || 0;
  const otherNum = parseFloat(otherWeight) || 0;
  const netWeight = Math.max(grossNum - stoneNum - otherNum, 0);

  // ---------- Diamond row helpers ----------

  function addDiamondRow() {
    setDiamonds((prev) => [...prev, { key: `d${Date.now()}`, size: '', amount: '' }]);
  }
  function updateDiamondRow(key: string, patch: Partial<DiamondRow>) {
    setDiamonds((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeDiamondRow(key: string) {
    setDiamonds((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  function validate(): string | null {
    if (!productName.trim()) return 'Product name is required';
    if (!metalId) return 'Select a metal';
    if (!purityId) return 'Select a purity';
    if (!grossWeight || grossNum <= 0) return 'Enter gross weight';
    if (stoneNum + otherNum > grossNum) return 'Stone + other weight is more than gross weight';
    if (isDiamond) {
      const bad = diamonds.some(
        (d) => (d.size.trim() && !(parseFloat(d.amount) > 0)) || (!d.size.trim() && d.amount.trim())
      );
      if (bad) return 'Each diamond row needs both a size and an amount';
    }
    return null;
  }

  function goToProductList() {
    if (autoNavTimer.current) clearTimeout(autoNavTimer.current);
    router.replace(PRODUCT_LIST_ROUTE as never);
  }

  // ---------- Inline "Add New" handlers for the master-data dropdowns ----------

  async function handleAddCategory(name: string): Promise<SelectOption> {
    const created = await createCategory({ name });
    const opt: SelectOption = { id: created.id, label: created.name };
    setCategories((prev) => [...prev, opt].sort((a, b) => a.label.localeCompare(b.label)));
    return opt;
  }

  async function handleAddSubcategory(name: string): Promise<SelectOption> {
    if (!categoryId) throw new Error('Select a category first');
    const created = await createSubcategory({ category_id: categoryId, name });
    const opt: SelectOption = { id: created.id, label: created.name };
    setSubcategories((prev) => [...prev, opt].sort((a, b) => a.label.localeCompare(b.label)));
    return opt;
  }

  async function handleAddPurity(name: string): Promise<SelectOption> {
    if (!metalId) throw new Error('Select a metal first');
    const created = await createPurity({ metal_id: metalId, name, purity_percentage: null });
    const opt: SelectOption = { id: created.id, label: created.name };
    setPurities((prev) => [...prev, opt].sort((a, b) => a.label.localeCompare(b.label)));
    return opt;
  }

  async function handleAddStoneName(name: string): Promise<SelectOption> {
    const created = await createStoneName({ name });
    const opt: SelectOption = { id: created.id, label: created.name };
    setStoneOptions((prev) => [...prev, opt].sort((a, b) => a.label.localeCompare(b.label)));
    return opt;
  }

  async function handleSave() {
    const err = validate();
    if (err) { showError(err, 'Missing information'); return; }
    if (!currentStaff) {
      showError('Please log in again.', 'Session expired');
      return;
    }
    setSaving(true);
    try {
      // Per-stone amounts: with 2+ stones each uses its own field; with a
      // single stone its amount is simply the Stone Charge.
      const stonesPayload = stoneIds.map((id) => ({
        stone_id: id,
        amount: multiStone ? parseFloat(stoneAmounts[id]) || 0 : stoneChargeNum,
      }));

      const product = await createProduct({
        product_name: productName.trim(),
        category_id: categoryId,
        subcategory_id: subcategoryId,
        brand: brand || undefined,
        metal_id: metalId!,
        purity_id: purityId!,
        gross_weight: grossNum,
        stone_weight: stoneNum,
        other_weight: otherNum,
        net_weight: netWeight,
        hsn_code: hsnCode || undefined,
        huid: huid || undefined,
        design_number: designNumber || undefined,
        size: size || undefined,
        stones: stonesPayload,
        diamonds: isDiamond
          ? diamonds
            .filter((d) => d.size.trim())
            .map((d) => ({ size: d.size.trim(), amount: parseFloat(d.amount) || 0 }))
          : [],
      }, currentStaff.id);

      if (images.length) {
        const uploaded = await Promise.all(
          images.map((img, idx) => uploadProductImageBase64(product.id, img.base64!, idx))
        );
        await insertProductImages(uploaded.map((u, idx) => ({
          product_id: product.id, storage_path: u.storagePath, is_primary: images[idx].isPrimary, sort_order: idx,
        })), currentStaff.id);
      }

      // Zero-value charges are skipped inside saveProductCharges.
      await saveProductCharges(
        product.id,
        [
          { charge_name: 'Value Added Charge', calculation_type: 'percentage', value: parseFloat(vacPercent) || 0 },
          { charge_name: 'Stone Charge', calculation_type: 'fixed', value: stoneChargeNum },
          { charge_name: 'Making Charge', calculation_type: 'fixed', value: parseFloat(makingChargeFixed) || 0 },
        ],
        currentStaff.id
      );

      // Notification failure must never block the success popup.
      try {
        await notify(
          'product',
          'New product added',
          `${product.product_name} (${product.product_code}) was added to inventory`
        );
      } catch (notifyError) {
        console.warn('Failed to send product notification', notifyError);
      }

      setSavedProduct(product);
      autoNavTimer.current = setTimeout(() => {
        router.replace(PRODUCT_LIST_ROUTE as never);
      }, SAVED_POPUP_AUTO_NAV_MS);
    } catch (e: any) {
      showError(e.message ?? 'Failed to save product', 'Could not save product');
    } finally {
      setSaving(false);
    }
  }

  if (loadingMeta) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <ErrorModal
          visible={errorVisible}
          title={errorInfo?.title}
          message={errorInfo?.message ?? null}
          onClose={() => setErrorVisible(false)}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Photos */}
        <Card title="Photos" hint="First photo is the main image">
          <ImagePickerGrid images={images} onChange={setImages} />
        </Card>

        {/* 2. Item */}
        <Card title="Item">
          <Field label="Product name *">
            <TextInput
              style={styles.input}
              placeholder="e.g. Temple Necklace"
              placeholderTextColor={colors.textMuted}
              value={productName}
              onChangeText={setProductName}
            />
          </Field>
          <SelectField
            label="Category"
            value={categoryId}
            options={categories}
            onChange={setCategoryId}
            onAddNew={handleAddCategory}
          />
          <SelectField
            label="Subcategory"
            value={subcategoryId}
            options={subcategories}
            onChange={setSubcategoryId}
            disabled={!categoryId}
            onAddNew={handleAddSubcategory}
          />
        </Card>

        {/* 3. Metal & purity */}
        <Card title="Metal & Purity">
          <SelectField
            label="Metal *"
            value={metalId}
            options={metals}
            onChange={setMetalId}
          />
          <SelectField
            label="Purity *"
            value={purityId}
            options={purities}
            onChange={setPurityId}
            disabled={!metalId}
            onAddNew={handleAddPurity}
          />
        </Card>

        {/* 4. Weight */}
        <Card title="Weight" hint="in grams">
          <View style={styles.row}>
            <Field label="Gross *" style={styles.col}>
              <TextInput
                style={styles.input}
                placeholder="0.000"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                value={grossWeight}
                onChangeText={setGrossWeight}
              />
            </Field>
            <Field label="Stone" style={styles.col}>
              <TextInput
                style={styles.input}
                placeholder="0.000"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                value={stoneWeight}
                onChangeText={setStoneWeight}
              />
            </Field>
            <Field label="Other" style={styles.col}>
              <TextInput
                style={styles.input}
                placeholder="0.000"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                value={otherWeight}
                onChangeText={setOtherWeight}
              />
            </Field>
          </View>
          <View style={styles.netBanner}>
            <Text style={styles.netLabel}>Net weight</Text>
            <Text style={styles.netValue}>{netWeight.toFixed(3)} g</Text>
          </View>
        </Card>

        {/* 5. Diamonds (Diamond metal only) */}
        {isDiamond && (
          <Card title="Diamonds" hint="Add each size with its amount">
            {diamonds.map((row) => (
              <View key={row.key} style={styles.diamondRow}>
                <Field label="Size" style={styles.col}>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 0.25 ct"
                    placeholderTextColor={colors.textMuted}
                    value={row.size}
                    onChangeText={(v) => updateDiamondRow(row.key, { size: v })}
                  />
                </Field>
                <Field label="Rate ₹" style={styles.col}>
                  <TextInput
                    style={styles.input}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    value={row.amount}
                    onChangeText={(v) => updateDiamondRow(row.key, { amount: v })}
                  />
                </Field>
                {diamonds.length > 1 && (
                  <TouchableOpacity
                    onPress={() => removeDiamondRow(row.key)}
                    hitSlop={8}
                    style={styles.removeBtn}
                  >
                    <X size={18} color="#DC2626" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <TouchableOpacity style={styles.addRowBtn} onPress={addDiamondRow}>
              <Plus size={16} color={colors.primary} />
              <Text style={styles.addRowBtnText}>Add another size</Text>
            </TouchableOpacity>
          </Card>
        )}

        {/* 6. Stones */}
        <Card
          title="Stones"
          hint={multiStone ? 'Enter an amount for each stone' : undefined}
        >
          <MultiSelectField
            options={stoneOptions}
            values={stoneIds}
            onChange={setStoneIds}
            placeholder="Select stones"
            onAddNew={handleAddStoneName}
          />
          {stoneOptions.length === 0 && (
            <Text style={styles.helperText}>
              No stone names yet — tap the field and use "+ Add New" to create one.
            </Text>
          )}

          {/* Name-based amounts: only when 2 or more stones are selected */}
          {multiStone && (
            <View style={styles.stoneAmounts}>
              {stoneIds.map((id) => {
                const label = stoneOptions.find((s) => s.id === id)?.label ?? 'Stone';
                return (
                  <Field key={id} label={`${label} amount ₹`}>
                    <TextInput
                      style={styles.input}
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="decimal-pad"
                      value={stoneAmounts[id] ?? ''}
                      onChangeText={(v) => setStoneAmounts((prev) => ({ ...prev, [id]: v }))}
                    />
                  </Field>
                );
              })}
            </View>
          )}
        </Card>

        {/* 7. Charges */}
        <Card title="Charges" hint="Applied at invoice time">
          <View style={styles.row}>
            <Field label="Value added %" style={styles.col}>
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                value={vacPercent}
                onChangeText={setVacPercent}
              />
            </Field>
            <Field label="Making charge ₹" style={styles.col}>
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                value={makingChargeFixed}
                onChangeText={setMakingChargeFixed}
              />
            </Field>
          </View>

          {multiStone ? (
            <Field label="Stone charge ₹ (total of stones above)">
              <View style={[styles.input, styles.inputLocked]}>
                <Text style={styles.lockedText}>{stoneAmountTotal.toFixed(2)}</Text>
              </View>
            </Field>
          ) : (
            <Field label="Stone charge ₹">
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                value={stoneChargeFixed}
                onChangeText={setStoneChargeFixed}
              />
            </Field>
          )}
        </Card>

        {/* 8. More details (collapsed by default) */}
        <View style={styles.card}>
          <Pressable style={styles.moreHeader} onPress={() => setShowMore((v) => !v)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>More details</Text>
              <Text style={styles.cardHint}>Size, HUID, design number, brand, HSN</Text>
            </View>
            {showMore ? (
              <ChevronUp size={20} color={colors.textMuted} />
            ) : (
              <ChevronDown size={20} color={colors.textMuted} />
            )}
          </Pressable>

          {showMore && (
            <View style={{ marginTop: spacing.md }}>
              <Field label="Size">
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Ring size 16, Bangle 2.4"
                  placeholderTextColor={colors.textMuted}
                  value={size}
                  onChangeText={setSize}
                />
              </Field>
              <View style={styles.row}>
                <Field label="HUID" style={styles.col}>
                  <TextInput
                    style={styles.input}
                    placeholder="HUID"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="characters"
                    value={huid}
                    onChangeText={setHuid}
                  />
                </Field>
                <Field label="Design no." style={styles.col}>
                  <TextInput
                    style={styles.input}
                    placeholder="Design number"
                    placeholderTextColor={colors.textMuted}
                    value={designNumber}
                    onChangeText={setDesignNumber}
                  />
                </Field>
              </View>
              <View style={styles.row}>
                <Field label="Brand" style={styles.col}>
                  <TextInput
                    style={styles.input}
                    placeholder="Brand"
                    placeholderTextColor={colors.textMuted}
                    value={brand}
                    onChangeText={setBrand}
                  />
                </Field>
                <Field label="HSN code" style={styles.col}>
                  <TextInput
                    style={styles.input}
                    placeholder="HSN code"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    value={hsnCode}
                    onChangeText={setHsnCode}
                  />
                </Field>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sticky save bar */}
      <View style={styles.footer}>
        <View>
          <Text style={styles.footerLabel}>Net weight</Text>
          <Text style={styles.footerValue}>{netWeight.toFixed(3)} g</Text>
        </View>
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Product</Text>}
        </TouchableOpacity>
      </View>

      <Modal visible={!!savedProduct} transparent animationType="fade" onRequestClose={goToProductList}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <CheckCircle2 size={48} color={colors.primary} style={{ marginBottom: spacing.sm }} />
            <Text style={styles.successTitle}>Product Saved</Text>
            <Text style={styles.successSub}>{savedProduct?.product_name}</Text>
            <Text style={styles.successCode}>Code: {savedProduct?.product_code}</Text>
            <Text style={styles.successNote}>
              Pricing for this item will be calculated automatically using the metal rate on the day it's invoiced.
            </Text>
            <TouchableOpacity style={styles.viewNowBtn} onPress={goToProductList}>
              <Text style={styles.viewNowBtnText}>View Now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ErrorModal
        visible={errorVisible}
        title={errorInfo?.title}
        message={errorInfo?.message ?? null}
        onClose={() => setErrorVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  screen: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: spacing.sm },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardHint: { fontSize: 12, color: colors.textMuted },

  field: { marginBottom: spacing.sm },
  label: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.background,
  },
  inputLocked: { justifyContent: 'center', opacity: 0.8 },
  lockedText: { fontSize: 15, fontWeight: '700', color: colors.text },

  row: { flexDirection: 'row', gap: spacing.sm },
  col: { flex: 1 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  chipTextActive: { color: '#fff' },

  netBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    marginTop: 2,
  },
  netLabel: { fontSize: 13, fontWeight: '600', color: '#92400E' },
  netValue: { fontSize: 17, fontWeight: '800', color: '#92400E' },

  diamondRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  removeBtn: { height: 44, width: 28, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  addRowBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 },
  addRowBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },

  helperText: { color: colors.textMuted, fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  stoneAmounts: { marginTop: spacing.sm },

  moreHeader: { flexDirection: 'row', alignItems: 'center' },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerLabel: { fontSize: 11, color: colors.textMuted },
  footerValue: { fontSize: 16, fontWeight: '800', color: colors.text },
  saveBtn: {
    flex: 1,
    maxWidth: 220,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  successTitle: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' },
  successSub: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: 4 },
  successCode: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 2 },
  successNote: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md, fontStyle: 'italic' },
  viewNowBtn: { marginTop: spacing.lg, paddingVertical: 10, paddingHorizontal: 20 },
  viewNowBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
});