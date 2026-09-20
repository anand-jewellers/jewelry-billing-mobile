import { useState, useMemo } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  Platform,
} from 'react-native';
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
  Search,
  X,
  Settings,
  Tag,
  Cog,
  FileSpreadsheet,
  Boxes,
  type LucideIcon,
} from 'lucide-react-native';
import { useStaff } from '../../../src/context/StaffContext';
import { colors, spacing } from '../../../src/theme';
import type { PageKey } from '../../../src/types/settings';

interface SettingItem {
  label: string;
  sublabel: string;
  route: string;
  icon: LucideIcon;
  watermarkIcon: LucideIcon;
  pageKey: PageKey;
  theme: {
    bg: string;
    iconColor: string;
    watermarkColor: string;
  };
}

const SETTINGS_ITEMS: SettingItem[] = [
  {
    label: 'Company',
    sublabel: 'Manage shop details, address, logo, etc.',
    route: '/settings/company',
    icon: Building2,
    watermarkIcon: Building2,
    pageKey: 'settings.company',
    theme: {
      bg: '#FEF3C7',
      iconColor: '#D97706',
      watermarkColor: 'rgba(217, 119, 6, 0.08)',
    },
  },
  {
    label: 'Metals',
    sublabel: 'Manage gold, silver and other metals.',
    route: '/settings/metals',
    icon: Gem,
    watermarkIcon: Boxes,
    pageKey: 'settings.metals',
    theme: {
      bg: '#FEF3C7',
      iconColor: '#D97706',
      watermarkColor: 'rgba(217, 119, 6, 0.08)',
    },
  },
  {
    label: 'Purity',
    sublabel: 'Manage purity levels (18K, 20K, 22K, 24K, etc.)',
    route: '/settings/purity',
    icon: Sparkles,
    watermarkIcon: Sparkles,
    pageKey: 'settings.purity',
    theme: {
      bg: '#F3E8FF',
      iconColor: '#9333EA',
      watermarkColor: 'rgba(147, 51, 234, 0.08)',
    },
  },
  {
    label: 'Categories',
    sublabel: 'Manage product categories.',
    route: '/settings/categories',
    icon: LayoutGrid,
    watermarkIcon: Tag,
    pageKey: 'settings.categories',
    theme: {
      bg: '#DCFCE7',
      iconColor: '#16A34A',
      watermarkColor: 'rgba(22, 163, 74, 0.08)',
    },
  },
  {
    label: 'Gold Rates',
    sublabel: 'Update daily gold and silver rates.',
    route: '/settings/gold-rates',
    icon: TrendingUp,
    watermarkIcon: TrendingUp,
    pageKey: 'settings.gold_rates',
    theme: {
      bg: '#DBEAFE',
      iconColor: '#2563EB',
      watermarkColor: 'rgba(37, 99, 235, 0.08)',
    },
  },
  {
    label: 'Making Charges',
    sublabel: 'Set making charges for products.',
    route: '/settings/making-charges',
    icon: Hammer,
    watermarkIcon: Cog,
    pageKey: 'settings.making_charges',
    theme: {
      bg: '#FFEDD5',
      iconColor: '#EA580C',
      watermarkColor: 'rgba(234, 88, 12, 0.08)',
    },
  },
  {
    label: 'Value Added Charges',
    sublabel: 'Manage additional charges (wastage, etc.)',
    route: '/settings/value-added-charges',
    icon: PlusCircle,
    watermarkIcon: FileSpreadsheet,
    pageKey: 'settings.value_added_charges',
    theme: {
      bg: '#FFE4E6',
      iconColor: '#E11D48',
      watermarkColor: 'rgba(225, 29, 72, 0.08)',
    },
  },
  {
    label: 'Tax',
    sublabel: 'Configure GST and other taxes.',
    route: '/settings/tax',
    icon: Percent,
    watermarkIcon: FileText,
    pageKey: 'settings.tax',
    theme: {
      bg: '#D1FAE5',
      iconColor: '#059669',
      watermarkColor: 'rgba(5, 150, 105, 0.08)',
    },
  },
  {
    label: 'Invoice Settings',
    sublabel: 'Configure invoice format and preferences.',
    route: '/settings/invoice-settings',
    icon: FileText,
    watermarkIcon: FileText,
    pageKey: 'settings.invoice_settings',
    theme: {
      bg: '#EDE9FE',
      iconColor: '#7C3AED',
      watermarkColor: 'rgba(124, 58, 237, 0.08)',
    },
  },
  {
    label: 'Staff',
    sublabel: 'Manage staff and user access.',
    route: '/settings/staff',
    icon: Users,
    watermarkIcon: Users,
    pageKey: 'settings.staff',
    theme: {
      bg: '#E0F2FE',
      iconColor: '#0284C7',
      watermarkColor: 'rgba(2, 132, 199, 0.08)',
    },
  },
];

