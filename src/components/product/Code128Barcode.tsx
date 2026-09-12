// src/components/product/Code128Barcode.tsx
import { useMemo } from 'react';
import Svg, { Rect } from 'react-native-svg';
// @ts-ignore — jsbarcode ships no TS types; we only use its documented
// headless "fill a plain object" mode, which never touches the DOM.
import JsBarcode from 'jsbarcode';

interface Props {
  value: string;
  format?: string; // default CODE128 (auto mode-switching)
  height?: number; // bar height in px
  barWidth?: number; // width of one narrow module, in px
  lineColor?: string;
  background?: string;
}

/**
 * Renders a scannable barcode with zero dependency on any RN-specific
 * barcode wrapper library. JsBarcode's core CODE128 encoder is DOM-free —
 * passing a plain object as the target makes it fill `encodings[0].data`
 * with the raw binary bar pattern (e.g. "110100..."), which we then draw
 * ourselves as SVG rects. This is the same encoding logic every JsBarcode
 * based wrapper uses internally, just without their rendering bugs.
 */
export function Code128Barcode({
  value,
  format = 'CODE128',
  height = 50,
  barWidth = 1.6,
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

  const totalWidth = pattern.length * barWidth;

  const bars: { x: number; width: number }[] = [];
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '1') {
      let j = i;
      while (j < pattern.length && pattern[j] === '1') j++;
      bars.push({ x: i * barWidth, width: (j - i) * barWidth });
      i = j;
    } else {
      i++;
    }
  }

  return (
    <Svg width={totalWidth} height={height} viewBox={`0 0 ${totalWidth} ${height}`}>
      <Rect x={0} y={0} width={totalWidth} height={height} fill={background} />
      {bars.map((bar, idx) => (
        <Rect key={idx} x={bar.x} y={0} width={bar.width} height={height} fill={lineColor} />
      ))}
    </Svg>
  );
}