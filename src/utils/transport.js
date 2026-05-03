/**
 * Transport façade — plugin'in dış dünya ile tüm temasını tek noktadan yönetir.
 *
 * Tasarım: daemon HTTP client'ı (legacy v1 mimarisi) ile UXP-native implementasyonlar
 * (v2 self-contained) arasında köprü. Plugin kodu artık `daemon.*` yerine `transport.*`
 * çağırır. Phase 2-6 boyunca her metod yavaş yavaş daemon'dan UXP-native'e geçirilecek.
 *
 * Phase 1: tüm metodlar daemon.js'e delege (no-op refactor).
 * Phase 2 (mevcut): setDeepgramKey, deepgramTest, check → secureStorage + plugin-side fetch
 * Phase 3: transcribe, silenceDetect → plugin-side Deepgram client
 * Phase 4: writeFile, reveal, getHomeDirs → UXP localFileSystem + shell
 * Phase 5: exportAudio → AME EncoderManager
 * Phase 7: daemon.js silinir
 */

const daemon = require("./daemon");
const secretStore = require("./secret-store");

// ——— Phase 2: secureStorage + plugin-side Deepgram auth ———

async function setDeepgramKey(key) {
  return secretStore.setKey(key);
}

async function deepgramTest(tempKey) {
  const key = (tempKey && String(tempKey).trim()) || (await secretStore.getKey());
  if (!key) {
    return { ok: false, error: "Key girilmedi" };
  }
  try {
    const res = await fetch("https://api.deepgram.com/v1/projects", {
      method: "GET",
      headers: { Authorization: `Token ${key}` },
    });
    if (res.ok) {
      return { ok: true, valid: true, message: "Key geçerli" };
    }
    if (res.status === 401) {
      return { ok: true, valid: false, message: "Geçersiz key (401)" };
    }
    return { ok: true, valid: false, message: `Deepgram HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e.message || "Deepgram'a ulaşılamadı (network?)" };
  }
}

/**
 * Connection status check.
 * - deepgram: secureStorage'da geçerli key var mı
 * - ame: Adobe Media Encoder kurulu mu (audio mixdown için zorunlu)
 *
 * Geriye uyumluluk: ffmpeg/whisper/models alanları false döner — eski
 * UI kodu badge'leri "yok" olarak işaretler.
 */
async function check() {
  const key = await secretStore.getKey();
  let amePresent = false;
  try {
    const ppro = require("premierepro");
    const mgr = ppro.EncoderManager.getManager();
    amePresent = !!(mgr && mgr.isAMEInstalled);
  } catch {
    amePresent = false;
  }
  return {
    ok: true,
    deepgram: !!key,
    ame: amePresent,
    // Geriye uyumluluk için (eski v1 UI kodu hala bunları okuyor olabilir)
    ffmpeg: false,
    whisper: !!key,
    models: key ? ["nova-3"] : [],
  };
}

async function ping() {
  // v2'de daemon yok; ping anlamsız ama backward-compat için her zaman OK döner
  return { ok: true };
}

// ——— Phase 3+ için hala daemon'a delege (geçici) ———

async function call(path, body, timeoutMs) {
  return daemon.call(path, body, timeoutMs);
}

async function exportAudio(opts) {
  return daemon.exportAudio(opts);
}

async function silenceDetect(opts) {
  return daemon.silenceDetect(opts);
}

async function transcribe(opts) {
  return daemon.transcribe(opts);
}

async function writeFile(opts) {
  return daemon.writeFile(opts);
}

async function reveal(filePath) {
  return daemon.reveal(filePath);
}

async function getHomeDirs() {
  return daemon.getHomeDirs();
}

async function log(tag, message) {
  // v2'de log daemon'a değil console'a — ufak optimization
  try {
    console.log(`[${tag}]`, message);
  } catch {}
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
  DAEMON_URL: daemon.DAEMON_URL,
};
