// app/(tabs)/invoices/purchase.tsx
//
// Cash purchase of old gold / silver ("Adagu Nagai").
//   /invoices/purchase          -> new purchase form, saves, then shows the receipt
//   /invoices/purchase?id=<id>  -> opens a saved purchase receipt (print / share)

import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  type LayoutChangeEvent,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import { Printer, Share2, Plus, Trash2, Pencil } from 'lucide-react-native';
import { PageGuard } from '../../../src/components/PageGuard';
import { ErrorModal } from '../../../src/components/ui';
import { PurchaseItemModal } from '../../../src/components/invoice/PurchaseItemModal';
import { colors, spacing } from '../../../src/theme';
import { useStaff } from '../../../src/context/StaffContext';
import { listMetals, listPurities, getCompanySettings } from '../../../src/lib/api/settings';
import { getCurrentRate } from '../../../src/lib/api/invoices';
import {
  createCashPurchase,
  getCashPurchase,
  deleteCashPurchases,
  type CashPurchase,
  type PurchaseItem,
} from '../../../src/lib/api/cashPurchases';
import { sumExchangeTotal, displayNetWeight } from '../../../src/lib/exchangeGold';
import {
  shopInfoFromCompany,
  shareReceiptPdfOnWhatsApp,
} from '../../../src/lib/whatsappShare';
import { formatReceiptDate, type RepairShopInfo } from '../../../src/lib/repairReceipt';
import {
  PURCHASE_PAY_MODES,
  purchaseModeLabel,
  generatePurchaseReceiptNo,
  buildPurchaseReceiptHtml,
  estimatePurchaseReceiptHeightPt,
  type PurchaseReceiptData,
} from '../../../src/lib/purchaseReceipt';
import {
  getConnectedPrinter,
  disconnectActive,
} from '../../../src/lib/thermalPrint/printerService';
import { printPurchaseReceiptDirect } from '../../../src/lib/thermalPrint/escposPurchaseReceipt';
import type { Metal, Purity } from '../../../src/types/settings';

const money = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

function purchaseToReceipt(p: CashPurchase): PurchaseReceiptData {
  return {
    receiptNo: p.receipt_no,
    dateText: formatReceiptDate(new Date(p.created_at)),
    customerName: p.customer_name,
    phone: p.phone ?? '',
    items: p.items,
    total: p.total_amount,
    paymentLabel: purchaseModeLabel(p.payment_mode),
    remarks: p.remarks ?? '',
  };
}

