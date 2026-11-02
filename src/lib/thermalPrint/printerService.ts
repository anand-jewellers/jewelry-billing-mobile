// src/lib/thermalPrint/printerService.ts
import RNBluetoothClassic, { BluetoothDevice } from 'react-native-bluetooth-classic';
import { getSavedPrinter, type SavedPrinter, type PrinterKind } from './printerStore';
import { ensureBluetoothPermissions } from './bluetoothPermissions';

let activeDevice: BluetoothDevice | null = null;

export async function discoverPrinters(): Promise<BluetoothDevice[]> {
  const ok = await ensureBluetoothPermissions();
  if (!ok) throw new Error('Bluetooth permission was denied.');

  const enabled = await RNBluetoothClassic.isBluetoothEnabled();
  if (!enabled) throw new Error('Turn on Bluetooth to see paired printers.');

  return RNBluetoothClassic.getBondedDevices();
}

export async function connectByAddress(saved: SavedPrinter): Promise<BluetoothDevice> {
  const ok = await ensureBluetoothPermissions();
  if (!ok) throw new Error('Bluetooth permission was denied.');

  if (activeDevice) {
    const stillConnected = await activeDevice.isConnected().catch(() => false);
    if (stillConnected && activeDevice.address === saved.address) {
      return activeDevice;
    }
    await activeDevice.disconnect().catch(() => {});
    activeDevice = null;
  }

  const attempt = () =>
    RNBluetoothClassic.connectToDevice(saved.address, {
      connectorType: 'rfcomm',
      delimiter: '',
      secure: false,
    } as any);

  let device: BluetoothDevice;
  try {
    device = await attempt();
  } catch {
    await new Promise((r) => setTimeout(r, 800));
    device = await attempt();
  }
  activeDevice = device;
  return device;
}

export async function getConnectedPrinter(kind: PrinterKind = 'bill'): Promise<BluetoothDevice> {
  const saved = await getSavedPrinter(kind);
  if (!saved) {
    throw new Error(`No ${kind} printer configured. Go to Settings → Printer to add one.`);
  }
  return connectByAddress(saved);
}

export async function disconnectActive(): Promise<void> {
  if (activeDevice) {
    await activeDevice.disconnect().catch(() => {});
    activeDevice = null;
  }
}