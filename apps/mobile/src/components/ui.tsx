import type { ReactNode } from 'react';
import {
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  type TextProps,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { fonts, useColors } from '../theme';

type Variant = 'body' | 'title' | 'large' | 'meta' | 'label' | 'section' | 'display';

export function Txt({
  variant = 'body',
  tone,
  style,
  ...props
}: TextProps & { variant?: Variant; tone?: string }) {
  const c = useColors();
  const base = {
    body: { fontSize: 16, lineHeight: 22, color: c.ink },
    title: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const, color: c.ink },
    large: { fontSize: 30, lineHeight: 34, fontFamily: fonts.display, letterSpacing: -0.6, color: c.ink },
    meta: { fontSize: 13, lineHeight: 17, color: c.ink3 },
    label: { fontSize: 15, lineHeight: 20, color: c.ink2 },
    section: { fontSize: 14, lineHeight: 18, fontWeight: '600' as const, color: c.ink },
    display: { fontSize: 52, lineHeight: 52, fontFamily: fonts.display, letterSpacing: -2, color: c.jade },
  }[variant];
  // Dynamic Type: text grows with the user's setting, but headings that are already large grow
  // less, so the largest accessibility sizes stay readable instead of breaking every line.
  const maxScale = { display: 1.2, large: 1.35, title: 2, section: 2, body: 2.6, label: 2.6, meta: 2.6 }[
    variant
  ];
  return (
    <Text maxFontSizeMultiplier={maxScale} {...props} style={[base, tone ? { color: tone } : null, style]} />
  );
}

/** Press feedback with a small spring scale (respects the platform's reduced-motion via Reanimated). */
export function Press({
  children,
  style,
  scaleTo = 0.96,
  ...props
}: PressableProps & { style?: ViewStyle | ViewStyle[]; scaleTo?: number; children: ReactNode }) {
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      {...props}
      onPressIn={(e) => {
        s.value = withSpring(scaleTo, { damping: 20, stiffness: 400 });
        props.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.value = withSpring(1, { damping: 18, stiffness: 300 });
        props.onPressOut?.(e);
      }}
    >
      <Animated.View style={[anim, style]}>{children}</Animated.View>
    </Pressable>
  );
}

export function Chip({
  children,
  active,
  tone,
  onPress,
  icon,
}: {
  children: ReactNode;
  active?: boolean;
  tone?: string;
  onPress?: () => void;
  icon?: ReactNode;
}) {
  const c = useColors();
  return (
    <Press onPress={onPress} accessibilityRole="button">
      <View
        style={[
          styles.chip,
          {
            borderColor: active ? (tone ?? c.jadeLine) : c.line,
            backgroundColor: active && !tone ? c.jadeSoft : 'transparent',
          },
        ]}
      >
        {icon}
        <Txt
          variant="meta"
          numberOfLines={1}
          tone={active ? (tone ?? c.jade) : c.ink2}
          style={{ fontSize: 14 }}
        >
          {children}
        </Txt>
      </View>
    </Press>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  const c = useColors();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyRing, { borderColor: c.jadeLine }]}>
        <Txt style={{ fontSize: 28, color: c.jade }}>✓</Txt>
      </View>
      <Txt variant="title" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      {body ? (
        <Txt
          variant="meta"
          style={{ textAlign: 'center', fontSize: 14, lineHeight: 20, marginTop: 4, maxWidth: 280 }}
        >
          {body}
        </Txt>
      ) : null}
    </View>
  );
}

export function SectionHeader({
  title,
  count,
  tone,
  right,
}: {
  title: string;
  count?: number;
  tone?: string;
  right?: ReactNode;
}) {
  const c = useColors();
  return (
    <View style={[styles.section, { borderBottomColor: c.line }]}>
      <Txt variant="section" tone={tone}>
        {title}
      </Txt>
      {count ? <Txt variant="meta">{count}</Txt> : null}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

export const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth * 2,
    maxWidth: 240,
  },
  empty: { alignItems: 'center', paddingTop: 72, paddingHorizontal: 32 },
  emptyRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 20,
  },
});
