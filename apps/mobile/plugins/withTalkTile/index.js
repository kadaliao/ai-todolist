// Android Quick Settings tile that opens Docket listening (see TalkTileService.kt next to this).
// The Chinese label comes from locales/zh-Hans.json (android.tile_talk).
const fs = require('node:fs');
const path = require('node:path');
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withStringsXml,
} = require('expo/config-plugins');

const SERVICE = '.TalkTileService';

module.exports = function withTalkTile(config) {
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const main = path.join(c.modRequest.platformProjectRoot, 'app/src/main');
      const pkg = (c.android?.package ?? 'com.kadaliao.docket').replace(/\./g, '/');
      fs.mkdirSync(path.join(main, 'java', pkg), { recursive: true });
      fs.copyFileSync(
        path.join(__dirname, 'TalkTileService.kt'),
        path.join(main, 'java', pkg, 'TalkTileService.kt'),
      );
      fs.mkdirSync(path.join(main, 'res/drawable'), { recursive: true });
      fs.copyFileSync(
        path.join(__dirname, 'ic_tile_mic.xml'),
        path.join(main, 'res/drawable/ic_tile_mic.xml'),
      );
      return c;
    },
  ]);

  config = withStringsXml(config, (c) => {
    c.modResults = AndroidConfig.Strings.setStringItem(
      [{ $: { name: 'tile_talk' }, _: 'Talk to Docket' }],
      c.modResults,
    );
    return c;
  });

  return withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.service = (app.service ?? []).filter((s) => s.$['android:name'] !== SERVICE);
    app.service.push({
      $: {
        'android:name': SERVICE,
        'android:exported': 'true',
        'android:label': '@string/tile_talk',
        'android:icon': '@drawable/ic_tile_mic',
        'android:permission': 'android.permission.BIND_QUICK_SETTINGS_TILE',
      },
      'intent-filter': [
        { action: [{ $: { 'android:name': 'android.service.quicksettings.action.QS_TILE' } }] },
      ],
    });
    return c;
  });
};