export default function SettingsMenuScreen() {
  const router = useRouter();
  const { currentStaff, hasAccess } = useStaff();
  const [searchText, setSearchText] = useState('');

  const isManager = currentStaff?.role === 'admin' || currentStaff?.role === 'manager';

  const visibleItems = useMemo(() => {
    return SETTINGS_ITEMS.filter((item) => hasAccess(item.pageKey));
  }, [hasAccess]);

  const filteredItems = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return visibleItems;
    return visibleItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.sublabel.toLowerCase().includes(q)
    );
  }, [visibleItems, searchText]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Header Section: Title & Subtitle + Jewelry Rings Illustration */}
      <View style={styles.headerSection}>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Master Settings</Text>
          <Text style={styles.headerSubtitle}>
            Manage your business settings in one place
          </Text>
        </View>

        <View style={styles.quoteGraphicContainer}>
          <View style={styles.ringGraphic}>
            <View style={styles.ringBandFront} />
            <View style={styles.ringBandBack} />
            <Sparkles size={11} color="#EAB308" style={styles.sparkleOne} />
            <Sparkles size={8} color="#FACC15" style={styles.sparkleTwo} />
          </View>

          <View style={styles.quoteTextWrap}>
            <Text style={styles.quoteLine1}>Settings</Text>
            <Text style={styles.quoteLine2}>for a</Text>
            <Text style={styles.quoteLine3}>Brighter</Text>
            <Text style={styles.quoteLine3}>Business</Text>
            <View style={styles.goldSeparator}>
              <View style={styles.goldLine} />
              <View style={styles.goldGemDot} />
              <View style={styles.goldLine} />
            </View>
          </View>
        </View>
      </View>

      {/* Search Bar */}
      <View style={styles.searchBar}>
        <Search size={18} color="#94A3B8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search settings (e.g. metal, tax, company...)"
          placeholderTextColor="#94A3B8"
          value={searchText}
          onChangeText={setSearchText}
        />
        {searchText.length > 0 && (
          <Pressable onPress={() => setSearchText('')} hitSlop={8}>
            <X size={16} color="#94A3B8" />
          </Pressable>
        )}
      </View>

      {!isManager && (
        <Text style={styles.readOnlyNote}>
          You only see the settings pages you've been given access to. Contact an admin or manager for more.
        </Text>
      )}

      {/* Settings Grid */}
      <View style={styles.grid}>
        {filteredItems.map((item) => {
          const Icon = item.icon;
          const WatermarkIcon = item.watermarkIcon;

          return (
            <Pressable
              key={item.route}
              onPress={() => router.push(item.route as never)}
              style={({ pressed }) => [styles.gridItem, pressed && styles.gridItemPressed]}
            >
              <View style={styles.card}>
                {/* Watermark in top-right */}
                <View style={styles.watermarkWrapper}>
                  <WatermarkIcon
                    size={52}
                    color={item.theme.watermarkColor}
                    strokeWidth={1.5}
                  />
                </View>

                {/* Top Row: Icon Badge + Chevron */}
                <View style={styles.cardTopRow}>
                  <View style={[styles.iconBadge, { backgroundColor: item.theme.bg }]}>
                    <Icon size={20} color={item.theme.iconColor} strokeWidth={2} />
                  </View>
                  <ChevronRight size={18} color={item.theme.iconColor} style={styles.chevron} />
                </View>

                {/* Text Content */}
                <View style={styles.cardContent}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Text style={styles.cardSublabel} numberOfLines={2}>
                    {item.sublabel}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* "More Settings" Bottom Banner */}
      {/* <Pressable
        style={({ pressed }) => [styles.moreCard, pressed && styles.gridItemPressed]}
        onPress={() => {}}
      >
        <View style={styles.moreIconBadge}>
          <Settings size={22} color="#FFFFFF" strokeWidth={2} />
        </View>
        <View style={styles.moreTextContainer}>
          <Text style={styles.moreTitle}>More Settings</Text>
          <Text style={styles.moreSublabel}>Explore advanced settings and preferences.</Text>
        </View>
        <ChevronRight size={20} color="#B45309" />
      </Pressable> */}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl * 1.5,
  },
  headerSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  headerTitleContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '400',
  },
  quoteGraphicContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 10,
  },
  ringGraphic: {
    width: 44,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  ringBandFront: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 3,
    borderColor: '#EAB308',
    backgroundColor: 'transparent',
    position: 'absolute',
    left: 2,
    top: 6,
    zIndex: 2,
  },
  ringBandBack: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 3,
    borderColor: '#FACC15',
    backgroundColor: 'transparent',
    position: 'absolute',
    right: 3,
    top: 4,
    zIndex: 1,
  },
  sparkleOne: {
    position: 'absolute',
    top: 0,
    right: -2,
    zIndex: 3,
  },
  sparkleTwo: {
    position: 'absolute',
    bottom: 2,
    left: -2,
    zIndex: 3,
  },
  quoteTextWrap: {
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  quoteLine1: {
    fontSize: 11,
    fontWeight: '600',
    color: '#92400E',
    fontStyle: 'italic',
    lineHeight: 13,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  quoteLine2: {
    fontSize: 10,
    fontWeight: '500',
    color: '#92400E',
    fontStyle: 'italic',
    lineHeight: 12,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  quoteLine3: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
    fontStyle: 'italic',
    lineHeight: 14,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  goldSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 3,
    width: '100%',
  },
  goldLine: {
    height: 1,
    flex: 1,
    backgroundColor: '#F59E0B',
    opacity: 0.6,
  },
  goldGemDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#D97706',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 48,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 13.5,
    color: '#0F172A',
    padding: 0,
  },
  readOnlyNote: {
    fontSize: 12.5,
    color: colors.textSecondary,
    backgroundColor: '#FEF3C7',
    padding: spacing.md,
    borderRadius: 12,
    marginBottom: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  gridItem: {
    width: '48%',
  },
  gridItemPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.985 }],
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    padding: 14,
    minHeight: 124,
    position: 'relative',
    overflow: 'hidden',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 1,
  },
  watermarkWrapper: {
    position: 'absolute',
    top: 6,
    right: 6,
    opacity: 0.7,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    marginTop: 4,
  },
  cardContent: {
    marginTop: 10,
  },
  cardTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  cardSublabel: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 3,
    lineHeight: 15,
  },
  moreCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 14,
    marginTop: 14,
    shadowColor: '#B45309',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 1,
  },
  moreIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#B45309',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreTextContainer: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  moreTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#78350F',
  },
  moreSublabel: {
    fontSize: 11.5,
    color: '#92400E',
    marginTop: 2,
  },
});