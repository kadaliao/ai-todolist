#!/bin/sh
# Package Docket.app into a compressed DMG with an Applications shortcut (no Finder scripting,
# so it works headless and on CI).
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
echo "$OUT"
