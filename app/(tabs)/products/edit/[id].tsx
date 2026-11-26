// app/(tabs)/products/edit/[id].tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, Pressable, StyleSheet,
  ActivityIndicator, Modal, Image, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CheckCircle2, ChevronDown, ChevronUp, Plus, X } from 'lucide-react-native';
import { colors, spacing, radius } from '../../../../src/theme';
import { SelectField, SelectOption } from '../../../../src/components/ui/SelectField';
import { MultiSelectField } from '../../../../src/components/ui/MultiSelectField';
import { ErrorModal } from '../../../../src/components/ui/ErrorModal';
import { ImagePickerGrid, PickedImage } from '../../../../src/components/product/ImagePickerGrid';
import {
  getMetals, getPurities, getCategories, getSubcategories, getStoneNames,
  getProductById, updateProduct, setProductStones, setProductDiamonds, updateProductCharges,
  insertProductImages, deleteProductImage, setProductImagePrimary, clearProductImagePrimary,
} from '../../../../src/lib/products';
import {
  listTaxSettings,
  createCategory,
  createSubcategory,
  createStoneName,
} from '../../../../src/lib/api/settings';
import type { TaxSetting } from '../../../../src/types/settings';
import { uploadProductImageBase64, getProductImageUrl } from '../../../../src/lib/storage';
import { useStaff } from '../../../../src/context/StaffContext';
import { PageGuard } from '../../../../src/components/PageGuard';

const SAVED_POPUP_AUTO_NAV_MS = 1500;

// Increase this if a header sits above the screen and the keyboard still
// covers the focused field a little (iOS only).
const KEYBOARD_VERTICAL_OFFSET = 0;

const isPurity916 = (name?: string | null, percentage?: number | null): boolean => {
  if (name && /916|91\.6|22\s*k/i.test(name)) return true;
  const pct = Number(percentage);
  return Number.isFinite(pct) && Math.abs(pct - 91.6) < 0.15;
};

type PurityOption = SelectOption & { percentage: number | null };
type ExistingImage = { id: string; storage_path: string; is_primary: boolean };
type DiamondRow = { key: string; size: string; amount: string };

// ---------- Small layout helpers (same as Add page) ----------

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

