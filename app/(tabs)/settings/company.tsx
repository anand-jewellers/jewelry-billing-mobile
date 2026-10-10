// app/(tabs)/settings/company.tsx

import { useEffect, useState } from 'react';
import { ScrollView, Text, StyleSheet, ActivityIndicator, View, Image, Pressable, Platform, KeyboardAvoidingView, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { Card, Input, Button } from '../../../src/components/ui';
import { ErrorModal } from '../../../src/components/ui/ErrorModal';
import { SuccessModal } from '../../../src/components/ui/SuccessModal';
import { colors, radius, spacing } from '../../../src/theme';
import { supabase } from '../../../src/lib/supabaseClient';
import { getCompanySettings, updateCompanySettings } from '../../../src/lib/api/settings';
import { useCompanySettings } from '../../../src/context/CompanySettingsContext';
import type { CompanySettings } from '../../../src/types/settings';
import { useStaff } from '../../../src/context/StaffContext';
import { LogoCropModal } from '../../../src/components/master/LogoCropModal';

const LOGO_BUCKET = 'company-assets';

type PickedImage = { uri: string; width: number; height: number };

/**
 * Opens the image picker WITHOUT the native cropper (it has no Save button).
 * Returns the local file URI and size. No network request here.
 */
async function pickLocalLogo(): Promise<PickedImage> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo library permission was denied.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false, // our own Save / Crop step is shown instead
    quality: 0.8,
  });

  if (result.canceled || !result.assets?.[0]?.uri) {
    throw new Error('CANCELED');
  }

  const a = result.assets[0];
  return { uri: a.uri, width: a.width, height: a.height };
}

/**
 * Uploads a local file URI to Supabase Storage and returns the public URL.
 * Only called when the user taps "Save Changes".
 */
