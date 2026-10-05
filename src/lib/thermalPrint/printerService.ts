import RNBluetoothClassic, { BluetoothDevice } from 'react-native-bluetooth-classic';
import { getSavedPrinter, type SavedPrinter } from './printerStore';
import { ensureBluetoothPermissions } from './bluetoothPermissions';

let activeDevice: BluetoothDevice | null = null;

export async function discoverPrinters(): Promise<BluetoothDevice[]> {
  const ok = await ensureBluetoothPermissions();
  if (!ok) throw new Error('Bluetooth permission was denied.');

  const enabled = await RNBluetoothClassic.isBluetoothEnabled();
  if (!enabled) throw new Error('Turn on Bluetooth to see paired printers.');

  // Bluetooth Classic only lists devices already paired at the OS level —
  // there's no separate "scan for nearby" step needed for a printer the
  // cashier has already paired once in phone Settings.
  return RNBluetoothClassic.getBondedDevices();
}

export async function connectByAddress(saved: SavedPrinter): Promise<BluetoothDevice> {
  const ok = await ensureBluetoothPermissions();
  if (!ok) throw new Error('Bluetooth permission was denied.');

  if (activeDevice) {
    const stillConnected = await activeDevice.isConnected().catch(() => false);
    if (stillConnected && activeDevice.address === saved.address) {
      return activeDevice; // already on the right printer
    }
    await activeDevice.disconnect().catch(() => {});
    activeDevice = null;
  }

  const device = await RNBluetoothClassic.connectToDevice(saved.address);
  activeDevice = device;
  return device;
}

export async function getConnectedPrinter(): Promise<BluetoothDevice> {
  const saved = await getSavedPrinter();
  if (!saved) throw new Error('No printer configured. Go to Settings → Printer to add one.');
  return connectByAddress(saved);
}

export async function disconnectActive(): Promise<void> {
  if (activeDevice) {
    await activeDevice.disconnect().catch(() => {});
    activeDevice = null;
  }
}