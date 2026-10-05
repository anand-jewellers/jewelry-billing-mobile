// src\lib\thermalPrint\printerStore.ts

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SavedPrinter {
  address: string;
  name: string;
  type: 'BLUETOOTH' | 'WIFI' | 'ETHERNET' | 'USB';
}

const KEY = 'thermal_printer_config';

export async function getSavedPrinter(): Promise<SavedPrinter | null> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function saveSavedPrinter(p: SavedPrinter): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(p));
}

export async function clearSavedPrinter(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}