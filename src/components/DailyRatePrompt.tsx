import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { TrendingUp } from 'lucide-react-native';
import { useStaff } from '../context/StaffContext';
import { colors, spacing } from '../theme';

const STORAGE_KEY = 'gold_rate_prompt_last_shown';
const PROMPT_AT_MINUTES = 9 * 60 + 30; // 9:30 AM (device local time)

// Local date as YYYY-MM-DD (don't use toISOString, it is UTC and can be off by a day)
const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function DailyRatePrompt() {
  const router = useRouter();
  const { currentStaff, hasAccess } = useStaff();
  const [visible, setVisible] = useState(false);
  const busy = useRef(false);

  const canUpdateRates = !!currentStaff && hasAccess('settings.gold_rates');

  const check = useCallback(async () => {
    if (!canUpdateRates || busy.current) return;
    busy.current = true;
    try {
      const now = new Date();
      if (now.getHours() * 60 + now.getMinutes() < PROMPT_AT_MINUTES) return; // before 9:30

      const today = dateKey(now);
      const lastShown = await AsyncStorage.getItem(STORAGE_KEY);
      if (lastShown === today) return; // already shown today

      await AsyncStorage.setItem(STORAGE_KEY, today); // mark first so it never repeats
      setVisible(true);
    } catch {
      // storage problem: skip silently, never block the app
    } finally {
      busy.current = false;
    }
  }, [canUpdateRates]);

  useEffect(() => {
    check(); // when the app opens / staff signs in

    // App brought back from background
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });

    // App left open from before 9:30 (or past midnight): re-check every minute
    const timer = setInterval(check, 60 * 1000);

    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [check]);

  const handleYes = () => {
    setVisible(false);
    router.push('/settings/gold-rates' as never);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <View style={styles.iconBadge}>
            <TrendingUp size={26} color="#2563EB" />
          </View>
          <Text style={styles.title}>Update today's metal rate?</Text>
          <Text style={styles.message}>
            Do you want to change the gold / silver rate for today?
          </Text>

          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.noBtn]} onPress={() => setVisible(false)}>
              <Text style={styles.noText}>No</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.yesBtn]} onPress={handleYes}>
              <Text style={styles.yesText}>Yes, update</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  box: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
  },
  iconBadge: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 17, fontWeight: '700', color: '#0F172A', textAlign: 'center' },
  message: { fontSize: 13.5, color: colors.textSecondary, textAlign: 'center', marginTop: 6 },
  row: { flexDirection: 'row', gap: 10, marginTop: 20, width: '100%' },
  btn: { flex: 1, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  noBtn: { backgroundColor: '#F1F5F9' },
  yesBtn: { backgroundColor: colors.primary },
  noText: { color: '#334155', fontWeight: '600', fontSize: 14.5 },
  yesText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14.5 },
});