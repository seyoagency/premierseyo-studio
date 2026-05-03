#!/bin/bash
# PremierSEYO macOS .pkg builder
# Universal (arm64 + x86_64) bundled installer.
#
# Gereksinimler (CI veya lokal):
#   - macOS host (pkgbuild + productbuild + lipo + codesign)
#   - vendor/macos/{arm64,x86_64}/ altinda node ve ffmpeg binary'leri
#   - npm run build:assets onceden calistirilmis
#
# Ortam degiskenleri:
#   APPLE_TEAM_ID                 — code signing icin
#   APPLE_DEV_ID_APPLICATION_NAME — "Developer ID Application: ..." (codesign --sign)
#   APPLE_DEV_ID_INSTALLER_NAME   — "Developer ID Installer: ..." (productsign --sign)
#   APPLE_ID, APPLE_TEAM_ID, APPLE_NOTARY_PASSWORD — notarytool icin
#   PREMIERSEYO_SKIP_NOTARIZE=1   — sertifikasiz lokal test icin
#
# Cikti: dist/PremierSEYO-<VERSION>-universal.pkg

set -euo pipefail

REPO_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"
cd "$REPO_ROOT"

VERSION=$(/usr/bin/awk -F'"' '/"version"/ {print $4; exit}' manifest.json)
PKG_ID="com.seyoweb.premierseyostudio"
STAGING_ROOT="dist/macos/staging"
APP_PAYLOAD="$STAGING_ROOT/payload"
APP_INSTALL_DIR="$APP_PAYLOAD/Applications/PremierSEYO Studio"
SCRIPTS_DIR="$STAGING_ROOT/scripts"
COMPONENT_PKG="$STAGING_ROOT/component.pkg"
DIST_FILE="$STAGING_ROOT/distribution.xml"
OUT_DIR="dist"
OUT_PKG="$OUT_DIR/PremierSEYO-Studio-${VERSION}-universal.pkg"

VENDOR_ARM64="vendor/macos/arm64"
VENDOR_X86_64="vendor/macos/x86_64"

log() { printf "\033[1;34m[build-pkg]\033[0m %s\n" "$*"; }

# 1. Onkosul kontrolu
[ -f "src/bundle.js" ] || { echo "[build-pkg] ERR: src/bundle.js yok. once 'npm run build:assets' calistir."; exit 1; }
[ -d "$VENDOR_ARM64" ] || { echo "[build-pkg] ERR: $VENDOR_ARM64 yok"; exit 1; }
[ -d "$VENDOR_X86_64" ] || { echo "[build-pkg] ERR: $VENDOR_X86_64 yok"; exit 1; }
[ -f "$VENDOR_ARM64/node" ] || { echo "[build-pkg] ERR: $VENDOR_ARM64/node yok"; exit 1; }
[ -f "$VENDOR_X86_64/node" ] || { echo "[build-pkg] ERR: $VENDOR_X86_64/node yok"; exit 1; }
[ -f "$VENDOR_ARM64/ffmpeg" ] || { echo "[build-pkg] ERR: $VENDOR_ARM64/ffmpeg yok"; exit 1; }
[ -f "$VENDOR_X86_64/ffmpeg" ] || { echo "[build-pkg] ERR: $VENDOR_X86_64/ffmpeg yok"; exit 1; }

log "version=$VERSION"

# 2. Staging temizle
rm -rf "$STAGING_ROOT"
mkdir -p "$APP_INSTALL_DIR" "$APP_INSTALL_DIR/daemon" "$APP_INSTALL_DIR/plugin-source" "$SCRIPTS_DIR" "$OUT_DIR"

# 3. Universal binary uret (lipo)
log "lipo: node + ffmpeg universal"
/usr/bin/lipo -create -output "$APP_INSTALL_DIR/node" "$VENDOR_ARM64/node" "$VENDOR_X86_64/node"
/usr/bin/lipo -create -output "$APP_INSTALL_DIR/ffmpeg" "$VENDOR_ARM64/ffmpeg" "$VENDOR_X86_64/ffmpeg"
chmod +x "$APP_INSTALL_DIR/node" "$APP_INSTALL_DIR/ffmpeg"

# 4. Daemon dosyalari
log "daemon -> $APP_INSTALL_DIR/daemon"
/usr/bin/rsync -a --exclude="install-daemon.sh" --exclude="uninstall-daemon.sh" --exclude="*.plist" \
  daemon/ "$APP_INSTALL_DIR/daemon/"

# 5. Plugin source (postinstall bunu kullaniciya kopyalar)
log "plugin-source -> $APP_INSTALL_DIR/plugin-source"
/usr/bin/rsync -a manifest.json "$APP_INSTALL_DIR/plugin-source/"
/usr/bin/rsync -a src/ "$APP_INSTALL_DIR/plugin-source/src/"
/usr/bin/rsync -a icons/ "$APP_INSTALL_DIR/plugin-source/icons/"

