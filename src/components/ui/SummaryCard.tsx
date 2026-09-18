import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './Card';
import { colors, spacing } from '../../theme';

interface SummaryCardProps {
  label: string;
  value: string;
  tone?: 'primary' | 'gold' | 'neutral';
  icon?: keyof typeof Ionicons.glyphMap;
}

const toneColor = {
  primary: colors.primary,
  gold: colors.gold,
  neutral: colors.textPrimary,
};

export function SummaryCard({ label, value, tone = 'neutral', icon }: SummaryCardProps) {
  const accent = toneColor[tone];
  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        {icon && (
          <View style={[styles.iconWrap, { backgroundColor: accent + '1A' }]}>
            <Ionicons name={icon} size={14} color={accent} />
          </View>
        )}
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={[styles.value, { color: accent }]}>{value}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
    flexBasis: 160, // shrinks/grows from this base, so rows fill the available width
    minWidth: 150,
    height: 90,
    justifyContent: 'space-between',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 12,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  value: {
    fontSize: 20,
    fontWeight: '700',
  },
});