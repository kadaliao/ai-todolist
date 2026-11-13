import { Platform, useColorScheme } from 'react-native';

/** Same tokens as the web app: ink on cool paper, jade for done/primary, vermilion/amber/lapis priorities. */

const light = {
  bg: '#FBFBFC',
  surface: '#FFFFFF',
  raised: '#FFFFFF',
  sidebar: '#F2F3F5',
  hover: 'rgba(29,34,48,0.045)',
  active: 'rgba(29,34,48,0.08)',
  ink: '#1D2230',
  ink2: '#5B6170',
  ink3: '#8C919C',
  line: '#E6E8EC',
  lineStrong: '#D3D6DC',
  jade: '#1F8F6A',
  jadeInk: '#FFFFFF',
  jadeSoft: '#E2F2EB',
  jadeLine: '#9FD2BD',
  p1: '#D64545',
  p2: '#DD8F12',
  p3: '#3D6FD9',
  purple: '#8A5CD6',
  danger: '#C93C3C',
  select: '#E7EFFF',
  scrim: 'rgba(16,19,26,0.32)',
};

const dark: typeof light = {
  bg: '#17191E',
  surface: '#1F2228',
  raised: '#262A31',
  sidebar: '#1B1E24',
  hover: 'rgba(232,234,238,0.05)',
  active: 'rgba(232,234,238,0.09)',
  ink: '#E8EAEE',
  ink2: '#A3A8B3',
  ink3: '#6F7581',
  line: '#2A2E36',
  lineStrong: '#383D47',
  jade: '#3FB58A',
  jadeInk: '#0F1A15',
  jadeSoft: '#1B3229',
  jadeLine: '#2F6A54',
  p1: '#F06A6A',
  p2: '#EFAB3A',
  p3: '#6F97F2',
  purple: '#A07CE8',
  danger: '#F06A6A',
  select: '#22304A',
  scrim: 'rgba(0,0,0,0.5)',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export const PRIORITY_COLOR = (c: Colors, p: number) =>
  p === 3 ? c.p1 : p === 2 ? c.p2 : p === 1 ? c.p3 : c.ink3;

/** Bricolage Grotesque is embedded in native builds (expo-font plugin): iOS looks fonts up by
 * PostScript name, Android by file name. The web preview loads it at runtime under the file name. */
export const fonts = {
  display: Platform.select({ ios: 'BricolageGrotesque-Bold', default: 'BricolageGrotesque_700Bold' }),
  displaySemi: Platform.select({
    ios: 'BricolageGrotesque-SemiBold',
    default: 'BricolageGrotesque_600SemiBold',
  }),
};

/** Content column for wide screens (iPad, tablets): lists stay readable instead of spanning 13". */
export const readable = { width: '100%', maxWidth: 760, alignSelf: 'center' } as const;
