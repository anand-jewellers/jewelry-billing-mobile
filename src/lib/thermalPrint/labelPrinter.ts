// src/lib/thermalPrint/labelPrinter.ts
import { Buffer } from 'buffer';
import type { LabelData } from '../labelLayout';
import { rasterizeLabel } from './labelRaster';
import {
  buildLabelTsplBitmap,
  buildCalibrationTspl,
  buildBorderTest,
  buildBorderTestContinuous,
} from './labelTspl';
import { getConnectedPrinter, disconnectActive } from './printerService';
import { getSavedPrinter } from './printerStore';

const CHUNK = 512;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function hasLabelPrinter(): Promise<boolean> {
  return !!(await getSavedPrinter('label'));
}

async function writeChunked(device: any, payload: Buffer) {
  for (let i = 0; i < payload.length; i += CHUNK) {
    const part = payload.subarray(i, i + CHUNK);
    await device.write(Buffer.from(part).toString('base64'), 'base64');
    await sleep(30);
  }
}

/** Optional gap calibration. */
export async function calibrateLabelPrinter(): Promise<void> {
  const device = await getConnectedPrinter('label');
  await writeChunked(device, buildCalibrationTspl());
  await sleep(4000);
}

export async function printBorderTest(): Promise<void> {
  const device = await getConnectedPrinter('label');
  await writeChunked(device, buildBorderTest());
}

export async function printBorderTestContinuous(): Promise<void> {
  const device = await getConnectedPrinter('label');
  await writeChunked(device, buildBorderTestContinuous());
}

export async function printLabelsBluetooth(labels: LabelData[], copies = 1): Promise<void> {
  if (!labels.length) return;

  const bitmaps: Buffer[] = [];
  for (const l of labels) bitmaps.push(await rasterizeLabel(l));
  const payload = buildLabelTsplBitmap(bitmaps, copies);

  try {
    const device = await getConnectedPrinter('label');
    await writeChunked(device, payload);
  } catch {
    await disconnectActive();   // drop the dead socket and retry once
    await sleep(800);
    const device = await getConnectedPrinter('label');
    await writeChunked(device, payload);
  }
}

export async function printMinimalTest(): Promise<void> {
  const device = await getConnectedPrinter('label');
  const cmd =
    'SIZE 100 mm,15 mm\r\n' +
    'GAP 3 mm,0 mm\r\n' +
    'CLS\r\n' +
    'TEXT 40,40,"3",0,1,1,"TEST"\r\n' +
    'PRINT 1,1\r\n';
  await writeChunked(device, Buffer.from(cmd, 'ascii'));
}

export async function printBitmapTest(): Promise<void> {
  const W = 100, H = 120;                       // 100 bytes x 120 rows = 800 x 120 dots
  const bmp = Buffer.alloc(W * H, 0xff);        // all white
  for (let y = 0; y < 16; y++) bmp.fill(0x00, y * W, (y + 1) * W);        // black bar at the top
  for (let y = 60; y < 76; y++) bmp.fill(0xf0, y * W, (y + 1) * W);       // striped bar in the middle

  const head =
    'SIZE 100 mm,15 mm\r\nGAP 3 mm,0 mm\r\nCLS\r\n' + `BITMAP 0,0,${W},${H},0,`;
  const payload = Buffer.concat([
    Buffer.from(head, 'ascii'),
    bmp,
    Buffer.from('\r\nPRINT 1,1\r\n', 'ascii'),
  ]);

  const device = await getConnectedPrinter('label');
  await writeChunked(device, payload);
}