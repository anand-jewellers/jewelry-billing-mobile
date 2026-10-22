// app/(tabs)/invoices/repair.tsx
//
// Two modes:
//   /invoices/repair          -> new repair form, saves, then shows the receipt
//   /invoices/repair?id=<id>  -> opens a saved repair
//                                (print / share / mark ready / collect balance & deliver)
//
// Status flow: received -> ready -> delivered

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
  type LayoutChangeEvent,
  Platform,
  Modal,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Printer, Share2, Plus, Trash2, Check, X, BellRing } from 'lucide-react-native';
import { PageGuard } from '../../../src/components/PageGuard';
import { ErrorModal } from '../../../src/components/ui';
import { colors, spacing } from '../../../src/theme';
import { useStaff } from '../../../src/context/StaffContext';
import { getCompanySettings } from '../../../src/lib/api/settings';
import {
  createRepairOrder,
  getRepairOrder,
  deleteRepairOrder,
  deliverRepairOrder,
  markRepairReady,
  type RepairOrder,
} from '../../../src/lib/api/repairs';
import {
  shopInfoFromCompany,
  shareRepairReceiptOnWhatsApp,
  shareRepairReadyOnWhatsApp,
  type ShopShareInfo,
} from '../../../src/lib/whatsappShare';
import {
  getConnectedPrinter,
  disconnectActive,
} from '../../../src/lib/thermalPrint/printerService';
import { printRepairReceiptDirect } from '../../../src/lib/thermalPrint/escposRepairReceipt';
import {
  buildRepairReceiptHtml,
  estimateRepairReceiptHeightPt,
  formatReceiptDate,
  generateRepairReceiptNo,
  type RepairReceiptData,
  type RepairShopInfo,
} from '../../../src/lib/repairReceipt';

