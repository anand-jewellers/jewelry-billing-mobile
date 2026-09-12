import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Input } from '../../../src/components/ui';
import { colors, spacing } from '../../../src/theme';
import { createCustomer } from '../../../src/lib/api/customers';

export default function AddCustomerScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Customer name is required.');
      return;
    }
    if (!phone.trim()) {
      setError('Phone number is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const customer = await createCustomer({ name, phone, email, address, gstin });
      router.replace(`/customers/${customer.id}`);
    } catch (e: any) {
      setError(e.message ?? 'Could not save customer.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.lg }}>
      {error && <Text style={styles.error}>{error}</Text>}

      <Input label="Name" value={name} onChangeText={setName} placeholder="Customer name" />
      <Input label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="10-digit mobile number" />
      <Input label="Email (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="customer@example.com" />
      <Input label="Address (optional)" value={address} onChangeText={setAddress} placeholder="Address" />
      <Input label="GSTIN (optional)" value={gstin} onChangeText={setGstin} placeholder="GSTIN" />

      <View style={{ marginTop: spacing.lg }}>
        <Button label={saving ? 'Saving…' : 'Save Customer'} onPress={handleSave} disabled={saving} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  error: { fontSize: 13, color: colors.error, textAlign: 'center', marginBottom: spacing.md },
});