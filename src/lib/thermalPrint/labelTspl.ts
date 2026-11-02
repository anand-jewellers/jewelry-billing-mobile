// src/lib/thermalPrint/labelTspl.ts
import { Buffer } from 'buffer';
import { LABEL_W_MM } from '../labelLayout';
import { W_DOTS, H_DOTS, ROW_BYTES, DPMM } from './labelRaster';

// Page size must match the roll (same as the desktop driver: 100 x 15 mm).
export const PAGE_H_MM = 15;
export const GAP_MM = 3;                       // change only if the desktop driver shows another gap

const DARKNESS = 12;                           // 0-15
const SPEED = 4;
const DIRECTION = 1;                           // flip to 0 if the print is upside down

// Trim in printer dots. Positive Y moves the print down.
export const OFFSET_X_DOTS = 0;
export const OFFSET_Y_DOTS = 0;

const EXPECTED_BYTES = ROW_BYTES * H_DOTS;
const PAGE_H_DOTS = Math.round(PAGE_H_MM * DPMM);

function header(): string {
  return (
    [
      `SIZE ${LABEL_W_MM} mm,${PAGE_H_MM} mm`,
      `GAP ${GAP_MM} mm,0 mm`,
      `DIRECTION ${DIRECTION},0`,
      'REFERENCE 0,0',
      `DENSITY ${DARKNESS}`,
      `SPEED ${SPEED}`,
    ].join('\r\n') + '\r\n'
  );
}

export function buildLabelTsplBitmap(bitmaps: Buffer[], copies = 1): Buffer {
  const parts: Buffer[] = [Buffer.from(header(), 'ascii')];
  for (const bmp of bitmaps) {
    if (bmp.length !== EXPECTED_BYTES) {
      throw new Error(`Bitmap is ${bmp.length} bytes, expected ${EXPECTED_BYTES}`);
    }
    parts.push(
      Buffer.from(
        `CLS\r\nBITMAP ${OFFSET_X_DOTS},${OFFSET_Y_DOTS},${ROW_BYTES},${H_DOTS},0,`,
        'ascii'
      ),
      bmp,
      Buffer.from(`\r\nPRINT ${copies},1\r\n`, 'ascii')
    );
  }
  return Buffer.concat(parts);
}

/** Optional: gap calibration. Only use after PAGE_H_MM and GAP_MM are correct. */
export function buildCalibrationTspl(): Buffer {
  return Buffer.from(
    [`SIZE ${LABEL_W_MM} mm,${PAGE_H_MM} mm`, `GAP ${GAP_MM} mm,0 mm`, 'GAPDETECT'].join('\r\n') + '\r\n',
    'ascii'
  );
}

function borderTest(gap: string): Buffer {
  return Buffer.from(
    [
      `SIZE ${LABEL_W_MM} mm,${PAGE_H_MM} mm`,
      gap,
      `DIRECTION ${DIRECTION},0`,
      'REFERENCE 0,0',
      `DENSITY ${DARKNESS}`,
      'CLS',
      `BOX 0,0,${W_DOTS - 2},${PAGE_H_DOTS - 2},2`,
      'PRINT 1,1',
    ].join('\r\n') + '\r\n',
    'ascii'
  );
}

/** Test: prints a rectangle around one label. */
export function buildBorderTest(): Buffer {
  return borderTest(`GAP ${GAP_MM} mm,0 mm`);
}

/** Test: same rectangle, but without gap sensing. */
export function buildBorderTestContinuous(): Buffer {
  return borderTest('GAP 0 mm,0 mm');
}