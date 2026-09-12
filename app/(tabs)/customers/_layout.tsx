import { Stack } from 'expo-router';
import { colors } from '../../../src/theme';

export default function CustomersLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,   // ← AppHeader replaces the native header
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Customers' }} />
      <Stack.Screen name="add" options={{ title: 'Add Customer' }} />
      <Stack.Screen name="[id]" options={{ title: 'Customer Details' }} />
    </Stack>
  );
}