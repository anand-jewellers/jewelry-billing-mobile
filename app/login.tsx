import { useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  ActivityIndicator,
  useWindowDimensions,
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
import { ErrorModal } from '../src/components/ui/ErrorModal';
import { spacing } from '../src/theme';

export default function LoginScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 768;

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
      style={[styles.screen, isDesktop && styles.desktopScreen]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.container, isDesktop && styles.desktopContainer]}>
        {/* Top Royal Navy Hero Header */}
        <View style={[styles.hero, isDesktop && styles.desktopHero]}>
          {/* Settings Icon: ONLY visible on mobile */}
          {!isDesktop && (
            <View style={styles.topRightIcon}>
              <View style={styles.settingsCircle}>
                <Settings size={18} color="#CBD5E1" />
              </View>
            </View>
          )}

          <View style={[styles.logoOuterBorder, isDesktop && styles.desktopLogoOuterBorder]}>
            <View style={[styles.logoCard, isDesktop && styles.desktopLogoCard]}>
              {settings?.logo_url ? (
                <Image
                  source={{ uri: settings.logo_url }}
                  style={styles.logoImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.fallbackLogo}>
                  <Text style={[styles.fallbackLogoText, isDesktop && { fontSize: 17 }]}>MY</Text>
                  <Text style={styles.fallbackLogoSub}>Jewellerery</Text>
                </View>
              )}
            </View>
          </View>

          <Text style={[styles.companyName, isDesktop && { fontSize: 20 }]}>
            {settings?.company_name || 'My Jewellerery Billing'}
          </Text>
          <View style={[styles.taglineWrap, isDesktop && { marginTop: 2, marginBottom: 10, gap: 6 }]}>
            <View style={styles.taglineLine} />
            <Text style={styles.taglineText}>Trust in Every Ornament</Text>
            <View style={styles.taglineLine} />
          </View>

          <View style={[styles.pillarsRow, isDesktop && { gap: 24 }]}>
            <View style={styles.pillarItem}>
              <Diamond size={isDesktop ? 16 : 18} color="#FDE047" strokeWidth={1.8} />
              <Text style={styles.pillarLabel}>Quality</Text>
            </View>
            <View style={styles.pillarItem}>
              <ShieldCheck size={isDesktop ? 16 : 18} color="#FDE047" strokeWidth={1.8} />
              <Text style={styles.pillarLabel}>Purity</Text>
            </View>
            <View style={styles.pillarItem}>
              <Flower2 size={isDesktop ? 16 : 18} color="#FDE047" strokeWidth={1.8} />
              <Text style={styles.pillarLabel}>Trust</Text>
            </View>
          </View>
        </View>

        {/* Curved Golden Wave Transition */}
        <View style={styles.curveContainer}>
          <Svg
            width="100%"
            height={isDesktop ? 30 : 40}
            viewBox="0 0 400 60"
            preserveAspectRatio="none"
            style={styles.svgCurve}
          >
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
        <View style={[styles.bodyWrapper, isDesktop && styles.desktopBodyWrapper]}>
          <View style={[styles.loginCard, isDesktop && styles.desktopLoginCard]}>
            <Text style={[styles.cardHeading, isDesktop && { fontSize: 18 }]}>Welcome Back</Text>
            <Text style={styles.cardSubheading}>
              Sign in to continue to your billing system
            </Text>

            {/* Email Field */}
            <View style={[styles.inputFieldBox, isDesktop && styles.desktopInputFieldBox]}>
              <Mail size={isDesktop ? 16 : 18} color="#64748B" style={styles.inputIcon} />
              <TextInput
                style={[
                  styles.textInput,
                  Platform.OS === 'web' && ({ outlineStyle: 'none' } as any),
                ]}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="Email Address"
                placeholderTextColor="#94A3B8"
                onSubmitEditing={handleSubmit}
                returnKeyType="next"
              />
            </View>

            {/* Password Field */}
            <View style={[styles.inputFieldBox, isDesktop && styles.desktopInputFieldBox]}>
              <Lock size={isDesktop ? 16 : 18} color="#64748B" style={styles.inputIcon} />
              <TextInput
                style={[
                  styles.textInput,
                  Platform.OS === 'web' && ({ outlineStyle: 'none' } as any),
                ]}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder="Password"
                placeholderTextColor="#94A3B8"
                onSubmitEditing={handleSubmit}
                returnKeyType="go"
              />
              <Pressable
                onPress={() => setShowPassword((prev) => !prev)}
                style={[styles.eyeBtn, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
                hitSlop={10}
              >
                {showPassword ? (
                  <EyeOff size={16} color="#64748B" />
                ) : (
                  <Eye size={16} color="#64748B" />
                )}
              </Pressable>
            </View>

            {/* Sign In Button */}
            <Pressable
              style={({ pressed }) => [
                styles.signInBtn,
                isDesktop && styles.desktopSignInBtn,
                Platform.OS === 'web' && ({ cursor: submitting ? 'not-allowed' : 'pointer' } as any),
                pressed && { opacity: 0.9 },
              ]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <View style={styles.btnRow}>
                  <Text style={styles.signInBtnText}>Sign In</Text>
                  <ArrowRight size={isDesktop ? 16 : 18} color="#FFFFFF" strokeWidth={2.4} />
                </View>
              )}
            </Pressable>

            <View style={[styles.secureBadgeRow, isDesktop && { marginTop: 4 }]}>
              <View style={styles.secureLine} />
              <View style={styles.secureContent}>
                <ShieldCheck size={isDesktop ? 13 : 14} color="#D97706" />
                <Text style={styles.secureText}>Secure Access</Text>
              </View>
              <View style={styles.secureLine} />
            </View>
          </View>

          {/* Bottom Brand Quote */}
          <View style={[styles.bottomBrandSection, isDesktop && styles.desktopBottomBrandSection]}>
            <Text style={styles.quoteLine1}>More Than Jewellery</Text>
            <Text style={styles.quoteLine2}>A Part of Your Story</Text>
            <View style={styles.goldSeparator} />
            <Text style={styles.poweredBy}>Powered by Bizfonal Infotech</Text>
          </View>
        </View>
      </View>

      {/* Error Modal */}
      <ErrorModal
        visible={!!error}
        title="Sign In Failed"
        message={error}
        onClose={() => setError(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FDFBF7',
  },
  desktopScreen: {
    backgroundColor: '#EEF2F6',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  container: {
    flex: 1,
    width: '100%',
  },
  desktopContainer: {
    flex: undefined,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#FDFBF7',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#0B2347',
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 22,
    elevation: 8,
  },
  hero: {
    backgroundColor: '#0B2347',
    alignItems: 'center',
    paddingTop: 44,
    paddingBottom: 18,
    paddingHorizontal: spacing.lg,
    position: 'relative',
  },
  desktopHero: {
    paddingTop: 24,
    paddingBottom: 12,
  },
  topRightIcon: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 10,
  },
  settingsCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoOuterBorder: {
    width: 76,
    height: 76,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: 'rgba(253, 224, 71, 0.35)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  desktopLogoOuterBorder: {
    width: 62,
    height: 62,
    borderRadius: 18,
    marginBottom: 8,
  },
  logoCard: {
    width: 66,
    height: 66,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  desktopLogoCard: {
    width: 54,
    height: 54,
    borderRadius: 14,
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
    fontSize: 20,
    fontWeight: '800',
    color: '#0B2347',
  },
  fallbackLogoSub: {
    fontSize: 9,
    fontWeight: '600',
    color: '#B45309',
    marginTop: -2,
  },
  companyName: {
    fontSize: 23,
    fontWeight: '700',
    color: '#FDE047',
    textAlign: 'center',
    letterSpacing: 0.3,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  taglineWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    marginBottom: 14,
  },
  taglineLine: {
    width: 22,
    height: 1,
    backgroundColor: 'rgba(253, 224, 71, 0.4)',
  },
  taglineText: {
    fontSize: 12,
    color: '#F1F5F9',
    letterSpacing: 0.4,
    fontWeight: '400',
  },
  pillarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
  },
  pillarItem: {
    alignItems: 'center',
    gap: 3,
  },
  pillarLabel: {
    fontSize: 11.5,
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
    marginTop: 20,
  },
  desktopBodyWrapper: {
    flex: undefined,
    paddingHorizontal: 22,
    marginTop: 54, // Clean separation below the gold curve
    paddingBottom: 20,
  },
  loginCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 20,
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 4,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.8)',
    gap: 12,
  },
  desktopLoginCard: {
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginTop: 4,
    gap: 10,
  },
  cardHeading: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0B2347',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  cardSubheading: {
    fontSize: 12.5,
    color: '#64748B',
    textAlign: 'center',
    marginTop: -4,
    marginBottom: 6,
  },
  inputFieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 50,
  },
  desktopInputFieldBox: {
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
  },
  inputIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    paddingVertical: 0,
    height: '100%',
  },
  eyeBtn: {
    padding: 4,
  },
  signInBtn: {
    backgroundColor: '#0F3E78',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  desktopSignInBtn: {
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 4,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signInBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secureBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
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
    fontSize: 11,
    fontWeight: '600',
    color: '#92400E',
  },
  bottomBrandSection: {
    alignItems: 'center',
    marginTop: 60,
    paddingBottom: 8,
  },
  desktopBottomBrandSection: {
    marginTop: 20,
    paddingBottom: 4,
  },
  quoteLine1: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#B45309',
    fontStyle: 'italic',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  quoteLine2: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#92400E',
    fontStyle: 'italic',
    marginTop: 1,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  },
  goldSeparator: {
    width: 56,
    height: 1.5,
    backgroundColor: '#F59E0B',
    marginTop: 6,
    marginBottom: 10,
    borderRadius: 1,
    opacity: 0.6,
  },
  poweredBy: {
    fontSize: 11,
    color: '#94A3B8',
    letterSpacing: 0.3,
  },
});