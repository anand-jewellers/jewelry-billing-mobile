import { View, Text, StyleSheet } from 'react-native';
import { Card } from './Card';
import { colors, spacing } from '../../theme';

interface SummaryCardProps {
  label: string;
  value: string;
  tone?: 'primary' | 'gold' | 'neutral';
}

export function SummaryCard({ label, value, tone = 'neutral' }: SummaryCardProps) {
  return (
    <Card style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, tone === 'gold' && { color: colors.gold }, tone === 'primary' && { color: colors.primary }]}>
        {value}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    minWidth: 150,
    flexGrow: 1,
  },
  label: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  value: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});
