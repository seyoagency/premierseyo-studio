#!/bin/bash
# PremierSEYO Helper Daemon — kaldırma scripti
#
# Modlar:
#   ./uninstall-daemon.sh         Daemon stop + plist sil
#   ./uninstall-daemon.sh --purge + config + log + key + tmp + plugin install dizini
#
# Hem yeni (premierseyo) hem eski (premierecut) kurulumları temizler.

set -e

PURGE=0
[ "$1" = "--purge" ] && PURGE=1

# Yeni isim
PLIST_NEW="$HOME/Library/LaunchAgents/com.seyoweb.premierseyostudio.daemon.plist"
CFG_DIR_NEW="$HOME/.config/premier-seyo"
LOG_NEW="$HOME/Library/Logs/premierseyo-daemon.log"
ERR_LOG_NEW="$HOME/Library/Logs/premierseyo-daemon.error.log"

# Eski isim
PLIST_OLD="$HOME/Library/LaunchAgents/com.seyoweb.premierecut.daemon.plist"
CFG_DIR_OLD="$HOME/.config/premiere-cut"
LOG_OLD="$HOME/Library/Logs/premierecut-daemon.log"
ERR_LOG_OLD="$HOME/Library/Logs/premierecut-daemon.error.log"

# Plugin install dizini (her iki versiyon)
PLUGIN_BASE="$HOME/Library/Application Support/Adobe/UXP/Plugins/External"

c_green() { printf "\033[1;32m%s\033[0m\n" "$1"; }
c_yellow() { printf "\033[1;33m%s\033[0m\n" "$1"; }
c_blue() { printf "\033[1;34m%s\033[0m\n" "$1"; }

c_blue "==> PremierSEYO daemon kaldırılıyor..."

# LaunchAgent unload + plist sil (yeni + eski)
for PLIST in "$PLIST_NEW" "$PLIST_OLD"; do
  if [ -f "$PLIST" ]; then
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    c_green "Kaldırıldı: $PLIST"
  fi
done

# TMP dizinleri temizle
rm -rf "$TMPDIR/premier-seyo" "$TMPDIR/premiere-cut" /tmp/premier-seyo /tmp/premiere-cut 2>/dev/null || true

if [ "$PURGE" = "1" ]; then
  c_yellow "==> --purge modu: tüm artefactlar temizleniyor"

  # API key + token + config
  for DIR in "$CFG_DIR_NEW" "$CFG_DIR_OLD"; do
    if [ -d "$DIR" ]; then
      rm -rf "$DIR"
      c_green "Silindi: $DIR"
    fi
  done

  # Log dosyaları
  for LOG in "$LOG_NEW" "$ERR_LOG_NEW" "$LOG_OLD" "$ERR_LOG_OLD"; do
    [ -f "$LOG" ] && rm -f "$LOG" && c_green "Silindi: $LOG"
  done

  # Plugin install dizini (com.seyoweb.premierseyostudio_*)
  if [ -d "$PLUGIN_BASE" ]; then
    for D in "$PLUGIN_BASE"/com.seyoweb.premierseyostudio_*; do
      [ -d "$D" ] && rm -rf "$D" && c_green "Silindi: $D"
    done
  fi

  echo
  c_yellow "NOT: Eklenti localStorage ayarları (premierseyo-settings-v2) Premiere'in"
  c_yellow "      WebStorage cache'inde kalmış olabilir. Premiere kapatılınca temizlenir."
fi

echo
c_green "✓ Kaldırma tamamlandı"

if [ "$PURGE" = "0" ]; then
  echo
  echo "Tam temizlik için: ./uninstall-daemon.sh --purge"
  echo "  (config + log + key + plugin install dizini)"
fi
