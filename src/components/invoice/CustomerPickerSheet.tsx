import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { X, Plus } from 'lucide-react-native';
import { colors, spacing } from '../../theme';
import { searchCustomers, createCustomer } from '../../lib/api/invoices';
import type { Customer } from '../../types/invoices';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (customer: Customer) => void;
}

export function CustomerPickerSheet({ visible, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    const t = setTimeout(() => {
      searchCustomers(query).then(setResults).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query, visible]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const customer = await createCustomer({
      name: newName.trim(),
      phone: newPhone.trim() || null,
      email: null,
      address: null,
      gstin: null,
    });
    onSelect(customer);
    setCreating(false);
    setNewName('');
    setNewPhone('');
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Select Customer</Text>
            <Pressable onPress={onClose}><X size={20} color={colors.textPrimary} /></Pressable>
          </View>

          {!creating ? (
            <>
              <TextInput
                style={styles.input}
                placeholder="Search by name or phone"
                value={query}
                onChangeText={setQuery}
              />
              <Pressable style={styles.newBtn} onPress={() => setCreating(true)}>
                <Plus size={16} color={colors.primary} />
                <Text style={styles.newBtnText}>New customer</Text>
              </Pressable>
              {loading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
              ) : (
                <FlatList
                  data={results}
                  keyExtractor={(c) => c.id}
                  style={{ maxHeight: 360 }}
                  renderItem={({ item }) => (
                    <Pressable style={styles.row} onPress={() => onSelect(item)}>
                      <Text style={styles.rowName}>{item.name}</Text>
                      <Text style={styles.rowMeta}>{item.phone ?? item.email ?? '—'}</Text>
                    </Pressable>
                  )}
                  ListEmptyComponent={<Text style={styles.empty}>No customers found.</Text>}
                />
              )}
            </>
          ) : (
            <>
              <TextInput style={styles.input} placeholder="Name" value={newName} onChangeText={setNewName} />
              <TextInput style={styles.input} placeholder="Phone" value={newPhone} onChangeText={setNewPhone} keyboardType="phone-pad" />
              <Pressable style={styles.saveBtn} onPress={handleCreate}>
                <Text style={styles.saveBtnText}>Create & Select</Text>
              </Pressable>
              <Pressable onPress={() => setCreating(false)}>
                <Text style={styles.cancelText}>Back to search</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: spacing.lg, maxHeight: '85%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  input: { borderWidth: 1, borderColor: colors.border ?? '#ddd', borderRadius: 8, padding: spacing.sm, marginBottom: spacing.sm, color: colors.textPrimary },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  newBtnText: { color: colors.primary, fontWeight: '600' },
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  rowMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.textMuted, padding: spacing.lg },
  saveBtn: { backgroundColor: colors.gold ?? colors.primary, padding: spacing.md, borderRadius: 10, alignItems: 'center', marginTop: spacing.sm },
  saveBtnText: { color: '#fff', fontWeight: '700' },
  cancelText: { textAlign: 'center', color: colors.textSecondary, marginTop: spacing.md },
});