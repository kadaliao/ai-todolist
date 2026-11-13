#!/bin/sh
# Package Docket.app into a compressed DMG with an Applications shortcut (no Finder scripting,
# so it works headless and on CI).
#
# Signing and notarization are opt-in through the environment:
#   APPLE_SIGNING_IDENTITY  e.g. "Developer ID Application: Your Name (TEAMID)". Tauri signs the
#                           .app with it (hardened runtime); this script signs the DMG too.
#   DOCKET_NOTARY_PROFILE   a notarytool keychain profile, created once with
#                           `xcrun notarytool store-credentials <name>`. When set, the DMG is
#                           notarized and stapled so Gatekeeper opens it without warnings.
set -eu
cd "$(dirname "$0")/.."
APP=src-tauri/target/release/bundle/macos/Docket.app
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
ARCH=$(uname -m)
OUT=src-tauri/target/release/bundle/Docket_${VERSION}_${ARCH}.dmg
STAGE=$(mktemp -d)
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$OUT"
hdiutil create -quiet -volname "Docket" -srcfolder "$STAGE" -ov -format UDZO "$OUT"
rm -rf "$STAGE"

if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$OUT"
  if [ -n "${DOCKET_NOTARY_PROFILE:-}" ]; then
    xcrun notarytool submit "$OUT" --keychain-profile "$DOCKET_NOTARY_PROFILE" --wait
    xcrun stapler staple "$OUT"
  fi
fi
echo "$OUT"
