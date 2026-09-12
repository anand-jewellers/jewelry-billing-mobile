// app/(tabs)/products/add.tsx
import { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { colors, spacing } from '../../../src/theme';
import { SelectField, SelectOption } from '../../../src/components/ui/SelectField';
import { ImagePickerGrid, PickedImage } from '../../../src/components/product/ImagePickerGrid';
import {
  getMetals, getPurities, getCategories, getSubcategories,
  createProduct, insertProductImages,
} from '../../../src/lib/products';
import { uploadProductImageBase64 } from '../../../src/lib/storage';
import { useStaff } from '../../../src/context/StaffContext';

export default function AddProductScreen() {
  const { currentStaff } = useStaff();
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedProduct, setSavedProduct] = useState<any>(null);

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

  const [grossWeight, setGrossWeight] = useState('');
  const [stoneWeight, setStoneWeight] = useState('0');
  const [otherWeight, setOtherWeight] = useState('0');

  const [images, setImages] = useState<PickedImage[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [m, c] = await Promise.all([getMetals(), getCategories()]);
        setMetals(m.map((x: any) => ({ id: x.id, label: x.name })));
        setCategories(c.map((x: any) => ({ id: x.id, label: x.name })));
      } catch (e: any) {
        Alert.alert('Error', e.message ?? 'Failed to load master data');
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, []);

  useEffect(() => {
    setPurityId(null); setPurities([]);
    if (!metalId) return;
    getPurities(metalId).then((p) => setPurities(p.map((x: any) => ({ id: x.id, label: x.name })))).catch((e) => Alert.alert('Error', e.message));
  }, [metalId]);

  useEffect(() => {
    setSubcategoryId(null); setSubcategories([]);
    if (!categoryId) return;
    getSubcategories(categoryId).then((s) => setSubcategories(s.map((x: any) => ({ id: x.id, label: x.name })))).catch((e) => Alert.alert('Error', e.message));
  }, [categoryId]);

  const grossNum = parseFloat(grossWeight) || 0;
  const stoneNum = parseFloat(stoneWeight) || 0;
  const otherNum = parseFloat(otherWeight) || 0;
  const netWeight = Math.max(grossNum - stoneNum - otherNum, 0);

  function validate(): string | null {
    if (!productName.trim()) return 'Product name is required';
    if (!metalId) return 'Select a metal';
    if (!purityId) return 'Select a purity';
    if (!grossWeight || grossNum <= 0) return 'Enter gross weight';
    return null;
  }

  async function handleSave() {
    const err = validate();
    if (err) { Alert.alert('Missing information', err); return; }
    if (!currentStaff) {
      Alert.alert('Session expired', 'Please log in again.');
      return;
    }
    setSaving(true);
    try {
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
      }, currentStaff.id);

      if (images.length) {
        const uploaded = await Promise.all(
          images.map((img, idx) => uploadProductImageBase64(product.id, img.base64!, idx))
        );
        await insertProductImages(uploaded.map((u, idx) => ({
          product_id: product.id, storage_path: u.storagePath, is_primary: images[idx].isPrimary, sort_order: idx,
        })), currentStaff.id);
      }

      setSavedProduct(product);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to save product');
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setSavedProduct(null); setProductName(''); setMetalId(null); setCategoryId(null);
    setBrand(''); setHuid(''); setDesignNumber(''); setGrossWeight(''); setStoneWeight('0');
    setOtherWeight('0'); setHsnCode('7113'); setImages([]);
  }

  if (loadingMeta) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  }

  if (savedProduct) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.successTitle}>Product Saved</Text>
        <Text style={styles.successSub}>{savedProduct.product_name}</Text>
        <Text style={styles.successCode}>Code: {savedProduct.product_code}</Text>
        <Text style={styles.successNote}>
          Pricing for this item will be calculated automatically using the metal rate on the day it's invoiced.
        </Text>
        <TouchableOpacity style={styles.link} onPress={resetForm}>
          <Text style={styles.linkText}>Add another product</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <ImagePickerGrid images={images} onChange={setImages} />

      <Text style={styles.sectionTitle}>Basic Details</Text>
      <TextInput style={styles.input} placeholder="Product name" placeholderTextColor={colors.textMuted} value={productName} onChangeText={setProductName} />
      <SelectField label="Category" value={categoryId} options={categories} onChange={setCategoryId} />
      <SelectField label="Subcategory" value={subcategoryId} options={subcategories} onChange={setSubcategoryId} disabled={!categoryId} />
      <TextInput style={styles.input} placeholder="Brand (optional)" placeholderTextColor={colors.textMuted} value={brand} onChangeText={setBrand} />

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

      <Text style={styles.sectionTitle}>HSN Code</Text>
      <TextInput style={styles.input} placeholder="HSN code" placeholderTextColor={colors.textMuted} value={hsnCode} onChangeText={setHsnCode} />

      <Text style={styles.sectionTitle}>Identifiers (optional)</Text>
      <TextInput style={styles.input} placeholder="HUID" placeholderTextColor={colors.textMuted} value={huid} onChangeText={setHuid} />
      <TextInput style={styles.input} placeholder="Design number" placeholderTextColor={colors.textMuted} value={designNumber} onChangeText={setDesignNumber} />

      <Text style={styles.helperNote}>
        No pricing is entered here. Metal rate, making charge, and GST are all applied automatically at billing time using that day's rate.
      </Text>

      <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Product</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xl * 2, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 12, paddingHorizontal: spacing.md, fontSize: 15, color: colors.text, backgroundColor: colors.surface, marginBottom: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  rowInput: { flex: 1 },
  netWeightText: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.sm },
  helperNote: { color: colors.textMuted, fontSize: 12, marginTop: spacing.md, fontStyle: 'italic' },
  saveBtn: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  successTitle: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center', marginTop: spacing.lg },
  successSub: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: 4 },
  successCode: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 2 },
  successNote: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md, paddingHorizontal: spacing.lg, fontStyle: 'italic' },
  link: { alignItems: 'center', marginTop: spacing.lg },
  linkText: { color: colors.primary, fontWeight: '600' },
});