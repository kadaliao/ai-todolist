/** "Add to Docket" in the share sheet: saves shared text or a link to the Inbox queue in the App
 * Group, which the app turns into tasks the next time it opens (src/state/widget.ts).
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'share',
  name: 'DocketShare',
  displayName: 'Docket',
  bundleIdentifier: '.share',
  deploymentTarget: '16.4',
  frameworks: ['SwiftUI', 'UniformTypeIdentifiers'],
  colors: {
    $accent: { light: '#1F8F6A', dark: '#3FB58A' },
  },
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
