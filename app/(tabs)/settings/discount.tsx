// app/(tabs)/settings/discount.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, Pressable, Image, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ImagePlus, Send, X, Pause, Play, SkipForward, Search, Check } from 'lucide-react-native';
import { colors, spacing } from '../../../src/theme';
import { listCustomers } from '../../../src/lib/api/customers';
import {
  getShopShareInfo,
  normalizeWhatsAppPhone,
  shareDiscountToCustomer,
  watchAwayAndBack,
  type ShopShareInfo,
} from '../../../src/lib/whatsappShare';

interface Recipient {
  id: string;
  name: string | null;
  phone: string;
}

type Status = 'idle' | 'loading' | 'running' | 'paused' | 'done';
type Audience = 'all' | 'selected';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MAX_LIST_ROWS = 200;

export default function DiscountScreen() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [recipients, setRecipients] = useState<Recipient[]>([]); // snapshot of the running send
  const [index, setIndex] = useState(0);

  // Audience selection
  const [audience, setAudience] = useState<Audience>('all');
  const [allCustomers, setAllCustomers] = useState<Recipient[]>([]);
  const [skippedNoPhone, setSkippedNoPhone] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pickerSearch, setPickerSearch] = useState('');

  // refs so the async loop always sees the latest values
  const stopRef = useRef(false);
  const indexRef = useRef(0);
  const recipientsRef = useRef<Recipient[]>([]);
  const shopRef = useRef<ShopShareInfo | null>(null);

  async function loadCustomers() {
    setListLoading(true);
    setListError(false);
    try {
      const customers = await listCustomers(); // no date filter = every customer
      const seen = new Set<string>();
      const list: Recipient[] = [];
      let noPhone = 0;
      for (const c of customers) {
        const phone = normalizeWhatsAppPhone(c.phone);
        if (!phone) { noPhone++; continue; }
        if (seen.has(phone)) continue; // same number saved twice
        seen.add(phone);
        list.push({ id: c.id, name: c.name || null, phone });
      }
      list.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
      setAllCustomers(list);
      setSkippedNoPhone(noPhone);
    } catch (e) {
      console.error(e);
      setListError(true);
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    loadCustomers();
  }, []);

  const filteredCustomers = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return allCustomers;
    return allCustomers.filter(
      (c) => (c.name ?? '').toLowerCase().includes(q) || c.phone.includes(q.replace(/\D/g, '') || q)
    );
  }, [allCustomers, pickerSearch]);

  const audienceList = useMemo(
    () => (audience === 'all' ? allCustomers : allCustomers.filter((c) => selectedIds.has(c.id))),
    [audience, allCustomers, selectedIds]
  );

  const active = status === 'running' || status === 'paused';
  const canSend =
    !!imageUri &&
    note.trim().length > 0 &&
    audienceList.length > 0 &&
    !listLoading &&
    (status === 'idle' || status === 'done');

  function toggleCustomer(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredCustomers.forEach((c) => next.add(c.id));
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function pickImage() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: false,
    });
    if (!res.canceled && res.assets?.[0]?.uri) setImageUri(res.assets[0].uri);
  }

  async function onSendPress() {
    if (!imageUri || !note.trim() || !audienceList.length) return;
    setStatus('loading');
    try {
      shopRef.current = await getShopShareInfo().catch(() => null);
    } catch {
      shopRef.current = null;
    }

    const list = audienceList;
    setStatus('idle');

    Alert.alert(
      'Send discount offer',
      `This will open WhatsApp for ${list.length} customer${list.length > 1 ? 's' : ''}, one after another. ` +
        'Tap Send in WhatsApp, then press back to move to the next customer.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start',
          onPress: () => {
            recipientsRef.current = list;
            setRecipients(list);
            indexRef.current = 0;
            setIndex(0);
            runFrom(0);
          },
        },
      ]
    );
  }

  async function runFrom(start: number) {
    stopRef.current = false;
    setStatus('running');
    const list = recipientsRef.current;

    for (let i = start; i < list.length; i++) {
      if (stopRef.current) return;
      indexRef.current = i;
      setIndex(i);

      const r = list[i];
      const watcher = watchAwayAndBack(); // start BEFORE launching
      let result: 'shared' | 'cancelled';
      try {
        result = await shareDiscountToCustomer({
          imageUri: imageUri!,
          note,
          customerName: r.name,
          phone: r.phone,
          shop: shopRef.current,
        });
      } catch (e) {
        console.warn('Discount share failed', e);
        watcher.cancel();
        setStatus('paused');
        return;
      }

      if (result === 'cancelled') {
        watcher.cancel();
        setStatus('paused'); // stay on this customer; Resume retries, Skip moves on
        return;
      }

      const backInApp = await watcher.wait();
      if (stopRef.current) return;
      if (!backInApp) {
        setStatus('paused'); // WhatsApp didn't open, or user took too long
        return;
      }
      await sleep(400);
    }

    indexRef.current = list.length;
    setIndex(list.length);
    setStatus('done');
  }

  function pause() {
    stopRef.current = true;
    setStatus('paused');
  }

  function resume() {
    runFrom(indexRef.current);
  }

  function skipCurrent() {
    const next = indexRef.current + 1;
    if (next >= recipientsRef.current.length) {
      setStatus('done');
      setIndex(recipientsRef.current.length);
      return;
    }
    indexRef.current = next;
    setIndex(next);
    runFrom(next);
  }

  function stopAll() {
    stopRef.current = true;
    setStatus('idle');
    setRecipients([]);
    recipientsRef.current = [];
  }

  const total = recipients.length;
  const current = recipients[index];

  const sendLabel =
    audience === 'all'
      ? `Send to all customers${allCustomers.length ? ` (${allCustomers.length})` : ''}`
      : `Send to ${audienceList.length} customer${audienceList.length === 1 ? '' : 's'}`;

  return (
    <>
      <Stack.Screen options={{ title: 'Discount', headerShown: true }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Discount Offer</Text>
        <Text style={styles.subtitle}>
          Choose an offer image, write a note and send it on WhatsApp to everyone or to specific customers.
        </Text>

        {/* Image */}
        <Text style={styles.label}>Offer image</Text>
        {imageUri ? (
          <View style={styles.previewWrap}>
            <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="contain" />
            {!active && (
              <Pressable style={styles.removeBtn} onPress={() => setImageUri(null)} hitSlop={8}>
                <X size={16} color="#fff" />
              </Pressable>
            )}
          </View>
        ) : (
          <Pressable style={styles.picker} onPress={pickImage} disabled={active}>
            <ImagePlus size={28} color="#64748B" />
            <Text style={styles.pickerText}>Tap to choose an image</Text>
          </Pressable>
        )}
        {imageUri && !active && (
          <Pressable onPress={pickImage}>
            <Text style={styles.changeText}>Change image</Text>
          </Pressable>
        )}

        {/* Note */}
        <Text style={styles.label}>Note</Text>
        <TextInput
          style={styles.noteInput}
          placeholder="e.g. Diwali special: flat 10% off on making charges until 15 Nov."
          placeholderTextColor="#94A3B8"
          multiline
          value={note}
          onChangeText={setNote}
          editable={!active}
          textAlignVertical="top"
        />
        <Text style={styles.hint}>Each message starts with "Hi (customer name)," and carries your shop name.</Text>

        {/* Audience */}
        {/* <Text style={styles.label}>Send to</Text> */}
        <View style={styles.segment}>
          {/* <Pressable
            style={[styles.segmentBtn, audience === 'all' && styles.segmentBtnActive]}
            onPress={() => setAudience('all')}
            disabled={active}
          >
            <Text style={[styles.segmentText, audience === 'all' && styles.segmentTextActive]}>
              All customers
            </Text>
          </Pressable> */}
          <Pressable
            style={[styles.segmentBtn, audience === 'selected' && styles.segmentBtnActive]}
            onPress={() => setAudience('selected')}
            disabled={active}
          >
            <Text style={[styles.segmentText, audience === 'selected' && styles.segmentTextActive]}>
              Select customers
            </Text>
          </Pressable>
        </View>

        {listLoading && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />}

        {listError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Could not load customers.</Text>
            <Pressable onPress={loadCustomers}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {!listLoading && !listError && audience === 'all' && (
          <Text style={styles.hint}>
            {allCustomers.length} customer{allCustomers.length === 1 ? '' : 's'} with a valid phone number
            {skippedNoPhone > 0 ? ` (${skippedNoPhone} skipped, no valid number)` : ''}.
          </Text>
        )}

        {!listLoading && !listError && audience === 'selected' && (
          <View style={styles.selectCard}>
            <View style={styles.searchBar}>
              <Search size={16} color="#94A3B8" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by name or phone"
                placeholderTextColor="#94A3B8"
                value={pickerSearch}
                onChangeText={setPickerSearch}
                editable={!active}
              />
              {pickerSearch.length > 0 && (
                <Pressable onPress={() => setPickerSearch('')} hitSlop={8}>
                  <X size={14} color="#94A3B8" />
                </Pressable>
              )}
            </View>

            <View style={styles.selectToolbar}>
              <Text style={styles.selectCount}>{selectedIds.size} selected</Text>
              <View style={{ flexDirection: 'row', gap: 14 }}>
                <Pressable onPress={selectAllFiltered} disabled={active}>
                  <Text style={styles.linkText}>
                    {pickerSearch.trim() ? 'Select results' : 'Select all'}
                  </Text>
                </Pressable>
                <Pressable onPress={clearSelection} disabled={active}>
                  <Text style={[styles.linkText, { color: '#B91C1C' }]}>Clear</Text>
                </Pressable>
              </View>
            </View>

            <ScrollView style={styles.selectList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {filteredCustomers.length === 0 && (
                <Text style={styles.emptyText}>No customers found.</Text>
              )}
              {filteredCustomers.slice(0, MAX_LIST_ROWS).map((c) => {
                const checked = selectedIds.has(c.id);
                return (
                  <Pressable
                    key={c.id}
                    style={styles.row}
                    onPress={() => toggleCustomer(c.id)}
                    disabled={active}
                  >
                    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                      {checked && <Check size={14} color="#fff" strokeWidth={3} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName} numberOfLines={1}>{c.name ?? 'Customer'}</Text>
                      <Text style={styles.rowPhone}>{c.phone}</Text>
                    </View>
                  </Pressable>
                );
              })}
              {filteredCustomers.length > MAX_LIST_ROWS && (
                <Text style={styles.emptyText}>
                  Showing first {MAX_LIST_ROWS}. Use search to find others.
                </Text>
              )}
            </ScrollView>
          </View>
        )}

        {/* Send */}
        <Pressable
          style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
          onPress={onSendPress}
          disabled={!canSend}
        >
          {status === 'loading' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Send size={18} color="#fff" />
              <Text style={styles.sendBtnText}>{sendLabel}</Text>
            </>
          )}
        </Pressable>
        {audience === 'selected' && selectedIds.size === 0 && !active && (
          <Text style={styles.hint}>Select at least one customer to send.</Text>
        )}

        {/* Progress */}
        {(active || status === 'done') && (
          <View style={styles.progressCard}>
            {status === 'done' ? (
              <>
                <Text style={styles.progressTitle}>All done</Text>
                <Text style={styles.progressText}>
                  Opened WhatsApp for {total} customer{total > 1 ? 's' : ''}.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.progressTitle}>
                  {status === 'running' ? 'Sending' : 'Paused'} · {Math.min(index + 1, total)} of {total}
                </Text>
                <Text style={styles.progressText}>
                  {current ? `${current.name ?? 'Customer'} (${current.phone})` : ''}
                </Text>
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${(index / Math.max(total, 1)) * 100}%` }]} />
                </View>
                <View style={styles.progressActions}>
                  {status === 'running' ? (
                    <Pressable style={styles.smallBtn} onPress={pause}>
                      <Pause size={14} color="#334155" />
                      <Text style={styles.smallBtnText}>Pause</Text>
                    </Pressable>
                  ) : (
                    <>
                      <Pressable style={styles.smallBtn} onPress={resume}>
                        <Play size={14} color="#334155" />
                        <Text style={styles.smallBtnText}>Resume</Text>
                      </Pressable>
                      <Pressable style={styles.smallBtn} onPress={skipCurrent}>
                        <SkipForward size={14} color="#334155" />
                        <Text style={styles.smallBtnText}>Skip</Text>
                      </Pressable>
                    </>
                  )}
                  <Pressable style={[styles.smallBtn, styles.stopBtn]} onPress={stopAll}>
                    <X size={14} color="#B91C1C" />
                    <Text style={[styles.smallBtnText, { color: '#B91C1C' }]}>Stop</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  title: { fontSize: 22, fontWeight: '800', color: '#0F172A' },
  subtitle: { fontSize: 13, color: '#64748B', marginTop: 4, marginBottom: spacing.lg },
  label: { fontSize: 13, fontWeight: '700', color: '#0F172A', marginBottom: 8, marginTop: spacing.md },
  picker: {
    height: 160, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#CBD5E1',
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  pickerText: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  previewWrap: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#E2E8F0' },
  preview: { width: '100%', height: 260 },
  removeBtn: {
    position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(15,23,42,0.7)', alignItems: 'center', justifyContent: 'center',
  },
  changeText: { color: colors.primary, fontWeight: '700', fontSize: 13, marginTop: 8 },
  noteInput: {
    minHeight: 110, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 14,
    padding: 12, fontSize: 14, color: '#0F172A',
  },
  hint: { fontSize: 11.5, color: '#94A3B8', marginTop: 6 },

  // audience
  segment: {
    flexDirection: 'row', backgroundColor: '#E2E8F0', borderRadius: 12, padding: 3,
  },
  segmentBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: '#fff' },
  segmentText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  segmentTextActive: { color: '#0F172A', fontWeight: '800' },
  errorBox: {
    marginTop: spacing.md, flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: '#FEE2E2', borderRadius: 12, padding: 12,
  },
  errorText: { color: '#B91C1C', fontSize: 13, fontWeight: '600' },
  retryText: { color: '#B91C1C', fontSize: 13, fontWeight: '800' },
  selectCard: {
    marginTop: spacing.md, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1,
    borderColor: '#E2E8F0', padding: 12,
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F8FAFC',
    borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, paddingHorizontal: 12, height: 42,
  },
  searchInput: { flex: 1, fontSize: 13.5, color: '#0F172A', padding: 0 },
  selectToolbar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 10, marginBottom: 4,
  },
  selectCount: { fontSize: 12.5, fontWeight: '700', color: '#0F172A' },
  linkText: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  selectList: { maxHeight: 300 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#CBD5E1',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  checkboxChecked: { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  rowName: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  rowPhone: { fontSize: 12, color: '#64748B', marginTop: 2 },
  emptyText: { fontSize: 12.5, color: '#94A3B8', textAlign: 'center', paddingVertical: 14 },

  sendBtn: {
    marginTop: spacing.lg, backgroundColor: '#0F172A', borderRadius: 14, height: 50,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  progressCard: {
    marginTop: spacing.lg, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1,
    borderColor: '#E2E8F0', padding: 14,
  },
  progressTitle: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  progressText: { fontSize: 13, color: '#64748B', marginTop: 4 },
  bar: { height: 6, borderRadius: 3, backgroundColor: '#E2E8F0', marginTop: 12, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: colors.primary },
  progressActions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  smallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, backgroundColor: '#F1F5F9',
  },
  smallBtnText: { fontSize: 13, fontWeight: '700', color: '#334155' },
  stopBtn: { backgroundColor: '#FEE2E2' },
});