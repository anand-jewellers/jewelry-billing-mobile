import { useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
} from 'react-native';
import { Link } from 'expo-router';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import { Eye, EyeOff } from 'lucide-react-native';
import { useStaff } from '../src/context/StaffContext';
import { Button, Input } from '../src/components/ui';
import { useCompanySettings } from '../src/context/CompanySettingsContext';
import { colors, spacing } from '../src/theme';

// Height (in px) of the dome curve. Bigger = more pronounced arch.
const CURVE_HEIGHT = 56;
// Height used inside the SVG's own coordinate space (0-100 wide) — controls
// how "tall"/round the arch looks relative to its width. Bigger = rounder.
const CURVE_VIEWBOX_HEIGHT = 42;

export default function LoginScreen() {
  const { settings } = useCompanySettings();
  const { loginStaff } = useStaff();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      setError('Enter both email and password.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const res = await loginStaff(email.trim(), password);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not sign in. Check your email and password and try again.');
    }
    // On success, currentStaff updates in StaffContext and the root
    // RouteGuard redirects to "/" automatically.
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <View style={styles.hero}>
          <View style={styles.logoRing}>
            <View style={styles.logoBox}>
              {settings?.logo_url ? (
                <Image source={{ uri: settings.logo_url }} style={styles.logoImage} resizeMode="contain" />
              ) : (
                <Svg width={56} height={56} viewBox="0 0 34 34">
                  <Circle cx={17} cy={17} r={16} stroke={colors.gold} strokeWidth={1.4} fill={colors.primary} />
                  <Path d="M17 8.5 L23 14 L20.5 24.5 H13.5 L11 14 Z" stroke={colors.gold} strokeWidth={1.2} fill="none" />
                  <SvgText x={17} y={19.5} fontSize={7} fill={colors.gold} textAnchor="middle">
                    22K
                  </SvgText>
                </Svg>
              )}
            </View>
          </View>

          <Text style={styles.companyName} numberOfLines={2}>
            {settings?.company_name || 'Bizjewel Billing'}
          </Text>
          <Text style={styles.heroSubtitle}>Sign in to manage your billing</Text>
        </View>

        <View style={styles.sheetWrap}>
          <Svg
            width="100%"
            height={CURVE_HEIGHT}
            viewBox={`0 0 100 ${CURVE_VIEWBOX_HEIGHT}`}
            preserveAspectRatio="none"
            style={styles.sheetCurve}
          >
            <Path
              d={`M0,${CURVE_VIEWBOX_HEIGHT} A50,${CURVE_VIEWBOX_HEIGHT} 0 0 1 100,${CURVE_VIEWBOX_HEIGHT} Z`}
              fill={colors.background}
            />
          </Svg>

          <View style={styles.sheet}>
            <View>
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

              <View style={styles.passwordWrap}>
                <Input
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  placeholder="••••••••"
                />
                <Pressable
                  onPress={() => setShowPassword((prev) => !prev)}
                  style={styles.eyeButton}
                  hitSlop={10}
                >
                  {showPassword ? (
                    <EyeOff size={18} color={colors.textSecondary} />
                  ) : (
                    <Eye size={18} color={colors.textSecondary} />
                  )}
                </Pressable>
              </View>

              <View style={{ marginTop: spacing.md }}>
                <Button label={submitting ? 'Signing in…' : 'Sign in'} onPress={handleSubmit} loading={submitting} variant="primary" />
              </View>

              {/* <Link href="/forgot-password" style={styles.link}>
                Forgot your password?
              </Link> */}
            </View>

            <Text style={styles.poweredBy}>Powered by Bizfonal Infotech</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const LOGO_SIZE = 92;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.primary },
  scrollContent: { flexGrow: 1 },

  hero: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    paddingTop: 72,
    paddingBottom: 56,
    paddingHorizontal: spacing.xl,
  },
  logoRing: {
    width: LOGO_SIZE + 8,
    height: LOGO_SIZE + 8,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  logoBox: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  logoImage: { width: '100%', height: '100%' },
  companyName: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.surface,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  heroSubtitle: {
    fontSize: 13.5,
    color: colors.surface,
    marginTop: spacing.xs,
    textAlign: 'center',
  },

  sheetWrap: {
    flex: 1,
    marginTop: -CURVE_HEIGHT + spacing.xl,
  },
  sheetCurve: {},
  sheet: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    justifyContent: 'space-between',
  },
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
  passwordWrap: { position: 'relative', justifyContent: 'center' },
  eyeButton: {
    position: 'absolute',
    right: spacing.md,
    top: 34,
  },
  link: { fontSize: 12.5, color: colors.primaryLight, textAlign: 'center', marginTop: spacing.lg, fontWeight: '500' },
  poweredBy: {
    fontSize: 11.5,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
    letterSpacing: 0.2,
  },
});