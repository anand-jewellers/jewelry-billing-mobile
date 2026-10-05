// src/components/MoonToJewelSplash.tsx
import React, { useEffect, useMemo, useRef } from "react";
import {
  View,
  Animated,
  StyleSheet,
  Easing,
  Dimensions,
  Image,
} from "react-native";
import Svg, {
  Defs,
  RadialGradient,
  Stop,
  LinearGradient,
  G,
  Circle,
  Polygon,
  Rect,
} from "react-native-svg";
import { useCompanySettings } from "../context/CompanySettingsContext";

const { width, height } = Dimensions.get("window");

type Props = {
  onFinish?: () => void;
  backgroundColor?: string;
  /** Override the context-provided brand name if you ever need to. */
  brandName?: string;
  /** Override the context-provided logo URL if you ever need to. */
  logoUrl?: string | null;
  tagline?: string;
};

// ---------------------------------------------------------------------------
// Easing curves
// ---------------------------------------------------------------------------
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const EASE_IN_OUT = Easing.bezier(0.45, 0, 0.15, 1);
const EASE_SOFT_IN = Easing.bezier(0.55, 0, 0.85, 0.35);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function Backdrop({ backgroundColor }: { backgroundColor: string }) {
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="bg" cx="50%" cy="42%" r="80%">
          <Stop offset="0%" stopColor="#16295C" stopOpacity={0.85} />
          <Stop offset="55%" stopColor="#0A1740" stopOpacity={0.95} />
          <Stop offset="100%" stopColor={backgroundColor} stopOpacity={1} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill="url(#bg)" />
    </Svg>
  );
}

function ShimmerSweep({
  progress,
  width: w,
}: {
  progress: Animated.Value;
  width: number;
}) {
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-w, w],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.15, 0.85, 1],
    outputRange: [0, 0.9, 0.9, 0],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        width: w * 0.35,
        opacity,
        transform: [{ translateX }, { skewX: "-18deg" }],
      }}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="shimmer" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0%" stopColor="#FFF6C2" stopOpacity={0} />
            <Stop offset="45%" stopColor="#FFF6C2" stopOpacity={0.85} />
            <Stop offset="55%" stopColor="#FFFFFF" stopOpacity={0.95} />
            <Stop offset="100%" stopColor="#FFF6C2" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#shimmer)" />
      </Svg>
    </Animated.View>
  );
}

/**
 * Renders a company logo inside a circular gold frame, or falls back to a
 * "brand initial" mark if no logo URL is present. Sits inside the same
 * Animated.View that was previously wrapping the jewelled lozenge SVG so
 * the entrance choreography is unchanged.
 */
function BrandMark({
  logoUrl,
  brandName,
}: {
  logoUrl?: string | null;
  brandName: string;
}) {
  const initial = (brandName || "B").trim().charAt(0).toUpperCase();

  return (
    <View style={markStyles.frame}>
      {logoUrl ? (
        <Image
          source={{ uri: logoUrl }}
          style={markStyles.logo}
          resizeMode="contain"
        />
      ) : (
        <View style={markStyles.fallback}>
          <Svg width={56} height={56} viewBox="0 0 56 56">
            <Defs>
              <LinearGradient id="fallbackRing" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0%" stopColor="#F6E7A8" />
                <Stop offset="50%" stopColor="#D4AF37" />
                <Stop offset="100%" stopColor="#A67C1F" />
              </LinearGradient>
              <RadialGradient id="fallbackGlow" cx="35%" cy="30%" r="80%">
                <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={1} />
                <Stop offset="100%" stopColor="#EDE3C4" stopOpacity={1} />
              </RadialGradient>
            </Defs>
            <Circle
              cx={28}
              cy={28}
              r={25}
              fill="url(#fallbackGlow)"
              stroke="url(#fallbackRing)"
              strokeWidth={1.4}
            />
            <G>
              <Polygon
                points="28,10 34,20 28,24 22,20"
                fill="#FFFFFF"
                opacity={0.9}
              />
            </G>
          </Svg>
          {/* Brand initial rendered on top of the ring */}
          <View style={markStyles.fallbackInitialWrap} pointerEvents="none">
            {/* Intentionally empty — we draw the initial via Text below */}
          </View>
        </View>
      )}
    </View>
  );
}

