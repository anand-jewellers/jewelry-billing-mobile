// app/(tabs)/settings/printer.tsx

import { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Card } from '../../../src/components/ui';
import { ErrorModal } from '../../../src/components/ui/ErrorModal';
import { SuccessModal } from '../../../src/components/ui/SuccessModal';
import { colors, spacing, radius } from '../../../src/theme';
import { discoverPrinters } from '../../../src/lib/thermalPrint/printerService';
import { getSavedPrinter, saveSavedPrinter, clearSavedPrinter, type SavedPrinter } from '../../../src/lib/thermalPrint/printerStore';
import type { ThermalPrinterDevice } from 'react-native-thermal-pos-printer';

export default function PrinterSettingsScreen() {
  const [devices, setDevices] = useState<ThermalPrinterDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [saved, setSaved] = useState<SavedPrinter | null>(null);

  // Error modal state. The info object is intentionally NOT cleared on close so
  // the text stays mounted while the modal fades out; the boolean drives it.
  const [errorInfo, setErrorInfo] = useState<{ title: string; message: string } | null>(null);
  const [errorVisible, setErrorVisible] = useState(false);

  function showError(message: string, title = 'Something went wrong') {
    setErrorInfo({ title, message });
    setErrorVisible(true);
  }

  // Success modal state — same pattern.
  const [successInfo, setSuccessInfo] = useState<{ title: string; message: string } | null>(null);
  const [successVisible, setSuccessVisible] = useState(false);

  function showSuccess(message: string, title = 'Success') {
    setSuccessInfo({ title, message });
    setSuccessVisible(true);
  }

  useFocusEffect(
    useCallback(() => {
      getSavedPrinter().then(setSaved);
    }, [])
  );

  const handleScan = async () => {
    setScanning(true);
    try {
      const found = await discoverPrinters(8000);
      setDevices(found);
      setHasScanned(true);
      if (found.length === 0) {
        showError(
          'Make sure the printer is powered on and paired with this phone in Android Bluetooth settings first.',
          'No printers found'
        );
      }
    } catch (e: any) {
      showError(e?.message ?? 'Could not scan for printers.', 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const handleSelect = async (device: ThermalPrinterDevice) => {
    try {
      const toSave: SavedPrinter = { address: device.address, name: device.name, type: device.type };
      await saveSavedPrinter(toSave);
      setSaved(toSave);
      showSuccess(`${device.name || 'Printer'} is now your default printer.`, 'Printer saved');
    } catch (e: any) {
      showError(e?.message ?? 'Could not save the printer.', 'Could not save printer');
    }
  };

  const handleClear = async () => {
    try {
      await clearSavedPrinter();
      setSaved(null);
    } catch (e: any) {
      showError(e?.message ?? 'Could not remove the printer.', 'Could not remove printer');
    }
  };

  return (
    <View style={styles.screen}>
      {/* Scrollable content: current printer + scan results */}
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={devices}
        keyExtractor={(d) => d.address}
        ListHeaderComponent={
          <View>
            <Text style={styles.title}>Thermal Printer</Text>

            {saved ? (
              <Card style={{ marginBottom: spacing.lg }}>
                <Text style={styles.savedLabel}>Current printer</Text>
                <Text style={styles.savedName}>{saved.name}</Text>
                <Text style={styles.savedAddress}>{saved.address}</Text>
                <Pressable style={styles.clearBtn} onPress={handleClear}>
                  <Text style={styles.clearBtnText}>Remove</Text>
                </Pressable>
              </Card>
            ) : (
              <Text style={styles.emptyText}>No printer configured yet.</Text>
            )}

            {devices.length > 0 && <Text style={styles.listLabel}>Tap a device to set it as your printer</Text>}
          </View>
        }
        ListEmptyComponent={
          !scanning && !hasScanned ? (
            <Text style={styles.hintText}>
              Pair your printer in Android Bluetooth settings, then tap "Scan for printers" below.
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          const isCurrent = saved?.address === item.address;
          return (
            <Pressable style={styles.deviceRow} onPress={() => handleSelect(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.deviceName}>{item.name || 'Unnamed device'}</Text>
                <Text style={styles.deviceAddress}>{item.address}</Text>
              </View>
              {isCurrent && <Text style={styles.currentBadge}>Current</Text>}
            </Pressable>
          );
        }}
      />

      {/* Scan button pinned to the bottom of the screen */}
      <View style={styles.footer}>
        <Pressable
          style={[styles.scanBtn, scanning && styles.scanBtnDisabled]}
          onPress={handleScan}
          disabled={scanning}
        >
          {scanning ? (
            <View style={styles.scanningRow}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.scanBtnText}>Scanning…</Text>
            </View>
          ) : (
            <Text style={styles.scanBtnText}>Scan for printers</Text>
          )}
        </Pressable>
      </View>

      <SuccessModal
        visible={successVisible}
        title={successInfo?.title}
        message={successInfo?.message ?? null}
        onClose={() => setSuccessVisible(false)}
      />

      <ErrorModal
        visible={errorVisible}
        title={errorInfo?.title}
        message={errorInfo?.message ?? null}
        onClose={() => setErrorVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1 },
  listContent: { padding: spacing.lg, paddingBottom: spacing.md },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  emptyText: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.lg },
  hintText: { fontSize: 13, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 19 },
  listLabel: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  savedLabel: { fontSize: 12, color: colors.textMuted },
  savedName: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginTop: 2 },
  savedAddress: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  clearBtn: { marginTop: spacing.sm },
  clearBtnText: { color: '#B00020', fontWeight: '600', fontSize: 13 },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  deviceName: { fontSize: 15, color: colors.textPrimary, fontWeight: '600' },
  deviceAddress: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  currentBadge: { fontSize: 12, fontWeight: '700', color: colors.primary },
  footer: {
    padding: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  scanBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius?.md ?? 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanBtnDisabled: { opacity: 0.8 },
  scanningRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  scanBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});