import { View, Text, Switch as RNSwitch, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';

interface ToggleRowProps {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  description?: string;
}

export function ToggleRow({ label, value, onValueChange, description }: ToggleRowProps) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, paddingRight: spacing.md }}>
        <Text style={styles.label}>{label}</Text>
        {description && <Text style={styles.description}>{description}</Text>}
      </View>
      <RNSwitch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.primaryLight }}
        thumbColor={colors.white}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  label: { fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
  description: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
