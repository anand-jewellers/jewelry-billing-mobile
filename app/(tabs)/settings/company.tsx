import { useEffect, useState } from 'react';
import { ScrollView, Text, StyleSheet, ActivityIndicator, View, Image, Pressable } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { Card, Input, Button } from '../../../src/components/ui';
import { colors, radius, spacing } from '../../../src/theme';
import { supabase } from '../../../src/lib/supabaseClient';
import { getCompanySettings, updateCompanySettings } from '../../../src/lib/api/settings';
import { useCompanySettings } from '../../../src/context/CompanySettingsContext';
import type { CompanySettings } from '../../../src/types/settings';

const LOGO_BUCKET = 'company-assets';

/**
 * Picks an image, uploads it to the "company-assets" Storage bucket under a
 * fixed filename, and returns its public URL (with a cache-busting query
 * param so the UI doesn't keep showing a stale cached copy). Only admins
 * can write to this bucket (see the storage RLS policy
 * "admin write company-assets" in the schema) — a non-admin will get a
 * permission error here, which is expected.
 *
 * NOTE: We read the picked file via expo-file-system's File.bytes(),
 * rather than using fetch(asset.uri).arrayBuffer(). On Android, fetch()
 * against content:// / file:// URIs from ImagePicker can silently return
 * a truncated/empty buffer, which produced a "logo" that was only a few
 * bytes and failed to render. File.bytes() reads the actual file
 * contents reliably (Expo SDK 54+ File/Directory API).
 *
 * NOTE: The upload path is fixed ("logo/company-logo.<ext>") rather than
 * timestamped, and upsert:true overwrites it in place on re-upload —
 * previously every upload used a new Date.now()-based filename, which left
 * every past logo sitting in Storage forever. If the file extension
 * changes between uploads (e.g. you pick a .png after previously using a
 * .jpg), we also delete any other "company-logo.*" files first so there's
 * only ever one logo file at a time.
 */
