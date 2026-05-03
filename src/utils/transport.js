/**
 * Transport façade — plugin'in dış dünya ile tüm temasını tek noktadan yönetir.
 *
 * Tarihsel: v1 mimaride bu modül daemon HTTP client'ına delege ediyordu.
 * v2'de daemon tamamen kaldırıldı; tüm metodlar UXP-native:
 *   - setDeepgramKey / deepgramTest / check → secureStorage + plugin fetch
 *   - transcribe / silenceDetect → plugin-side Deepgram client
 *   - writeFile / reveal / getHomeDirs → UXP localFileSystem + shell
 *   - exportAudio → AME EncoderManager (audio-exporter.js'de doğrudan)
 *   - log → console.log
 */

const secretStore = require("./secret-store");
const deepgramClient = require("../core/deepgram-client");
const fileSaver = require("./file-saver");

// ——— Auth & connection ———

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
    // Backwards-compat: eski badge isimleri için
    ffmpeg: amePresent,
    whisper: !!key,
    models: key ? ["nova-3"] : [],
  };
}

async function ping() {
  return { ok: true };
}

// ——— Audio analysis (Deepgram) ———

async function silenceDetect({ audioPath, minDuration = 0.4, language = "tr", uttSplit = 0.8 } = {}) {
  const json = await deepgramClient.transcribeFile(audioPath, { language, uttSplit });
  const regions = deepgramClient.deriveSilenceRegions(json, { minSilence: minDuration });
  const duration = deepgramClient.getDuration(json);
  return { ok: true, regions, duration };
}

async function transcribe({ audioPath, language = "tr", keyterm = null, uttSplit = 0.8 } = {}) {
  const json = await deepgramClient.transcribeFile(audioPath, { language, keyterm, uttSplit });
  return { ok: true, result: json };
}

// ——— File system ———

async function writeFile({ filePath, content } = {}) {
  const savedPath = await fileSaver.writeAtPath(filePath, content);
  return { ok: true, path: savedPath };
}

async function reveal(filePath) {
  return fileSaver.revealInOS(filePath);
}

async function getHomeDirs() {
  return fileSaver.getHomeDirs();
}

// ——— Logging ———

async function log(tag, message) {
  try {
    console.log(`[${tag}]`, message);
  } catch {}
}

module.exports = {
  ping,
  check,
  silenceDetect,
  transcribe,
  writeFile,
  reveal,
  getHomeDirs,
  log,
  setDeepgramKey,
  deepgramTest,
};
