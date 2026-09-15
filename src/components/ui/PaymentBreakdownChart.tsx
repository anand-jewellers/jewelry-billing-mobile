import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, spacing } from '../../theme';
import type { PaymentBreakdownSlice } from '../../lib/api/reports';

interface Props {
  data: PaymentBreakdownSlice[];
  size?: number;
  strokeWidth?: number;
}

const RADIUS_DEFAULT = 70;

export function PaymentBreakdownChart({ data, size = 160, strokeWidth = 22 }: Props) {
  const total = data.reduce((s, d) => s + d.amount, 0);

  if (total <= 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>No payments recorded in this period.</Text>
      </View>
    );
  }

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // Running offset (in "dash units") so each arc starts where the last ended.
  let cumulative = 0;

  return (
    <View style={styles.wrap}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          {/* Track (unfilled background ring) */}
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={colors.border}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {data.map((slice) => {
            const fraction = slice.amount / total;
            const dashLength = Math.max(0, Math.min(circumference, fraction * circumference));
            const dashArray = `${dashLength} ${Math.max(0, circumference - dashLength)}`;
            const dashOffset = circumference * (1 - cumulative) + circumference / 4;
            cumulative += fraction;

            return (
              <Circle
                key={slice.mode}
                cx={center}
                cy={center}
                r={radius}
                stroke={slice.color}
                strokeWidth={strokeWidth}
                strokeDasharray={dashArray}
                strokeDashoffset={dashOffset}
                strokeLinecap="butt"
                fill="none"
                // SVG circles start at 3 o'clock and go clockwise by default;
                // rotating -90° makes the first slice start at 12 o'clock.
                transform={`rotate(-90 ${center} ${center})`}
              />
            );
          })}
        </Svg>
        <View style={[styles.centerLabelWrap, { width: size, height: size }]}>
          <Text style={styles.centerAmount}>₹{total.toLocaleString('en-IN')}</Text>
          <Text style={styles.centerSub}>Collected</Text>
        </View>
      </View>

      <View style={styles.legend}>
        {data.map((slice) => (
          <View key={slice.mode} style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: slice.color }]} />
            <Text style={styles.legendLabel}>{slice.label}</Text>
            <Text style={styles.legendAmount}>₹{slice.amount.toLocaleString('en-IN')}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.sm },
  centerLabelWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerAmount: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
  centerSub: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  legend: { flex: 1, gap: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { flex: 1, fontSize: 13, color: colors.textSecondary },
  legendAmount: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  emptyWrap: { paddingVertical: spacing.lg, alignItems: 'center' },
  emptyText: { fontSize: 13, color: colors.textMuted },
});