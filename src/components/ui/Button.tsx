import { Pressable, Text, StyleSheet, ActivityIndicator, type PressableProps } from 'react-native';
import { colors, radius, spacing } from '../../theme';

interface ButtonProps extends Omit<PressableProps, 'style'> {
  label: string;
  variant?: 'primary' | 'gold' | 'outline' | 'ghost';
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({ label, variant = 'primary', loading, fullWidth = true, disabled, ...rest }: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        fullWidth && { width: '100%' },
        isDisabled && { opacity: 0.6 },
        pressed && !isDisabled && { opacity: 0.85 },
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'outline' || variant === 'ghost' ? colors.primary : colors.textOnPrimary} />
      ) : (
        <Text style={[styles.label, textVariantStyles[variant]]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: colors.primary },
  gold: { backgroundColor: colors.gold },
  outline: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.primary },
  ghost: { backgroundColor: 'transparent' },
});

const textVariantStyles = StyleSheet.create({
  primary: { color: colors.textOnPrimary },
  gold: { color: colors.textOnGold },
  outline: { color: colors.primary },
  ghost: { color: colors.primary },
});
