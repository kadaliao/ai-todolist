import {
  createPairing,
  type DeviceInfo,
  listDevices,
  pairingLink,
  qrMatrix,
  qrPath,
  removeDevice,
} from '@ai-todo/core';
import { getLocale, t } from '@ai-todo/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import { Txt } from '../components/ui';
import { useSync } from '../state/sync';
import { useColors } from '../theme';

/** Settings → Sync → Add device: a one-time code as a QR code and a link, and the device list. */
export default function DevicesScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const config = useSync((s) => s.config);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const renew = useCallback(async () => {
    if (!config) return;
    setError(null);
    try {
      setPairing(await createPairing(config.url, config.token));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [config]);

  const refresh = useCallback(async () => {
    if (!config) return;
    try {
      setDevices(await listDevices(config.url, config.token));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [config]);

  useEffect(() => {
    void renew();
    void refresh();
  }, [renew, refresh]);

  // Tick for the countdown; the list refreshes too, so a device that just paired shows up.
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const link = pairing && config ? pairingLink(config.url, pairing.code) : null;
  const matrix = useMemo(() => (link ? qrMatrix(link) : null), [link]);
  const path = matrix ? qrPath(matrix) : null;
  const size = matrix?.length ?? 0;
  const expired = !!pairing && pairing.expiresAt <= now;
  const minutes = pairing ? Math.max(1, Math.round((pairing.expiresAt - now) / 60_000)) : 0;

  const remove = (d: DeviceInfo) =>
    Alert.alert(t('pair.removeConfirm', { name: d.name }), undefined, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('pair.remove'),
        style: 'destructive',
        onPress: async () => {
          if (!config) return;
          try {
            await removeDevice(config.url, config.token, d.name);
            await refresh();
          } catch (e) {
            setError((e as Error).message);
          }
        },
      },
    ]);

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{
        paddingTop: 20 + (Platform.OS === 'android' ? insets.top : 0),
        paddingBottom: insets.bottom + 40,
      }}
    >
      <View style={styles.head}>
        <Txt variant="large">{t('pair.title')}</Txt>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Txt tone={c.jade} style={{ fontWeight: '600' }}>
            {t('done')}
          </Txt>
        </Pressable>
      </View>

      <View style={styles.body}>
        <Txt variant="meta" style={styles.help}>
          {t('pair.scan')}
        </Txt>

        <View style={[styles.qrCard, { borderColor: c.line }]}>
          {path && !expired ? (
            <Svg
              width={232}
              height={232}
              viewBox={`-4 -4 ${size + 8} ${size + 8}`}
              accessibilityLabel={t('pair.title')}
            >
              <Rect x={-4} y={-4} width={size + 8} height={size + 8} fill="#ffffff" />
              <Path d={path} fill="#000000" />
            </Svg>
          ) : (
            <View style={styles.qrEmpty}>
              {expired ? (
                <Txt style={{ color: '#555' }}>{t('pair.expired')}</Txt>
              ) : (
                <ActivityIndicator color="#555" />
              )}
            </View>
          )}
        </View>

        {pairing ? (
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Txt variant="meta">{t('pair.code')}</Txt>
            <Txt
              selectable
              style={{
                fontSize: 28,
                lineHeight: 38,
                fontWeight: '700',
                letterSpacing: 2,
                fontVariant: ['tabular-nums'],
              }}
            >
              {pairing.code}
            </Txt>
            <Txt variant="meta" tone={expired ? c.p1 : undefined}>
              {expired ? t('pair.expired') : t('pair.expires', { min: minutes })}
            </Txt>
          </View>
        ) : null}

        <View style={styles.row}>
          {link && !expired ? (
            <Btn primary label={t('pair.share')} onPress={() => void Share.share({ message: link })} />
          ) : null}
          <Btn label={t('pair.renew')} onPress={() => void renew()} />
        </View>

        {error ? (
          <Txt variant="meta" tone={c.p1} style={styles.help}>
            {error}
          </Txt>
        ) : null}

        <Txt variant="section" style={{ marginTop: 18 }}>
          {t('pair.devices')}
        </Txt>
        {devices ? (
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}>
            {devices.map((d, i) => (
              <View
                key={d.name}
                style={[
                  styles.item,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
                ]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt style={{ fontSize: 16 }}>{d.name}</Txt>
                  <Txt variant="meta">
                    {d.current
                      ? t('pair.thisDevice')
                      : d.lastSeen
                        ? t('pair.lastSeen', { when: when(d.lastSeen) })
                        : t('pair.never')}
                  </Txt>
                </View>
                {d.current ? null : (
                  <Pressable onPress={() => remove(d)} hitSlop={10} accessibilityRole="button">
                    <Txt tone={c.p1} style={{ fontSize: 15 }}>
                      {t('pair.remove')}
                    </Txt>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        ) : (
          <ActivityIndicator color={c.jade} />
        )}
      </View>
    </ScrollView>
  );
}

/** “14:05” today, “11月3日” / “Nov 3” before. */
function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString())
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (getLocale() === 'zh') return `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

function Btn({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} style={[styles.btn, { backgroundColor: primary ? c.jade : c.hover }]}>
      <Txt style={{ color: primary ? c.jadeInk : c.ink, fontWeight: '600', fontSize: 15 }}>{label}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  body: { paddingHorizontal: 16, gap: 12, marginTop: 16 },
  help: { paddingHorizontal: 8, fontSize: 13.5, lineHeight: 19 },
  qrCard: {
    alignSelf: 'center',
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#ffffff',
  },
  qrEmpty: { width: 232, height: 232, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  btn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
});
