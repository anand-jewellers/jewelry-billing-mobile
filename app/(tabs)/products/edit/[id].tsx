// app/(tabs)/products/edit/[id].tsx
//
// Edit an existing product. Mirrors the Add Product form field-for-field,
// including the Diamonds card (rate per carat), and uses ErrorModal instead
// of Alert.alert (Alert.alert does nothing on web, so errors/validation
// messages were invisible and Save looked "broken").
import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CheckCircle2, Plus, X } from 'lucide-react-native';
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
import { listTaxSettings } from '../../../../src/lib/api/settings';
import type { TaxSetting } from '../../../../src/types/settings';
import { uploadProductImageBase64, getProductImageUrl } from '../../../../src/lib/storage';
import { useStaff } from '../../../../src/context/StaffContext';
import { parseCarat, diamondChargeAmount } from '../../../../src/lib/invoiceCalc';

const SAVED_POPUP_AUTO_NAV_MS = 1500;

type ExistingImage = { id: string; storage_path: string; is_primary: boolean };

// size = carat weight, amount = RATE per carat (same meaning as the Add page)
type DiamondRow = { key: string; size: string; amount: string };

export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { currentStaff } = useStaff();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const autoNavTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Error modal (works on web, unlike Alert.alert)
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
  const [stoneOptions, setStoneOptions] = useState<SelectOption[]>([]);
  const [gstOptions, setGstOptions] = useState<SelectOption[]>([]);
  const [taxSettings, setTaxSettings] = useState<TaxSetting[]>([]);

  const [productName, setProductName] = useState('');
  const [metalId, setMetalId] = useState<string | null>(null);
  const [purityId, setPurityId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  const [brand, setBrand] = useState('');
  const [huid, setHuid] = useState('');
  const [designNumber, setDesignNumber] = useState('');
  const [hsnCode, setHsnCode] = useState('');
  const [grossWeight, setGrossWeight] = useState('');
  const [stoneWeight, setStoneWeight] = useState('');
  const [otherWeight, setOtherWeight] = useState('');
  const [size, setSize] = useState('');
  const [stoneIds, setStoneIds] = useState<string[]>([]);
  const [vacPercent, setVacPercent] = useState('');
  const [stoneChargeFixed, setStoneChargeFixed] = useState('');
  const [makingChargeFixed, setMakingChargeFixed] = useState('');
  const [gstSettingId, setGstSettingId] = useState<string | null>(null);

  // Diamond rows (size in ct + rate per ct)
  const [diamonds, setDiamonds] = useState<DiamondRow[]>([{ key: 'd0', size: '', amount: '' }]);

  const [existingImages, setExistingImages] = useState<ExistingImage[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<string[]>([]);
  const [primaryExistingId, setPrimaryExistingId] = useState<string | null>(null);
  const [newImages, setNewImages] = useState<PickedImage[]>([]);

  const initialLoadDone = useRef(false);

  // Diamond card shows for any metal whose name contains "diamond"
  const selectedMetalLabel = metals.find((m) => m.id === metalId)?.label ?? '';
  const isDiamond = /diamond/i.test(selectedMetalLabel);

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

        const activeTax = (tax ?? []).filter((t) => t.is_active);
        setTaxSettings(activeTax);
        setGstOptions(activeTax.map((t) => ({ id: t.id, label: `${t.tax_name} — ${t.tax_percentage}%` })));

        if (product.metal_id) {
          const p = await getPurities(product.metal_id);
          setPurities(p.map((x: any) => ({ id: x.id, label: x.name })));
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
        setHuid(product.huid ?? '');
        setDesignNumber(product.design_number ?? '');
        setHsnCode(product.hsn_code ?? '');
        setGrossWeight(product.gross_weight != null ? String(product.gross_weight) : '');
        setStoneWeight(product.stone_weight != null ? String(product.stone_weight) : '');
        setOtherWeight(product.other_weight != null ? String(product.other_weight) : '');
        setSize(product.size ?? '');
        setStoneIds((product.product_stones ?? []).map((ps: any) => ps.stone_id));
        setGstSettingId(product.tax_setting_id ?? product.tax_settings?.id ?? null);

        const charges = product.product_value_added_charges ?? [];
        const findCharge = (name: string) => charges.find((c: any) => c.charge_name === name);
        setVacPercent(findCharge('Value Added Charge') ? String(findCharge('Value Added Charge').value) : '');
        setStoneChargeFixed(findCharge('Stone Charge') ? String(findCharge('Stone Charge').value) : '');
        setMakingChargeFixed(findCharge('Making Charge') ? String(findCharge('Making Charge').value) : '');

        // Saved diamond rows -> editable rows
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

        const images: ExistingImage[] = (product.product_images ?? [])
          .slice()
          .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        setExistingImages(images);
        setPrimaryExistingId(images.find((i) => i.is_primary)?.id ?? images[0]?.id ?? null);

        initialLoadDone.current = true;
      } catch (e: any) {
        showError(e.message ?? 'Failed to load product', 'Could not load product');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!initialLoadDone.current) return;
    setPurityId(null); setPurities([]);
    if (!metalId) return;
    getPurities(metalId)
      .then((p) => setPurities(p.map((x: any) => ({ id: x.id, label: x.name }))))
      .catch((e) => showError(e.message ?? 'Failed to load purities'));
  }, [metalId]);

  useEffect(() => {
    if (!initialLoadDone.current) return;
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
      if (bad) return 'Each diamond row needs both a size and a rate';
    }
    const remainingImages = existingImages.filter((img) => !removedImageIds.includes(img.id)).length + newImages.length;
    if (remainingImages === 0) return 'Add at least one photo';
    return null;
  }

  function removeExistingImage(imageId: string) {
    setRemovedImageIds((prev) => [...prev, imageId]);
    if (primaryExistingId === imageId) {
      const next = existingImages.find((img) => img.id !== imageId && !removedImageIds.includes(img.id));
      setPrimaryExistingId(next?.id ?? null);
    }
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
        huid: huid || null,
        design_number: designNumber || null,
        size: size || null,
        tax_setting_id: gstSettingId || null,
      });

      await setProductStones(id, stoneIds);

      // Diamonds are fully replaced too. Non-diamond metal -> clears them.
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
          { charge_name: 'Stone Charge', calculation_type: 'fixed', value: parseFloat(stoneChargeFixed) || 0 },
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
    <>
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>Photos</Text>
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
                    <Ionicons name={isPrimary ? 'star' : 'star-outline'} size={16} color={isPrimary ? '#F5A623' : '#fff'} />
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
        <ImagePickerGrid images={newImages} onChange={setNewImages} />
        <Text style={styles.helperText}>
          Tap the star on a saved photo to make it the cover image. New photos you add here are uploaded when you save.
        </Text>

        <Text style={styles.sectionTitle}>Basic Details</Text>
        <TextInput style={styles.input} placeholder="Product name" placeholderTextColor={colors.textMuted} value={productName} onChangeText={setProductName} />
        <SelectField label="Category" value={categoryId} options={categories} onChange={setCategoryId} />
        <SelectField label="Subcategory" value={subcategoryId} options={subcategories} onChange={setSubcategoryId} disabled={!categoryId} />

        <Text style={styles.sectionTitle}>Metal & Purity</Text>
        <SelectField label="Metal" value={metalId} options={metals} onChange={setMetalId} />
        <SelectField label="Purity" value={purityId} options={purities} onChange={setPurityId} disabled={!metalId} />

        <Text style={styles.sectionTitle}>Weight (grams)</Text>
        <View style={styles.row}>
          <TextInput style={[styles.input, styles.rowInput]} placeholder="Gross" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={grossWeight} onChangeText={setGrossWeight} />
          <TextInput style={[styles.input, styles.rowInput]} placeholder="Stone" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={stoneWeight} onChangeText={setStoneWeight} />
          <TextInput style={[styles.input, styles.rowInput]} placeholder="Other" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={otherWeight} onChangeText={setOtherWeight} />
        </View>
        <Text style={styles.netWeightText}>Net weight: {netWeight.toFixed(3)} g</Text>

        {/* ---------- Diamonds (Diamond metal only) ---------- */}
        {isDiamond && (
          <>
            <Text style={styles.sectionTitle}>Diamonds</Text>
            {diamonds.map((row) => {
              const ct = parseCarat(row.size);
              const rate = parseFloat(row.amount) || 0;
              const charge = diamondChargeAmount(row.size, rate);
              return (
                <View key={row.key} style={styles.diamondBlock}>
                  <View style={styles.diamondRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>Size (ct)</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="e.g. 0.25 ct"
                        placeholderTextColor={colors.textMuted}
                        value={row.size}
                        onChangeText={(v) => updateDiamondRow(row.key, { size: v })}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>Rate ₹ / ct</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="0"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="decimal-pad"
                        value={row.amount}
                        onChangeText={(v) => updateDiamondRow(row.key, { amount: v })}
                      />
                    </View>
                    {diamonds.length > 1 && (
                      <TouchableOpacity onPress={() => removeDiamondRow(row.key)} hitSlop={8} style={styles.removeBtn}>
                        <X size={18} color="#DC2626" />
                      </TouchableOpacity>
                    )}
                  </View>
                  {ct > 0 && rate > 0 && (
                    <Text style={styles.chargePreview}>
                      Charge = {ct} × {rate.toLocaleString('en-IN')} = ₹{charge.toLocaleString('en-IN')}
                    </Text>
                  )}
                </View>
              );
            })}
            <TouchableOpacity style={styles.addRowBtn} onPress={addDiamondRow}>
              <Plus size={16} color={colors.primary} />
              <Text style={styles.addRowBtnText}>Add another size</Text>
            </TouchableOpacity>
            <Text style={styles.helperText}>
              Enter the diamond rate per carat. The charge is size × rate, and it is the same on the product page and the invoice.
            </Text>
          </>
        )}

        <Text style={styles.sectionTitle}>Stones</Text>
        <MultiSelectField
          options={stoneOptions}
          values={stoneIds}
          onChange={setStoneIds}
          placeholder="Select stones"
          disabled={stoneOptions.length === 0}
        />
        {stoneOptions.length === 0 && (
          <Text style={styles.helperText}>No stone names set up yet — add some in Settings → Stone Names.</Text>
        )}

        <Text style={styles.sectionTitle}>Size</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Ring size 16, Bangle 2.4"
          placeholderTextColor={colors.textMuted}
          value={size}
          onChangeText={setSize}
        />

        <Text style={styles.sectionTitle}>Charges</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.rowInput]}
            placeholder="V A %"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            value={vacPercent}
            onChangeText={setVacPercent}
          />
          <TextInput
            style={[styles.input, styles.rowInput]}
            placeholder="S C ₹"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            value={stoneChargeFixed}
            onChangeText={setStoneChargeFixed}
          />
          <TextInput
            style={[styles.input, styles.rowInput]}
            placeholder="M C ₹"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            value={makingChargeFixed}
            onChangeText={setMakingChargeFixed}
          />
        </View>
        <Text style={styles.helperText}>
          Value Added Charge is a % applied to the metal value at invoice time. Stone Charge and Making
          Charge here are fixed ₹ amounts specific to this product (they override the general making
          charge rule for this item).
        </Text>

        <Text style={styles.sectionTitle}>HSN Code</Text>
        <TextInput style={styles.input} placeholder="HSN code" placeholderTextColor={colors.textMuted} value={hsnCode} onChangeText={setHsnCode} />

        <Text style={styles.sectionTitle}>Identifiers (optional)</Text>
        <TextInput style={styles.input} placeholder="HUID" placeholderTextColor={colors.textMuted} value={huid} onChangeText={setHuid} />
        <TextInput style={styles.input} placeholder="Design number" placeholderTextColor={colors.textMuted} value={designNumber} onChangeText={setDesignNumber} />
        <TextInput style={styles.input} placeholder="Brand" placeholderTextColor={colors.textMuted} value={brand} onChangeText={setBrand} />

        {gstOptions.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>GST</Text>
            <SelectField label="GST rate" value={gstSettingId} options={gstOptions} onChange={setGstSettingId} />
          </>
        )}

        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()} disabled={saving}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>

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
    </>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xl * 2, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  label: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 12, paddingHorizontal: spacing.md, fontSize: 15, color: colors.text, backgroundColor: colors.surface, marginBottom: spacing.sm },
  row: { flexDirection: 'column', gap: spacing.sm },
  rowInput: { flex: 1 },
  netWeightText: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.sm },
  helperText: { color: colors.textMuted, fontSize: 12, marginTop: 2, marginBottom: spacing.sm, fontStyle: 'italic' },
  diamondBlock: { marginBottom: spacing.xs },
  diamondRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  removeBtn: { height: 44, width: 28, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  chargePreview: { fontSize: 12, color: colors.textMuted, marginTop: -2, marginBottom: spacing.sm },
  addRowBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 },
  addRowBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
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
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  cancelBtn: {
    flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  cancelBtnText: { color: colors.textMuted, fontWeight: '700', fontSize: 15 },
  saveBtn: { flex: 2, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
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