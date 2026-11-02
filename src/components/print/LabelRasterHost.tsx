// src/components/print/LabelRasterHost.tsx
//
// Hidden renderer. Draws ONLY the text layer of the label, in a native
// 800 x 120 SVG where 1 SVG unit = 1 printer dot (so no scaling on capture).
// Bars are drawn directly into the bitmap by labelRaster.ts.
//
// FONT: bundle Arimo Bold (metric-compatible with Arial Bold) so Android
// uses the same glyph widths the layout was designed for (CHAR_W = 0.64).
//   Expo:  app.json -> ["expo-font", { "fonts": ["./assets/fonts/Arimo-Bold.ttf"] }]  then rebuild
//   Bare:  android/app/src/main/assets/fonts/Arimo-Bold.ttf
// The name below must equal the file name without ".ttf".

import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { buildLabelLayout, LabelData } from '../../lib/labelLayout';
import { rasterHost, W_DOTS, H_DOTS, DPMM } from '../../lib/thermalPrint/labelRaster';

const FONT_FAMILY = 'Arimo-Bold';
const SETTLE_MS = 120; // extra wait after commit so the native SVG view has drawn

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function LabelRasterHost() {
  const [label, setLabel] = useState<LabelData | null>(null);
  const [tick, setTick] = useState(0);
  const svgRef = useRef<any>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const committed = useRef<(() => void) | null>(null);

  const layout = useMemo(() => (label ? buildLabelLayout(label) : null), [label]);

  // Fires after React has committed the new label to the native view.
  useEffect(() => {
    committed.current?.();
    committed.current = null;
  }, [tick]);

  useEffect(() => {
    const capture = async (l: LabelData): Promise<string> => {
      await new Promise<void>((resolve) => {
        committed.current = resolve;
        setLabel(l);
        setTick((t) => t + 1);
      });
      await nextFrame();
      await nextFrame();
      await sleep(SETTLE_MS);

      const svg = svgRef.current;
      if (!svg?.toDataURL) throw new Error('Label renderer not ready.');
      return new Promise<string>((resolve) => {
        svg.toDataURL((b64: string) => resolve(b64), { width: W_DOTS, height: H_DOTS });
      });
    };

    // Serialize captures so two labels can never overlap.
    rasterHost.render = (l: LabelData) => {
      const job = queue.current.then(() => capture(l));
      queue.current = job.catch(() => undefined);
      return job;
    };

    return () => {
      rasterHost.render = null;
    };
  }, []);

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, top: 0, width: W_DOTS, height: H_DOTS, opacity: 0.01 }}
    >
      <Svg
        key={tick}
        ref={svgRef}
        width={W_DOTS}
        height={H_DOTS}
        viewBox={`0 0 ${W_DOTS} ${H_DOTS}`}
      >
        <Rect x={0} y={0} width={W_DOTS} height={H_DOTS} fill="#fff" />
        {layout?.texts.map((t, i) => (
          <SvgText
            key={i}
            x={t.x * DPMM}
            y={t.y * DPMM}
            fontSize={t.size * DPMM}
            fontFamily={FONT_FAMILY}
            fill="#000"
            textAnchor={t.anchor}
          >
            {t.text}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}