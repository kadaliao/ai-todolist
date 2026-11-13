import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dismissToast, useToasts } from '../state/actions';
import { useColors } from '../theme';
import { Press, Txt } from './ui';

export function Toasts() {
  const c = useColors();
  const toasts = useToasts((s) => s.toasts);
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 134 }]}>
      {toasts.map((t) => (
        <Animated.View
          key={t.id}
          entering={FadeInDown.springify().damping(18)}
          exiting={FadeOutDown.duration(160)}
          layout={LinearTransition}
        >
          <View style={[styles.toast, { backgroundColor: c.ink }]}>
            <Txt numberOfLines={2} style={{ flex: 1, color: c.bg, fontSize: 14.5 }}>
              {t.message}
            </Txt>
            {t.action ? (
              <Press
                onPress={() => {
                  t.action?.run();
                  dismissToast(t.id);
                }}
              >
                <Txt
                  style={{
                    color: c.jadeLine,
                    fontWeight: '700',
                    fontSize: 14.5,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                  }}
                >
                  {t.action.label}
                </Txt>
              </Press>
            ) : null}
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', gap: 8 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingLeft: 18,
    paddingRight: 8,
    borderRadius: 14,
    maxWidth: 520,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
});
