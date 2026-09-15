import React, { useEffect, useMemo, useRef } from "react";
import { View, Animated, StyleSheet, Easing, Dimensions } from "react-native";
import Svg, { Path, Polygon, Circle, Defs, RadialGradient, Stop, G } from "react-native-svg";

const { width, height } = Dimensions.get("window");

type Props = {
  onFinish?: () => void;
  size?: number;
  backgroundColor?: string;
};

const RAY_COUNT = 14;
const PARTICLE_COUNT = 16;
const BEAD_COUNT = 11;

// A smooth, premium "ease-out" curve — decelerates gently with no snap at the end.
const SMOOTH_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const SMOOTH_IN_OUT = Easing.bezier(0.45, 0, 0.15, 1);

function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function quadraticBezier(t: number, p0: number, c: number, p2: number) {
  return (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * c + t * t * p2;
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
  const jewelScale = useRef(new Animated.Value(0.6)).current;

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

  // Necklace bead positions — a quadratic-bezier drape from shoulder to shoulder,
  // with a gentle taper (thin at the ends, fuller in the middle).
  const beads = useMemo(() => {
    const p0 = { x: 14, y: 20 };
    const c = { x: 60, y: 66 };
    const p2 = { x: 106, y: 20 };
    return Array.from({ length: BEAD_COUNT }, (_, i) => {
      const t = i / (BEAD_COUNT - 1);
      const x = quadraticBezier(t, p0.x, c.x, p2.x);
      const y = quadraticBezier(t, p0.y, c.y, p2.y);
      const r = 1.6 + 1.1 * Math.sin(t * Math.PI);
      return { x, y, r };
    });
  }, []);

  const chainMidY = quadraticBezier(0.5, 20, 66, 20);

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(moonOpacity, {
          toValue: 1,
          duration: 550,
          easing: SMOOTH_OUT,
          useNativeDriver: true,
        }),
        Animated.spring(moonScale, {
          toValue: 1,
          friction: 8,
          tension: 45,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(120),

      Animated.parallel([
        Animated.timing(starOpacity, {
          toValue: 1,
          duration: 320,
          easing: SMOOTH_OUT,
          useNativeDriver: true,
        }),
        Animated.spring(starScale, {
          toValue: 1,
          friction: 7,
          tension: 50,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(80),

      Animated.parallel([
        Animated.timing(starTranslateY, {
          toValue: -34,
          duration: 750,
          easing: SMOOTH_IN_OUT,
          useNativeDriver: true,
        }),
        Animated.timing(starTranslateX, {
          toValue: 0,
          duration: 750,
          easing: SMOOTH_IN_OUT,
          useNativeDriver: true,
        }),
        Animated.timing(starScale, {
          toValue: 1.5,
          duration: 750,
          easing: SMOOTH_IN_OUT,
          useNativeDriver: true,
        }),
        Animated.timing(starRotate, {
          toValue: 1,
          duration: 750,
          easing: SMOOTH_IN_OUT,
          useNativeDriver: true,
        }),
        Animated.timing(moonOpacity, {
          toValue: 0,
          duration: 500,
          delay: 150,
          easing: SMOOTH_OUT,
          useNativeDriver: true,
        }),
      ]),

      Animated.parallel([
        Animated.timing(starOpacity, {
          toValue: 0,
          duration: 450,
          easing: SMOOTH_OUT,
          useNativeDriver: true,
        }),
        Animated.timing(jewelOpacity, {
          toValue: 1,
          duration: 450,
          easing: SMOOTH_OUT,
          useNativeDriver: true,
        }),
        Animated.spring(jewelScale, {
          toValue: 1,
          friction: 8,
          tension: 45,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(glowOpacity, {
            toValue: 0.9,
            duration: 280,
            easing: SMOOTH_OUT,
            useNativeDriver: true,
          }),
          Animated.timing(glowOpacity, {
            toValue: 0,
            duration: 550,
            easing: SMOOTH_OUT,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(glowScale, {
          toValue: 1.8,
          duration: 800,
          easing: SMOOTH_OUT,
          useNativeDriver: true,
        }),
        Animated.timing(burstProgress, {
          toValue: 1,
          duration: 800,
          easing: SMOOTH_OUT,
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

      {/* Radiating light rays */}
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

      {/* ===== Necklace reveal (replaces the diamond) ===== */}
      <Animated.View
        style={[
          styles.centered,
          { opacity: jewelOpacity, transform: [{ scale: jewelScale }] },
        ]}
      >
        <Svg width={size * 0.85} height={size * 0.85} viewBox="0 0 120 110">
          <Defs>
            <RadialGradient id="beadFill" cx="35%" cy="30%" r="80%">
              <Stop offset="0%" stopColor="#FFFEF8" stopOpacity={1} />
              <Stop offset="100%" stopColor="#EDE3C4" stopOpacity={1} />
            </RadialGradient>
            <RadialGradient id="tableFill" cx="40%" cy="30%" r="80%">
              <Stop offset="0%" stopColor="#FFFDF5" stopOpacity={1} />
              <Stop offset="100%" stopColor="#E8F4FF" stopOpacity={1} />
            </RadialGradient>
          </Defs>

          {/* Thin gold strand the beads sit on */}
          <Path
            d={`M14,20 Q60,66 106,20`}
            fill="none"
            stroke="#D4AF37"
            strokeWidth={0.8}
            opacity={0.85}
          />

          {/* Pearl beads draped along the strand */}
          {beads.map((b, i) => (
            <Circle
              key={i}
              cx={b.x}
              cy={b.y}
              r={b.r}
              fill="url(#beadFill)"
              stroke="#C9B77E"
              strokeWidth={0.4}
            />
          ))}

          {/* Drop chain down to the pendant */}
          <Path
            d={`M60,${chainMidY + 2} L60,58`}
            stroke="#D4AF37"
            strokeWidth={0.8}
            opacity={0.85}
          />

          {/* Pendant — small faceted drop, scaled down and centered under the chain */}
          <G transform="translate(42,58) scale(0.42)">
            <Polygon points="14,30 40,74 26,30" fill="#7FB8E8" stroke="#4A7FAE" strokeWidth={0.5} />
            <Polygon points="26,30 40,74 40,30" fill="#9FCCF0" stroke="#4A7FAE" strokeWidth={0.5} />
            <Polygon points="40,30 40,74 54,30" fill="#8CC0EA" stroke="#4A7FAE" strokeWidth={0.5} />
            <Polygon points="54,30 40,74 66,30" fill="#6FAEDE" stroke="#4A7FAE" strokeWidth={0.5} />

            <Polygon points="14,30 26,30 20,16" fill="#D9EDFF" stroke="#7FA8C9" strokeWidth={0.5} />
            <Polygon points="26,30 40,30 32,12" fill="#F0F8FF" stroke="#7FA8C9" strokeWidth={0.5} />
            <Polygon points="40,30 54,30 48,12" fill="#EAF5FF" stroke="#7FA8C9" strokeWidth={0.5} />
            <Polygon points="54,30 66,30 60,16" fill="#C9E4FF" stroke="#7FA8C9" strokeWidth={0.5} />
            <Polygon points="20,16 32,12 26,30" fill="#BEE0FF" stroke="#7FA8C9" strokeWidth={0.5} />
            <Polygon points="32,12 48,12 40,30" fill="#F6FBFF" stroke="#7FA8C9" strokeWidth={0.5} />
            <Polygon points="48,12 60,16 54,30" fill="#A9D4FF" stroke="#7FA8C9" strokeWidth={0.5} />

            <Polygon
              points="20,16 32,12 48,12 60,16 54,30 26,30"
              fill="url(#tableFill)"
              stroke="#6B98C2"
              strokeWidth={0.6}
            />
            <Polygon
              points="14,30 26,30 40,30 54,30 66,30"
              fill="none"
              stroke="#4A7FAE"
              strokeWidth={0.5}
            />

            <Path d="M30,18 L31.5,21 L34,21 L31.5,23 L32.5,26 L30,24 L27.5,26 L28.5,23 L26,21 L28.5,21 Z" fill="#FFFFFF" opacity={0.95} />
            <Circle cx={44} cy={40} r={0.8} fill="#FFFFFF" opacity={0.9} />
          </G>
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  centered: { position: "absolute", alignItems: "center", justifyContent: "center" },
});