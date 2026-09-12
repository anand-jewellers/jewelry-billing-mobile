// src/lib/imageCompression.ts
import * as ImageManipulator from 'expo-image-manipulator';

const MAX_BYTES = 50 * 1024; // 50 KB
const MIN_WIDTH = 200;

export interface CompressedImage {
  uri: string;
  base64: string;
  sizeBytes: number;
  width: number;
  quality: number;
}

function base64SizeInBytes(base64: string) {
  const padding = (base64.match(/=+$/) || [''])[0].length;
  return (base64.length * 3) / 4 - padding;
}

export async function compressImageUnder50KB(uri: string): Promise<CompressedImage> {
  let width = 900;
  let quality = 0.7;

  let result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width } }], {
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  let sizeBytes = base64SizeInBytes(result.base64!);

  let attempts = 0;
  while (sizeBytes > MAX_BYTES && attempts < 12) {
    if (quality > 0.35) {
      quality = Math.round((quality - 0.1) * 100) / 100;
    } else if (width > MIN_WIDTH) {
      width = Math.round(width * 0.8);
    } else {
      break;
    }

    result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width } }], {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    sizeBytes = base64SizeInBytes(result.base64!);
    attempts += 1;
  }

  if (sizeBytes > MAX_BYTES) {
    console.warn(`Compressed image is still ${(sizeBytes / 1024).toFixed(1)} KB after ${attempts} attempts`);
  }

  return { uri: result.uri, base64: result.base64!, sizeBytes, width, quality };
}