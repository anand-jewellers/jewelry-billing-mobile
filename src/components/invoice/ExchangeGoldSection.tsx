import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Plus, Trash2, Pencil } from 'lucide-react-native';
import { colors, spacing, radius } from '../../theme';
import { ExchangeGoldModal } from './ExchangeGoldModal';
import { sumExchangeTotal, displayNetWeight } from '../../lib/exchangeGold';
import type { ExchangeItem } from '../../types/invoices';
import type { Metal, Purity } from '../../types/settings';

interface Props {
    items: ExchangeItem[];
    onChange: (items: ExchangeItem[], total: number) => void;
    metals?: Metal[];
    purities?: Purity[];
    fetchRate?: (metalId: string, purityId: string) => Promise<number>;
    locked?: boolean;
    onLockedAttempt?: () => void;
}
export function ExchangeGoldSection({
    items,
    onChange,
    metals,
    purities,
    fetchRate,
    locked = false,
    onLockedAttempt,
}: Props) {
    const [modalOpen, setModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<ExchangeItem | null>(null);

    const commit = (next: ExchangeItem[]) => onChange(next, sumExchangeTotal(next));

    const handleSave = (item: ExchangeItem) => {
        const exists = items.some((i) => i.id === item.id);
        commit(exists ? items.map((i) => (i.id === item.id ? item : i)) : [...items, item]);
    };

    const handleDelete = (id: string) => commit(items.filter((i) => i.id !== id));

    const openAdd = () => {
        if (locked) return onLockedAttempt?.();
        setEditingItem(null);
        setModalOpen(true);
    };

    const openEdit = (item: ExchangeItem) => {
        if (locked) return onLockedAttempt?.();
        setEditingItem(item);
        setModalOpen(true);
    };

    const attemptDelete = (id: string) => {
        if (locked) return onLockedAttempt?.();
        handleDelete(id);
    };

    const total = sumExchangeTotal(items);

    return (
        <View style={styles.wrap}>
            <View style={styles.headerRow}>
                <Text style={styles.title}>Old Gold Exchange</Text>
                <Pressable style={styles.addBtn} onPress={openAdd}>
                    <Plus size={14} color={colors.primary} />
                    <Text style={styles.addBtnText}>Add Item</Text>
                </Pressable>
            </View>

            {items.length === 0 ? (
                <Text style={styles.emptyText}>No old gold added for this invoice.</Text>
            ) : (
                items.map((item) => (
                    <View key={item.id} style={styles.itemRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.itemName}>{item.description}</Text>
                            <Text style={styles.itemMeta}>
                                {item.gross_weight}g gross · claimed {item.purity_percent}% · old {item.old_percent}% · deduction {item.deduction_percent}% · net {displayNetWeight(item)}g
                            </Text>
                        </View>
                        <Text style={styles.itemAmount}>₹{item.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                        <Pressable hitSlop={8} style={styles.iconBtn} onPress={() => openEdit(item)}>
                            <Pencil size={14} color={colors.textMuted} />
                        </Pressable>
                        <Pressable hitSlop={8} style={styles.iconBtn} onPress={() => attemptDelete(item.id)}>
                            <Trash2 size={14} color={colors.error ?? 'crimson'} />
                        </Pressable>
                    </View>
                ))
            )}

            {items.length > 0 && (
                <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Exchange Total</Text>
                    <Text style={styles.totalValue}>₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                </View>
            )}

            <ExchangeGoldModal
                visible={modalOpen}
                onClose={() => setModalOpen(false)}
                onSave={handleSave}
                editingItem={editingItem}
                metals={metals}
                purities={purities}
                fetchRate={fetchRate}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { borderWidth: 1, borderColor: colors.border, borderRadius: radius?.md ?? 10, padding: spacing.md, marginBottom: spacing.lg, backgroundColor: colors.surface },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    title: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
    addBtnText: { fontSize: 12, fontWeight: '700', color: colors.primary },
    emptyText: { fontSize: 12, color: colors.textMuted, paddingVertical: spacing.sm },
    itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 },
    itemName: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
    itemMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    itemAmount: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
    iconBtn: { padding: 4 },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, marginTop: 4, borderTopWidth: 1, borderTopColor: colors.border },
    totalLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
    totalValue: { fontSize: 15, fontWeight: '800', color: colors.primary },
});