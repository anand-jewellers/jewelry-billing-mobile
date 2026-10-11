// src/components/invoice/BarcodeScannerModal.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, StyleSheet, Pressable, Platform } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Zap, ZapOff } from 'lucide-react-native';
import { colors, spacing } from '../../theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  onScanned: (data: string) => void;
}

const SCAN_COOLDOWN_MS = 2500;     // long enough that a dialog doesn't trigger a re-scan
const CONFIRM_WINDOW_MS = 900;     // the same value must be read twice within this window
const CAMERA_START_DELAY_MS = 250; // let the Modal finish animating before the camera starts
const USB_KEY_GAP_MS = 100;        // scanners type much faster than a human; a longer gap restarts the buffer
const USB_MIN_LENGTH = 3;          // ignore very short bursts
const MANUAL_BAR_LIFT = 56;        // extra space above the bottom inset (increase for more margin)

export function BarcodeScannerModal({ visible, onClose, onScanned }: Props) {
  const isWeb = Platform.OS === 'web';
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);

  const lockRef = useRef(false);
  const lastReadRef = useRef<{ value: string; at: number } | null>(null);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriesRef = useRef(0);

  const clearStartTimer = () => {
    if (startTimerRef.current) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
  };

  const startCamera = useCallback(() => {
    if (isWeb) return; // desktop web uses the USB scanner, not the camera
    clearStartTimer();
    startTimerRef.current = setTimeout(() => {
      setCameraKey((k) => k + 1); // brand-new camera session every time
      setCameraOn(true);
    }, CAMERA_START_DELAY_MS);
  }, [isWeb]);

  // Reset everything each time the scanner opens or closes
  useEffect(() => {
    if (visible) {
      lockRef.current = false;
      lastReadRef.current = null;
      retriesRef.current = 0;
      setTorch(false);
      setManualCode('');
    } else {
      // Release the camera completely when closed
      clearStartTimer();
      setCameraOn(false);
    }
    return clearStartTimer;
  }, [visible]);

  // ---- USB physical scanner (web desktop) ----
  useEffect(() => {
    if (!isWeb || !visible) return;

    let buffer = '';
    let lastKeyAt = 0;

    const finish = (e: KeyboardEvent) => {
      const code = buffer.trim();
      buffer = '';
      if (code.length < USB_MIN_LENGTH || lockRef.current) return;
      e.preventDefault();
      e.stopPropagation(); // stops the TextInput's own Enter handler -> no double scan
      lockRef.current = true;
      setManualCode('');
      console.log('[USB scanner] code:', code);
      onScanned(code);
      setTimeout(() => { lockRef.current = false; }, SCAN_COOLDOWN_MS);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      if (now - lastKeyAt > 150) buffer = ''; // long gap = human typing, restart
      lastKeyAt = now;

      if (e.key === 'Enter' || e.key === 'Tab') {
        finish(e);
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        buffer += e.key;
      }
    };

    // capture = true so we see the keys before the text box does
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isWeb, visible, onScanned]);

  const handleScan = useCallback(
    (result: BarcodeScanningResult) => {
      if (lockRef.current) return;

      // Only Code 128 is printed on our labels. Android reports 'code128',
      // iOS reports 'org.iso.Code128'. Ignore anything else (e.g. a misread as EAN-8).
      const type = String(result.type ?? '').toLowerCase();
      if (!type.includes('128')) return;

      const value = String(result.data ?? '').trim();
      if (!value) return;

      // Require the same value twice in a row: a single bad frame is ignored.
      const now = Date.now();
      const last = lastReadRef.current;
      if (!last || last.value !== value || now - last.at > CONFIRM_WINDOW_MS) {
        lastReadRef.current = { value, at: now };
        return;
      }

      lockRef.current = true;
      lastReadRef.current = null;
      console.log('[BarcodeScanner] scanned value:', value, '| symbology:', result.type);
      onScanned(value);
      setTimeout(() => { lockRef.current = false; }, SCAN_COOLDOWN_MS);
    },
    [onScanned]
  );

  // If the camera fails to start, rebuild the session (max 2 retries)
  const handleMountError = useCallback(() => {
    if (retriesRef.current >= 2) return;
    retriesRef.current += 1;
    setCameraOn(false);
    startCamera();
  }, [startCamera]);

  const submitManual = () => {
    const code = manualCode.trim();
    if (!code) return;
    setManualCode('');
    onScanned(code);
  };

  if (!visible) return null;

  // Camera permission screens only apply on native
  if (!isWeb && !permission) {
    return (
      <Modal visible animationType="fade">
        <View style={styles.permissionScreen}>
          <Text style={styles.permissionText}>Checking camera permission…</Text>
        </View>
      </Modal>
    );
  }

  if (!isWeb && !permission?.granted) {
    return (
      <Modal visible animationType="fade">
        <View style={styles.permissionScreen}>
          <Text style={styles.permissionText}>Camera access is needed to scan product barcodes.</Text>
          <Pressable style={styles.permBtn} onPress={requestPermission}>
            <Text style={styles.permBtnText}>Grant Permission</Text>
          </Pressable>
          <Pressable style={styles.closeLink} onPress={onClose}>
            <Text style={styles.closeLinkText}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      visible
      animationType="fade"          // fade, not slide: the size is final immediately
      statusBarTranslucent          // same full-screen size on every open
      onShow={startCamera}          // start the camera only after the Modal is on screen
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {!isWeb && cameraOn && (
          <CameraView
            key={cameraKey}
            style={StyleSheet.absoluteFill}
            facing="back"
            autofocus="on"
            zoom={0.1}
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: ['code128'] }}
            onBarcodeScanned={handleScan}
            onMountError={handleMountError}
          />
        )}

        <View style={styles.frame} pointerEvents="none">
          {isWeb ? (
            <Text style={styles.hint}>
              Scan the label with your USB scanner{'\n'}or type the product code below
            </Text>
          ) : (
            <>
              <View style={styles.frameBox} />
              <Text style={styles.hint}>Hold 10–15 cm away and keep the barcode flat and steady</Text>
            </>
          )}
        </View>

        <View style={styles.topBar}>
          <Pressable style={styles.iconBtn} onPress={onClose} hitSlop={8}>
            <X size={22} color="#fff" />
          </Pressable>
          {!isWeb && (
            <Pressable style={styles.iconBtn} onPress={() => setTorch((t) => !t)} hitSlop={8}>
              {torch ? <ZapOff size={22} color={colors.gold ?? '#D4AF37'} /> : <Zap size={22} color="#fff" />}
            </Pressable>
          )}
        </View>

        {/* Fallback: type the code if the camera can't decode the printed label.
            Lifted above the Android navigation bar using the safe-area inset. */}
        <View style={[styles.manualBar, { bottom: insets.bottom + MANUAL_BAR_LIFT }]}>
          <TextInput
            style={styles.manualInput}
            placeholder="Or type the product code"
            placeholderTextColor="rgba(255,255,255,0.6)"
            value={manualCode}
            onChangeText={setManualCode}
            autoCapitalize="characters"
            autoFocus={isWeb}
            returnKeyType="done"
            onSubmitEditing={submitManual}
          />
          <Pressable style={styles.manualBtn} onPress={submitManual} disabled={!manualCode.trim()}>
            <Text style={styles.manualBtnText}>Find</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  topBar: { position: 'absolute', top: 50, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg },
  iconBtn: { backgroundColor: 'rgba(0,0,0,0.5)', padding: 10, borderRadius: 24 },
  frame: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frameBox: { width: 300, height: 110, borderWidth: 2, borderColor: colors.gold ?? '#D4AF37', borderRadius: 12 },
  hint: { color: '#fff', marginTop: spacing.md, fontSize: 13, textAlign: 'center', paddingHorizontal: spacing.lg },
  manualBar: { position: 'absolute', left: spacing.lg, right: spacing.lg, flexDirection: 'row', gap: 8 },
  manualInput: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: spacing.md, paddingVertical: 12, color: '#fff', fontSize: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  manualBtn: { backgroundColor: colors.gold ?? colors.primary, borderRadius: 10, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  manualBtnText: { color: '#fff', fontWeight: '700' },
  permissionScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.background },
  permissionText: { textAlign: 'center', color: colors.textPrimary, marginBottom: spacing.lg, fontSize: 15 },
  permBtn: { backgroundColor: colors.gold ?? colors.primary, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10 },
  permBtnText: { color: '#fff', fontWeight: '700' },
  closeLink: { marginTop: spacing.md },
  closeLinkText: { color: colors.textSecondary },
});