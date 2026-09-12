// invoices/_layout.tsx
import { Stack } from 'expo-router';
import { colors } from '../../../src/theme';

export default function InvoicesLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Invoices' }} />
      <Stack.Screen name="new" options={{ title: 'New Invoice' }} />
      <Stack.Screen name="[id]" options={{ title: 'Invoice Details' }} />
    </Stack>
  );
}