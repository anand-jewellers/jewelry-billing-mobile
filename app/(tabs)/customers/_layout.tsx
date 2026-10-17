// app/(tabs)/customers/_layout.tsx

import { Stack } from 'expo-router';
import { colors } from '../../../src/theme';

// Always keep the customer list at the bottom of this stack, even when a
// deeper screen (like Orders) is opened directly from the Dashboard.
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function CustomersLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false, // AppHeader replaces the native header
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Customers' }} />
      <Stack.Screen name="add" options={{ title: 'Add Customer' }} />
      <Stack.Screen name="orders/index" options={{ title: 'Orders' }} />
      <Stack.Screen name="[id]" options={{ title: 'Customer Details' }} />
    </Stack>
  );
}