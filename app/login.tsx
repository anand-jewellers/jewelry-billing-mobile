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
  TextInput,
  ActivityIndicator,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  Diamond,
  Flower2,
  Settings,
} from 'lucide-react-native';
import { useStaff } from '../src/context/StaffContext';
import { useCompanySettings } from '../src/context/CompanySettingsContext';
import { colors, spacing } from '../src/theme';

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
      setError('Please enter both email and password.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const res = await loginStaff(email.trim(), password);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not sign in. Check your email and password and try again.');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Top Royal Navy Hero Header */}
        <View style={styles.hero}>
          {/* Top Right Quick Settings Icon */}
          <View style={styles.topRightIcon}>
            <View style={styles.settingsCircle}>
              <Settings size={18} color="#CBD5E1" />
            </View>
          </View>

          {/* Logo Badge Container */}
          <View style={styles.logoOuterBorder}>
            <View style={styles.logoCard}>
              {settings?.logo_url ? (
                <Image
                  source={{ uri: settings.logo_url }}
                  style={styles.logoImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.fallbackLogo}>
                  <Text style={styles.fallbackLogoText}>AJ</Text>
                  <Text style={styles.fallbackLogoSub}>Jewellers</Text>
                </View>
              )}
            </View>
          </View>

          {/* Store Name & Tagline */}
          <Text style={styles.companyName}>
            {settings?.company_name || 'Anand Jewellers'}
          </Text>
          <View style={styles.taglineWrap}>
            <View style={styles.taglineLine} />
            <Text style={styles.taglineText}>Trust in Every Ornament</Text>
            <View style={styles.taglineLine} />
          </View>

          {/* Value Pillars: Quality, Purity, Trust */}
          <View style={styles.pillarsRow}>
            <View style={styles.pillarItem}>
              <Diamond size={20} color="#FDE047" strokeWidth={1.8} />
              <Text style={styles.pillarLabel}>Quality</Text>
            </View>
            <View style={styles.pillarItem}>
              <ShieldCheck size={20} color="#FDE047" strokeWidth={1.8} />
              <Text style={styles.pillarLabel}>Purity</Text>
            </View>
            <View style={styles.pillarItem}>
              <Flower2 size={20} color="#FDE047" strokeWidth={1.8} />
              <Text style={styles.pillarLabel}>Trust</Text>
            </View>
          </View>
        </View>

        {/* Curved Golden Wave Transition */}
        <View style={styles.curveContainer}>
          <Svg
            width="100%"
            height={60}
            viewBox="0 0 400 60"
            preserveAspectRatio="none"
            style={styles.svgCurve}
          >
            {/* Golden Ribbon Accent */}
            <Path
              d="M0,28 C140,65 260,10 400,48 L400,60 L0,60 Z"
              fill="#D97706"
              opacity={0.35}
            />
            <Path
              d="M0,32 C130,68 270,12 400,52 L400,60 L0,60 Z"
              fill="#FDE68A"
            />
            <Path
              d="M0,36 C120,70 280,16 400,56 L400,60 L0,60 Z"
              fill="#FDFBF7"
            />
          </Svg>
        </View>

        {/* Floating White Login Card */}
        <View style={styles.bodyWrapper}>
          <View style={styles.loginCard}>
            <Text style={styles.cardHeading}>Welcome Back</Text>
            <Text style={styles.cardSubheading}>
              Sign in to continue to your billing system
            </Text>

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Email Field */}
            <View style={styles.inputFieldBox}>
              <Mail size={18} color="#64748B" style={styles.inputIcon} />
              <View style={styles.inputContent}>
                <Text style={styles.inputLabel}>Email</Text>
                <TextInput
                  style={styles.textInput}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="you@yourshop.com"
                  placeholderTextColor="#94A3B8"
                />
              </View>
            </View>

            {/* Password Field */}
            <View style={[styles.inputFieldBox, { marginTop: 14 }]}>
              <Lock size={18} color="#64748B" style={styles.inputIcon} />
              <View style={styles.inputContent}>
                <Text style={styles.inputLabel}>Password</Text>
                <TextInput
                  style={styles.textInput}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  placeholder="••••••••"
                  placeholderTextColor="#94A3B8"
                />
              </View>
              <Pressable
                onPress={() => setShowPassword((prev) => !prev)}
                style={styles.eyeBtn}
                hitSlop={10}
              >
                {showPassword ? (
                  <EyeOff size={18} color="#64748B" />
                ) : (
                  <Eye size={18} color="#64748B" />
                )}
              </Pressable>
            </View>

            {/* Sign In Button */}
            <Pressable
              style={styles.signInBtn}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <View style={styles.btnRow}>
                  <Text style={styles.signInBtnText}>Sign In</Text>
                  <ArrowRight size={18} color="#FFFFFF" strokeWidth={2.4} />
                </View>
              )}
            </Pressable>

            {/* Secure Access Ribbon */}
            <View style={styles.secureBadgeRow}>
              <View style={styles.secureLine} />
              <View style={styles.secureContent}>
                <ShieldCheck size={14} color="#D97706" />
                <Text style={styles.secureText}>Secure Access</Text>
              </View>
              <View style={styles.secureLine} />
            </View>
          </View>

          {/* Bottom Brand Quote & Decorative Lotus */}
          <View style={styles.bottomBrandSection}>
            <View style={styles.watermarkLotus}>
              <Flower2 size={44} color="#FDE68A" opacity={0.6} />
            </View>

            <Text style={styles.quoteLine1}>More Than Jewellery</Text>
            <Text style={styles.quoteLine2}>A Part of Your Story</Text>

            <View style={styles.goldSeparator}>
              <View style={styles.quoteGoldLine} />
            </View>

            <Text style={styles.poweredBy}>Powered by Bizfonal Infotech</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FDFBF7',
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
  },
  hero: {
    backgroundColor: '#0B2347', // Royal Deep Navy
    alignItems: 'center',
    paddingTop: 56,
    paddingBottom: 28,
    paddingHorizontal: spacing.lg,
    position: 'relative',
  },
  topRightIcon: {
    position: 'absolute',
    top: 48,
    right: 20,
    zIndex: 10,
  },
  settingsCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoOuterBorder: {
    width: 88,
    height: 88,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: 'rgba(253, 224, 71, 0.35)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoCard: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  fallbackLogo: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackLogoText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0B2347',
  },
  fallbackLogoSub: {
    fontSize: 10,
    fontWeight: '600',
    color: '#B45309',
    marginTop: -2,
  },
  companyName: {
    fontSize: 27,
    fontWeight: '700',
    color: '#FDE047', // Warm Gold
    textAlign: 'center',
    letterSpacing: 0.3,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  taglineWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    marginBottom: 20,
  },
  taglineLine: {
    width: 24,
    height: 1,
    backgroundColor: 'rgba(253, 224, 71, 0.4)',
  },
  taglineText: {
    fontSize: 12.5,
    color: '#F1F5F9',
    letterSpacing: 0.4,
    fontWeight: '400',
  },
  pillarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 36,
  },
  pillarItem: {
    alignItems: 'center',
    gap: 4,
  },
  pillarLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#E2E8F0',
  },
  curveContainer: {
    marginTop: -1,
    backgroundColor: '#0B2347',
  },
  svgCurve: {
    display: 'flex',
  },
  bodyWrapper: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    marginTop: -24,
  },
  loginCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 4,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.8)',
  },
  cardHeading: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0B2347',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  cardSubheading: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 12.5,
    color: '#B91C1C',
    textAlign: 'center',
  },
  inputFieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  inputIcon: {
    marginRight: 10,
  },
  inputContent: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textInput: {
    fontSize: 14,
    color: '#0F172A',
    paddingVertical: 2,
    paddingHorizontal: 0,
    marginTop: 2,
  },
  eyeBtn: {
    padding: 6,
  },
  signInBtn: {
    backgroundColor: '#0F3E78', // Radiant Navy Blue Button
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
    shadowColor: '#0F3E78',
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 3,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signInBtnText: {
    fontSize: 15.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secureBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    gap: 10,
  },
  secureLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  secureContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  secureText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#92400E',
  },
  bottomBrandSection: {
    alignItems: 'center',
    marginTop: 28,
    paddingBottom: 16,
  },
  watermarkLotus: {
    marginBottom: 6,
  },
  quoteLine1: {
    fontSize: 14.5,
    fontWeight: '600',
    color: '#B45309',
    fontStyle: 'italic',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  quoteLine2: {
    fontSize: 15.5,
    fontWeight: '700',
    color: '#92400E',
    fontStyle: 'italic',
    marginTop: 1,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  goldSeparator: {
    width: 60,
    height: 1.5,
    backgroundColor: '#F59E0B',
    marginTop: 8,
    marginBottom: 16,
    borderRadius: 1,
    opacity: 0.6,
  },
  quoteGoldLine: {
    width: '100%',
    height: '100%',
  },
  poweredBy: {
    fontSize: 11.5,
    color: '#94A3B8',
    letterSpacing: 0.3,
  },
});