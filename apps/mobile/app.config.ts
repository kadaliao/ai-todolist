import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json holds the configuration; this only adds what shouldn't live in a public repo.
 * APPLE_TEAM_ID signs the app, the widget and the share extension (EAS secret or local env).
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  ios: {
    ...config.ios,
    ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
  },
});
