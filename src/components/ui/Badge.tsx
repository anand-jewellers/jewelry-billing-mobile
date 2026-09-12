import { View, Text, StyleSheet } from 'react-native';
import { colors, radius } from '../../theme';

type BadgeTone = 'success' | 'warning' | 'error' | 'primary' | 'neutral';

interface BadgeProps {
  label: string;
  tone?: BadgeTone;
}

export function Badge({ label, tone = 'neutral' }: BadgeProps) {
  return (
    <View style={[styles.badge, toneStyles[tone].bg]}>
      <Text style={[styles.text, toneStyles[tone].text]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
});

const toneStyles: Record<BadgeTone, { bg: object; text: object }> = {
  success: { bg: { backgroundColor: colors.successSurface }, text: { color: colors.success } },
  warning: { bg: { backgroundColor: colors.warningSurface }, text: { color: colors.warning } },
  error: { bg: { backgroundColor: colors.errorSurface }, text: { color: colors.error } },
  primary: { bg: { backgroundColor: colors.primarySurface }, text: { color: colors.primary } },
  neutral: { bg: { backgroundColor: colors.goldSurface }, text: { color: colors.goldDark } },
};
