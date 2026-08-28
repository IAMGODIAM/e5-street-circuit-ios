#!/usr/bin/env bash
# Apply release-only iOS metadata to the committed Capacitor project.
set -euo pipefail

PLIST="ios/App/App/Info.plist"
PRIVACY="ios/App/App/PrivacyInfo.xcprivacy"
PLIST_BUDDY="/usr/libexec/PlistBuddy"
BUILD_NUM="${BUILD_NUMBER:-${PROJECT_BUILD_NUMBER:-1}}"

if [[ ! "$BUILD_NUM" =~ ^[1-9][0-9]{0,3}(\.[0-9]{1,2}){0,2}$ ]]; then
  echo "Invalid CFBundleVersion '$BUILD_NUM' (expected 1–4 digits, optionally followed by two 1–2 digit components)." >&2
  exit 1
fi

set_bool() {
  "$PLIST_BUDDY" -c "Delete :$1" "$PLIST" 2>/dev/null || true
  "$PLIST_BUDDY" -c "Add :$1 bool $2" "$PLIST"
}

# Landscape racing UI on both iPhone and iPad.
for key in UISupportedInterfaceOrientations 'UISupportedInterfaceOrientations~ipad'; do
  "$PLIST_BUDDY" -c "Delete :$key" "$PLIST" 2>/dev/null || true
  "$PLIST_BUDDY" -c "Add :$key array" "$PLIST"
  "$PLIST_BUDDY" -c "Add :$key:0 string UIInterfaceOrientationLandscapeLeft" "$PLIST"
  "$PLIST_BUDDY" -c "Add :$key:1 string UIInterfaceOrientationLandscapeRight" "$PLIST"
done

set_bool UIStatusBarHidden true
set_bool UIViewControllerBasedStatusBarAppearance false
set_bool UIRequiresFullScreen true
set_bool CADisableMinimumFrameDurationOnPhone true
set_bool ITSAppUsesNonExemptEncryption false
set_bool UIApplicationSupportsIndirectInputEvents true
set_bool UIDesignRequiresCompatibility true

# Private seat links. The web layer immediately removes the token from the URL.
"$PLIST_BUDDY" -c "Delete :CFBundleURLTypes" "$PLIST" 2>/dev/null || true
"$PLIST_BUDDY" -c "Add :CFBundleURLTypes array" "$PLIST"
"$PLIST_BUDDY" -c "Add :CFBundleURLTypes:0 dict" "$PLIST"
"$PLIST_BUDDY" -c "Add :CFBundleURLTypes:0:CFBundleURLName string com.e5enclave.streetcircuit" "$PLIST"
"$PLIST_BUDDY" -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PLIST"
"$PLIST_BUDDY" -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string e5circuit" "$PLIST"

"$PLIST_BUDDY" -c "Delete :CFBundleVersion" "$PLIST" 2>/dev/null || true
"$PLIST_BUDDY" -c "Add :CFBundleVersion string $BUILD_NUM" "$PLIST"

plutil -lint "$PLIST" "$PRIVACY"
echo "Street Circuit iOS metadata validated · build $BUILD_NUM"
