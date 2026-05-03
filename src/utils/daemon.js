/**
 * Daemon HTTP client — UXP plugin ile local helper daemon arasinda kopru
 *
 * UXP'de child_process olmadigi icin FFmpeg/whisper gibi islemler
 * daemon uzerinden HTTP ile yapilir. Auth: daemon ilk baslatmada
 * ~/.config/premier-seyo/token (chmod 600) uretir; plugin ayni dosyadan
 * okur ve X-Premiere-Cut-Token header'inda gonderir. Boylece tarayicidaki
 * bir site de localhost'a istek atsa bile token dosyasini okuyamaz.
 */

const DAEMON_URL = "http://127.0.0.1:53117";
const DEFAULT_TIMEOUT = 30 * 60 * 1000; // 30 dk (whisper icin)

let _cachedToken = null;
let _cachedHome = null;

function readTokenSafe() {
  // UXP'de fs.readFileSync kısıtlı olabilir; opsiyonel — başarısızsa null döner.
  if (_cachedToken) return _cachedToken;
  try {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tokenPath = path.join(os.homedir(), ".config", "premier-seyo", "token");
    const content = fs.readFileSync(tokenPath, "utf-8").trim();
    if (content && content.length >= 32) {
      _cachedToken = content;
      return content;
    }
  } catch {
    // UXP fs sandbox kısıtlaması — token opsiyonel kalır, daemon da o modda çalışır
  }
  return null;
}

async function call(path, body = null, timeoutMs = DEFAULT_TIMEOUT) {
  const url = DAEMON_URL + path;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (path !== "/ping") headers["X-Premiere-Cut-Client"] = "premierseyo-uxp";
  const token = path === "/ping" ? null : readTokenSafe();
  if (token) headers["X-Premiere-Cut-Token"] = token;

  try {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error(
          "Helper daemon yetkilendirmesi basarisiz. Daemon'u yeniden baslatin.\n" +
          "Komutlar: launchctl unload ~/Library/LaunchAgents/com.seyoweb.premierseyo.daemon.plist && " +
          "launchctl load ~/Library/LaunchAgents/com.seyoweb.premierseyo.daemon.plist"
        );
      }
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Daemon timeout (${timeoutMs}ms): ${path}`);
    }
    if (err.message && err.message.includes("fetch")) {
      throw new Error(
        "Helper daemon'a ulasilamadi. Lutfen daemon'un calistigindan emin olun.\n" +
        "Baslatma komutu: launchctl load ~/Library/LaunchAgents/com.seyoweb.premierseyo.daemon.plist"
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function ping() {
  return call("/ping", null, 3000);
}

async function check() {
  await ping();
  return call("/check", null, 10000);
}

async function exportAudio({ inputPath, sampleRate = 48000, mono = false, suffix = "" }) {
  return call("/export-audio", { inputPath, sampleRate, mono, suffix }, 600000);
}

async function silenceDetect({ audioPath, minDuration = 0.4, language = "tr", uttSplit = 0.8 }) {
  return call("/silence-detect", { audioPath, minDuration, language, uttSplit }, 600000);
}

async function transcribe({ audioPath, language = "tr", keyterm = null, uttSplit = 0.8 }) {
  return call("/transcribe", { audioPath, language, keyterm, uttSplit }, 10 * 60 * 1000);
}

async function writeFile({ filePath, content }) {
  return call("/write-file", { filePath, content }, 30000);
}

async function reveal(filePath) {
  return call("/reveal", { filePath }, 5000);
}

async function log(tag, message) {
  try {
    await call("/log", { tag, message }, 3000);
  } catch {}
}

async function setDeepgramKey(key) {
  return call("/set-deepgram-key", { key }, 5000);
}

async function deepgramTest(tempKey = null) {
  // tempKey verilirse daemon stored key yerine onu kullanır (kaydetmeden test).
  const body = (tempKey && tempKey.length >= 20) ? { key: tempKey } : null;
  return call("/deepgram-test", body, 12000);
}

/**
 * Daemon uzerinden kullanicinin home / Documents dizinlerini al.
 * UXP'de os.userInfo() guvenilir degil; daemon kendi tarafindan reel path dondurur.
 */
async function getHomeDirs() {
  if (_cachedHome) return _cachedHome;
  const res = await call("/home-dir", null, 5000);
  _cachedHome = { homeDir: res.homeDir, documentsDir: res.documentsDir };
  return _cachedHome;
}

module.exports = {
  call,
  ping,
  check,
  exportAudio,
  silenceDetect,
  transcribe,
  writeFile,
  reveal,
  getHomeDirs,
  log,
  setDeepgramKey,
  deepgramTest,
  DAEMON_URL,
};