function RadioGroup({
  options,
  value,
  onChange,
  disabled,
  emptyText,
}: {
  options: { id: string; label: string }[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  emptyText?: string;
}) {
  if (options.length === 0) {
    return <Text style={styles.helperText}>{emptyText ?? 'No options'}</Text>;
  }
  return (
    <View style={[styles.radioWrap, disabled && { opacity: 0.5 }]}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            style={styles.radioItem}
            onPress={() => !disabled && onChange(o.id)}
            hitSlop={6}
          >
            <View style={[styles.radioOuter, on && styles.radioOuterOn]}>
              {on && <View style={styles.radioInner} />}
            </View>
            <Text style={[styles.radioLabel, on && styles.radioLabelOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function EditProductScreen() {
  return (
    <PageGuard pageKey="products.edit">
      <EditProductScreenInner />
    </PageGuard>
  );
}

function EditProductScreenInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { currentStaff } = useStaff();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const autoNavTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [errorInfo, setErrorInfo] = useState<{ title: string; message: string } | null>(null);
  const [errorVisible, setErrorVisible] = useState(false);
  function showError(message: string, title = 'Something went wrong') {
    setErrorInfo({ title, message });
    setErrorVisible(true);
  }

  const [metals, setMetals] = useState<SelectOption[]>([]);
  const [purities, setPurities] = useState<PurityOption[]>([]);
  const [categories, setCategories] = useState<SelectOption[]>([]);
  const [subcategories, setSubcategories] = useState<SelectOption[]>([]);
  const [stoneOptions, setStoneOptions] = useState<SelectOption[]>([]);
  const [gstOptions, setGstOptions] = useState<SelectOption[]>([]);

  const [productName, setProductName] = useState('');
  const [metalId, setMetalId] = useState<string | null>(null);
  const [purityId, setPurityId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  const [brand, setBrand] = useState('');
  const [hasHuid, setHasHuid] = useState<'yes' | 'no'>('no');
  const [huid, setHuid] = useState('');
  const [designNumber, setDesignNumber] = useState('');
  const [hsnCode, setHsnCode] = useState('');
  const [size, setSize] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [gstSettingId, setGstSettingId] = useState<string | null>(null);

  const [grossWeight, setGrossWeight] = useState('');
  const [stoneWeight, setStoneWeight] = useState('');
  const [otherWeight, setOtherWeight] = useState('');

  const [stoneIds, setStoneIds] = useState<string[]>([]);
  const [stoneAmounts, setStoneAmounts] = useState<Record<string, string>>({});

  const [diamonds, setDiamonds] = useState<DiamondRow[]>([{ key: 'd0', size: '', amount: '' }]);

  const [vacPercent, setVacPercent] = useState('');
  const [stoneChargeFixed, setStoneChargeFixed] = useState('');
  const [makingChargeFixed, setMakingChargeFixed] = useState('');

  const [existingImages, setExistingImages] = useState<ExistingImage[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<string[]>([]);
  const [primaryExistingId, setPrimaryExistingId] = useState<string | null>(null);
  const [newImages, setNewImages] = useState<PickedImage[]>([]);

  // --- Fix for "purity not selected on edit" ---
  // After the product loads, setMetalId()/setCategoryId() fire the "changed"
  // effects below. These refs remember the loaded values so those first
  // effects are skipped and don't wipe the saved purity / subcategory.
  const initialLoadDone = useRef(false);
  const skipMetalEffect = useRef<string | null>(null);
  const skipCategoryEffect = useRef<string | null>(null);

  const selectedMetalLabel = metals.find((m) => m.id === metalId)?.label ?? '';
  const selectedCategoryLabel = categories.find((c) => c.id === categoryId)?.label ?? '';
  const isDiamond =
    /diamond/i.test(selectedMetalLabel) || /diamond/i.test(selectedCategoryLabel);

  // Stone charge logic (same as Add page)
  const multiStone = stoneIds.length >= 2;
  const stoneAmountTotal = stoneIds.reduce(
    (sum, sid) => sum + (parseFloat(stoneAmounts[sid]) || 0),
    0
  );
  const stoneChargeNum = multiStone ? stoneAmountTotal : parseFloat(stoneChargeFixed) || 0;

  // ---------- Initial load ----------
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const [m, c, tax, stones, product] = await Promise.all([
          getMetals(),
          getCategories(),
          listTaxSettings(),
          getStoneNames(),
          getProductById(id),
        ]);

        setMetals(m.map((x: any) => ({ id: x.id, label: x.name })));
        setCategories(c.map((x: any) => ({ id: x.id, label: x.name })));
        setStoneOptions((stones ?? []).map((x: any) => ({ id: x.id, label: x.name })));

        const activeTax = ((tax ?? []) as TaxSetting[]).filter((t) => t.is_active);
        setGstOptions(activeTax.map((t) => ({ id: t.id, label: `${t.tax_name} — ${t.tax_percentage}%` })));

        if (product.metal_id) {
          const p = await getPurities(product.metal_id);
          setPurities(
            p.map((x: any) => ({ id: x.id, label: x.name, percentage: x.purity_percentage ?? null }))
          );
        }
        if (product.category_id) {
          const s = await getSubcategories(product.category_id);
          setSubcategories(s.map((x: any) => ({ id: x.id, label: x.name })));
        }

        setProductName(product.product_name ?? '');
        setMetalId(product.metal_id ?? null);
        setPurityId(product.purity_id ?? null);
        setCategoryId(product.category_id ?? null);
        setSubcategoryId(product.subcategory_id ?? null);
        setBrand(product.brand ?? '');
        setHasHuid(product.huid ? 'yes' : 'no');
        setHuid(product.huid ?? 'HUID');
        setDesignNumber(product.design_number ?? '');
        setHsnCode(product.hsn_code ?? '');
        setGrossWeight(product.gross_weight != null ? String(product.gross_weight) : '');
        setStoneWeight(product.stone_weight != null ? String(product.stone_weight) : '');
        setOtherWeight(product.other_weight != null ? String(product.other_weight) : '');
        setSize(product.size ?? '');
        setGstSettingId(product.tax_setting_id ?? product.tax_settings?.id ?? null);

        // Stones + per-stone amounts
        const productStones: any[] = product.product_stones ?? [];
        setStoneIds(productStones.map((ps) => ps.stone_id));
        const amounts: Record<string, string> = {};
        productStones.forEach((ps) => {
          amounts[ps.stone_id] = ps.amount ? String(ps.amount) : '';
        });
        setStoneAmounts(amounts);

        // Charges
        const charges = product.product_value_added_charges ?? [];
        const findCharge = (name: string) => charges.find((ch: any) => ch.charge_name === name);
        setVacPercent(findCharge('Value Added Charge') ? String(findCharge('Value Added Charge').value) : '');
        setStoneChargeFixed(findCharge('Stone Charge') ? String(findCharge('Stone Charge').value) : '');
        setMakingChargeFixed(findCharge('Making Charge') ? String(findCharge('Making Charge').value) : '');

        // Diamonds
        const savedDiamonds = (product.product_diamonds ?? [])
          .slice()
          .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        if (savedDiamonds.length) {
          setDiamonds(
            savedDiamonds.map((d: any, i: number) => ({
              key: d.id ?? `d${i}`,
              size: String(d.size ?? ''),
              amount: d.amount != null ? String(d.amount) : '',
            }))
          );
        }

        // Images
        const images: ExistingImage[] = (product.product_images ?? [])
          .slice()
          .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        setExistingImages(images);
        setPrimaryExistingId(images.find((i) => i.is_primary)?.id ?? images[0]?.id ?? null);

        // Tell the "changed" effects to ignore the first change caused by loading.
        skipMetalEffect.current = product.metal_id ?? null;
        skipCategoryEffect.current = product.category_id ?? null;
        initialLoadDone.current = true;
      } catch (e: any) {
        showError(e.message ?? 'Failed to load product', 'Could not load product');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Metal changed by the USER -> reload purities and pick 91.6 if present.
  useEffect(() => {
    if (!initialLoadDone.current) return;
    if (skipMetalEffect.current !== null && skipMetalEffect.current === metalId) {
      skipMetalEffect.current = null; // loaded value: keep saved purity
      return;
    }
    skipMetalEffect.current = null;

    setPurityId(null);
    setPurities([]);
    if (!metalId) return;

    let cancelled = false;
    getPurities(metalId)
      .then((rows: any[]) => {
        if (cancelled) return;
        const list: PurityOption[] = rows.map((x: any) => ({
          id: x.id,
          label: x.name,
          percentage: x.purity_percentage ?? null,
        }));
        setPurities(list);
        setPurityId(list.find((p) => isPurity916(p.label, p.percentage))?.id ?? null);
      })
      .catch((e) => {
        if (!cancelled) showError(e.message ?? 'Failed to load purities');
      });
    return () => {
      cancelled = true;
    };
  }, [metalId]);

  // Category changed by the USER -> reload subcategories.
  useEffect(() => {
    if (!initialLoadDone.current) return;
    if (skipCategoryEffect.current !== null && skipCategoryEffect.current === categoryId) {
      skipCategoryEffect.current = null; // loaded value: keep saved subcategory
      return;
    }
    skipCategoryEffect.current = null;

    setSubcategoryId(null);
    setSubcategories([]);
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

  // ---------- Inline "Add New" handlers ----------
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
  async function handleAddStoneName(name: string): Promise<SelectOption> {
    const created = await createStoneName({ name });
    const opt: SelectOption = { id: created.id, label: created.name };
    setStoneOptions((prev) => [...prev, opt].sort((a, b) => a.label.localeCompare(b.label)));
    return opt;
  }

  // ---------- Images ----------
  function removeExistingImage(imageId: string) {
    setRemovedImageIds((prev) => [...prev, imageId]);
    if (primaryExistingId === imageId) {
      const next = existingImages.find((img) => img.id !== imageId && !removedImageIds.includes(img.id));
      setPrimaryExistingId(next?.id ?? null);
    }
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
    if (hasHuid === 'yes' && !huid.trim()) return 'Enter the HUID or select No';
    const remainingImages =
      existingImages.filter((img) => !removedImageIds.includes(img.id)).length + newImages.length;
    if (remainingImages === 0) return 'Add at least one photo';
    return null;
  }

  function goToProductDetails() {
    if (autoNavTimer.current) clearTimeout(autoNavTimer.current);
    router.replace(`/products/${id}` as never);
  }

  async function handleSave() {
    const err = validate();
    if (err) { showError(err, 'Missing information'); return; }
    if (!currentStaff) {
      showError('Please log in again.', 'Session expired');
      return;
    }
    if (!id) return;

    setSaving(true);
    try {
      await updateProduct(id, {
        product_name: productName.trim(),
        category_id: categoryId,
        subcategory_id: subcategoryId,
        brand: brand || null,
        metal_id: metalId!,
        purity_id: purityId!,
        gross_weight: grossNum,
        stone_weight: stoneNum,
        other_weight: otherNum,
        net_weight: netWeight,
        hsn_code: hsnCode || null,
        huid: hasHuid === 'yes' ? huid.trim() || null : null,
        design_number: designNumber || null,
        size: size || null,
        tax_setting_id: gstSettingId || null,
      });

      // Stones with amounts (same rule as Add page)
      await setProductStones(
        id,
        stoneIds.map((sid) => ({
          stone_id: sid,
          amount: multiStone ? parseFloat(stoneAmounts[sid]) || 0 : stoneChargeNum,
        }))
      );

      await setProductDiamonds(
        id,
        isDiamond
          ? diamonds
              .filter((d) => d.size.trim())
              .map((d) => ({ size: d.size.trim(), amount: parseFloat(d.amount) || 0 }))
          : []
      );

      await updateProductCharges(
        id,
        [
          { charge_name: 'Value Added Charge', calculation_type: 'percentage', value: parseFloat(vacPercent) || 0 },
          { charge_name: 'Stone Charge', calculation_type: 'fixed', value: stoneChargeNum },
          { charge_name: 'Making Charge', calculation_type: 'fixed', value: parseFloat(makingChargeFixed) || 0 },
        ],
        currentStaff.id
      );

      for (const imageId of removedImageIds) {
        await deleteProductImage(imageId);
      }
      const remainingExisting = existingImages.filter((img) => !removedImageIds.includes(img.id));

      const newImagePrimaryIndex = newImages.findIndex((img) => img.isPrimary);
      if (newImagePrimaryIndex !== -1) {
        await clearProductImagePrimary(id);
      } else if (primaryExistingId && remainingExisting.some((img) => img.id === primaryExistingId)) {
        await setProductImagePrimary(id, primaryExistingId);
      }

      if (newImages.length) {
        const uploaded = await Promise.all(
          newImages.map((img, idx) => uploadProductImageBase64(id, img.base64!, remainingExisting.length + idx))
        );
        await insertProductImages(
          uploaded.map((u, idx) => ({
            product_id: id,
            storage_path: u.storagePath,
            is_primary: idx === newImagePrimaryIndex,
            sort_order: remainingExisting.length + idx,
          })),
          currentStaff.id
        );
      }

      setSaved(true);
      autoNavTimer.current = setTimeout(goToProductDetails, SAVED_POPUP_AUTO_NAV_MS);
    } catch (e: any) {
      showError(e?.message ?? 'Failed to update product', 'Could not save changes');
    } finally {
      setSaving(false);
    }
  }

  const errorModal = (
    <ErrorModal
      visible={errorVisible}
      title={errorInfo?.title}
      message={errorInfo?.message ?? null}
      onClose={() => setErrorVisible(false)}
    />
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        {errorModal}
      </View>
    );
  }

  const visibleExisting = existingImages.filter((img) => !removedImageIds.includes(img.id));

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={KEYBOARD_VERTICAL_OFFSET}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Photos */}
        <Card
          title="Photos"
          hint={visibleExisting.length > 0 ? 'Star = main image' : 'Add a new photo'}
        >
          {visibleExisting.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.existingImagesRow}>
              {visibleExisting.map((img) => {
                const isPrimary = img.id === primaryExistingId;
                return (
                  <View key={img.id} style={styles.existingImageWrap}>
                    <Image source={{ uri: getProductImageUrl(img.storage_path) }} style={styles.existingImage} />
                    <TouchableOpacity
                      style={styles.existingImagePrimaryBtn}
                      onPress={() => setPrimaryExistingId(img.id)}
                    >
                      <Ionicons
                        name={isPrimary ? 'star' : 'star-outline'}
                        size={16}
                        color={isPrimary ? '#F5A623' : '#fff'}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.existingImageRemoveBtn}
                      onPress={() => removeExistingImage(img.id)}
                    >
                      <Ionicons name="trash-outline" size={16} color="#fff" />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          )}

          {/* Camera / Gallery buttons appear only after the saved photo(s) are deleted */}
          {visibleExisting.length === 0 && (
            <ImagePickerGrid images={newImages} onChange={setNewImages} />
          )}
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
          <Field label="Metal *">
            <RadioGroup
              options={metals}
              value={metalId}
              onChange={setMetalId}
              emptyText="No metals found"
            />
          </Field>
          <Field label="Purity *">
            <RadioGroup
              options={purities}
              value={purityId}
              onChange={setPurityId}
              disabled={!metalId}
              emptyText={metalId ? 'No purities for this metal' : 'Select a metal first'}
            />
          </Field>
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

        {/* 5. Diamonds */}
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
        <Card title="Stones" hint={multiStone ? 'Enter an amount for each stone' : undefined}>
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

          {multiStone && (
            <View style={styles.stoneAmounts}>
              {stoneIds.map((sid) => {
                const label = stoneOptions.find((s) => s.id === sid)?.label ?? 'Stone';
                return (
                  <Field key={sid} label={`${label} amount ₹`}>
                    <TextInput
                      style={styles.input}
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="decimal-pad"
                      value={stoneAmounts[sid] ?? ''}
                      onChangeText={(v) => setStoneAmounts((prev) => ({ ...prev, [sid]: v }))}
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

        {/* HUID (Yes / No) */}
        <Card title="HUID">
          <Field label="HUID">
            <RadioGroup
              options={[
                { id: 'yes', label: 'Yes' },
                { id: 'no', label: 'No' },
              ]}
              value={hasHuid}
              onChange={(v) => setHasHuid(v as 'yes' | 'no')}
            />
          </Field>
          {hasHuid === 'yes' && (
            <Field label="HUID number">
              <TextInput
                style={styles.input}
                placeholder="HUID"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
                selectTextOnFocus
                value={huid}
                onChangeText={setHuid}
              />
            </Field>
          )}
        </Card>

        {/* 8. More details (collapsed by default) */}
        <View style={styles.card}>
          <Pressable style={styles.moreHeader} onPress={() => setShowMore((v) => !v)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>More details</Text>
              <Text style={styles.cardHint}>Size, design number, brand, HSN, GST</Text>
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
                <Field label="Design no." style={styles.col}>
                  <TextInput
                    style={styles.input}
                    placeholder="Design number"
                    placeholderTextColor={colors.textMuted}
                    value={designNumber}
                    onChangeText={setDesignNumber}
                  />
                </Field>
                <Field label="Brand" style={styles.col}>
                  <TextInput
                    style={styles.input}
                    placeholder="Brand"
                    placeholderTextColor={colors.textMuted}
                    value={brand}
                    onChangeText={setBrand}
                  />
                </Field>
              </View>
              <Field label="HSN code">
                <TextInput
                  style={styles.input}
                  placeholder="HSN code"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  value={hsnCode}
                  onChangeText={setHsnCode}
                />
              </Field>
              {gstOptions.length > 0 && (
                <SelectField
                  label="GST rate"
                  value={gstSettingId}
                  options={gstOptions}
                  onChange={setGstSettingId}
                />
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sticky save bar (moves up with the keyboard) */}
      <View style={styles.footer}>
        <View>
          <Text style={styles.footerLabel}>Net weight</Text>
          <Text style={styles.footerValue}>{netWeight.toFixed(3)} g</Text>
        </View>
        <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()} disabled={saving}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
        </TouchableOpacity>
      </View>

      <Modal visible={saved} transparent animationType="fade" onRequestClose={goToProductDetails}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <CheckCircle2 size={48} color={colors.primary} style={{ marginBottom: spacing.sm }} />
            <Text style={styles.successTitle}>Product Updated</Text>
            <Text style={styles.successSub}>{productName}</Text>
            <TouchableOpacity style={styles.viewNowBtn} onPress={goToProductDetails}>
              <Text style={styles.viewNowBtnText}>View Now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {errorModal}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  // Extra bottom space so the last fields can be scrolled above the keyboard.
  screen: { padding: spacing.lg, paddingBottom: spacing.xl * 4 },
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

  radioWrap: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 8 },
  radioItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  radioOuter: {
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterOn: { borderColor: colors.primary },
  radioInner: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  radioLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  radioLabelOn: { color: colors.text, fontWeight: '700' },

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

  existingImagesRow: { marginBottom: spacing.sm },
  existingImageWrap: {
    width: 90, height: 90, borderRadius: radius.md, marginRight: spacing.sm, overflow: 'hidden',
    backgroundColor: colors.border,
  },
  existingImage: { width: '100%', height: '100%' },
  existingImagePrimaryBtn: {
    position: 'absolute', top: 4, left: 4, width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  existingImageRemoveBtn: {
    position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(176,0,32,0.85)', alignItems: 'center', justifyContent: 'center',
  },

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
  cancelBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelBtnText: { color: colors.textMuted, fontWeight: '700', fontSize: 14 },
  saveBtn: {
    flex: 1,
    maxWidth: 180,
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
  viewNowBtn: { marginTop: spacing.lg, paddingVertical: 10, paddingHorizontal: 20 },
  viewNowBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
});