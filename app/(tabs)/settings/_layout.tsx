// settings/_layout.tsx
import { Stack } from 'expo-router';
import { colors } from '../../../src/theme';

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Settings' }} />
      <Stack.Screen name="company" options={{ title: 'Company' }} />
      <Stack.Screen name="metals" options={{ title: 'Metals' }} />
      <Stack.Screen name="purity" options={{ title: 'Purity' }} />
      <Stack.Screen name="categories" options={{ title: 'Categories' }} />
      <Stack.Screen name="gold-rates" options={{ title: 'Gold Rates' }} />
      <Stack.Screen name="making-charges" options={{ title: 'Making Charges' }} />
      <Stack.Screen name="value-added-charges" options={{ title: 'Value Added Charges' }} />
      <Stack.Screen name="tax" options={{ title: 'Tax' }} />
      <Stack.Screen name="invoice-settings" options={{ title: 'Invoice Settings' }} />
      <Stack.Screen name="staff" options={{ title: 'Staff' }} />
    </Stack>
  );
}