#!/bin/bash
# PremierSEYO Helper Daemon — kurulum scripti
#
# 1. Bağımlılık kontrolü (node + ffmpeg)
# 2. Eski (premiere-cut/premiercut) kurulumu varsa otomatik migrate
# 3. Deepgram API key prompt + validate
# 4. LaunchAgent kur, daemon başlat
# 5. Plugin'i Premiere UXP install dizinine kopyala (npm run build)
#
# Tek-script kurulum: ./scripts/install.sh repo kökünden çağrılır
# veya doğrudan: ./daemon/install-daemon.sh

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
DAEMON_PATH="$SCRIPT_DIR/server.js"
PLIST_TEMPLATE="$SCRIPT_DIR/com.seyoweb.premierseyostudio.daemon.plist"
PLIST_TARGET="$HOME/Library/LaunchAgents/com.seyoweb.premierseyostudio.daemon.plist"

# Yeni standart path'ler (premier-seyo)
CFG_DIR="$HOME/.config/premier-seyo"
KEY_FILE="$CFG_DIR/deepgram.key"
TOKEN_FILE="$CFG_DIR/token"
LOG_FILE="$HOME/Library/Logs/premierseyo-daemon.log"
ERR_LOG_FILE="$HOME/Library/Logs/premierseyo-daemon.error.log"

# Eski path'ler (migration kaynağı)
OLD_PLIST_TARGET="$HOME/Library/LaunchAgents/com.seyoweb.premierecut.daemon.plist"
OLD_CFG_DIR="$HOME/.config/premiere-cut"
OLD_LOG="$HOME/Library/Logs/premierecut-daemon.log"
OLD_ERR_LOG="$HOME/Library/Logs/premierecut-daemon.error.log"

c_green() { printf "\033[1;32m%s\033[0m\n" "$1"; }
c_yellow() { printf "\033[1;33m%s\033[0m\n" "$1"; }
c_red() { printf "\033[1;31m%s\033[0m\n" "$1"; }
c_blue() { printf "\033[1;34m%s\033[0m\n" "$1"; }

c_blue "==> PremierSEYO kurulumu başlıyor..."
echo

# ─────────────────────────────────────────────────────────────────────────────
# 1. Bağımlılık kontrolü
# ─────────────────────────────────────────────────────────────────────────────

NODE_PATH=$(which node 2>/dev/null || true)
[ -z "$NODE_PATH" ] && [ -x /opt/homebrew/bin/node ] && NODE_PATH=/opt/homebrew/bin/node
[ -z "$NODE_PATH" ] && [ -x /usr/local/bin/node ] && NODE_PATH=/usr/local/bin/node

if [ -z "$NODE_PATH" ]; then
  c_red "Node.js bulunamadı."
  echo "Yükle: brew install node"
  exit 1
fi
c_green "Node.js bulundu: $NODE_PATH"

if ! command -v ffmpeg >/dev/null 2>&1; then
  c_red "FFmpeg bulunamadı."
  echo "Yükle: brew install ffmpeg"
  exit 1
fi
c_green "FFmpeg bulundu: $(which ffmpeg)"
echo

# ─────────────────────────────────────────────────────────────────────────────
# 2. Eski kurulum migration
# ─────────────────────────────────────────────────────────────────────────────

MIGRATED=0

if [ -f "$OLD_PLIST_TARGET" ]; then
  c_yellow "==> Eski LaunchAgent (premierecut) bulundu, kaldırılıyor..."
  launchctl unload "$OLD_PLIST_TARGET" 2>/dev/null || true
  rm -f "$OLD_PLIST_TARGET"
  MIGRATED=1
fi

mkdir -p "$CFG_DIR"
chmod 700 "$CFG_DIR"

if [ -d "$OLD_CFG_DIR" ]; then
  c_yellow "==> Eski config dizini ($OLD_CFG_DIR) yeni konuma taşınıyor..."
  if [ -f "$OLD_CFG_DIR/deepgram.key" ] && [ ! -f "$KEY_FILE" ]; then
    mv "$OLD_CFG_DIR/deepgram.key" "$KEY_FILE"
    chmod 600 "$KEY_FILE"
    c_green "    deepgram.key taşındı"
  fi
  if [ -f "$OLD_CFG_DIR/token" ] && [ ! -f "$TOKEN_FILE" ]; then
    mv "$OLD_CFG_DIR/token" "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
    c_green "    token taşındı"
  fi
  rmdir "$OLD_CFG_DIR" 2>/dev/null || true
  MIGRATED=1
fi

if [ -f "$OLD_LOG" ]; then
  mv "$OLD_LOG" "$LOG_FILE" 2>/dev/null || true
fi
if [ -f "$OLD_ERR_LOG" ]; then
  mv "$OLD_ERR_LOG" "$ERR_LOG_FILE" 2>/dev/null || true
fi

[ "$MIGRATED" = "1" ] && { c_green "Migration tamamlandı."; echo; }

# ─────────────────────────────────────────────────────────────────────────────
# 3. Deepgram API Key
# ─────────────────────────────────────────────────────────────────────────────

