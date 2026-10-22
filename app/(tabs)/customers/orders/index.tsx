// app\(tabs)\customers\orders\index.tsx

import { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Card } from '../../../../src/components/ui';
import { colors, spacing } from '../../../../src/theme';
import { listOpenOrders, OrderWithCustomer } from '../../../../src/lib/api/customerOrders';

export default function OrdersScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      listOpenOrders()
        .then((o) => { setOrders(o); setError(null); })
        .catch((e) => setError(e.message ?? 'Could not load orders.'))
        .finally(() => setLoading(false));
    }, [])
  );

  if (loading) return <ActivityIndicator style={{ marginTop: 40 }} />;
  if (error) return <Text style={styles.error}>{error}</Text>;

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      data={orders}
      keyExtractor={(o) => o.id}
      ListEmptyComponent={<Text style={styles.empty}>No open orders.</Text>}
      renderItem={({ item }) => (
        <Pressable
          // ⚠️ change this to your real customer detail route
          onPress={() => router.push(`/customers/${item.customer_id}` as never)}
        >
          <Card style={{ padding: spacing.md }}>
            <View style={styles.row}>
              <Text style={styles.title}>{item.order_number}</Text>
              <Text style={[styles.badge, item.status === 'ready' && styles.badgeReady]}>
                {item.status.toUpperCase()}
              </Text>
            </View>
            <Text style={styles.line}>{item.customer?.name ?? 'Unknown customer'}</Text>
            <Text style={styles.line}>
              {item.category} · {item.metal} ({item.purity})
            </Text>
            {item.due_date && <Text style={styles.muted}>Due: {item.due_date}</Text>}
          </Card>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  badge: {
    fontSize: 11, fontWeight: '700', color: '#B45309',
    backgroundColor: '#FEF3C7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },
  badgeReady: { color: '#1E8E3E', backgroundColor: '#E6F4EA' },
  line: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 40 },
  error: { textAlign: 'center', color: colors.error, marginTop: 40 },
});