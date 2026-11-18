import { normalizeServerUrl, parsePairingLink } from '@ai-todo/core';
import { t } from '@ai-todo/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../components/ui';
import { useReplica } from '../state/replica';
import { connectSync, disconnectSync, useSync } from '../state/sync';
import { useColors } from '../theme';

function host(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

/**
 * `docket://pair?url=…&code=…`, opened by scanning another device's QR code with the camera:
 * confirm, trade the code for a token, sync.
 */
export default function PairLink() {
  const c = useColors();
  const r = useReplica();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ url?: string; code?: string; confirm?: string }>();
  const config = useSync((s) => s.config);
  const link =
    params.url && params.code
      ? parsePairingLink(
          `docket://pair?url=${encodeURIComponent(params.url)}&code=${encodeURIComponent(params.code)}`,
        )
      : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);

  const same = !!link && !!config && normalizeServerUrl(config.url) === link.url;
  const other = !!link && !!config && !same;

  const join = async () => {
    if (!link) return;
    setBusy(true);
    setError(null);
    try {
      if (other) disconnectSync();
      const { name } = await connectSync(r, { url: link.url, token: link.code });
      setJoined(name ?? '');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Development only: `&confirm=1` presses Connect (the headless simulator can't tap).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once on open
  useEffect(() => {
    if (__DEV__ && params.confirm === '1') void join();
  }, []);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <View style={[styles.wrap, { backgroundColor: c.bg, paddingBottom: insets.bottom + 24 }]}>
      {!link ? (
        <Txt style={styles.title}>{t('pair.bad')}</Txt>
      ) : joined !== null ? (
        <Txt style={styles.title}>{t('pair.joined', { name: joined })}</Txt>
      ) : (
        <>
          <Txt style={styles.title}>{t('pair.join', { host: host(link.url) })}</Txt>
          <Txt variant="meta" style={styles.help}>
            {same
              ? t('pair.joinSame')
              : other && config
                ? t('pair.joinOther', { host: host(config.url) })
                : t('pair.joinHelp')}
          </Txt>
        </>
      )}
      {error ? (
        <Txt variant="meta" tone={c.p1} style={styles.help}>
          {error}
        </Txt>
      ) : null}
      <View style={styles.row}>
        {link && joined === null && !same ? (
          <Pressable
            onPress={join}
            disabled={busy}
            style={[styles.btn, { backgroundColor: c.jade, opacity: busy ? 0.5 : 1 }]}
          >
            <Txt style={{ color: c.jadeInk, fontWeight: '600', fontSize: 16 }}>
              {t('settings.sync.connect')}
            </Txt>
          </Pressable>
        ) : null}
        <Pressable onPress={close} style={[styles.btn, { backgroundColor: c.hover }]}>
          <Txt style={{ fontWeight: '600', fontSize: 16 }}>
            {joined !== null || same ? t('done') : t('cancel')}
          </Txt>
        </Pressable>
        {busy ? <ActivityIndicator color={c.jade} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, paddingTop: 40, gap: 14 },
  title: { fontSize: 22, fontWeight: '700', lineHeight: 30 },
  help: { fontSize: 14.5, lineHeight: 21 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  btn: {
    height: 46,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
