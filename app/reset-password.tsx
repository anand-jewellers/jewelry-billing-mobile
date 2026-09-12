import { useState } from 'react';
import { Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { updatePassword } from '../src/lib/auth';
import { Button, Card, Input } from '../src/components/ui';
import { colors, spacing } from '../src/theme';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await updatePassword(password);
      router.replace('/login');
    } catch {
      setError('Could not update your password. The reset link may have expired — request a new one.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} style={styles.screen}>
      <Text style={styles.title}>Set a new password</Text>

      <Card style={styles.card}>
        {error && (
          <Text style={styles.errorText}>{error}</Text>
        )}

        <Input
          label="New password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="At least 8 characters"
        />

        <Input
          label="Confirm password"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          placeholder="Re-enter password"
        />

        <Button label={submitting ? 'Updating…' : 'Update password'} onPress={handleSubmit} loading={submitting} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, paddingVertical: 40 },
  title: { fontSize: 22, color: colors.primary, fontWeight: '700', textAlign: 'center', marginBottom: spacing.xl },
  card: { paddingVertical: spacing.xl },
  errorText: { fontSize: 13, color: colors.error, marginBottom: spacing.md, textAlign: 'center' },
});
