import { getLocale, type Locale, setLocale, t } from '@ai-todo/shared';
import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { requestPinWidget } from 'react-native-android-widget';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../components/ui';
import { requestPermission, setNotifySettings, useNotify } from '../state/notifications';
import { useReplica } from '../state/replica';
import { setSetting } from '../state/storage';
import { connectSync, disconnectSync, syncNow, useSync } from '../state/sync';
import { setSpeechMode, useVoice } from '../state/voice';
import { useColors } from '../theme';
import { WIDGET_NAME } from '../widget/android';

export default function SettingsScreen() {
  const c = useColors();
  const r = useReplica();
  const insets = useSafeAreaInsets();
  const sync = useSync();
  const notify = useNotify();
  const speechMode = useVoice((s) => s.mode);
  const cloudAvailable = !!sync.ai?.speech;
  const [url, setUrl] = useState(sync.config?.url ?? '');
  const [token, setToken] = useState(sync.config?.token ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useState(0);
  const zh = getLocale() === 'zh';

  const status =
    sync.state === 'error'
      ? t('settings.sync.status.error', { message: sync.message })
      : t(`settings.sync.status.${sync.state}` as 'settings.sync.status.off');

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{
        paddingTop: 20 + (Platform.OS === 'android' ? insets.top : 0),
        paddingBottom: insets.bottom + 40,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.head}>
        <Txt variant="large">{t('settings.title')}</Txt>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Txt tone={c.jade} style={{ fontWeight: '600' }}>
            {t('done')}
          </Txt>
        </Pressable>
      </View>

      <Group title={t('settings.general')}>
        <Row label={t('settings.language')}>
          <Segmented
            value={getLocale()}
            options={[
              ['zh', '中文'],
              ['en', 'English'],
            ]}
            onChange={(v) => {
              setLocale(v as Locale);
              setSetting('locale', v);
              force((n) => n + 1);
            }}
          />
        </Row>
      </Group>

      <Group title={t('settings.sync')}>
        <Txt variant="meta" style={styles.help}>
          {t('settings.sync.help')}
        </Txt>
        <TextInput
          value={url}
          onChangeText={setUrl}
          editable={!sync.config}
          placeholder="https://docket.example.com"
          placeholderTextColor={c.ink3}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.surface }]}
        />
        <TextInput
          value={token}
          onChangeText={setToken}
          editable={!sync.config}
          placeholder={t('settings.sync.token')}
          placeholderTextColor={c.ink3}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={[styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.surface }]}
        />
        <View style={styles.syncRow}>
          {sync.config ? (
            <>
              <Btn label={zh ? '立即同步' : 'Sync now'} onPress={syncNow} />
              <Btn label={t('settings.sync.disconnect')} onPress={disconnectSync} />
            </>
          ) : (
            <Btn
              primary
              label={t('settings.sync.connect')}
              disabled={!url.trim() || !token.trim() || busy}
              onPress={async () => {
                setBusy(true);
                setError(null);
                try {
                  await connectSync(r, { url, token });
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
          {busy ? <ActivityIndicator color={c.jade} /> : null}
        </View>
        <Txt
          variant="meta"
          tone={error || sync.state === 'error' ? c.p1 : sync.state === 'synced' ? c.jade : undefined}
          style={styles.help}
        >
          {error ?? status}
        </Txt>
      </Group>

      <Group title={zh ? '提醒' : 'Reminders'}>
        {notify.permission === 'granted' ? (
          <>
            <Row label={zh ? '提醒通知' : 'Reminder notifications'}>
              <Switch
                value={notify.enabled}
                onValueChange={(v) => setNotifySettings({ enabled: v })}
                trackColor={{ true: c.jade }}
              />
            </Row>
            <Row label={zh ? '有时间的任务默认准时提醒' : 'Remind at task time by default'}>
              <Switch
                value={notify.atTimeByDefault}
                onValueChange={(v) => setNotifySettings({ atTimeByDefault: v })}
                trackColor={{ true: c.jade }}
              />
            </Row>
          </>
        ) : notify.permission === 'denied' ? (
          <Row label={zh ? '通知已被关闭' : 'Notifications are off'}>
            <Btn label={zh ? '打开设置' : 'Open Settings'} onPress={() => void Linking.openSettings()} />
          </Row>
        ) : (
          <Row label={zh ? '提醒通知' : 'Reminder notifications'}>
            <Btn primary label={zh ? '允许通知' : 'Allow'} onPress={() => void requestPermission()} />
          </Row>
        )}
      </Group>

      {Platform.OS === 'android' ? (
        <Group title={zh ? '桌面小组件' : 'Home screen widget'}>
          <Row
            label={zh ? '今天的任务，点圆圈直接完成' : "Today's tasks, check them off from the home screen"}
          >
            <Btn
              label={zh ? '添加' : 'Add'}
              onPress={() => void requestPinWidget({ widgetName: WIDGET_NAME })}
            />
          </Row>
        </Group>
      ) : null}

      <Group title={t('agent.speech')}>
        <Row label={zh ? '识别方式' : 'Recognizer'}>
          <Segmented
            value={speechMode === 'cloud' && cloudAvailable ? 'cloud' : 'system'}
            options={[
              ['system', t('agent.speech.system')],
              ['cloud', t('agent.speech.cloud')],
            ]}
            disabled={cloudAvailable ? [] : ['cloud']}
            onChange={(v) => setSpeechMode(v as 'system' | 'cloud')}
          />
        </Row>
        <Txt variant="meta" style={styles.help}>
          {`${t('agent.speech.system')}：${t('agent.speech.systemHelp')}\n${t('agent.speech.cloud')}：${
            cloudAvailable ? t('agent.speech.cloudHelp') : t('agent.speech.cloudOff')
          }`.replaceAll('：', zh ? '：' : ': ')}
        </Txt>
      </Group>

      <Group title={t('settings.ai')}>
        <Txt variant="meta" style={styles.help}>
          {t('settings.ai.help')}
        </Txt>
        <Txt tone={sync.ai?.available ? c.jade : c.ink2} style={styles.help}>
          {sync.ai?.available
            ? t('settings.ai.status.ok', { model: sync.ai.model ?? '' })
            : t('settings.ai.status.off')}
        </Txt>
      </Group>
    </ScrollView>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginTop: 22 }}>
      <Txt variant="meta" style={{ paddingHorizontal: 24, paddingBottom: 8, fontWeight: '600' }}>
        {title}
      </Txt>
      <View style={{ paddingHorizontal: 16, gap: 10 }}>{children}</View>
    </View>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  const c = useColors();
  return (
    <View style={[styles.row, { backgroundColor: c.surface, borderColor: c.line }]}>
      <Txt style={{ flex: 1 }}>{label}</Txt>
      {children}
    </View>
  );
}

function Btn({
  label,
  onPress,
  primary,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.btn, { backgroundColor: primary ? c.jade : c.hover, opacity: disabled ? 0.45 : 1 }]}
    >
      <Txt style={{ color: primary ? c.jadeInk : c.ink, fontWeight: '600', fontSize: 15 }}>{label}</Txt>
    </Pressable>
  );
}

function Segmented({
  value,
  options,
  onChange,
  disabled = [],
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
  disabled?: string[];
}) {
  const c = useColors();
  return (
    <View style={[styles.seg, { backgroundColor: c.hover }]}>
      {options.map(([v, label]) => (
        <Pressable
          key={v}
          onPress={() => onChange(v)}
          disabled={disabled.includes(v)}
          accessibilityRole="button"
          accessibilityState={{ selected: value === v, disabled: disabled.includes(v) }}
          style={[
            styles.segItem,
            value === v && { backgroundColor: c.surface },
            disabled.includes(v) && { opacity: 0.4 },
          ]}
        >
          <Txt
            style={{
              fontSize: 14,
              fontWeight: value === v ? '600' : '400',
              color: value === v ? c.ink : c.ink2,
            }}
          >
            {label}
          </Txt>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  help: { paddingHorizontal: 8, fontSize: 13.5, lineHeight: 19 },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  btn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seg: { flexDirection: 'row', borderRadius: 9, padding: 2 },
  segItem: {
    paddingHorizontal: 14,
    height: 32,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
