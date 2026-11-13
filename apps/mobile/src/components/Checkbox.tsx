import { useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { PRIORITY_COLOR, useColors } from '../theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * The check-off: jade floods the ring with a little overshoot, then the tick draws itself.
 * `checked` drives the animation; the parent decides when the task actually completes.
 */
export function Checkbox({
  priority,
  checked,
  onPress,
  size = 24,
}: {
  priority: number;
  checked: boolean;
  onPress: () => void;
  size?: number;
}) {
  const c = useColors();
  const ring = PRIORITY_COLOR(c, priority);
  const fill = useSharedValue(checked ? 1 : 0);
  const draw = useSharedValue(checked ? 1 : 0);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (checked) {
      fill.value = withTiming(1, { duration: 220 });
      scale.value = withSequence(
        withTiming(0.86, { duration: 70 }),
        withSpring(1, { damping: 9, stiffness: 320 }),
      );
      draw.value = withDelay(110, withTiming(1, { duration: 230 }));
    } else {
      fill.value = withTiming(0, { duration: 150 });
      draw.value = withTiming(0, { duration: 120 });
    }
  }, [checked, fill, draw, scale]);

  const circle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    borderColor: interpolateColor(fill.value, [0, 1], [ring, c.jade]),
    backgroundColor: interpolateColor(fill.value, [0, 1], [priority ? `${ring}18` : 'transparent', c.jade]),
  }));
  const tick = useAnimatedProps(() => ({ strokeDashoffset: 20 * (1 - draw.value) }));

  return (
    <Pressable onPress={onPress} hitSlop={12} accessibilityRole="checkbox" accessibilityState={{ checked }}>
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 1.8,
            alignItems: 'center',
            justifyContent: 'center',
          },
          circle,
        ]}
      >
        <Svg width={size * 0.6} height={size * 0.6} viewBox="0 0 12 12">
          <AnimatedPath
            d="M2.6 6.3 5 8.6 9.5 3.6"
            stroke={c.jadeInk}
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            strokeDasharray={20}
            animatedProps={tick}
          />
        </Svg>
      </Animated.View>
    </Pressable>
  );
}
