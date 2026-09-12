// src/components/product/ImagePickerGrid.tsx
import { useState } from 'react';
import { View, Image, TouchableOpacity, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../../theme';
import { compressImageUnder50KB } from '../../lib/imageCompression';

export interface PickedImage {
  uri: string;
  isPrimary: boolean;
  base64?: string; // already-compressed JPEG payload, ready to upload
  sizeKB?: number;
}

interface Props {
  images: PickedImage[];
  onChange: (images: PickedImage[]) => void;
  max?: number;
}

export function ImagePickerGrid({ images, onChange }: Props) {
  const current = images[0] ?? null;
  const [compressing, setCompressing] = useState(false);

  async function handlePicked(rawUri: string) {
    setCompressing(true);
    try {
      const compressed = await compressImageUnder50KB(rawUri);
      onChange([
        {
          uri: compressed.uri,
          isPrimary: true,
          base64: compressed.base64,
          sizeKB: Math.round(compressed.sizeBytes / 1024),
        },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not process the photo');
    } finally {
      setCompressing(false);
    }
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera permission needed', 'Please allow camera access to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled) return;
    await handlePicked(result.assets[0].uri);
  }

  async function pickFromGallery() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access to choose an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 0.8,
    });
    if (result.canceled) return;
    await handlePicked(result.assets[0].uri);
  }

  function removeImage() {
    onChange([]);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Product Image</Text>

      {compressing ? (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : current ? (
        <View style={styles.thumbWrap}>
          <Image source={{ uri: current.uri }} style={styles.thumb} />
          <TouchableOpacity style={styles.removeBtn} onPress={removeImage}>
            <Ionicons name="close" size={14} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.retakeBtn} onPress={takePhoto}>
            <Text style={styles.retakeText}>Retake</Text>
          </TouchableOpacity>
          {current.sizeKB != null && <Text style={styles.sizeText}>{current.sizeKB} KB</Text>}
        </View>
      ) : (
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.actionTile} onPress={takePhoto}>
            <Ionicons name="camera" size={26} color={colors.primary} />
            <Text style={styles.addText}>Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionTile} onPress={pickFromGallery}>
            <Ionicons name="images" size={26} color={colors.primary} />
            <Text style={styles.addText}>Gallery</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.xs, fontWeight: '600' },
  thumbWrap: { width: 120 },
  thumb: { width: 120, height: 120, borderRadius: 10, backgroundColor: colors.border },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  removeBtn: {
    position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center',
  },
  retakeBtn: { marginTop: 6 },
  retakeText: { fontSize: 12, color: colors.primary, textAlign: 'center', fontWeight: '600' },
  sizeText: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 2 },
  actionsRow: { flexDirection: 'row', gap: spacing.sm },
  actionTile: {
    width: 90, height: 90, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed',
    borderColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  addText: { fontSize: 12, color: colors.primary, marginTop: 4 },
});