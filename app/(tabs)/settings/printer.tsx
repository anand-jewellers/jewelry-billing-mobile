// app/(tabs)/settings/printer.tsx

import { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { BluetoothDevice } from 'react-native-bluetooth-classic';
import { Card } from '../../../src/components/ui';
import { ErrorModal } from '../../../src/components/ui/ErrorModal';
import { SuccessModal } from '../../../src/components/ui/SuccessModal';
import { colors, spacing, radius } from '../../../src/theme';
import { discoverPrinters } from '../../../src/lib/thermalPrint/printerService';
import {
  getSavedPrinter,
  saveSavedPrinter,
  clearSavedPrinter,
  type SavedPrinter,
  type PrinterKind,
} from '../../../src/lib/thermalPrint/printerStore';
import {
  calibrateLabelPrinter,
  printBorderTest,
  printBorderTestContinuous,
  printMinimalTest,
} from '../../../src/lib/thermalPrint/labelPrinter';
export default function PrinterSettingsScreen() {
  const [kind, setKind] = useState<PrinterKind>('bill');
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [saved, setSaved] = useState<SavedPrinter | null>(null);

  const [errorInfo, setErrorInfo] = useState<{ title: string; message: string } | null>(null);
  const [errorVisible, setErrorVisible] = useState(false);
  function showError(message: string, title = 'Something went wrong') {
    setErrorInfo({ title, message });
    setErrorVisible(true);
  }

  const [successInfo, setSuccessInfo] = useState<{ title: string; message: string } | null>(null);
  const [successVisible, setSuccessVisible] = useState(false);
  function showSuccess(message: string, title = 'Success') {
    setSuccessInfo({ title, message });
    setSuccessVisible(true);
  }

  const [calibrating, setCalibrating] = useState(false);

  const handleCalibrate = async () => {
    setCalibrating(true);
    try {
      await calibrateLabelPrinter();
      showSuccess(
        'The printer fed a few labels to learn the gap. Now print one test label.',
        'Calibration sent'
      );
    } catch (e: any) {
      showError(e?.message ?? 'Could not calibrate the printer.', 'Calibration failed');
    } finally {
      setCalibrating(false);
    }
  };

  const kindLabel = kind === 'bill' ? 'bill printer' : 'label printer';

  // Reload the saved printer whenever the screen is focused or the tab changes
  useFocusEffect(
    useCallback(() => {
      getSavedPrinter(kind).then(setSaved);
    }, [kind])
  );

  const handleScan = async () => {
    setScanning(true);
    try {
      const found = await discoverPrinters();
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

  const handleSelect = async (device: BluetoothDevice) => {
    try {
      const toSave: SavedPrinter = {
        address: device.address,
        name: device.name,
        type: 'BLUETOOTH',
      };
      await saveSavedPrinter(toSave, kind);
      setSaved(toSave);
      showSuccess(`${device.name || 'Printer'} is now your ${kindLabel}.`, 'Printer saved');
    } catch (e: any) {
      showError(e?.message ?? 'Could not save the printer.', 'Could not save printer');
    }
  };

  const handleClear = async () => {
    try {
      await clearSavedPrinter(kind);
      setSaved(null);
    } catch (e: any) {
      showError(e?.message ?? 'Could not remove the printer.', 'Could not remove printer');
    }
  };

  return (
    <View style={styles.screen}>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={devices}
        keyExtractor={(d) => d.address}
        ListHeaderComponent={
          <View>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.md }}>
              {(['bill', 'label'] as PrinterKind[]).map((k) => (
                <Pressable
                  key={k}
                  onPress={() => {
                    setKind(k);
                    setDevices([]);
                    setHasScanned(false);
                  }}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 10,
                    alignItems: 'center',
                    backgroundColor: kind === k ? colors.primary : colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ color: kind === k ? '#fff' : colors.textPrimary, fontWeight: '700' }}>
                    {k === 'bill' ? 'Bill printer' : 'Label printer'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.title}>
              {kind === 'bill' ? 'Bill Printer' : 'Label (Barcode) Printer'}
            </Text>

            {saved ? (
              <Card style={{ marginBottom: spacing.lg }}>
                <Text style={styles.savedLabel}>Current {kindLabel}</Text>
                <Text style={styles.savedName}>{saved.name}</Text>
                <Text style={styles.savedAddress}>{saved.address}</Text>
                <Pressable style={styles.clearBtn} onPress={handleClear}>
                  <Text style={styles.clearBtnText}>Remove</Text>
                </Pressable>

                {kind === 'label' && (
                  <>
                    <Pressable
                      style={[styles.scanBtn, { marginTop: spacing.sm }]}
                      onPress={() =>
                        printBorderTest().catch((e) =>
                          showError(e?.message ?? 'Border test failed', 'Border test')
                        )
                      }
                    >
                      <Text style={styles.scanBtnText}>Border test</Text>
                    </Pressable>

                    <Pressable
                      style={[styles.scanBtn, { marginTop: spacing.sm }]}
                      onPress={() =>
                        printBorderTestContinuous().catch((e) =>
                          showError(e?.message ?? 'Test failed', 'Border test (no gap)')
                        )
                      }
                    >
                      <Text style={styles.scanBtnText}>Border test (no gap)</Text>
                    </Pressable>

                    <Pressable
                      style={[styles.scanBtn, { marginTop: spacing.sm }, calibrating && styles.scanBtnDisabled]}
                      onPress={handleCalibrate}
                      disabled={calibrating}
                    >
                      <Text style={styles.scanBtnText}>
                        {calibrating ? 'Calibrating…' : 'Calibrate label printer'}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.scanBtn, { marginTop: spacing.sm }]}
                      onPress={() =>
                        printMinimalTest().catch((e) =>
                          showError(e?.message ?? 'Test failed', 'Minimal test')
                        )
                      }
                    >
                      <Text style={styles.scanBtnText}>Minimal test</Text>
                    </Pressable>
                  </>
                )}
              </Card>
            ) : (
              <Text style={styles.emptyText}>No {kindLabel} configured yet.</Text>
            )}

            {devices.length > 0 && (
              <Text style={styles.listLabel}>Tap a device to set it as your {kindLabel}</Text>
            )}
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