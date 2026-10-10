// src/components/master/LogoCropModal.tsx

import { useRef, useState } from 'react';
import { View, Text, Modal, Image, Pressable, PanResponder, StyleSheet, useWindowDimensions } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { Button } from '../ui';
import { colors, radius, spacing } from '../../theme';

type Picked = { uri: string; width: number; height: number };

interface Props {
  visible: boolean;
  image: Picked | null;
  onCancel: () => void;
  onDone: (croppedUri: string) => void;
}

export function LogoCropModal({ visible, image, onCancel, onDone }: Props) {
  return (
    <Modal visible={visible && !!image} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      {image ? <CropBody image={image} onCancel={onCancel} onDone={onDone} /> : null}
    </Modal>
  );
}

// Mounted fresh every time the modal opens, so zoom/position always start centered.
function CropBody({ image, onCancel, onDone }: { image: Picked; onCancel: () => void; onDone: (uri: string) => void }) {
  const { width: winW } = useWindowDimensions();
  const V = Math.min(winW - spacing.lg * 4, 320); // square crop window size (px)
  const { uri, width: w, height: h } = image;
  const base = V / Math.min(w, h); // scale at which the image just covers the window

  // Keep the image covering the whole window (no empty gaps).
  const clamp = (x: number, y: number, z: number) => {
    const dw = w * base * z;
    const dh = h * base * z;
    return { x: Math.min(0, Math.max(V - dw, x)), y: Math.min(0, Math.max(V - dh, y)) };
  };

  const init = clamp((V - w * base) / 2, (V - h * base) / 2, 1);
  const [off, setOff] = useState(init);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Refs hold the latest values for the PanResponder (it is created only once).
  const offRef = useRef(init);
  const zoomRef = useRef(1);
  const startRef = useRef(init);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = offRef.current;
      },
      onPanResponderMove: (_, g) => {
        const c = clamp(startRef.current.x + g.dx, startRef.current.y + g.dy, zoomRef.current);
        offRef.current = c;
        setOff(c);
      },
    })
  ).current;

  // Zoom around the center of the window.
  const changeZoom = (delta: number) => {
    const nz = Math.min(5, Math.max(1, +(zoomRef.current + delta).toFixed(2)));
    const oldS = base * zoomRef.current;
    const newS = base * nz;
    const cx = (V / 2 - offRef.current.x) / oldS;
    const cy = (V / 2 - offRef.current.y) / oldS;
    const c = clamp(V / 2 - cx * newS, V / 2 - cy * newS, nz);
    zoomRef.current = nz;
    offRef.current = c;
    setZoom(nz);
    setOff(c);
  };

  const done = async () => {
    setBusy(true);
    setErr(null);
    try {
      const s = base * zoomRef.current;
      const ox = Math.max(0, Math.round(-offRef.current.x / s));
      const oy = Math.max(0, Math.round(-offRef.current.y / s));
      const size = Math.max(1, Math.min(Math.round(V / s), w - ox, h - oy));
      const out = await ImageManipulator.manipulateAsync(
        uri,
        [{ crop: { originX: ox, originY: oy, width: size, height: size } }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.PNG }
      );
      onDone(out.uri);
    } catch {
      setErr('Could not crop the image. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        <Text style={styles.title}>Crop logo</Text>
        <Text style={styles.hint}>Drag to move. Use + / − to zoom.</Text>

        <View style={[styles.window, { width: V, height: V }]} {...pan.panHandlers}>
          <Image source={{ uri }} style={{ position: 'absolute', left: off.x, top: off.y, width: w * base * zoom, height: h * base * zoom }} />
        </View>

        <View style={styles.zoomRow}>
          <Pressable style={styles.zoomBtn} onPress={() => changeZoom(-0.25)} hitSlop={8}>
            <Text style={styles.zoomText}>−</Text>
          </Pressable>
          <Text style={styles.zoomLabel}>{Math.round(zoom * 100)}%</Text>
          <Pressable style={styles.zoomBtn} onPress={() => changeZoom(0.25)} hitSlop={8}>
            <Text style={styles.zoomText}>+</Text>
          </Pressable>
        </View>

        {err ? <Text style={styles.error}>{err}</Text> : null}

        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <Button label="Cancel" variant="outline" onPress={onCancel} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Done" onPress={done} loading={busy} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,31,61,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: { width: '100%', alignItems: 'center', backgroundColor: colors.surface ?? '#fff', borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary ?? '#0f172a', alignSelf: 'flex-start' },
  hint: { fontSize: 12, color: colors.textSecondary ?? '#64748b', alignSelf: 'flex-start', marginTop: -8 },
  window: { overflow: 'hidden', borderRadius: radius.lg, borderWidth: 2, borderColor: colors.primary, backgroundColor: '#f8fafc' },
  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  zoomBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  zoomText: { fontSize: 22, fontWeight: '700', color: colors.primary, lineHeight: 24 },
  zoomLabel: { minWidth: 48, textAlign: 'center', fontSize: 13, fontWeight: '600', color: colors.textPrimary ?? '#0f172a' },
  error: { fontSize: 13, color: colors.error, alignSelf: 'flex-start' },
  actions: { flexDirection: 'row', gap: spacing.sm, width: '100%' },
});