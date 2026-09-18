// src/components/ui/ShakeErrorCard.tsx  (new file)
import { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { colors, spacing } from '../../theme';

interface ShakeErrorCardProps {
  message: string | null;
}

export function ShakeErrorCard({ message }: ShakeErrorCardProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-8)).current;
  const shakeX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;

    // Reset then fade+slide in
    opacity.setValue(0);
    translateY.setValue(-8);
    shakeX.setValue(0);

    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => {
      // Then a quick shake, like an incorrect-password nudge
      Animated.sequence([
        Animated.timing(shakeX, { toValue: 6, duration: 45, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: -6, duration: 45, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: 4, duration: 45, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: 0, duration: 45, useNativeDriver: true }),
      ]).start();
    });
  }, [message]);

  if (!message) return null;

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity,
          transform: [{ translateY }, { translateX: shakeX }],
        },
      ]}
    >
      <AlertTriangle size={16} color={colors.error ?? 'crimson'} />
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FDECEC',
    borderLeftWidth: 3,
    borderLeftColor: 'crimson',
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  text: {
    color: '#7A1F1F',
    fontSize: 12.5,
    fontWeight: '600',
    flexShrink: 1,
  },
});