# 6. Scripts (preinstall + postinstall)
log "scripts kopyalanyor"
cp installer/macos/scripts/preinstall "$SCRIPTS_DIR/preinstall"
cp installer/macos/scripts/postinstall "$SCRIPTS_DIR/postinstall"
chmod +x "$SCRIPTS_DIR/preinstall" "$SCRIPTS_DIR/postinstall"

# 7. Code signing — Apple binary'leri imzalamak zorunlu (notarize icin)
if [ "${PREMIERSEYO_SKIP_NOTARIZE:-0}" != "1" ] && [ -n "${APPLE_DEV_ID_APPLICATION_NAME:-}" ]; then
  log "codesign: node + ffmpeg + daemon files"
  /usr/bin/codesign --force --options runtime --timestamp \
    --sign "$APPLE_DEV_ID_APPLICATION_NAME" \
    "$APP_INSTALL_DIR/node" "$APP_INSTALL_DIR/ffmpeg"
  # Daemon JS dosyalari interpreter (node) tarafindan calistirildigi icin sign edilmesi
  # gerekli degil — sadece executable'lar icin codesign zorunlu.
else
  log "WARN: codesign atlandi (APPLE_DEV_ID_APPLICATION_NAME yok veya SKIP_NOTARIZE=1)"
fi

# 8. Component pkg uret (root install)
log "pkgbuild -> $COMPONENT_PKG"
/usr/bin/pkgbuild \
  --root "$APP_PAYLOAD" \
  --identifier "$PKG_ID" \
  --version "$VERSION" \
  --scripts "$SCRIPTS_DIR" \
  --install-location "/" \
  "$COMPONENT_PKG"

# 9. Distribution XML
cat > "$DIST_FILE" <<DIST
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
    <title>PremierSEYO</title>
    <organization>com.seyoweb</organization>
    <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
    <options customize="never" require-scripts="true" rootVolumeOnly="true" allow-external-scripts="no"/>
    <volume-check>
        <allowed-os-versions>
            <os-version min="11.0"/>
        </allowed-os-versions>
    </volume-check>
    <choices-outline>
        <line choice="default">
            <line choice="$PKG_ID"/>
        </line>
    </choices-outline>
    <choice id="default" title="PremierSEYO"/>
    <choice id="$PKG_ID" visible="false">
        <pkg-ref id="$PKG_ID"/>
    </choice>
    <pkg-ref id="$PKG_ID" version="$VERSION" onConclusion="none">component.pkg</pkg-ref>
</installer-gui-script>
DIST

# 10. productbuild + sign
log "productbuild -> $OUT_PKG"
if [ "${PREMIERSEYO_SKIP_NOTARIZE:-0}" != "1" ] && [ -n "${APPLE_DEV_ID_INSTALLER_NAME:-}" ]; then
  /usr/bin/productbuild \
    --distribution "$DIST_FILE" \
    --package-path "$STAGING_ROOT" \
    --sign "$APPLE_DEV_ID_INSTALLER_NAME" \
    "$OUT_PKG"
else
  /usr/bin/productbuild \
    --distribution "$DIST_FILE" \
    --package-path "$STAGING_ROOT" \
    "$OUT_PKG"
fi

# 11. Notarize + staple
if [ "${PREMIERSEYO_SKIP_NOTARIZE:-0}" = "1" ]; then
  log "WARN: notarize atlandi (PREMIERSEYO_SKIP_NOTARIZE=1)"
elif [ -z "${APPLE_ID:-}" ] || [ -z "${APPLE_TEAM_ID:-}" ] || [ -z "${APPLE_NOTARY_PASSWORD:-}" ]; then
  log "WARN: APPLE_ID/APPLE_TEAM_ID/APPLE_NOTARY_PASSWORD eksik, notarize atlandi"
else
  log "notarytool submit (Apple'in tarama suresi 5-15 dk)"
  /usr/bin/xcrun notarytool submit "$OUT_PKG" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_NOTARY_PASSWORD" \
    --wait
  log "stapler staple"
  /usr/bin/xcrun stapler staple "$OUT_PKG"
  /usr/bin/xcrun stapler validate "$OUT_PKG"
fi

# 12. Final boyut + checksum
SIZE_MB=$(/usr/bin/du -m "$OUT_PKG" | /usr/bin/cut -f1)
SHA256=$(/usr/bin/shasum -a 256 "$OUT_PKG" | /usr/bin/awk '{print $1}')
log "OK: $OUT_PKG (${SIZE_MB} MB)"
log "sha256: $SHA256"
