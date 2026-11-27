#!/bin/bash
# Builds "Hop To It.app" and installs it into ~/Applications.
set -euo pipefail
cd "$(dirname "$0")"
APP="build/Hop To It.app"
rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -swift-version 5 -parse-as-library HopToIt.swift -o "$APP/Contents/MacOS/HopToIt" \
  -framework Cocoa -framework WebKit -framework ServiceManagement
"$APP/Contents/MacOS/HopToIt" --icons build/AppIcon.iconset
iconutil -c icns build/AppIcon.iconset -o "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Hop To It</string>
  <key>CFBundleDisplayName</key><string>Hop To It</string>
  <key>CFBundleIdentifier</key><string>local.hoptoit.app</string>
  <key>CFBundleExecutable</key><string>HopToIt</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --deep -s - "$APP"
mkdir -p ~/Applications
rm -rf ~/Applications/"Hop To It.app"
cp -R "$APP" ~/Applications/
echo "installed: ~/Applications/Hop To It.app"
