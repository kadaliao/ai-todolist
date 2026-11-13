import 'temporal-polyfill/global';
import type { Replica } from '@ai-todo/core';
import { setLocale } from '@ai-todo/shared';
import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  useFonts,
} from '@expo-google-fonts/bricolage-grotesque';
import { router, Stack } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { I18nManager, Platform, Settings, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Toasts } from '../components/Toasts';
import { bindActions } from '../state/actions';
import { startNotifications } from '../state/notifications';
import { loadReplica, ReplicaContext } from '../state/replica';
import { getSetting } from '../state/storage';
import { initSync, useSync } from '../state/sync';
import { startWidgetBridge } from '../state/widget';
import { useColors } from '../theme';

void SplashScreen.preventAutoHideAsync();

// Deep links into a sheet (docket://task/<id>, docket://add from the widget) keep the tabs underneath.
export const unstable_settings = { anchor: '(tabs)' };

/** The device's preferred language (Hermes' Intl always reports en-US, so ask the OS). */
function systemLanguage(): string {
  try {
    if (Platform.OS === 'web') return globalThis.navigator?.language ?? 'en';
    if (Platform.OS === 'ios')
      return String((Settings.get('AppleLanguages') as string[] | undefined)?.[0] ?? 'en');
    return String(I18nManager.getConstants().localeIdentifier ?? 'en');
  } catch {
    return 'en';
  }
}

const locale =
  getSetting<'zh' | 'en'>('locale') ?? (systemLanguage().toLowerCase().startsWith('zh') ? 'zh' : 'en');
setLocale(locale);

/**
 * Android share sheet → Quick Add prefilled with what was shared (iOS has its own extension in
 * targets/share). A bare link becomes a note, titled with the page title when the sender gives one.
 */
function AndroidShareIntake() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({
    disabled: Platform.OS !== 'android',
  });
  useEffect(() => {
    if (!hasShareIntent) return;
    const url = shareIntent.webUrl ?? undefined;
    const raw = (shareIntent.text ?? '').trim();
    const rest = url ? raw.replace(url, '').trim() : raw;
    const text = rest || shareIntent.meta?.title?.trim() || '';
    router.push({ pathname: '/add', params: { text, ...(url ? { notes: url } : {}) } });
    resetShareIntent();
  }, [hasShareIntent, shareIntent, resetShareIntent]);
  return null;
}

/**
 * Native builds embed the display font, so there is nothing to wait for. The web preview loads it
 * at runtime; a failed load falls back to the system font instead of holding the splash screen.
 */
const useAppFonts: () => boolean =
  Platform.OS === 'web'
    ? () => {
        const [loaded, error] = useFonts({ BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold });
        return loaded || !!error;
      }
    : () => true;

function boot(): Replica {
  const r = loadReplica();
  bindActions(r);
  return r;
}

export default function RootLayout() {
  const c = useColors();
  const scheme = useColorScheme();
  const fontsLoaded = useAppFonts();
  const [replica, setReplica] = useState<Replica>(boot);
  const reloadNonce = useSync((s) => s.reloadNonce);

  // Adopting an account's data replaces the local replica.
  useEffect(() => {
    if (reloadNonce) setReplica(boot());
  }, [reloadNonce]);

  useEffect(() => {
    const stopSync = initSync(replica);
    const stopNotify = startNotifications(replica);
    const stopWidget = startWidgetBridge(replica);
    return () => {
      stopSync();
      stopNotify();
      stopWidget();
    };
  }, [replica]);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(c.bg);
  }, [c.bg]);

  useEffect(() => {
    if (!fontsLoaded) return;
    void SplashScreen.hideAsync();
    // Development only: `xcrun simctl launch booted app.docket.mobile -docketRoute /add` opens a
    // screen directly (iOS exposes launch arguments through user defaults). Used for screenshots.
    if (__DEV__ && Platform.OS === 'ios') {
      const route = Settings.get('docketRoute') as string | undefined;
      if (route) setTimeout(() => router.push(route as never), 300);
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
      <ReplicaContext.Provider value={replica}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShadowVisible: false,
            headerStyle: { backgroundColor: c.bg },
            headerTintColor: c.jade,
            headerTitleStyle: { color: c.ink },
            contentStyle: { backgroundColor: c.bg },
            headerBackButtonDisplayMode: 'minimal',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="task/[id]"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: [0.62, 1],
              sheetGrabberVisible: true,
              headerShown: false,
              sheetCornerRadius: 22,
            }}
          />
          <Stack.Screen
            name="add"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              sheetGrabberVisible: true,
              headerShown: false,
              sheetCornerRadius: 22,
            }}
          />
          <Stack.Screen
            name="schedule"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              sheetGrabberVisible: true,
              headerShown: false,
              sheetCornerRadius: 22,
            }}
          />
          <Stack.Screen name="dump" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="search" options={{ headerShown: false, animation: 'fade' }} />
        </Stack>
        <Toasts />
        <AndroidShareIntake />
      </ReplicaContext.Provider>
    </GestureHandlerRootView>
  );
}
