import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Building2,
  Gem,
  Sparkles,
  LayoutGrid,
  TrendingUp,
  Hammer,
  PlusCircle,
  Percent,
  FileText,
  Users,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react-native';
import { useStaff } from '../../../src/context/StaffContext';
import { Card } from '../../../src/components/ui';
import { colors, spacing } from '../../../src/theme';
import { StaffLogoutButton } from '../../../src/components/StaffLogoutButton';
import type { PageKey } from '../../../src/types/settings';

const SETTINGS_ITEMS: { label: string; route: string; icon: LucideIcon; pageKey: PageKey }[] = [
  { label: 'Company', route: '/settings/company', icon: Building2, pageKey: 'settings.company' },
  { label: 'Metals', route: '/settings/metals', icon: Gem, pageKey: 'settings.metals' },
  { label: 'Purity', route: '/settings/purity', icon: Sparkles, pageKey: 'settings.purity' },
  { label: 'Categories', route: '/settings/categories', icon: LayoutGrid, pageKey: 'settings.categories' },
  { label: 'Gold Rates', route: '/settings/gold-rates', icon: TrendingUp, pageKey: 'settings.gold_rates' },
  { label: 'Making Charges', route: '/settings/making-charges', icon: Hammer, pageKey: 'settings.making_charges' },
  {
    label: 'Value Added Charges',
    route: '/settings/value-added-charges',
    icon: PlusCircle,
    pageKey: 'settings.value_added_charges',
  },
  { label: 'Tax', route: '/settings/tax', icon: Percent, pageKey: 'settings.tax' },
  {
    label: 'Invoice Settings',
    route: '/settings/invoice-settings',
    icon: FileText,
    pageKey: 'settings.invoice_settings',
  },
  { label: 'Staff', route: '/settings/staff', icon: Users, pageKey: 'settings.staff' },
];

export default function SettingsMenuScreen() {
  const router = useRouter();
  const { currentStaff, hasAccess } = useStaff();

  const isManager = currentStaff?.role === 'admin' || currentStaff?.role === 'manager';
  const visibleItems = SETTINGS_ITEMS.filter((item) => hasAccess(item.pageKey));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.lg }}>
      {/* <StaffLogoutButton /> */}

      {!isManager && (
        <Text style={styles.readOnlyNote}>
          You only see the settings pages you've been given access to. Contact an admin or manager for more.
        </Text>
      )}

      <View style={styles.grid}>
        {visibleItems.map((item) => {
          const Icon = item.icon;
          return (
            <Pressable
              key={item.route}
              onPress={() => router.push(item.route as never)}
              style={({ pressed }) => [styles.gridItem, pressed && styles.gridItemPressed]}
            >
              <Card style={styles.gridCard}>
                <View style={styles.iconBadge}>
                  <Icon size={22} color={colors.gold ?? colors.textPrimary} strokeWidth={1.8} />
                </View>
                <View style={styles.gridCardFooter}>
                  <Text style={styles.rowLabel} numberOfLines={2}>
                    {item.label}
                  </Text>
                  <ChevronRight size={16} color={colors.textMuted} />
                </View>
              </Card>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  readOnlyNote: {
    fontSize: 12.5,
    color: colors.textSecondary,
    backgroundColor: colors.goldSurface,
    padding: spacing.md,
    borderRadius: 8,
    marginBottom: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  gridItem: {
    width: '48%',
    marginBottom: spacing.md,
  },
  gridItemPressed: {
    opacity: 0.6,
  },
  gridCard: {
    paddingVertical: 16,
    paddingHorizontal: spacing.md,
    minHeight: 100,
    justifyContent: 'space-between',
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.goldSurface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  gridCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: {
    fontSize: 13.5,
    color: colors.textPrimary,
    fontWeight: '600',
    flexShrink: 1,
    marginRight: spacing.xs,
  },
});