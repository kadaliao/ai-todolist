#!/bin/sh
# Build, sign and (optionally) upload the iOS app to App Store Connect.
#   scripts/ios-release.sh            archive + export an App Store IPA
#   scripts/ios-release.sh --upload   …and upload it (then it shows up in TestFlight)
#
# Needs, in .env.release (gitignored): APPLE_TEAM_ID, ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH;
# the Apple Distribution identity in ~/Library/Keychains/docket-signing.keychain-db; and App Store
# provisioning profiles named
# "Docket App Store", "Docket Widget App Store", "Docket Share App Store" (installed from the
# developer portal or App Store Connect API).
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
set -a; . "$ROOT/.env.release"; set +a
MOBILE="$ROOT/apps/mobile"
OUT="$MOBILE/ios/build/release"
BUNDLE=$(node -p "require('$MOBILE/app.json').expo.ios.bundleIdentifier")

cd "$MOBILE"
CI=1 npx expo prebuild -p ios --no-install >/dev/null
(cd ios && pod install >/dev/null)

# Manual signing per target: each one gets its own App Store profile. The xcodeproj gem comes
# with CocoaPods, so use CocoaPods' Ruby and gem home (Homebrew install) when there is one.
POD_GEMS=$(sed -n 's/^GEM_HOME="\([^"]*\)".*/\1/p' "$(command -v pod)")
if [ -n "$POD_GEMS" ]; then RUBY=$(head -1 "$POD_GEMS/bin/pod" | sed 's/^#!//'); export GEM_HOME="$POD_GEMS"; else RUBY=ruby; fi
"$RUBY" - "$MOBILE/ios/Docket.xcodeproj" "$APPLE_TEAM_ID" <<'RUBY'
require 'xcodeproj'
path, team = ARGV
profiles = { 'Docket' => 'Docket App Store', 'DocketWidget' => 'Docket Widget App Store', 'DocketShare' => 'Docket Share App Store' }
project = Xcodeproj::Project.open(path)
project.targets.each do |t|
  next unless profiles[t.name]
  t.build_configurations.each do |c|
    next unless c.name == 'Release'
    c.build_settings['CODE_SIGN_STYLE'] = 'Manual'
    c.build_settings['DEVELOPMENT_TEAM'] = team
    c.build_settings['CODE_SIGN_IDENTITY'] = 'Apple Distribution'
    c.build_settings['CODE_SIGN_IDENTITY[sdk=iphoneos*]'] = 'Apple Distribution'
    c.build_settings['PROVISIONING_PROFILE_SPECIFIER'] = profiles[t.name]
  end
end
project.save
RUBY
unset GEM_HOME

# Signing keychain: a dedicated keychain holds the Apple Distribution identity (its random
# password lives in the login keychain as "docket-signing-keychain"), so codesign never needs the
# login keychain password. It joins the search list only for this build.
KC="$HOME/Library/Keychains/docket-signing.keychain-db"
ORIG_KEYCHAINS=$(security list-keychains -d user | tr -d '"' | xargs)
restore_keychains() { security list-keychains -d user -s $ORIG_KEYCHAINS; }
trap restore_keychains EXIT
security list-keychains -d user -s $ORIG_KEYCHAINS "$KC"
security unlock-keychain -p "$(security find-generic-password -a docket -s docket-signing-keychain -w)" "$KC"

rm -rf "$OUT"; mkdir -p "$OUT"
cd ios
xcodebuild -workspace Docket.xcworkspace -scheme Docket -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath "$MOBILE/ios/build/dd-archive" \
  -archivePath "$OUT/Docket.xcarchive" archive -quiet OTHER_CODE_SIGN_FLAGS="--keychain $KC"

cat > "$OUT/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>$APPLE_TEAM_ID</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key><dict>
    <key>$BUNDLE</key><string>Docket App Store</string>
    <key>$BUNDLE.widget</key><string>Docket Widget App Store</string>
    <key>$BUNDLE.share</key><string>Docket Share App Store</string>
  </dict>
  <key>uploadSymbols</key><true/>
</dict></plist>
EOF
xcodebuild -exportArchive -archivePath "$OUT/Docket.xcarchive" -exportPath "$OUT" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" -quiet
IPA=$(ls "$OUT"/*.ipa)
echo "exported $IPA"

if [ "${1:-}" = "--upload" ]; then
  mkdir -p "$HOME/.appstoreconnect/private_keys"
  ln -sf "$ASC_KEY_PATH" "$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8"
  xcrun altool --upload-app -f "$IPA" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
fi