async function pickAndUploadLogo(): Promise<string> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo library permission was denied.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  });

  if (result.canceled || !result.assets?.[0]) {
    throw new Error('CANCELED');
  }

  const asset = result.assets[0];
  const extMatch = asset.uri.match(/\.(\w+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
  const contentType = asset.mimeType ?? (ext === 'png' ? 'image/png' : 'image/jpeg');
  const fileName = `company-logo.${ext}`;
  const path = `logo/${fileName}`;

  const file = new File(asset.uri);
  const bytes = await file.bytes();
  console.log('Logo upload: read local file, bytes =', bytes.byteLength);

  if (bytes.byteLength < 1024) {
    // A real photo at quality 0.7 is virtually never under 1KB — this
    // almost always means the file read failed silently. Fail loudly
    // instead of uploading a broken image.
    throw new Error(
      `Read file looks too small (${bytes.byteLength} bytes) — the image may not have loaded correctly.`
    );
  }

  // Remove any previous logo file with a different extension so re-uploading
  // in a different format doesn't leave the old one behind.
  const { data: existingFiles } = await supabase.storage.from(LOGO_BUCKET).list('logo');
  const staleFiles = (existingFiles ?? [])
    .filter((f) => f.name.startsWith('company-logo.') && f.name !== fileName)
    .map((f) => `logo/${f.name}`);
  if (staleFiles.length > 0) {
    await supabase.storage.from(LOGO_BUCKET).remove(staleFiles);
  }

  const { error: uploadError } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (uploadError) {
    console.error('Logo upload: Supabase Storage upload error:', uploadError);
    throw uploadError;
  }

  const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
  // Cache-bust: same path every time means the same URL every time, which
  // <Image> and CDNs may cache. Appending a changing query param forces a
  // fresh fetch so the new logo shows immediately after overwriting.
  const bustedUrl = `${data.publicUrl}?v=${Date.now()}`;
  console.log('Logo upload: public URL =', bustedUrl);
  return bustedUrl;
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
  const { setSettings: setGlobalSettings } = useCompanySettings();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoSaved, setLogoSaved] = useState(false);
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);

  useEffect(() => {
    getCompanySettings()
      .then((data) => setForm(data))
      .catch(() => setError('Could not load company settings.'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await updateCompanySettings(form);
      setSaved(true);
      setGlobalSettings(form as CompanySettings);
    } catch {
      setError('Could not save. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof typeof form) => (value: string) => {
    setLogoSaved(false);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleChangeLogo = async () => {
    setError(null);
    setSaved(false);
    setLogoLoadFailed(false);
    setUploadingLogo(true);
    try {
      const url = await pickAndUploadLogo();
      setForm((f) => ({ ...f, logo_url: url }));
      await updateCompanySettings({ logo_url: url });
      setLogoSaved(true);
      setGlobalSettings({ ...(form as CompanySettings), logo_url: url });
    } catch (err) {
      if (err instanceof Error && err.message === 'CANCELED') return;
      // Log the real error to the Metro terminal so we can see exactly what failed.
      console.error('Logo upload failed:', err);
      const detail = err instanceof Error ? err.message : String(err);
      setError(`Could not upload the logo: ${detail}`);
    } finally {
      setUploadingLogo(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.lg }}>
      <Card>
        {error && <Text style={styles.error}>{error}</Text>}
        {saved && <Text style={styles.success}>Saved.</Text>}

        <Text style={styles.label}>Company Logo</Text>
        <View style={styles.logoRow}>
          <View style={styles.logoPreview}>
            {form.logo_url && !logoLoadFailed ? (
              <Image
                source={{ uri: form.logo_url }}
                style={styles.logoImage}
                resizeMode="contain"
                onError={(e) => {
                  console.error('Logo preview failed to load:', e.nativeEvent.error);
                  setLogoLoadFailed(true);
                }}
              />
            ) : (
              <Text style={styles.logoPlaceholder}>
                {logoLoadFailed ? 'Failed to load' : 'No logo'}
              </Text>
            )}
          </View>
          <Pressable onPress={handleChangeLogo} disabled={uploadingLogo} style={styles.logoButton}>
            {uploadingLogo ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Text style={styles.logoButtonText}>{form.logo_url ? 'Change Logo' : 'Upload Logo'}</Text>
            )}
          </Pressable>
        </View>
        {logoSaved && !uploadingLogo && !logoLoadFailed && (
          <Text style={styles.logoSaved}>Logo saved ✓</Text>
        )}
        <Text style={styles.logoHint}>
          Used on the login screen, the app header, and printed invoices. Square images work best.
        </Text>

        <Input label="Company Name" value={form.company_name} onChangeText={set('company_name')} placeholder="Your shop's name" />
        <Input label="Address" value={form.address ?? ''} onChangeText={set('address')} placeholder="Street address" />
        <Input label="City" value={form.city ?? ''} onChangeText={set('city')} />
        <Input label="State" value={form.state ?? ''} onChangeText={set('state')} />
        <Input label="Pincode" value={form.pincode ?? ''} onChangeText={set('pincode')} keyboardType="number-pad" />
        <Input label="Phone" value={form.phone ?? ''} onChangeText={set('phone')} keyboardType="phone-pad" />
        <Input label="Email" value={form.email ?? ''} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
        <Input label="GSTIN" value={form.gstin ?? ''} onChangeText={set('gstin')} autoCapitalize="characters" />
        <Input label="PAN" value={form.pan ?? ''} onChangeText={set('pan')} autoCapitalize="characters" />
        <Input label="Website" value={form.website ?? ''} onChangeText={set('website')} autoCapitalize="none" keyboardType="url" />

        <Button label={saving ? 'Saving…' : 'Save Changes'} onPress={handleSave} loading={saving} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  error: { fontSize: 13, color: colors.error, marginBottom: spacing.md, textAlign: 'center' },
  success: { fontSize: 13, color: colors.success, marginBottom: spacing.md, textAlign: 'center' },
  label: { fontSize: 12, color: colors.textSecondary, marginBottom: 6, fontWeight: '500' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  logoPreview: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImage: { width: '100%', height: '100%' },
  logoPlaceholder: { fontSize: 11, color: colors.textMuted },
  logoButton: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
  },
  logoButtonText: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  logoSaved: { fontSize: 12, color: colors.success, fontWeight: '600', marginBottom: spacing.xs },
  logoHint: { fontSize: 11.5, color: colors.textMuted, marginBottom: spacing.lg },
});  