const toNum = (s: string): number => {
  const n = Number(String(s).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

const money = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const PAY_MODES = [
  { id: 'cash', label: 'Cash' },
  { id: 'upi', label: 'UPI' },
  { id: 'card', label: 'Card' },
  { id: 'bank_transfer', label: 'Bank' },
];
const modeLabel = (id: string | null) => PAY_MODES.find((m) => m.id === id)?.label ?? id ?? '';

function orderToReceipt(o: RepairOrder): RepairReceiptData {
  return {
    receiptNo: o.receipt_no,
    dateText: formatReceiptDate(new Date(o.created_at)),
    customerName: o.customer_name,
    phone: o.phone ?? '',
    item: o.item,
    weight: o.weight && o.weight > 0 ? o.weight : null,
    charge: o.charge,
    advance: o.advance,
    remarks: o.remarks ?? '',
    finalPaid: o.final_payment > 0 ? o.final_payment : 0,
    deliveredText:
      o.status === 'delivered' && o.delivered_at ? formatReceiptDate(new Date(o.delivered_at)) : null,
  };
}

export default function RepairServiceScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { currentStaff } = useStaff();
  const isAdmin = currentStaff?.role === 'admin';
  const insets = useSafeAreaInsets();
  const sheetBottomPad = Math.max(insets.bottom, Platform.OS === 'android' ? 48 : 20) + 12;

  // ---- form fields ----
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [item, setItem] = useState('');
  const [weight, setWeight] = useState('');
  const [charge, setCharge] = useState('');
  const [advance, setAdvance] = useState('');
  const [remarks, setRemarks] = useState('');

  // extra "repair + weight" rows added with the + button
  const [extras, setExtras] = useState<{ id: string; item: string; weight: string }[]>([]);
  const addExtra = () =>
    setExtras((p) => [...p, { id: `${Date.now()}-${p.length}`, item: '', weight: '' }]);
  const updateExtra = (id: string, patch: Partial<{ item: string; weight: string }>) =>
    setExtras((p) => p.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const removeExtra = (id: string) => setExtras((p) => p.filter((e) => e.id !== id));

  // ---- saved repair (null = still on the form) ----
  const [order, setOrder] = useState<RepairOrder | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [shop, setShop] = useState<RepairShopInfo>({ name: 'Our Shop', address: null, phone: null });
  // full shop info (includes the Google Maps link) used by the "jewel is ready" message
  const [shopShare, setShopShare] = useState<ShopShareInfo | null>(null);
  const [sharing, setSharing] = useState(false);
  const [printing, setPrinting] = useState(false);

  // ---- mark ready / share ready message ----
  const [markingReady, setMarkingReady] = useState(false);
  const [sharingReady, setSharingReady] = useState(false);

  // ---- collect balance & deliver ----
  const [collectOpen, setCollectOpen] = useState(false);
  const [collectMode, setCollectMode] = useState('cash');
  const [collecting, setCollecting] = useState(false);

  // ---- error modal (same ErrorModal as the New Invoice page) ----
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState<string>('Missing details');
  const showError = (title: string, message: string) => {
    setErrorTitle(title);
    setErrorMessage(message);
  };

  // ---- keyboard-aware form: keeps the focused field visible above the keyboard ----
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

  const regField = (id: string) => (e: LayoutChangeEvent) => {
    fieldY.current[id] = e.nativeEvent.layout.y;
  };
  // after the keyboard has opened, bring the tapped field near the top
  const scrollToField = (id: string) => {
    const y = fieldY.current[id];
    if (y == null) return;
    setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true }), 280);
  };

  const receipt = order ? orderToReceipt(order) : null;
  const delivered = order?.status === 'delivered';
  const isReady = order?.status === 'ready';
  const balanceDue = order ? Math.max(0, order.charge - order.advance - order.final_payment) : 0;

  // Shop name / address / phone for the receipt header
  useEffect(() => {
    (async () => {
      try {
        const company: any = await getCompanySettings();
        const info = shopInfoFromCompany(company);
        const shopPhone =
          company?.phone ?? company?.mobile ?? company?.contact_number ?? company?.phone_number ?? null;
        setShopShare(info);
        setShop({
          name: info.name,
          address: info.address,
          phone: shopPhone ? String(shopPhone) : null,
        });
      } catch {
        /* keep the default shop name */
      }
    })();
  }, []);

  // Opened from the Repairs list -> load the saved repair
  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      try {
        const o = await getRepairOrder(id);
        if (alive) setOrder(o);
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

  const chargeNum = toNum(charge);
  const advanceNum = toNum(advance);
  const formBalance = Math.max(0, chargeNum - advanceNum);

  // ---------------------------------------------------------
  // Save + create receipt
  // ---------------------------------------------------------
  const handleCreate = async () => {
    if (saving) return;
    if (!name.trim()) return showError('Name needed', 'Enter the customer name.');
    const digits = phone.replace(/\D/g, '');
    if (phone.trim() && digits.length < 10) {
      return showError('Check phone number', 'Enter a valid 10-digit phone number or leave it empty.');
    }
    if (!item.trim()) return showError('Repair details needed', 'Enter what is being repaired.');
    if (chargeNum <= 0) return showError('Repair charge needed', 'Enter the repair charge.');
    if (advanceNum < 0) return showError('Check advance', 'Advance cannot be negative.');
    if (advanceNum > chargeNum) {
      return showError('Check advance', 'Advance cannot be more than the repair charge.');
    }

    // merge the extra rows: weights are added up, every repair item is listed with its own weight
    const extraWeights = extras.map((e) => toNum(e.weight));
    const totalWeight = toNum(weight) + extraWeights.reduce((sum, w) => sum + w, 0);
    const hasExtras = extras.some((e, i) => e.item.trim() || extraWeights[i] > 0);
    let itemText = item.trim();
    if (hasExtras) {
      const rows = [{ text: item.trim(), w: toNum(weight) }].concat(
        extras.map((e, i) => ({ text: e.item.trim() || `Item ${i + 2}`, w: extraWeights[i] }))
      );
      itemText = rows
        .filter((r, i) => i === 0 || r.text || r.w > 0)
        .map((r) => (r.w > 0 ? `${r.text} (${r.w.toFixed(3)} g)` : r.text))
        .join(' | ');
    }

    setSaving(true);
    try {
      const saved = await createRepairOrder({
        receiptNo: generateRepairReceiptNo(new Date()),
        customerName: name.trim(),
        phone: phone.trim(),
        item: itemText,
        weight: totalWeight > 0 ? totalWeight : null,
        charge: chargeNum,
        advance: advanceNum,
        remarks: remarks.trim(),
      });
      setOrder(saved);
    } catch (e: any) {
      showError('Could not save repair', e?.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------
  // Mark as ready (repair finished, waiting for the customer)
  // ---------------------------------------------------------
  const handleMarkReady = async () => {
    if (!order || markingReady) return;
    setMarkingReady(true);
    try {
      const updated = await markRepairReady(order.id);
      setOrder(updated);
    } catch (e: any) {
      showError('Could not update', e?.message ?? 'Unknown error');
    } finally {
      setMarkingReady(false);
    }
  };

  // ---------------------------------------------------------
  // Share "your jewel is ready" message on WhatsApp
  // ---------------------------------------------------------
  const handleShareReady = async () => {
    if (!order || sharingReady) return;
    setSharingReady(true);
    try {
      await shareRepairReadyOnWhatsApp({
        customerName: order.customer_name,
        customerPhone: order.phone,
        receiptNo: order.receipt_no,
        item: order.item,
        balanceDue,
        shop: shopShare ?? { name: shop.name, address: shop.address, mapsUrl: null },
      });
    } catch (e: any) {
      showError('Could not share message', e?.message ?? 'Unknown error');
    } finally {
      setSharingReady(false);
    }
  };

  // ---------------------------------------------------------
  // Collect balance & deliver
  // ---------------------------------------------------------
  const handleDeliver = async () => {
    if (!order || collecting) return;
    setCollecting(true);
    try {
      const updated = await deliverRepairOrder(order.id, {
        amount: balanceDue,
        mode: balanceDue > 0 ? collectMode : null,
      });
      setOrder(updated);
      setCollectOpen(false);
    } catch (e: any) {
      setCollectOpen(false); // close the sheet first so the error modal can show
      showError('Could not update', e?.message ?? 'Unknown error');
    } finally {
      setCollecting(false);
    }
  };

  // ---------------------------------------------------------
  // Print
  //  - Direct: ESC/POS to the connected Bluetooth thermal printer
  //  - Fallback: system print dialog (offered if the thermal print fails)
  // ---------------------------------------------------------
  const printViaSystem = async (r: RepairReceiptData) => {
    const html = buildRepairReceiptHtml(r, shop);
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
      await Print.printAsync({ html, width: 226, height: estimateRepairReceiptHeightPt(r) });
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
        await printRepairReceiptDirect(printer, receipt, shop);
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
    const html = buildRepairReceiptHtml(receipt, shop);
    setSharing(true);
    try {
      await shareRepairReceiptOnWhatsApp({
        html,
        // the note shows "paid so far", so include what was collected on delivery
        receipt: { ...receipt, advance: receipt.advance + (receipt.finalPaid ?? 0) },
        shopName: shop.name,
        heightPt: estimateRepairReceiptHeightPt(receipt),
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
    if (!order || !isAdmin) return;
    Alert.alert('Delete repair bill?', 'This permanently removes the saved receipt.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteRepairOrder(order.id);
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
    setItem('');
    setWeight('');
    setCharge('');
    setAdvance('');
    setRemarks('');
    setExtras([]);
    setOrder(null);
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
  if (order && receipt) {
    return (
      <PageGuard pageKey="invoices">
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
          {isReady && (
            <View style={styles.readyBanner}>
              <BellRing size={16} color="#B06000" />
              <Text style={styles.readyBannerText}>
                Ready for pickup
                {order.ready_at ? ` · ${formatReceiptDate(new Date(order.ready_at))}` : ''}
              </Text>
            </View>
          )}

          {delivered && (
            <View style={styles.deliveredBanner}>
              <Check size={16} color="#137333" strokeWidth={3} />
              <Text style={styles.deliveredBannerText}>
                Delivered · {receipt.deliveredText}
                {order.final_payment > 0
                  ? ` · ${money(order.final_payment)} (${modeLabel(order.final_payment_mode)})`
                  : ''}
              </Text>
            </View>
          )}

          <View style={styles.slip}>
            <Text style={styles.shopName}>{shop.name}</Text>
            {shop.address ? <Text style={styles.shopSub}>{shop.address}</Text> : null}
            {shop.phone ? <Text style={styles.shopSub}>Ph: {shop.phone}</Text> : null}
            <Text style={styles.slipTitle}>REPAIR / SERVICE RECEIPT</Text>

            <View style={styles.dash} />
            <Line k="Receipt No" v={receipt.receiptNo} bold />
            <Line k="Date" v={receipt.dateText} />
            {receipt.deliveredText ? <Line k="Delivered" v={receipt.deliveredText} bold /> : null}
            <Line k="Name" v={receipt.customerName} bold />
            {receipt.phone ? <Line k="Phone" v={receipt.phone} /> : null}

            <View style={styles.dash} />
            <Line k="For Repair" v={receipt.item} bold />
            {receipt.weight ? <Line k="Weight" v={`${receipt.weight.toFixed(3)} g`} /> : null}

            <View style={styles.dash} />
            <Line k="Repair Charge" v={money(receipt.charge)} />
            <Line k="Advance Paid" v={money(receipt.advance)} />
            {receipt.finalPaid ? <Line k="Paid on Delivery" v={money(receipt.finalPaid)} /> : null}
            <View style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>Balance Due</Text>
              <Text style={styles.balanceValue}>{money(balanceDue)}</Text>
            </View>

            {receipt.remarks ? (
              <>
                <View style={styles.dash} />
                <Text style={styles.kText}>Remarks</Text>
                <Text style={styles.remarksText}>{receipt.remarks}</Text>
              </>
            ) : null}

            <View style={styles.dash} />
            <Text style={styles.footNote}>
              {delivered
                ? 'Item delivered. Visit again!'
                : isReady
                  ? 'Your item is ready. Please collect it with this receipt.'
                  : 'Please bring this receipt when collecting your item.'}
            </Text>
          </View>

          {/* Step 1: repair finished -> mark as ready */}
          {order.status === 'received' && (
            <Pressable
              style={[styles.readyBtn, markingReady && { opacity: 0.7 }]}
              onPress={handleMarkReady}
              disabled={markingReady}
            >
              {markingReady ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <BellRing size={18} color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>Mark as ready</Text>
                </>
              )}
            </Pressable>
          )}

          {/* Step 2: tell the customer the jewel is ready (WhatsApp) */}
          {isReady && (
            <Pressable
              style={[styles.readyShareBtn, sharingReady && { opacity: 0.7 }]}
              onPress={handleShareReady}
              disabled={sharingReady}
            >
              {sharingReady ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Share2 size={18} color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>Share "jewel is ready" message</Text>
                </>
              )}
            </Pressable>
          )}

          {/* Step 3: customer came back: collect balance + hand over the jewel */}
          {!delivered && (
            <Pressable style={styles.deliverBtn} onPress={() => setCollectOpen(true)}>
              <Check size={18} color="#FFFFFF" strokeWidth={3} />
              <Text style={styles.primaryBtnText}>
                {balanceDue > 0 ? `Collect ${money(balanceDue)} & deliver` : 'Mark as delivered'}
              </Text>
            </Pressable>
          )}

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

          <View style={styles.actionRow}>
            {/* <Pressable style={styles.ghostBtn} onPress={resetForm}>
              <Plus size={16} color="#0F172A" />
              <Text style={styles.ghostBtnText}>New repair</Text>
            </Pressable> */}
            {/* <Pressable style={styles.ghostBtn} onPress={() => router.back()}>
              <Text style={styles.ghostBtnText}>Done</Text>
            </Pressable> */}
            {/* {isAdmin ? (
              <Pressable style={[styles.ghostBtn, styles.ghostBtnDanger]} onPress={handleDelete}>
                <Trash2 size={16} color="#C5221F" />
                <Text style={[styles.ghostBtnText, { color: '#C5221F' }]}>Delete</Text>
              </Pressable>
            ) : null} */}
          </View>
        </ScrollView>

        {/* Collect balance & deliver sheet */}
        <Modal
          visible={collectOpen}
          animationType="slide"
          transparent
          statusBarTranslucent
          onRequestClose={() => setCollectOpen(false)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => !collecting && setCollectOpen(false)}>
            <Pressable style={[styles.modalSheet, { paddingBottom: sheetBottomPad }]} onPress={() => { }}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {balanceDue > 0 ? 'Collect balance & deliver' : 'Deliver item'}
                </Text>
                <Pressable onPress={() => setCollectOpen(false)} hitSlop={8} disabled={collecting}>
                  <X size={22} color="#0F172A" />
                </Pressable>
              </View>

              <View style={styles.collectCard}>
                <Line k="Repair Charge" v={money(order.charge)} />
                <Line k="Advance Paid" v={money(order.advance)} />
                <View style={styles.balanceRow}>
                  <Text style={styles.balanceLabel}>Balance to collect</Text>
                  <Text style={styles.balanceValue}>{money(balanceDue)}</Text>
                </View>
              </View>

              {balanceDue > 0 && (
                <>
                  <Text style={styles.label}>Payment mode</Text>
                  <View style={styles.chipRow}>
                    {PAY_MODES.map((m) => (
                      <Pressable
                        key={m.id}
                        style={[styles.chip, collectMode === m.id && styles.chipOn]}
                        onPress={() => setCollectMode(m.id)}
                      >
                        <Text style={[styles.chipText, collectMode === m.id && styles.chipTextOn]}>
                          {m.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              <Text style={styles.collectNote}>
                Confirm only after the customer has paid and the jewel has been handed over.
              </Text>

              <Pressable
                style={[styles.deliverBtn, { marginTop: 14 }, collecting && { opacity: 0.7 }]}
                onPress={handleDeliver}
                disabled={collecting}
              >
                {collecting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Check size={18} color="#FFFFFF" strokeWidth={3} />
                    <Text style={styles.primaryBtnText}>Confirm delivery</Text>
                  </>
                )}
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>

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

        {/* For Repair + Weight side by side. "Add another" adds one more row of the same. */}
        <View style={styles.field} onLayout={regField('item')}>
          <Text style={styles.label}>
            For Repair & Weight <Text style={{ color: '#C5221F' }}>*</Text>
          </Text>
          <View style={styles.extraRow}>
            <TextInput
              style={[styles.input, styles.extraRemark, styles.remarkGrow]}
              value={item}
              onChangeText={setItem}
              placeholder="e.g. Gold chain - broken link"
              placeholderTextColor="#94A3B8"
              multiline
              onFocus={() => scrollToField('item')}
            />
            <TextInput
              style={[styles.input, styles.extraWeight]}
              value={weight}
              onChangeText={setWeight}
              placeholder="Weight (g)"
              placeholderTextColor="#94A3B8"
              keyboardType="decimal-pad"
              onFocus={() => scrollToField('item')}
            />
          </View>
        </View>

        {extras.map((e, i) => (
          <View key={e.id} style={styles.field} onLayout={regField(`extra-${e.id}`)}>
            <View style={styles.extraHeader}>
              <Text style={styles.label}>Item {i + 2}</Text>
              <Pressable onPress={() => removeExtra(e.id)} hitSlop={8}>
                <X size={18} color="#94A3B8" />
              </Pressable>
            </View>
            <View style={styles.extraRow}>
              <TextInput
                style={[styles.input, styles.extraRemark, styles.remarkGrow]}
                value={e.item}
                onChangeText={(t) => updateExtra(e.id, { item: t })}
                placeholder="For repair"
                placeholderTextColor="#94A3B8"
                multiline
                onFocus={() => scrollToField(`extra-${e.id}`)}
              />
              <TextInput
                style={[styles.input, styles.extraWeight]}
                value={e.weight}
                onChangeText={(t) => updateExtra(e.id, { weight: t })}
                placeholder="Weight (g)"
                placeholderTextColor="#94A3B8"
                keyboardType="decimal-pad"
                onFocus={() => scrollToField(`extra-${e.id}`)}
              />
            </View>
          </View>
        ))}

        <Pressable style={styles.addMoreBtn} onPress={addExtra}>
          <Plus size={16} color={colors.primary} />
          <Text style={styles.addMoreText}>Add another repair & weight</Text>
        </Pressable>

        <View style={styles.twoCol} onLayout={regField('amounts')}>
          <View style={{ flex: 1 }}>
            <Field label="Repair charge (₹)" required>
              <TextInput
                style={styles.input}
                value={charge}
                onChangeText={setCharge}
                placeholder="0"
                placeholderTextColor="#94A3B8"
                keyboardType="decimal-pad"
                onFocus={() => scrollToField('amounts')}
              />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Advance (₹)">
              <TextInput
                style={styles.input}
                value={advance}
                onChangeText={setAdvance}
                placeholder="0"
                placeholderTextColor="#94A3B8"
                keyboardType="decimal-pad"
                onFocus={() => scrollToField('amounts')}
              />
            </Field>
          </View>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceCardLabel}>Balance due</Text>
          <Text style={styles.balanceCardValue}>{money(formBalance)}</Text>
        </View>

        <Field label="Remarks" onLayout={regField('remarks')}>
          <TextInput
            style={[styles.input, styles.inputMulti]}
            value={remarks}
            onChangeText={setRemarks}
            placeholder="Delivery date, special instructions, etc."
            placeholderTextColor="#94A3B8"
            multiline
            onFocus={() => scrollToField('remarks')}
          />
        </Field>

        <Pressable
          style={[styles.primaryBtn, saving && { opacity: 0.7 }]}
          onPress={handleCreate}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryBtnText}>Save & create receipt</Text>
          )}
        </Pressable>
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
  twoCol: { flexDirection: 'row', gap: 12 },

  extraHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  extraRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  extraWeight: { flex: 0.45 },
  extraRemark: { flex: 1 },
  remarkGrow: {
    height: undefined,
    minHeight: 48,
    paddingTop: 12,
    paddingBottom: 12,
    textAlignVertical: 'top',
  },
  addMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    backgroundColor: '#FFFFFF',
    marginBottom: 14,
  },
  addMoreText: { color: colors.primary, fontWeight: '700', fontSize: 13 },

  balanceCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FEEFC3',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  balanceCardLabel: { fontSize: 13, fontWeight: '700', color: '#B06000' },
  balanceCardValue: { fontSize: 18, fontWeight: '800', color: '#0F172A' },

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
  deliverBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: '#137333',
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  deliveredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#E6F4EA',
    borderWidth: 1,
    borderColor: '#CEEAD6',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  deliveredBannerText: { flex: 1, fontSize: 13, fontWeight: '700', color: '#137333' },

  // Ready state
  readyBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: '#B06000',
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  readyShareBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: '#25D366', // WhatsApp green
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  readyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FEEFC3',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  readyBannerText: { flex: 1, fontSize: 13, fontWeight: '700', color: '#B06000' },

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
  slipTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginTop: 10,
  },
  dash: {
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    marginVertical: 12,
  },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 3 },
  kText: { fontSize: 13, color: '#64748B' },
  vText: { fontSize: 13, color: '#0F172A', flexShrink: 1, textAlign: 'right' },
  vBold: { fontWeight: '700' },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  balanceLabel: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  balanceValue: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  remarksText: { fontSize: 13, color: '#0F172A', marginTop: 2 },
  footNote: { fontSize: 12, color: '#64748B', textAlign: 'center' },

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

  // Collect balance sheet
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#F8FAFC',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  collectCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    marginBottom: 14,
  },
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
  collectNote: { fontSize: 12, color: '#64748B', marginTop: 12 },
});