import { useCallback, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, FlatList } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, spacing, radius } from '../../../src/theme';
import { getAllCurrentRates, setManualMetalRate, MetalRateRow } from '../../../src/lib/products';
import { useAuth } from '../../../src/context/AuthContext'; // adjust path/hook name to match your app

export default function MetalRatesScreen() {
  const { profile } = useAuth(); // expects { id, full_name, role, ... } | null
  const [rates, setRates] = useState<MetalRateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getAllCurrentRates()
      .then(setRates)
      .catch((e) => Alert.alert('Error', e.message))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);

  async function saveOverride(row: MetalRateRow) {
    if (!profile?.id) {
      Alert.alert('Error', 'You must be signed in to update rates.');
      return;
    }

    const key = `${row.metal_id}_${row.purity_id}`;
    const value = parseFloat(edits[key]);
    if (!value || value <= 0) {
      Alert.alert('Invalid rate', 'Enter a rate greater than 0');
      return;
    }
    setSavingKey(key);
    try {
      await setManualMetalRate(row.metal_id, row.purity_id, value, profile.id);
      setEdits((e) => ({ ...e, [key]: '' }));
      load();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save rate');
    } finally {
      setSavingKey(null);
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
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.list}
      data={rates}
      keyExtractor={(r) => `${r.metal_id}_${r.purity_id}`}
      renderItem={({ item }) => {
        const key = `${item.metal_id}_${item.purity_id}`;
        return (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.title}>{item.metals?.name} · {item.purities?.name}</Text>
              <View style={[styles.badge, item.source === 'auto' ? styles.badgeAuto : styles.badgeManual]}>
                <Text style={styles.badgeText}>{item.source === 'auto' ? 'Auto' : 'Manual'}</Text>
              </View>
            </View>
            <Text style={styles.currentRate}>₹ {Number(item.rate_per_gram).toFixed(2)} / g</Text>

            <View style={styles.overrideRow}>
              <TextInput
                style={styles.input}
                placeholder="Override rate"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                value={edits[key] ?? ''}
                onChangeText={(t) => setEdits((e) => ({ ...e, [key]: t }))}
              />
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={() => saveOverride(item)}
                disabled={savingKey === key}
              >
                <Text style={styles.saveBtnText}>{savingKey === key ? '...' : 'Update'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background,paddingTop: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  list: { padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  badge: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10 },
  badgeAuto: { backgroundColor: '#E6F4EA' },
  badgeManual: { backgroundColor: '#FFF4E5' },
  badgeText: { fontSize: 11, fontWeight: '700', color: colors.textPrimary },
  currentRate: { fontSize: 20, fontWeight: '800', color: colors.primary, marginTop: spacing.xs },
  overrideRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: spacing.md, fontSize: 14, color: colors.text, backgroundColor: colors.background },
  saveBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});