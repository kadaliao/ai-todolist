import { getLocale, t } from '@ai-todo/shared';
import * as Haptics from 'expo-haptics';
import { Mic, Square } from 'lucide-react-native';
import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, PanResponder, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  FadeInDown,
  FadeOutDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { create } from 'zustand';
import { speak } from '../state/assistant';
import { cancelListening, goHandsFree, listen, stopListening, useVoice, voiceLevel } from '../state/voice';
import { useColors } from '../theme';
import { Txt } from './ui';

/** Push-to-talk state shared by the mic button and the listening overlay. */
export const useHold = create<{ holding: boolean; cancel: boolean }>(() => ({
  holding: false,
  cancel: false,
}));

/** How long a press must last to count as push-to-talk rather than a tap. */
const HOLD_MS = 260;
/** Sliding this far up while holding cancels. */
const CANCEL_DY = -70;

/** Listen hands-free and hand the result to the assistant. */
export function talkHandsFree(): void {
  void listen({ handsFree: true }).then((text) => text && speak(text));
}

/**
 * The mic. Press and hold to talk (release sends, slide up cancels); a short tap starts
 * hands-free listening that ends after a pause, and a tap while listening stops it.
 */
export function MicButton({
  size = 60,
  onTap,
  onSent,
  style,
}: {
  size?: number;
  /** After a short tap started hands-free listening (e.g. open the assistant). */
  onTap?: () => void;
  /** After push-to-talk was released to send. */
  onSent?: () => void;
  style?: ViewStyle;
}) {
  const c = useColors();
  const status = useVoice((s) => s.status);
  const handsFree = useVoice((s) => s.handsFree);
  const pressed = useSharedValue(0);
  const latest = useRef({ onTap, onSent });
  latest.current = { onTap, onSent };
  const press = useRef({
    timer: null as ReturnType<typeof setTimeout> | null,
    holding: false,
    toggling: false,
  });

  const responder = useMemo(() => {
    const end = (terminated: boolean) => {
      const p = press.current;
      if (p.timer) clearTimeout(p.timer);
      p.timer = null;
      pressed.value = withSpring(0, { damping: 16, stiffness: 260 });
      if (p.toggling) {
        if (!terminated) stopListening();
        return;
      }
      if (p.holding) {
        p.holding = false;
        const cancel = terminated || useHold.getState().cancel;
        useHold.setState({ holding: false, cancel: false });
        if (cancel) cancelListening();
        else {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          stopListening();
          latest.current.onSent?.();
        }
        return;
      }
      if (terminated) {
        cancelListening();
        return;
      }
      goHandsFree();
      latest.current.onTap?.();
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const p = press.current;
        const st = useVoice.getState().status;
        p.toggling = st !== 'idle';
        p.holding = false;
        pressed.value = withSpring(1, { damping: 16, stiffness: 300 });
        if (p.toggling) return;
        // Start right away so the first words aren't lost; a tap turns it into hands-free.
        void listen({ handsFree: false }).then((text) => text && speak(text));
        p.timer = setTimeout(() => {
          p.holding = true;
          p.timer = null;
          useHold.setState({ holding: true, cancel: false });
        }, HOLD_MS);
      },
      onPanResponderMove: (_e, g) => {
        if (!press.current.holding) return;
        const cancel = g.dy < CANCEL_DY;
        if (cancel !== useHold.getState().cancel) {
          useHold.setState({ cancel });
          void Haptics.selectionAsync();
        }
      },
      onPanResponderRelease: () => end(false),
      onPanResponderTerminate: () => end(true),
    });
  }, [pressed]);

  const scale = useAnimatedStyle(() => ({ transform: [{ scale: 1 - pressed.value * 0.08 }] }));
  const listening = status === 'listening';
  const ring = useAnimatedStyle(() => ({
    opacity: listening ? 0.25 + voiceLevel.value * 0.5 : 0,
    transform: [{ scale: 1 + voiceLevel.value * 0.45 }],
  }));
  const active = status !== 'idle';
  const listeningHandsFree = active && handsFree;

  return (
    <View
      {...responder.panHandlers}
      accessible
      accessibilityRole="button"
      accessibilityLabel={listeningHandsFree ? t('agent.stop') : t('agent.tap')}
      accessibilityHint={t('agent.hold')}
      accessibilityState={{ busy: active }}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName !== 'activate') return;
        if (active) stopListening();
        else {
          talkHandsFree();
          latest.current.onTap?.();
        }
      }}
      style={[{ width: size + 16, height: size + 16, alignItems: 'center', justifyContent: 'center' }, style]}
      hitSlop={8}
    >
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { margin: 8, borderRadius: size, backgroundColor: c.jade }, ring]}
      />
      <Animated.View
        style={[
          styles.mic,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: c.jade,
            shadowColor: c.jade,
          },
          scale,
        ]}
      >
        {status === 'transcribing' || status === 'starting' ? (
          <ActivityIndicator color={c.jadeInk} />
        ) : listeningHandsFree ? (
          <Square color={c.jadeInk} fill={c.jadeInk} size={size * 0.32} />
        ) : (
          <Mic color={c.jadeInk} size={size * 0.44} strokeWidth={2.3} />
        )}
      </Animated.View>
    </View>
  );
}

/** Animated bars that follow the microphone level. */
export function LevelBars({ color, height = 22 }: { color: string; height?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height }}>
      {[0.55, 0.85, 1, 0.75, 0.5].map((k, i) => (
        <Bar key={i} k={k} i={i} color={color} height={height} />
      ))}
    </View>
  );
}

function Bar({ k, i, color, height }: { k: number; i: number; color: string; height: number }) {
  const wobble = useSharedValue(0);
  useEffect(() => {
    wobble.value = withRepeat(
      withSequence(withTiming(1, { duration: 260 + i * 70 }), withTiming(0, { duration: 260 + i * 70 })),
      -1,
    );
  }, [wobble, i]);
  const style = useAnimatedStyle(() => ({
    height: Math.max(3, height * k * (0.18 + voiceLevel.value * (0.6 + wobble.value * 0.4))),
  }));
  return <Animated.View style={[{ width: 3.5, borderRadius: 2, backgroundColor: color }, style]} />;
}

/** Full-width panel while push-to-talk is held: what you're saying, and how to cancel. */
export function HoldOverlay({ bottom }: { bottom: number }) {
  const c = useColors();
  const { holding, cancel } = useHold();
  const text = useVoice((s) => s.text);
  if (!holding) return null;
  const tone = cancel ? c.danger : c.jade;
  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18)}
      exiting={FadeOutDown.duration(140)}
      pointerEvents="none"
      style={[
        styles.overlay,
        { bottom, backgroundColor: c.raised, borderColor: cancel ? c.danger : c.jadeLine },
      ]}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.overlayHead}>
        <LevelBars color={tone} />
        <Txt variant="meta" tone={tone} style={{ fontWeight: '600' }}>
          {cancel ? t('agent.releaseCancel') : t('agent.listening')}
        </Txt>
      </View>
      <Txt style={{ fontSize: 18, lineHeight: 26, minHeight: 26 }} numberOfLines={5}>
        {text || (getLocale() === 'zh' ? '说吧，我在听' : 'Go ahead, I’m listening')}
      </Txt>
      <Txt variant="meta" style={{ textAlign: 'center' }}>
        {cancel ? t('agent.releaseCancel') : t('agent.release')}
      </Txt>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  mic: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  overlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    gap: 10,
    padding: 18,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth * 2,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  overlayHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
