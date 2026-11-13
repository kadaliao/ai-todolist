// Per-language preview images for the Android widget picker. react-native-android-widget copies
// one `previewImage` into res/drawable; this adds the same drawable under language qualifiers.
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

/** @param {{ name: string, images: Record<string, string> }} options  qualifier → image path */
module.exports = function withLocalizedWidgetPreview(config, { name, images }) {
  return withDangerousMod(config, [
    'android',
    async (c) => {
      for (const [qualifier, src] of Object.entries(images)) {
        const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res', `drawable-${qualifier}`);
        fs.mkdirSync(dir, { recursive: true });
        const ext = path.extname(src);
        fs.copyFileSync(
          path.resolve(c.modRequest.projectRoot, src),
          path.join(dir, `${name.toLowerCase()}_preview${ext}`),
        );
      }
      return c;
    },
  ]);
};