if [ ! -f "$KEY_FILE" ] || [ ! -s "$KEY_FILE" ]; then
  c_blue "==> Deepgram API Key gerekli"
  echo "Henüz key'in yoksa:"
  echo "  1. https://console.deepgram.com adresine git"
  echo "  2. Sign up (Google/GitHub ile, ücretsiz 200 USD kredi)"
  echo "  3. Sol menüden 'API Keys' > 'Create a New API Key'"
  echo "  4. Permission: 'Member' seç, key'i kopyala"
  echo
  # Stdin pipe ortaminda (curl | bash) prompt EOF aliyor; set -e ile crash etmesin diye `|| true`
  DG_KEY=""
  if [ -t 0 ]; then
    read -r -p "Key'i şimdi yapıştır (boş bırakırsan eklentide ayarlardan girebilirsin): " DG_KEY || DG_KEY=""
  else
    # Non-interactive (curl | bash veya stdin'den okuma): stdin'in ilk satirini key olarak dene; yoksa bos
    read -r DG_KEY || DG_KEY=""
    if [ -n "$DG_KEY" ]; then
      c_blue "==> Deepgram key stdin'den alindi (${#DG_KEY} karakter)"
    else
      c_yellow "==> Stdin bos, Deepgram key atlandi (eklenti drawer'indan girebilirsin)"
    fi
  fi
  echo

  if [ -n "$DG_KEY" ]; then
    if [ ${#DG_KEY} -lt 20 ]; then
      c_red "Key çok kısa (min 20 karakter). Atlanıyor."
    else
      printf "%s" "$DG_KEY" > "$KEY_FILE"
      chmod 600 "$KEY_FILE"
      c_green "Key kaydedildi: $KEY_FILE"

      # Hızlı validation
      echo -n "  Doğrulanıyor... "
      HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" -m 8 \
        -H "Authorization: Token $DG_KEY" \
        https://api.deepgram.com/v1/projects 2>/dev/null || echo "000")
      case "$HTTP_CODE" in
        200) c_green "geçerli ✓" ;;
        401|403) c_red "geçersiz ✗ — eklentide ayarlardan tekrar gir" ;;
        000) c_yellow "internet erişimi yok, daha sonra test edersin" ;;
        *) c_yellow "Deepgram cevap kodu $HTTP_CODE — daha sonra test et" ;;
      esac
    fi
  else
    c_yellow "Key girilmedi. Eklenti açıldıktan sonra Ayarlar drawer'ından girebilirsin."
  fi
  echo
else
  c_green "Mevcut Deepgram key bulundu: $KEY_FILE"
  echo
fi

# ─────────────────────────────────────────────────────────────────────────────
# 4. LaunchAgent kurulumu
# ─────────────────────────────────────────────────────────────────────────────

c_blue "==> LaunchAgent kuruluyor..."
mkdir -p "$HOME/Library/LaunchAgents"

# Template'i doldur
sed -e "s|__DAEMON_PATH__|$DAEMON_PATH|g" \
    -e "s|__HOME__|$HOME|g" \
    -e "s|__WORKDIR__|$SCRIPT_DIR|g" \
    -e "s|/usr/local/bin/node|$NODE_PATH|g" \
    "$PLIST_TEMPLATE" > "$PLIST_TARGET"

# Eski yüklü ise unload
launchctl unload "$PLIST_TARGET" 2>/dev/null || true

# Yükle
launchctl load "$PLIST_TARGET"

# Doğrulama (3 retry)
DAEMON_OK=0
for i in 1 2 3; do
  sleep 2
  if curl -sf -m 3 http://127.0.0.1:53117/ping > /dev/null 2>&1; then
    DAEMON_OK=1
    break
  fi
done

if [ "$DAEMON_OK" = "1" ]; then
  c_green "Daemon çalışıyor: http://127.0.0.1:53117"
else
  c_yellow "Daemon başlatıldı ama ping cevap vermiyor."
  echo "  Log: $LOG_FILE"
  echo "  Error log: $ERR_LOG_FILE"
fi
echo

# ─────────────────────────────────────────────────────────────────────────────
# 5. Plugin build + deploy
# ─────────────────────────────────────────────────────────────────────────────

c_blue "==> UXP Plugin build + deploy..."
cd "$REPO_ROOT"

if [ -f "package.json" ]; then
  if npm run build > /tmp/premierseyo-build.log 2>&1; then
    c_green "Plugin build edildi."
    grep "deploy" /tmp/premierseyo-build.log | tail -3
  else
    c_red "Plugin build başarısız:"
    cat /tmp/premierseyo-build.log
    exit 1
  fi
else
  c_yellow "package.json yok, plugin build atlanıyor."
fi
echo

# ─────────────────────────────────────────────────────────────────────────────
# 6. Final mesaj
# ─────────────────────────────────────────────────────────────────────────────

if pgrep -f "Adobe Premiere Pro" > /dev/null 2>&1; then
  c_yellow "==> Premiere Pro şu anda açık."
  echo "    Yeni eklenti yüklenmesi için Cmd+Q ile tam kapatıp tekrar açman gerek."
  echo
fi

c_green "✓ Kurulum tamamlandı"
echo
echo "Sonraki adımlar:"
echo "  1. Premiere Pro'yu Cmd+Q ile kapat → tekrar aç"
echo "  2. Window > UXP Plugins > PremierSEYO > PremierSEYO"
echo "  3. Drawer (sağ üst ⚙) → API Key kontrolü"
echo
echo "Sorun olursa:"
echo "  - Daemon log: tail -20 $LOG_FILE"
echo "  - Daemon yeniden başlat: launchctl unload && launchctl load $PLIST_TARGET"
echo "  - Tam kaldırma: ./daemon/uninstall-daemon.sh --purge"
