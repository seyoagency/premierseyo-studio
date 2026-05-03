/**
 * Secret store — Deepgram API key'i UXP secureStorage'da tutar.
 *
 * v1 mimaride daemon ~/.config/premier-seyo/deepgram.key dosyasında saklıyordu.
 * v2 self-contained mimaride plugin kendi secureStorage'ını kullanır:
 * - Cihaz bazli sifrelenmis (kullanici acccount-level)
 * - Sadece bu pluginId okuyabilir
 * - Plugin uninstall edilince silinir (uyari verilmeli UI'da)
 *
 * Migration: ilk acilista legacy daemon dosyasindan key'i otomatik kopyalar.
 */

const STORAGE_KEY = "deepgramApiKey";
const MIGRATION_FLAG = "premierseyo-studio-legacy-migrated-v1";

let _cachedKey = null;

function getSecureStorage() {
  try {
    return require("uxp").storage.secureStorage;
  } catch {
    return null;
  }
}

// secureStorage.getItem Uint8Array doner -> string'e cevir
function bytesToString(bytes) {
  if (!bytes) return null;
  if (typeof bytes === "string") return bytes;
  try {
    // Modern UXP'de TextDecoder destekleniyor olabilir
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder("utf-8").decode(bytes);
    }
  } catch {}
  // Fallback: byte-by-byte
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function stringToBytes(s) {
  try {
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(s);
    }
  } catch {}
  const arr = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i) & 0xff;
  return arr;
}

async function getKey() {
  if (_cachedKey) return _cachedKey;
  const ss = getSecureStorage();
  if (!ss) return null;
  try {
    const bytes = await ss.getItem(STORAGE_KEY);
    const str = bytesToString(bytes);
    if (str && str.length >= 32) {
      _cachedKey = str.trim();
      return _cachedKey;
    }
  } catch {
    // Key yok — null doneriz
  }
  return null;
}

async function setKey(key) {
  if (!key || typeof key !== "string" || key.trim().length < 32) {
    throw new Error("Gecersiz Deepgram API key (en az 32 karakter olmali)");
  }
  const ss = getSecureStorage();
  if (!ss) throw new Error("secureStorage UXP runtime'da kullanilabilir degil");
  await ss.setItem(STORAGE_KEY, stringToBytes(key.trim()));
  _cachedKey = key.trim();
  return _cachedKey;
}

async function removeKey() {
  _cachedKey = null;
  const ss = getSecureStorage();
  if (!ss) return;
  try {
    await ss.removeItem(STORAGE_KEY);
  } catch {}
}

/**
 * Legacy v1 daemon kurulumundan key'i taşı.
 * Bir kerelik: localStorage flag ile tekrar denenmez.
 */
async function migrateFromLegacy() {
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(MIGRATION_FLAG)) {
      return false; // Zaten migrate edildi
    }
  } catch {}

  // Mevcut secureStorage'da key varsa migration'a gerek yok
  const existing = await getKey();
  if (existing) {
    try { localStorage.setItem(MIGRATION_FLAG, "1"); } catch {}
    return false;
  }

  // Legacy dosyalarini oku
  try {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const legacyKeyPath = path.join(os.homedir(), ".config", "premier-seyo", "deepgram.key");
    const content = fs.readFileSync(legacyKeyPath, "utf-8").trim();
    if (content && content.length >= 32) {
      await setKey(content);
      try { localStorage.setItem(MIGRATION_FLAG, "1"); } catch {}
      return true;
    }
  } catch {
    // Legacy dosya yok veya okunamadi -- normal, sessiz gec
  }

  try { localStorage.setItem(MIGRATION_FLAG, "1"); } catch {}
  return false;
}

module.exports = {
  getKey,
  setKey,
  removeKey,
  migrateFromLegacy,
};
