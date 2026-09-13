import React, { useEffect, useMemo, useRef } from "react";
import { View, Animated, StyleSheet, Easing, Dimensions } from "react-native";
import Svg, { Path, Polygon, Circle, Defs, RadialGradient, Stop } from "react-native-svg";

const { width, height } = Dimensions.get("window");

type Props = {
  onFinish?: () => void;
  size?: number;
  backgroundColor?: string;
};

const RAY_COUNT = 14;
const PARTICLE_COUNT = 16;

function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export default function MoonToJewelSplash({
  onFinish,
  size = 140,
  backgroundColor = "#050B24",
}: Props) {
  const moonOpacity = useRef(new Animated.Value(0)).current;
  const moonScale = useRef(new Animated.Value(0.7)).current;

  const starOpacity = useRef(new Animated.Value(0)).current;
  const starScale = useRef(new Animated.Value(0.2)).current;
  const starTranslateY = useRef(new Animated.Value(10)).current;
  const starTranslateX = useRef(new Animated.Value(-6)).current;
  const starRotate = useRef(new Animated.Value(0)).current;

  const jewelOpacity = useRef(new Animated.Value(0)).current;
  const jewelScale = useRef(new Animated.Value(0.4)).current;

  const glowOpacity = useRef(new Animated.Value(0)).current;
  const glowScale = useRef(new Animated.Value(0.8)).current;

  const burstProgress = useRef(new Animated.Value(0)).current;

  const stars = useMemo(() => {
    return Array.from({ length: 55 }).map((_, i) => {
      const r1 = seededRandom(i * 12.9898);
      const r2 = seededRandom(i * 78.233);
      const r3 = seededRandom(i * 37.719);
      return {
        x: r1 * width,
        y: r2 * height,
        r: 0.6 + r3 * 1.6,
        opacity: 0.25 + r3 * 0.55,
      };
    });
  }, []);

  // Precompute unit vectors for rays and particles once
  const rays = useMemo(() => {
    return Array.from({ length: RAY_COUNT }, (_, i) => {
      const angle = (360 / RAY_COUNT) * i;
      const rad = (angle * Math.PI) / 180;
      return { angle, ux: Math.cos(rad), uy: Math.sin(rad) };
    });
  }, []);

  const particles = useMemo(() => {
    return Array.from({ length: PARTICLE_COUNT }).map((_, i) => {
      const angle = (360 / PARTICLE_COUNT) * i + seededRandom(i) * 20;
      const distance = 70 + seededRandom(i * 5.5) * 60;
      const rad = (angle * Math.PI) / 180;
      return {
        dx: Math.cos(rad) * distance,
        dy: Math.sin(rad) * distance,
        size: 2 + seededRandom(i * 3.1) * 3,
      };
    });
  }, []);

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(moonOpacity, {
          toValue: 1,
          duration: 550,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(moonScale, {
          toValue: 1,
          friction: 6,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(150),

      Animated.parallel([
        Animated.timing(starOpacity, {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
        }),
        Animated.spring(starScale, {
          toValue: 1,
          friction: 5,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(100),

      Animated.parallel([
        Animated.timing(starTranslateY, {
          toValue: -34,
          duration: 700,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(starTranslateX, {
          toValue: 0,
          duration: 700,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(starScale, {
          toValue: 1.5,
          duration: 700,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(starRotate, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(moonOpacity, {
          toValue: 0,
          duration: 500,
          delay: 150,
          useNativeDriver: true,
        }),
      ]),

      Animated.parallel([
        Animated.timing(starOpacity, {
          toValue: 0,
          duration: 350,
          useNativeDriver: true,
        }),
        Animated.timing(jewelOpacity, {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
        }),
        Animated.spring(jewelScale, {
          toValue: 1,
          friction: 4,
          tension: 60,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(glowOpacity, {
            toValue: 0.9,
            duration: 250,
            useNativeDriver: true,
          }),
          Animated.timing(glowOpacity, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(glowScale, {
          toValue: 1.8,
          duration: 750,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(burstProgress, {
          toValue: 1,
          duration: 750,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(350),
    ]).start(() => {
      onFinish && onFinish();
    });
  }, []);

  const starRotateDeg = starRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "160deg"],
  });

  const rayOpacity = burstProgress.interpolate({
    inputRange: [0, 0.15, 0.6, 1],
    outputRange: [0, 0.85, 0.4, 0],
  });

  const particleOpacity = burstProgress.interpolate({
    inputRange: [0, 0.1, 0.7, 1],
    outputRange: [0, 1, 0.6, 0],
  });

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="skyGlow" cx="50%" cy="35%" r="75%">
            <Stop offset="0%" stopColor="#132A5E" stopOpacity={0.6} />
            <Stop offset="100%" stopColor={backgroundColor} stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Circle cx={width / 2} cy={height * 0.35} r={Math.max(width, height)} fill="url(#skyGlow)" />
        {stars.map((s, i) => (
          <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#FFFFFF" opacity={s.opacity} />
        ))}
      </Svg>

      <Animated.View
        style={[
          styles.centered,
          { opacity: moonOpacity, transform: [{ scale: moonScale }] },
        ]}
      >
        <Svg width={size} height={size} viewBox="0 0 120 120">
          <Defs>
            <RadialGradient id="moonGlow" cx="40%" cy="35%" r="65%">
              <Stop offset="0%" stopColor="#FFFDF2" stopOpacity={1} />
              <Stop offset="100%" stopColor="#E8E2C8" stopOpacity={1} />
            </RadialGradient>
          </Defs>
          <Path
            d="M60,10
               A50,50 0 1,0 60,110
               A38,50 0 1,1 60,10 Z"
            fill="url(#moonGlow)"
          />
        </Svg>
      </Animated.View>

      <Animated.View
        style={[
          styles.centered,
          {
            opacity: starOpacity,
            transform: [
              { translateX: starTranslateX },
              { translateY: starTranslateY },
              { scale: starScale },
              { rotate: starRotateDeg },
            ],
          },
        ]}
      >
        <Svg width={size * 0.5} height={size * 0.5} viewBox="0 0 60 60">
          <Polygon
            points="30,2 37,22 58,22 41,35 47,56 30,43 13,56 19,35 2,22 23,22"
            fill="#FFFFFF"
            stroke="#F1F5FF"
            strokeWidth={1}
          />
        </Svg>
      </Animated.View>

      <Animated.View
        style={[
          styles.centered,
          { opacity: glowOpacity, transform: [{ scale: glowScale }] },
        ]}
      >
        <Svg width={size} height={size} viewBox="0 0 120 120">
          <Defs>
            <RadialGradient id="burst" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#CFE8FF" stopOpacity={0.9} />
              <Stop offset="100%" stopColor="#CFE8FF" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={60} cy={60} r={55} fill="url(#burst)" />
        </Svg>
      </Animated.View>

      {/* Radiating light rays — fixed-size streaks that translate outward + rotate to point along their angle, native-driver safe */}
      <View style={styles.centered} pointerEvents="none">
        {rays.map((r, i) => {
          const maxDist = size * 0.7;
          const translateX = Animated.multiply(burstProgress, r.ux * maxDist);
          const translateY = Animated.multiply(burstProgress, r.uy * maxDist);
          return (
            <Animated.View
              key={i}
              style={{
                position: "absolute",
                width: 3,
                height: 42,
                borderRadius: 1.5,
                backgroundColor: "#BFE0FF",
                opacity: rayOpacity,
                transform: [
                  { translateX },
                  { translateY },
                  { rotate: `${r.angle + 90}deg` },
                ],
              }}
            />
          );
        })}
      </View>

      {/* Flying particles */}
      <View style={styles.centered} pointerEvents="none">
        {particles.map((p, i) => {
          const translateX = Animated.multiply(burstProgress, p.dx);
          const translateY = Animated.multiply(burstProgress, p.dy);
          return (
            <Animated.View
              key={i}
              style={{
                position: "absolute",
                width: p.size,
                height: p.size,
                borderRadius: p.size / 2,
                backgroundColor: "#FFFFFF",
                opacity: particleOpacity,
                transform: [{ translateX }, { translateY }],
              }}
            />
          );
        })}
      </View>

      <Animated.View
        style={[
          styles.centered,
          { opacity: jewelOpacity, transform: [{ scale: jewelScale }] },
        ]}
      >
        <Svg width={size * 0.6} height={size * 0.6} viewBox="0 0 80 80">
          <Defs>
            <RadialGradient id="tableFill" cx="40%" cy="30%" r="80%">
              <Stop offset="0%" stopColor="#FFFDF5" stopOpacity={1} />
              <Stop offset="100%" stopColor="#E8F4FF" stopOpacity={1} />
            </RadialGradient>
          </Defs>

          {/* ===== Pavilion (bottom facets) — darkest, establishes depth ===== */}
          <Polygon points="14,30 40,74 26,30" fill="#7FB8E8" stroke="#4A7FAE" strokeWidth={0.5} />
          <Polygon points="26,30 40,74 40,30" fill="#9FCCF0" stroke="#4A7FAE" strokeWidth={0.5} />
          <Polygon points="40,30 40,74 54,30" fill="#8CC0EA" stroke="#4A7FAE" strokeWidth={0.5} />
          <Polygon points="54,30 40,74 66,30" fill="#6FAEDE" stroke="#4A7FAE" strokeWidth={0.5} />

          {/* ===== Crown (upper facets, between girdle and table) ===== */}
          <Polygon points="14,30 26,30 20,16" fill="#D9EDFF" stroke="#7FA8C9" strokeWidth={0.5} />
          <Polygon points="26,30 40,30 32,12" fill="#F0F8FF" stroke="#7FA8C9" strokeWidth={0.5} />
          <Polygon points="40,30 54,30 48,12" fill="#EAF5FF" stroke="#7FA8C9" strokeWidth={0.5} />
          <Polygon points="54,30 66,30 60,16" fill="#C9E4FF" stroke="#7FA8C9" strokeWidth={0.5} />
          <Polygon points="20,16 32,12 26,30" fill="#BEE0FF" stroke="#7FA8C9" strokeWidth={0.5} />
          <Polygon points="32,12 48,12 40,30" fill="#F6FBFF" stroke="#7FA8C9" strokeWidth={0.5} />
          <Polygon points="48,12 60,16 54,30" fill="#A9D4FF" stroke="#7FA8C9" strokeWidth={0.5} />

          {/* ===== Table (flat top facet) ===== */}
          <Polygon
            points="20,16 32,12 48,12 60,16 54,30 26,30"
            fill="url(#tableFill)"
            stroke="#6B98C2"
            strokeWidth={0.6}
          />

          {/* ===== Girdle outline ===== */}
          <Polygon
            points="14,30 26,30 40,30 54,30 66,30"
            fill="none"
            stroke="#4A7FAE"
            strokeWidth={0.5}
          />

          {/* ===== Sparkle highlights — asymmetric, sharp, not centered ===== */}
          <Path d="M30,18 L31.5,21 L34,21 L31.5,23 L32.5,26 L30,24 L27.5,26 L28.5,23 L26,21 L28.5,21 Z" fill="#FFFFFF" opacity={0.95} />
          <Path d="M50,20 L50.8,21.8 L52.6,22 L51.2,23.2 L51.6,25 L50,24 L48.4,25 L48.8,23.2 L47.4,22 L49.2,21.8 Z" fill="#FFFFFF" opacity={0.8} />
          <Circle cx={44} cy={40} r={0.8} fill="#FFFFFF" opacity={0.9} />
          <Circle cx={35} cy={48} r={0.6} fill="#FFFFFF" opacity={0.7} />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  centered: { position: "absolute", alignItems: "center", justifyContent: "center" },
});