export default function CashPurchaseScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { currentStaff } = useStaff();
  const isAdmin = currentStaff?.role === 'admin';

  // ---- master data ----
  const [metals, setMetals] = useState<Metal[]>([]);
  const [purities, setPurities] = useState<Purity[]>([]);

  // ---- form ----
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [items, setItems] = useState<PurchaseItem[]>([]);
  const [payMode, setPayMode] = useState('cash');
  const [remarks, setRemarks] = useState('');
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PurchaseItem | null>(null);

  // ---- saved purchase (null = still on the form) ----
  const [purchase, setPurchase] = useState<CashPurchase | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [shop, setShop] = useState<RepairShopInfo>({ name: 'Our Shop', address: null, phone: null });
  const [sharing, setSharing] = useState(false);
  const [printing, setPrinting] = useState(false);

  // ---- error modal (same ErrorModal as the New Invoice page) ----
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState<string>('Missing details');
  const showError = (title: string, message: string) => {
    setErrorTitle(title);
    setErrorMessage(message);
  };

  // ---- keyboard-aware form ----
  const scrollRef = useRef<ScrollView>(null);
  const fieldY = useRef<Record<string, number>>({});
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates.height));
    const b = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  const regField = (key: string) => (e: LayoutChangeEvent) => {
    fieldY.current[key] = e.nativeEvent.layout.y;
  };
  const scrollToField = (key: string) => {
    const y = fieldY.current[key];
    if (y == null) return;
    setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true }), 280);
  };

  const receipt = purchase ? purchaseToReceipt(purchase) : null;
  const total = sumExchangeTotal(items);

  // Master data + shop info
  useEffect(() => {
    (async () => {
      try {
        const [m, p] = await Promise.all([listMetals(), listPurities()]);
        setMetals(m);
        setPurities(p);
      } catch (e: any) {
        console.warn('[purchase] master data failed', e?.message ?? e);
      }
    })();
    (async () => {
      try {
        const company: any = await getCompanySettings();
        const info = shopInfoFromCompany(company);
        const shopPhone =
          company?.phone ?? company?.mobile ?? company?.contact_number ?? company?.phone_number ?? null;
        setShop({ name: info.name, address: info.address, phone: shopPhone ? String(shopPhone) : null });
      } catch {
        /* keep default */
      }
    })();
  }, []);

  // Opened from the Purchases list -> load the saved receipt
  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      try {
        const p = await getCashPurchase(id);
        if (alive) setPurchase(p);
      } catch (e: any) {
        if (!alive) return;
        Alert.alert('Could not open receipt', e?.message ?? 'Unknown error', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } finally {
        if (alive) setLoadingSaved(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // ---------------------------------------------------------
  // Items
  // ---------------------------------------------------------
  const handleItemSave = (item: PurchaseItem) => {
    setItems((prev) =>
      prev.some((i) => i.id === item.id) ? prev.map((i) => (i.id === item.id ? item : i)) : [...prev, item]
    );
  };
  const openAddItem = () => {
    setEditingItem(null);
    setItemModalOpen(true);
  };
  const openEditItem = (it: PurchaseItem) => {
    setEditingItem(it);
    setItemModalOpen(true);
  };

  // ---------------------------------------------------------
  // Save + create receipt
  // ---------------------------------------------------------
  const handleSave = async () => {
    if (saving) return;
    if (!name.trim()) return showError('Name needed', 'Enter the customer name.');
    const digits = phone.replace(/\D/g, '');
    if (phone.trim() && digits.length < 10) {
      return showError('Check phone number', 'Enter a valid 10-digit phone number or leave it empty.');
    }
    if (items.length === 0) return showError('No items', 'Add at least one item before saving.');

    setSaving(true);
    try {
      const saved = await createCashPurchase({
        receiptNo: generatePurchaseReceiptNo(new Date()),
        customerName: name.trim(),
        phone: phone.trim(),
        items,
        totalAmount: total,
        paymentMode: payMode,
        remarks: remarks.trim(),
      });
      setPurchase(saved);
    } catch (e: any) {
      showError('Could not save purchase', e?.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------
  // Print (thermal direct, system dialog as fallback)
  // ---------------------------------------------------------
  const printViaSystem = async (r: PurchaseReceiptData) => {
    const html = buildPurchaseReceiptHtml(r, shop);
    if (Platform.OS === 'web') {
      const w = window.open('', '_blank');
      if (!w) {
        showError('Pop-up blocked', 'Allow pop-ups for this site to print the receipt.');
        return;
      }
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 300);
    } else {
      await Print.printAsync({ html, width: 226, height: estimatePurchaseReceiptHeightPt(r) });
    }
  };

  const handlePrint = async () => {
    if (!receipt || printing) return;

    if (Platform.OS === 'web') {
      try {
        await printViaSystem(receipt);
      } catch (e: any) {
        showError('Could not print', e?.message ?? 'Unknown error');
      }
      return;
    }

    setPrinting(true);
    try {
      const printer = await getConnectedPrinter();
      try {
        await printPurchaseReceiptDirect(printer, receipt, shop);
      } finally {
        await disconnectActive();
      }
    } catch (e: any) {
      Alert.alert(
        'Could not print on thermal printer',
        `${e?.message ?? 'Unknown error'}\n\nPrint using the phone's print dialog instead?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Use print dialog',
            onPress: () => {
              printViaSystem(receipt).catch((err: any) => {
                const msg = String(err?.message ?? '').toLowerCase();
                if (!msg.includes('cancel')) showError('Could not print', err?.message ?? 'Unknown error');
              });
            },
          },
        ]
      );
    } finally {
      setPrinting(false);
    }
  };

  // ---------------------------------------------------------
  // Share (WhatsApp, PDF attached)
  // ---------------------------------------------------------
  const handleShare = async () => {
    if (!receipt) return;
    setSharing(true);
    try {
      const message = [
        `Hi ${receipt.customerName || 'there'},`,
        `Your cash purchase receipt from *${shop.name?.trim() || 'us'}* is attached.`,
        '',
        `Receipt No: ${receipt.receiptNo}`,
        `Total paid: ${money(receipt.total)} (${receipt.paymentLabel})`,
        '',
        'Thank you! 🙏',
      ].join('\n');

      await shareReceiptPdfOnWhatsApp({
        html: buildPurchaseReceiptHtml(receipt, shop),
        fileName: receipt.receiptNo,
        message,
        phone: receipt.phone || null,
        heightPt: estimatePurchaseReceiptHeightPt(receipt),
      });
    } catch (e: any) {
      showError('Could not share receipt', e?.message ?? 'Unknown error');
    } finally {
      setSharing(false);
    }
  };

  // ---------------------------------------------------------
  // Delete (admin only)
  // ---------------------------------------------------------
  const handleDelete = () => {
    if (!purchase || !isAdmin) return;
    Alert.alert('Delete purchase receipt?', 'This permanently removes the saved receipt.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCashPurchases([purchase.id]);
            router.back();
          } catch (e: any) {
            showError('Could not delete', e?.message ?? 'Unknown error');
          }
        },
      },
    ]);
  };

  const resetForm = () => {
    setName('');
    setPhone('');
    setItems([]);
    setPayMode('cash');
    setRemarks('');
    setPurchase(null);
  };

  // =========================================================
  // Loading a saved receipt
  // =========================================================
  if (loadingSaved) {
    return (
      <PageGuard pageKey="invoices">
        <View style={[styles.screen, { justifyContent: 'center' }]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </PageGuard>
    );
  }

  // =========================================================
  // Receipt view
  // =========================================================
  if (purchase && receipt) {
    return (
      <PageGuard pageKey="invoices">
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          <View style={styles.slip}>
            <Text style={styles.shopName}>{shop.name}</Text>
            {shop.address ? <Text style={styles.shopSub}>{shop.address}</Text> : null}
            {shop.phone ? <Text style={styles.shopSub}>Ph: {shop.phone}</Text> : null}
            <Text style={styles.slipTitle}>CASH PURCHASE RECEIPT</Text>

            <View style={styles.dash} />
            <Line k="Receipt No" v={receipt.receiptNo} bold />
            <Line k="Date" v={receipt.dateText} />
            <Line k="Name" v={receipt.customerName} bold />
            {receipt.phone ? <Line k="Phone" v={receipt.phone} /> : null}

            {receipt.items.map((it, idx) => {
              const stone = Number(it.stone_weight) || 0;
              return (
                <View key={it.id}>
                  <View style={styles.dash} />
                  <Text style={styles.itemTitle}>
                    ITEM {idx + 1}: {it.name}
                  </Text>
                  <Line k="Metal" v={`${it.metal_name} ${it.purity_name}`.trim()} />
                  <Line k="Weight" v={`${it.gross_weight.toFixed(3)} gms`} />
                  {stone > 0 ? <Line k="Dust/Stone" v={stone.toFixed(3)} /> : null}
                  {stone > 0 ? <Line k="Net Weight" v={displayNetWeight(it).toFixed(3)} /> : null}
                  <Line k="Old Percentage" v={`${it.old_percent.toFixed(2)}%`} />
                  <Line k="Rate/Gm" v={money(it.rate_per_gram)} />
                  <Line k="Amount" v={money(it.amount)} bold />
                </View>
              );
            })}

            <View style={styles.dash} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>TOTAL PAID</Text>
              <Text style={styles.totalValue}>{money(receipt.total)}</Text>
            </View>
            <Line k="Paid by" v={receipt.paymentLabel} />

            {receipt.remarks ? (
              <>
                <View style={styles.dash} />
                <Text style={styles.kText}>Remarks</Text>
                <Text style={styles.remarksText}>{receipt.remarks}</Text>
              </>
            ) : null}

            <View style={styles.signBox}>
              <Text style={styles.signText}>Customer signature</Text>
            </View>
          </View>

          <View style={styles.actionRow}>
            <Pressable style={styles.outlineBtn} onPress={handlePrint} disabled={printing}>
              {printing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Printer size={18} color={colors.primary} />
                  <Text style={styles.outlineBtnText}>Print</Text>
                </>
              )}
            </Pressable>

            <Pressable style={styles.primaryBtnFlex} onPress={handleShare} disabled={sharing}>
              {sharing ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Share2 size={18} color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>Share</Text>
                </>
              )}
            </Pressable>
          </View>

          {/* <View style={styles.actionRow}>
            <Pressable style={styles.ghostBtn} onPress={resetForm}>
              <Plus size={16} color="#0F172A" />
              <Text style={styles.ghostBtnText}>New purchase</Text>
            </Pressable>
            <Pressable style={styles.ghostBtn} onPress={() => router.back()}>
              <Text style={styles.ghostBtnText}>Done</Text>
            </Pressable>
            {isAdmin ? (
              <Pressable style={[styles.ghostBtn, styles.ghostBtnDanger]} onPress={handleDelete}>
                <Trash2 size={16} color="#C5221F" />
                <Text style={[styles.ghostBtnText, { color: '#C5221F' }]}>Delete</Text>
              </Pressable>
            ) : null}
          </View> */}
        </ScrollView>

        <ErrorModal
          visible={!!errorMessage}
          title={errorTitle}
          message={errorMessage}
          onClose={() => setErrorMessage(null)}
        />
      </PageGuard>
    );
  }

  // =========================================================
  // Form view
  // =========================================================
  return (
    <PageGuard pageKey="invoices">
      <ScrollView
        ref={scrollRef}
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingBottom: 40 + kbHeight }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <Field label="Name" required onLayout={regField('name')}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Customer name"
            placeholderTextColor="#94A3B8"
            autoCapitalize="words"
            onFocus={() => scrollToField('name')}
          />
        </Field>

        <Field label="Phone" onLayout={regField('phone')}>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="10-digit mobile number"
            placeholderTextColor="#94A3B8"
            keyboardType="phone-pad"
            maxLength={13}
            onFocus={() => scrollToField('phone')}
          />
        </Field>

        {/* Items */}
        <View style={styles.itemsHeader}>
          <Text style={styles.label}>
            Items <Text style={{ color: '#C5221F' }}>*</Text>
          </Text>
          <Pressable style={styles.addItemBtn} onPress={openAddItem}>
            <Plus size={14} color={colors.primary} />
            <Text style={styles.addItemText}>Add item</Text>
          </Pressable>
        </View>

        {items.length === 0 ? (
          <Pressable style={styles.emptyItems} onPress={openAddItem}>
            <Text style={styles.emptyItemsText}>No items yet. Tap to add old gold / silver.</Text>
          </Pressable>
        ) : (
          items.map((it) => (
            <View key={it.id} style={styles.itemCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName} numberOfLines={1}>
                  {it.name}
                </Text>
                <Text style={styles.itemMeta} numberOfLines={2}>
                  {it.metal_name} {it.purity_name} · {it.gross_weight}g
                  {it.stone_weight > 0 ? ` · stone ${it.stone_weight}g` : ''} · old {it.old_percent}% · ₹
                  {it.rate_per_gram}/g
                </Text>
              </View>
              <Text style={styles.itemAmount}>{money(it.amount)}</Text>
              <Pressable hitSlop={8} style={styles.iconBtn} onPress={() => openEditItem(it)}>
                <Pencil size={15} color="#64748B" />
              </Pressable>
              <Pressable
                hitSlop={8}
                style={styles.iconBtn}
                onPress={() => setItems((prev) => prev.filter((i) => i.id !== it.id))}
              >
                <Trash2 size={15} color="#C5221F" />
              </Pressable>
            </View>
          ))
        )}

        <View style={styles.totalCard}>
          <Text style={styles.totalCardLabel}>Total to pay customer</Text>
          <Text style={styles.totalCardValue}>{money(total)}</Text>
        </View>

        {/* Payment mode */}
        <View style={styles.field}>
          <Text style={styles.label}>Paid by</Text>
          <View style={styles.chipRow}>
            {PURCHASE_PAY_MODES.map((m) => (
              <Pressable
                key={m.id}
                style={[styles.chip, payMode === m.id && styles.chipOn]}
                onPress={() => setPayMode(m.id)}
              >
                <Text style={[styles.chipText, payMode === m.id && styles.chipTextOn]}>{m.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Field label="Remarks" onLayout={regField('remarks')}>
          <TextInput
            style={[styles.input, styles.inputMulti]}
            value={remarks}
            onChangeText={setRemarks}
            placeholder="Any note about this purchase"
            placeholderTextColor="#94A3B8"
            multiline
            onFocus={() => scrollToField('remarks')}
          />
        </Field>

        <Pressable
          style={[styles.primaryBtn, saving && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryBtnText}>Save & create receipt</Text>
          )}
        </Pressable>
      </ScrollView>

      <PurchaseItemModal
        visible={itemModalOpen}
        onClose={() => setItemModalOpen(false)}
        onSave={handleItemSave}
        metals={metals}
        purities={purities}
        fetchRate={getCurrentRate}
        editingItem={editingItem}
      />

      <ErrorModal
        visible={!!errorMessage}
        title={errorTitle}
        message={errorMessage}
        onClose={() => setErrorMessage(null)}
      />
    </PageGuard>
  );
}

// ---------------------------------------------------------
// Small pieces
// ---------------------------------------------------------
function Field({
  label,
  required,
  onLayout,
  children,
}: {
  label: string;
  required?: boolean;
  onLayout?: (e: LayoutChangeEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field} onLayout={onLayout}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={{ color: '#C5221F' }}> *</Text> : null}
      </Text>
      {children}
    </View>
  );
}

function Line({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={styles.kText}>{k}</Text>
      <Text style={[styles.vText, bold && styles.vBold]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: spacing.lg, paddingBottom: 40 },

  field: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '700', color: '#0F172A', marginBottom: 6 },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 14,
    color: '#0F172A',
  },
  inputMulti: {
    height: undefined,
    minHeight: 76,
    paddingTop: 12,
    paddingBottom: 12,
    textAlignVertical: 'top',
  },

  // items
  itemsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: '#FFFFFF',
  },
  addItemText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  emptyItems: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    borderRadius: 14,
    paddingVertical: 22,
    alignItems: 'center',
    marginBottom: 14,
    backgroundColor: '#FFFFFF',
  },
  emptyItemsText: { fontSize: 13, color: '#94A3B8' },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  itemName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  itemMeta: { fontSize: 11, color: '#64748B', marginTop: 2 },
  itemAmount: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  iconBtn: { padding: 4 },

  totalCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#E6F4EA',
    borderWidth: 1,
    borderColor: '#CEEAD6',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  totalCardLabel: { fontSize: 13, fontWeight: '700', color: '#137333' },
  totalCardValue: { fontSize: 18, fontWeight: '800', color: '#0F172A' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  chipOn: { backgroundColor: '#1E3A8A', borderColor: '#1E3A8A' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#0F172A' },
  chipTextOn: { color: '#FFFFFF' },

  primaryBtn: {
    marginTop: 6,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#1E3A8A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnFlex: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#1E3A8A',
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },

  // Receipt preview
  slip: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 18,
    marginBottom: 16,
  },
  shopName: { fontSize: 18, fontWeight: '800', color: '#0F172A', textAlign: 'center' },
  shopSub: { fontSize: 12, color: '#64748B', textAlign: 'center', marginTop: 2 },
  slipTitle: { fontSize: 13, fontWeight: '700', color: '#0F172A', textAlign: 'center', marginTop: 10 },
  dash: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#CBD5E1', marginVertical: 12 },
  itemTitle: { fontSize: 13, fontWeight: '800', color: '#1E3A8A', marginBottom: 4 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 3 },
  kText: { fontSize: 13, color: '#64748B' },
  vText: { fontSize: 13, color: '#0F172A', flexShrink: 1, textAlign: 'right' },
  vBold: { fontWeight: '700' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  totalLabel: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  totalValue: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  remarksText: { fontSize: 13, color: '#0F172A', marginTop: 2 },
  signBox: { marginTop: 36, borderTopWidth: 1, borderColor: '#334155', paddingTop: 4, alignItems: 'center' },
  signText: { fontSize: 11, color: '#64748B' },

  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  outlineBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineBtnText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  ghostBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBtnDanger: { borderColor: '#FAD2CF', backgroundColor: '#FCE8E6' },
  ghostBtnText: { fontSize: 13, fontWeight: '600', color: '#0F172A' },
});