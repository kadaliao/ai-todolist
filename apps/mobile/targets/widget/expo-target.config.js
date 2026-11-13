/** Home-screen and Lock Screen widgets showing today's tasks. Data comes from the app through the
 * shared App Group (see src/state/widget.ts); checking a task off is queued for the app to apply.
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'DocketWidget',
  displayName: 'Docket',
  bundleIdentifier: '.widget',
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'AppIntents'],
  colors: {
    $accent: { light: '#1F8F6A', dark: '#3FB58A' },
    $widgetBackground: { light: '#FFFFFF', dark: '#1F2228' },
    jade: { light: '#1F8F6A', dark: '#3FB58A' },
    ink: { light: '#1D2230', dark: '#E8EAEE' },
    ink2: { light: '#4B505D', dark: '#B6BAC3' },
    ink3: { light: '#656B76', dark: '#9499A3' },
    line: { light: '#E6E8EC', dark: '#2A2E36' },
    p1: { light: '#D64545', dark: '#F06A6A' },
    p2: { light: '#DD8F12', dark: '#EFAB3A' },
    p3: { light: '#3D6FD9', dark: '#6F97F2' },
  },
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
