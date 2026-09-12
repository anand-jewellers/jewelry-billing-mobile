import React, { useEffect, useRef } from "react";
import { View, Animated, StyleSheet, Easing, Dimensions } from "react-native";
import Svg, { Path, Polygon, Circle, Defs, RadialGradient, Stop } from "react-native-svg";

const { width } = Dimensions.get("window");

type Props = {
  onFinish?: () => void;
  size?: number;
  backgroundColor?: string;
};

const AnimatedG = Animated.createAnimatedComponent(View);

export default function MoonToJewelSplash({
  onFinish,
  size = 140,
  backgroundColor = "#0B3D91",
}: Props) {
  // Moon
  const moonOpacity = useRef(new Animated.Value(0)).current;
  const moonScale = useRef(new Animated.Value(0.7)).current;

  // Star
  const starOpacity = useRef(new Animated.Value(0)).current;
  const starScale = useRef(new Animated.Value(0.2)).current;
  const starTranslateY = useRef(new Animated.Value(10)).current;
  const starTranslateX = useRef(new Animated.Value(-6)).current;
  const starRotate = useRef(new Animated.Value(0)).current;

  // Jewel
  const jewelOpacity = useRef(new Animated.Value(0)).current;
  const jewelScale = useRef(new Animated.Value(0.4)).current;

  // Glow pulse
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const glowScale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.sequence([
      // 1. Moon fades in
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

      // 2. Star emerges from the moon's tip
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

      // 3. Star travels outward/up while spinning slightly, moon fades away
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

      // 4. Star morphs (cross-fades) into the jewel with a bounce + glow
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

  return (
    <View style={[styles.container, { backgroundColor }]}>
      {/* Moon */}
      <Animated.View
        style={[
          styles.centered,
          {
            opacity: moonOpacity,
            transform: [{ scale: moonScale }],
          },
        ]}
      >
        <Svg width={size} height={size} viewBox="0 0 120 120">
          <Defs>
            <RadialGradient id="moonGlow" cx="40%" cy="35%" r="65%">
              <Stop offset="0%" stopColor="#FFFDF2" stopOpacity={1} />
              <Stop offset="100%" stopColor="#E8E2C8" stopOpacity={1} />
            </RadialGradient>
          </Defs>
          {/* crescent: big circle minus offset smaller circle via path */}
          <Path
            d="M60,10
               A50,50 0 1,0 60,110
               A38,50 0 1,1 60,10 Z"
            fill="url(#moonGlow)"
          />
        </Svg>
      </Animated.View>

      {/* Star */}
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

      {/* Glow burst behind the jewel */}
      <Animated.View
        style={[
          styles.centered,
          {
            opacity: glowOpacity,
            transform: [{ scale: glowScale }],
          },
        ]}
      >
        <Svg width={size} height={size} viewBox="0 0 120 120">
          <Defs>
            <RadialGradient id="burst" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#FFE9A8" stopOpacity={0.9} />
              <Stop offset="100%" stopColor="#FFE9A8" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={60} cy={60} r={55} fill="url(#burst)" />
        </Svg>
      </Animated.View>

      {/* Jewel */}
      <Animated.View
        style={[
          styles.centered,
          {
            opacity: jewelOpacity,
            transform: [{ scale: jewelScale }],
          },
        ]}
      >
        <Svg width={size * 0.6} height={size * 0.6} viewBox="0 0 80 80">
          <Defs>
            <RadialGradient id="jewelBody" cx="35%" cy="25%" r="80%">
              <Stop offset="0%" stopColor="#FFF6D8" stopOpacity={1} />
              <Stop offset="45%" stopColor="#FFD966" stopOpacity={1} />
              <Stop offset="100%" stopColor="#C9971F" stopOpacity={1} />
            </RadialGradient>
          </Defs>
          {/* crown */}
          <Polygon
            points="10,26 70,26 40,4"
            fill="url(#jewelBody)"
            stroke="#8A6100"
            strokeWidth={1}
          />
          {/* pavilion */}
          <Polygon
            points="10,26 70,26 40,76"
            fill="url(#jewelBody)"
            stroke="#8A6100"
            strokeWidth={1}
          />
          {/* facet lines */}
          <Path
            d="M22,26 L40,4 M58,26 L40,4 M10,26 L40,44 L70,26 M40,44 L40,76"
            stroke="#8A6100"
            strokeOpacity={0.5}
            strokeWidth={0.8}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  centered: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
});