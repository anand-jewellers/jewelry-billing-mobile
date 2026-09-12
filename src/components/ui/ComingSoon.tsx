import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../../theme';

export function ComingSoon({ label }: { label: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>{label}</Text>
      <Text style={styles.sub}>This screen isn't built yet — coming in the next pass.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  text: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.xs },
  sub: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
});