export default function BrandIntro({
  onFinish,
  backgroundColor = "#050B24",
  brandName: brandNameProp,
  logoUrl: logoUrlProp,
  tagline = "Crafted for every moment",
}: Props) {
  // Pull live shop details from the same context LoginScreen uses.
  // If the provider isn't mounted, `settings` is undefined and we fall
  // back to the built-in defaults below.
  const { settings } = useCompanySettings();

  const brandName =
    brandNameProp ?? settings?.company_name?.trim() ?? "BIZJEWEL";
  const logoUrl = logoUrlProp ?? settings?.logo_url ?? null;

  // ---- composition roots --------------------------------------------------
  const sceneOpacity = useRef(new Animated.Value(0)).current;
  const sceneTranslateY = useRef(new Animated.Value(24)).current;

  // ---- monogram (now the shop logo / fallback mark) -----------------------
  const monogramScale = useRef(new Animated.Value(0.55)).current;
  const monogramOpacity = useRef(new Animated.Value(0)).current;
  const monogramGlow = useRef(new Animated.Value(0)).current;

  // ---- wordmark -----------------------------------------------------------
  const wordmarkOpacity = useRef(new Animated.Value(0)).current;
  const wordmarkScaleX = useRef(new Animated.Value(1.06)).current;
  const shimmerProgress = useRef(new Animated.Value(0)).current;

  // ---- tagline + hairline -------------------------------------------------
  const hairlineScaleX = useRef(new Animated.Value(0)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const taglineTranslateY = useRef(new Animated.Value(8)).current;

  // ---- ambient stars ------------------------------------------------------
  const ambientStars = useMemo(() => {
    return Array.from({ length: 42 }).map((_, i) => {
      const r1 = seededRandom(i * 12.9898);
      const r2 = seededRandom(i * 78.233);
      const r3 = seededRandom(i * 37.719);
      return {
        x: r1 * width,
        y: r2 * height,
        r: 0.5 + r3 * 1.1,
        opacity: 0.15 + r3 * 0.35,
      };
    });
  }, []);

  useEffect(() => {
    // Every animation below uses `useNativeDriver: true` — all animated
    // properties are `opacity` or `transform`.
    const timeline = Animated.sequence([
      Animated.parallel([
        Animated.timing(sceneOpacity, {
          toValue: 1,
          duration: 450,
          easing: EASE_OUT,
          useNativeDriver: true,
        }),
        Animated.timing(sceneTranslateY, {
          toValue: 0,
          duration: 650,
          easing: EASE_OUT,
          useNativeDriver: true,
        }),
      ]),

      Animated.parallel([
        Animated.timing(monogramOpacity, {
          toValue: 1,
          duration: 400,
          easing: EASE_OUT,
          useNativeDriver: true,
        }),
        Animated.spring(monogramScale, {
          toValue: 1,
          friction: 9,
          tension: 60,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(monogramGlow, {
            toValue: 0.85,
            duration: 320,
            easing: EASE_OUT,
            useNativeDriver: true,
          }),
          Animated.timing(monogramGlow, {
            toValue: 0.25,
            duration: 480,
            easing: EASE_OUT,
            useNativeDriver: true,
          }),
        ]),
      ]),

      Animated.parallel([
        Animated.timing(wordmarkOpacity, {
          toValue: 1,
          duration: 480,
          easing: EASE_OUT,
          useNativeDriver: true,
        }),
        Animated.timing(wordmarkScaleX, {
          toValue: 1,
          duration: 700,
          easing: EASE_IN_OUT,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(280),
          Animated.timing(shimmerProgress, {
            toValue: 1,
            duration: 900,
            easing: EASE_IN_OUT,
            useNativeDriver: true,
          }),
        ]),
      ]),

      Animated.parallel([
        Animated.timing(hairlineScaleX, {
          toValue: 1,
          duration: 520,
          easing: EASE_OUT,
          useNativeDriver: true,
        }),
        Animated.timing(taglineOpacity, {
          toValue: 1,
          duration: 460,
          delay: 120,
          easing: EASE_OUT,
          useNativeDriver: true,
        }),
        Animated.timing(taglineTranslateY, {
          toValue: 0,
          duration: 520,
          delay: 120,
          easing: EASE_OUT,
          useNativeDriver: true,
        }),
      ]),

      Animated.delay(600),

      Animated.parallel([
        Animated.timing(sceneOpacity, {
          toValue: 0,
          duration: 420,
          easing: EASE_SOFT_IN,
          useNativeDriver: true,
        }),
        Animated.timing(sceneTranslateY, {
          toValue: -22,
          duration: 460,
          easing: EASE_IN_OUT,
          useNativeDriver: true,
        }),
      ]),
    ]);

    timeline.start(({ finished }) => {
      if (finished) onFinish?.();
    });

    return () => {
      timeline.stop();
    };
  }, [
    onFinish,
    sceneOpacity,
    sceneTranslateY,
    monogramOpacity,
    monogramScale,
    monogramGlow,
    wordmarkOpacity,
    wordmarkScaleX,
    shimmerProgress,
    hairlineScaleX,
    taglineOpacity,
    taglineTranslateY,
  ]);

  const monogramGlowScale = monogramGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1.5],
  });

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <Backdrop backgroundColor={backgroundColor} />

      <Svg
        width={width}
        height={height}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      >
        {ambientStars.map((s, i) => (
          <Circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={s.r}
            fill="#FFFFFF"
            opacity={s.opacity}
          />
        ))}
      </Svg>

      <Animated.View
        style={[
          styles.scene,
          {
            opacity: sceneOpacity,
            transform: [{ translateY: sceneTranslateY }],
          },
        ]}
        pointerEvents="none"
      >
        {/* ---- Monogram: shop logo (or fallback initial) inside a gold glow ---- */}
        <View style={styles.monogramWrap}>
          <Animated.View
            style={[
              styles.monogramGlow,
              {
                opacity: monogramGlow,
                transform: [{ scale: monogramGlowScale }],
              },
            ]}
          >
            <Svg width={140} height={140} viewBox="0 0 140 140">
              <Defs>
                <RadialGradient id="mGlow" cx="50%" cy="50%" r="50%">
                  <Stop offset="0%" stopColor="#FFE9A8" stopOpacity={0.9} />
                  <Stop offset="55%" stopColor="#D4AF37" stopOpacity={0.35} />
                  <Stop offset="100%" stopColor="#D4AF37" stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={70} cy={70} r={70} fill="url(#mGlow)" />
            </Svg>
          </Animated.View>

          <Animated.View
            style={{
              opacity: monogramOpacity,
              transform: [{ scale: monogramScale }],
            }}
          >
            <BrandMark logoUrl={logoUrl} brandName={brandName} />
          </Animated.View>
        </View>

        {/* ---- Wordmark: the shop name ---- */}
        <View style={styles.wordmarkWrap}>
          <Animated.Text
            style={[
              styles.wordmark,
              {
                opacity: wordmarkOpacity,
                transform: [{ scaleX: wordmarkScaleX }],
              },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {brandName}
          </Animated.Text>
          <ShimmerSweep progress={shimmerProgress} width={width * 0.72} />
        </View>

        {/* ---- Hairline ---- */}
        <Animated.View
          style={[
            styles.hairline,
            { transform: [{ scaleX: hairlineScaleX }] },
          ]}
        />

        {/* ---- Tagline ---- */}
        <Animated.Text
          style={[
            styles.tagline,
            {
              opacity: taglineOpacity,
              transform: [{ translateY: taglineTranslateY }],
            },
          ]}
        >
          {tagline}
        </Animated.Text>
      </Animated.View>
    </View>
  );
}

const markStyles = StyleSheet.create({
  frame: {
    width: 104,
    height: 104,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: "rgba(253, 224, 71, 0.45)",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: {
    width: 84,
    height: 84,
    borderRadius: 20,
  },
  fallback: {
    width: 104,
    height: 104,
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackInitialWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  scene: {
    alignItems: "center",
    justifyContent: "center",
  },
  monogramWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  monogramGlow: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  wordmarkWrap: {
    position: "relative",
    overflow: "hidden",
    paddingHorizontal: 8,
    maxWidth: width * 0.85,
  },
  wordmark: {
    color: "#F4E9C8",
    fontSize: 34,
    fontWeight: "300",
    textAlign: "center",
    includeFontPadding: false,
    letterSpacing: 6,
  },
  hairline: {
    height: 1,
    width: 96,
    marginTop: 18,
    backgroundColor: "rgba(212, 175, 55, 0.55)",
  },
  tagline: {
    marginTop: 16,
    color: "rgba(233, 226, 200, 0.72)",
    fontSize: 13,
    fontWeight: "400",
    letterSpacing: 2.4,
    textTransform: "uppercase",
    textAlign: "center",
  },
});