async function uploadLogoToStorage(localUri: string): Promise<string> {
  const extMatch = localUri.match(/\.(\w+)(?:\?.*)?$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
  const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
  const fileName = `company-logo.${ext}`;
  const path = `logo/${fileName}`;

  let bytes: Uint8Array;
  if (Platform.OS === 'web') {
    const res = await fetch(localUri);
    const arrayBuffer = await res.arrayBuffer();
    bytes = new Uint8Array(arrayBuffer);
  } else {
    const file = new File(localUri);
    bytes = await file.bytes();
  }

  if (bytes.byteLength < 1024) {
    throw new Error(`File looks too small (${bytes.byteLength} bytes) — the image may not have loaded correctly.`);
  }

  // Remove existing older logo files with different extensions
  const { data: existingFiles } = await supabase.storage.from(LOGO_BUCKET).list('logo');
  const staleFiles = (existingFiles ?? [])
    .filter((f) => f.name.startsWith('company-logo.') && f.name !== fileName)
    .map((f) => `logo/${f.name}`);
  if (staleFiles.length > 0) {
    await supabase.storage.from(LOGO_BUCKET).remove(staleFiles);
  }

  const { error: uploadError } = await supabase.storage.from(LOGO_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

const emptyForm: Omit<CompanySettings, 'id'> = {
  company_name: '',
  logo_url: null,
  address: '',
  city: '',
  state: '',
  pincode: '',
  phone: '',
  email: '',
  gstin: '',
  pan: '',
  website: '',
};

export default function CompanySettingsScreen() {
  const insets = useSafeAreaInsets();
  const { setSettings: setGlobalSettings } = useCompanySettings();
  const { hasAccess } = useStaff();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);

  // Logo confirm step (Cancel / Crop / Save)
  const [pendingLogo, setPendingLogo] = useState<PickedImage | null>(null);
  const [cropOpen, setCropOpen] = useState(false);

  // Modals
  const [errorInfo, setErrorInfo] = useState<{ title: string; message: string } | null>(null);
  const [errorVisible, setErrorVisible] = useState(false);
  const [successInfo, setSuccessInfo] = useState<{ title: string; message: string } | null>(null);
  const [successVisible, setSuccessVisible] = useState(false);

  function showError(message: string, title = 'Something went wrong') {
    setErrorInfo({ title, message });
    setErrorVisible(true);
  }

  function showSuccess(message: string, title = 'Success') {
    setSuccessInfo({ title, message });
    setSuccessVisible(true);
  }

  const canChangeLogo = hasAccess('settings.company_logo');

  useEffect(() => {
    getCompanySettings()
      .then((data) => setForm(data))
      .catch(() => showError('Could not load company settings.', 'Could not load settings'))
      .finally(() => setLoading(false));
  }, []);

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  // Picks an image and opens the confirm card
  const handleChangeLogo = async () => {
    if (!canChangeLogo) return;
    try {
      const picked = await pickLocalLogo();
      setPendingLogo(picked);
    } catch (err) {
      if (err instanceof Error && err.message === 'CANCELED') return;
      const detail = err instanceof Error ? err.message : String(err);
      showError(`Could not select image: ${detail}`, 'Selection Failed');
    }
  };

  // Save: use the image exactly as picked
  const useLogoAsIs = () => {
    if (!pendingLogo) return;
    setLogoLoadFailed(false);
    setForm((f) => ({ ...f, logo_url: pendingLogo.uri }));
    setPendingLogo(null);
  };

  // Called by the crop modal with the manually cropped image
  const onLogoCropped = (uri: string) => {
    setLogoLoadFailed(false);
    setForm((f) => ({ ...f, logo_url: uri }));
    setCropOpen(false);
    setPendingLogo(null);
  };

  // Uploads image (if changed) and saves all form details on tap of bottom button
  const handleSave = async () => {
    setSaving(true);
    try {
      let finalLogoUrl = form.logo_url;

      const isLocalUri =
        finalLogoUrl?.startsWith('file:') ||
        finalLogoUrl?.startsWith('content:') ||
        finalLogoUrl?.startsWith('blob:') ||
        finalLogoUrl?.startsWith('ph:');

      if (isLocalUri && finalLogoUrl) {
        finalLogoUrl = await uploadLogoToStorage(finalLogoUrl);
      }

      const updatedForm = { ...form, logo_url: finalLogoUrl };

      await updateCompanySettings(updatedForm);
      setForm(updatedForm);
      setGlobalSettings(updatedForm as CompanySettings);
      showSuccess('Company details and logo have been updated.', 'Saved');
    } catch (err) {
      console.error('Save failed:', err);
      showError('Could not save changes. Check your connection and try again.', 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.screen}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 110 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {/* Identity & Logo */}
          <Card style={styles.brandCard}>
            <View style={styles.logoSection}>
              <View style={styles.logoWrapper}>
                <View style={styles.logoPreview}>
                  {form.logo_url && !logoLoadFailed ? (
                    <Image source={{ uri: form.logo_url }} style={styles.logoImage} resizeMode="contain" onError={() => setLogoLoadFailed(true)} />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Ionicons name="business-outline" size={36} color={colors.textMuted} />
                    </View>
                  )}
                </View>

                {canChangeLogo && (
                  <Pressable onPress={handleChangeLogo} style={({ pressed }) => [styles.cameraBadge, pressed && { opacity: 0.8 }]}>
                    <Ionicons name="camera" size={16} color="#fff" />
                  </Pressable>
                )}
              </View>

              <View style={styles.logoTextWrapper}>
                <Text style={styles.brandTitle}>Company Branding</Text>
                <Text style={styles.brandSubtitle}>Square logos work best. Changes are uploaded once you tap save below.</Text>
                {canChangeLogo && (
                  <Pressable onPress={handleChangeLogo} hitSlop={8}>
                    <Text style={styles.uploadTextLink}>{form.logo_url ? 'Choose Different Image' : 'Select Logo'}</Text>
                  </Pressable>
                )}
              </View>
            </View>

            <View style={styles.divider} />

            <Input label="Company / Shop Name *" value={form.company_name} onChangeText={set('company_name')} placeholder="e.g. Anand Jewellers" />
          </Card>

          {/* Location Details */}
          <View style={styles.sectionHeaderRow}>
            <Ionicons name="location-outline" size={18} color={colors.primary} />
            <Text style={styles.sectionTitle}>Physical Address</Text>
          </View>
          <Card style={styles.card}>
            <Input label="Street Address" value={form.address ?? ''} onChangeText={set('address')} placeholder="Door No, Building, Street name" />
            <View style={styles.row}>
              <View style={styles.col}>
                <Input label="City" value={form.city ?? ''} onChangeText={set('city')} placeholder="City" />
              </View>
              <View style={styles.col}>
                <Input label="State" value={form.state ?? ''} onChangeText={set('state')} placeholder="State" />
              </View>
            </View>
            <Input label="Pincode / Postal Code" value={form.pincode ?? ''} onChangeText={set('pincode')} keyboardType="number-pad" placeholder="600001" />
          </Card>

          {/* Contact Details */}
          <View style={styles.sectionHeaderRow}>
            <Ionicons name="call-outline" size={18} color={colors.primary} />
            <Text style={styles.sectionTitle}>Contact & Online Presence</Text>
          </View>
          <Card style={styles.card}>
            <Input label="Phone Number" value={form.phone ?? ''} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="+91 98765 43210" />
            <Input label="Official Email" value={form.email ?? ''} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" placeholder="contact@company.com" />
            <Input label="Website URL" value={form.website ?? ''} onChangeText={set('website')} autoCapitalize="none" keyboardType="url" placeholder="https://company.com" />
          </Card>

          {/* Tax Identification */}
          <View style={styles.sectionHeaderRow}>
            <MaterialCommunityIcons name="shield-check-outline" size={18} color={colors.primary} />
            <Text style={styles.sectionTitle}>Tax & Legal Identification</Text>
          </View>
          <Card style={styles.card}>
            <View style={styles.row}>
              <View style={styles.col}>
                <Input label="GSTIN" value={form.gstin ?? ''} onChangeText={set('gstin')} autoCapitalize="characters" placeholder="22AAAAA0000A1Z5" />
              </View>
              <View style={styles.col}>
                <Input label="PAN" value={form.pan ?? ''} onChangeText={set('pan')} autoCapitalize="characters" placeholder="ABCDE1234F" />
              </View>
            </View>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Fixed Bottom Save Button */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <Button label={saving ? 'Saving changes…' : 'Save Changes'} onPress={handleSave} loading={saving} />
      </View>

      {/* Logo confirm step: Cancel / Crop / Save */}
      <Modal visible={!!pendingLogo} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setPendingLogo(null)}>
        <View style={styles.previewBackdrop}>
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>Use this logo?</Text>
            {pendingLogo && (
              <View style={styles.previewBox}>
                <Image source={{ uri: pendingLogo.uri }} style={styles.previewImage} resizeMode="contain" />
              </View>
            )}
            <View style={styles.previewActions}>
              <View style={{ flex: 1 }}>
                <Button label="Cancel" variant="outline" onPress={() => setPendingLogo(null)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Crop" variant="outline" onPress={() => setCropOpen(true)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Save" onPress={useLogoAsIs} />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <LogoCropModal visible={cropOpen} image={pendingLogo} onCancel={() => setCropOpen(false)} onDone={onLogoCropped} />

      <SuccessModal visible={successVisible} title={successInfo?.title} message={successInfo?.message ?? null} onClose={() => setSuccessVisible(false)} />

      <ErrorModal visible={errorVisible} title={errorInfo?.title} message={errorInfo?.message ?? null} onClose={() => setErrorVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  screen: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  scrollContent: { padding: spacing.md },
  card: { marginBottom: spacing.md, borderRadius: radius.lg },
  brandCard: { marginBottom: spacing.md, borderRadius: radius.lg, padding: spacing.md },
  logoSection: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logoWrapper: { position: 'relative' },
  logoPreview: { width: 84, height: 84, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface ?? '#f8fafc', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoImage: { width: '100%', height: '100%' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  cameraBadge: { position: 'absolute', bottom: -3, right: -3, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#ffffff', elevation: 3, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 2 } },
  logoTextWrapper: { flex: 1, gap: 3 },
  brandTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary ?? '#0f172a' },
  brandSubtitle: { fontSize: 12, color: colors.textSecondary ?? '#64748b', lineHeight: 16 },
  uploadTextLink: { marginTop: 4, fontSize: 13, fontWeight: '600', color: colors.primary },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm, marginBottom: spacing.xs, paddingHorizontal: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.textSecondary ?? '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 },
  row: { flexDirection: 'row', gap: spacing.sm },
  col: { flex: 1 },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.surface ?? '#ffffff', paddingTop: spacing.sm, paddingHorizontal: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, elevation: 10, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: -3 } },
  previewBackdrop: { flex: 1, backgroundColor: 'rgba(15,31,61,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  previewCard: { width: '100%', backgroundColor: colors.surface ?? '#fff', borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  previewTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary ?? '#0f172a' },
  previewBox: { width: '100%', aspectRatio: 1, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: '#f8fafc', overflow: 'hidden' },
  previewImage: { width: '100%', height: '100%' },
  previewActions: { flexDirection: 'row', gap: spacing.sm },
});