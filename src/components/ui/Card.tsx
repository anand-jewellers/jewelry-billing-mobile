import { Children } from 'react';
import { View, StyleSheet, type ViewProps } from 'react-native';
import { colors, radius, spacing, shadow } from '../../theme';

interface CardProps extends ViewProps {
  padded?: boolean;
}

export function Card({ style, padded = true, children, ...rest }: CardProps) {
  // Safety net: a bare '' or whitespace-only string inside a <View> crashes
  // ("Unexpected text node"). This happens with `{value && <X />}` when value
  // is an empty string. Drop those children so the card never crashes.
  const safeChildren = Children.toArray(children).filter(
    (child) => !(typeof child === 'string' && child.trim() === '')
  );

  return (
    <View style={[styles.card, padded && styles.padded, style]} {...rest}>
      {safeChildren}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  padded: {
    padding: spacing.lg,
  },
});