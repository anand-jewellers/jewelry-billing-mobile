import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Link } from 'expo-router';
import { sendPasswordReset } from '../src/lib/auth';
import { Button, Card, Input } from '../src/components/ui';
import { colors, spacing } from '../src/theme';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await sendPasswordReset(email.trim());
      setSent(true);
    } catch {
      setError('Could not send the reset email. Double-check the address and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} style={styles.screen}>
      <Text style={styles.title}>Reset your password</Text>

      <Card style={styles.card}>
        {sent ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.sentTitle}>Check your inbox</Text>
            <Text style={styles.subtitle}>
              We sent a reset link to {email}. Open it on this device to set a new password.
            </Text>
            <Link href="/login" style={styles.link}>
              Back to sign in
            </Link>
          </View>
        ) : (
          <>
            <Text style={styles.subtitle}>Enter the email on your account and we'll send a reset link.</Text>

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="you@yourshop.com"
            />

            <View style={{ marginTop: spacing.sm }}>
              <Button label={submitting ? 'Sending…' : 'Send reset link'} onPress={handleSubmit} loading={submitting} />
            </View>

            <Link href="/login" style={styles.link}>
              Back to sign in
            </Link>
          </>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, paddingVertical: 40 },
  title: { fontSize: 22, color: colors.primary, fontWeight: '700', textAlign: 'center', marginBottom: spacing.xl },
  card: { paddingVertical: spacing.xl },
  sentTitle: { fontSize: 14, color: colors.textPrimary, fontWeight: '600', marginBottom: spacing.xs },
  subtitle: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.lg },
  errorBox: {
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorSurface,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  errorText: { fontSize: 13, color: colors.error },
  link: { fontSize: 12.5, color: colors.primaryLight, textAlign: 'center', marginTop: spacing.lg, fontWeight: '500' },
});
