/**
 * Transport façade — plugin'in dış dünya ile tüm temasını tek noktadan yönetir.
 *
 * Tasarım: daemon HTTP client'ı (legacy v1 mimarisi) ile UXP-native implementasyonlar
 * (v2 self-contained) arasında köprü. Plugin kodu artık `daemon.*` yerine `transport.*`
 * çağırır. Phase 2-6 boyunca her metod yavaş yavaş daemon'dan UXP-native'e geçirilecek.
 *
 * Phase 1 (mevcut): tüm metodlar daemon.js'e delege eder (no-op refactor).
 * Phase 2: setDeepgramKey, deepgramTest, check → secureStorage + plugin-side fetch
 * Phase 3: transcribe, silenceDetect → plugin-side Deepgram client
 * Phase 4: writeFile, reveal, getHomeDirs → UXP localFileSystem + shell
 * Phase 5: exportAudio → AME EncoderManager
 * Phase 7: daemon.js silinir, transport.js içindeki daemon import'ları kaldırılır
 */

const daemon = require("./daemon");

// API surface — daemon.js ile birebir aynı
async function call(path, body, timeoutMs) {
  return daemon.call(path, body, timeoutMs);
}

async function ping() {
  return daemon.ping();
}

async function check() {
  return daemon.check();
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
  return daemon.log(tag, message);
}

async function setDeepgramKey(key) {
  return daemon.setDeepgramKey(key);
}

async function deepgramTest(tempKey) {
  return daemon.deepgramTest(tempKey);
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
