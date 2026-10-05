// src/components/product/Code128Barcode.tsx
import { useMemo } from 'react';
import Svg, { Rect } from 'react-native-svg';
// @ts-ignore — jsbarcode ships no TS types
import JsBarcode from 'jsbarcode';

interface Props {
  value: string;
  format?: string;      // default CODE128 (auto mode-switching)
  height?: number;      // bar height in px
  barWidth?: number;    // fixed narrow-module width (ignored if maxWidth is set)
  maxWidth?: number;    // fit the whole barcode (incl. quiet zones) inside this width
  maxBarWidth?: number; // upper limit when auto-fitting
  pxStep?: number;      // printer pixel size in dp (0.5 = 1px at 2px/dp) — keeps bars crisp
  quietZone?: number;   // blank modules on each side (scanners need ~10)
  lineColor?: string;
  background?: string;
}

export function Code128Barcode({
  value,
  format = 'CODE128',
  height = 50,
  barWidth = 1.6,
  maxWidth,
  maxBarWidth = 2,
  pxStep = 0.5,
  quietZone = 10,
  lineColor = '#000000',
  background = '#ffffff',
}: Props) {
  const pattern = useMemo(() => {
    if (!value) return null;
    try {
      const data: any = {};
      JsBarcode(data, value, { format, displayValue: false });
      return (data.encodings?.[0]?.data as string) ?? null;
    } catch (e) {
      console.warn('Barcode encoding failed', e);
      return null;
    }
  }, [value, format]);

  if (!pattern) return null;

  // Auto-fit: exact pattern length + quiet zones, snapped down to whole printer pixels
  const totalModules = pattern.length + quietZone * 2;
  const bw = maxWidth
    ? Math.max(pxStep, Math.min(maxBarWidth, Math.floor(maxWidth / totalModules / pxStep) * pxStep))
    : barWidth;

  const offset = quietZone * bw;
  const totalWidth = totalModules * bw;

  const bars: { x: number; width: number }[] = [];
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '1') {
      let j = i;
      while (j < pattern.length && pattern[j] === '1') j++;
      bars.push({ x: offset + i * bw, width: (j - i) * bw });
      i = j;
    } else {
      i++;
    }
  }

  return (
    <Svg width={totalWidth} height={height} viewBox={`0 0 ${totalWidth} ${height}`}>
      <Rect x={0} y={0} width={totalWidth} height={height} fill={background} />
      {bars.map((bar, idx) => (
        <Rect
          key={idx}
          x={bar.x}
          y={0}
          width={bar.width}
          height={height}
          fill={lineColor}
          shapeRendering="crispEdges"
        />
      ))}
    </Svg>
  );
}