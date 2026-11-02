import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SavedPrinter {
  address: string;
  name: string;
  type: 'BLUETOOTH' | 'WIFI' | 'ETHERNET' | 'USB';
}

export type PrinterKind = 'bill' | 'label';

const KEYS: Record<PrinterKind, string> = {
  bill: 'thermal_printer_config',   // unchanged, so your saved bill printer keeps working
  label: 'label_printer_config',
};

export async function getSavedPrinter(kind: PrinterKind = 'bill'): Promise<SavedPrinter | null> {
  const raw = await AsyncStorage.getItem(KEYS[kind]);
  return raw ? JSON.parse(raw) : null;
}

export async function saveSavedPrinter(p: SavedPrinter, kind: PrinterKind = 'bill'): Promise<void> {
  await AsyncStorage.setItem(KEYS[kind], JSON.stringify(p));
}

export async function clearSavedPrinter(kind: PrinterKind = 'bill'): Promise<void> {
  await AsyncStorage.removeItem(KEYS[kind]);
}