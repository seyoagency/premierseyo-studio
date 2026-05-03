/**
 * Konusma tanima — daemon uzerinden Deepgram Nova-3
 *
 * Daemon `/transcribe` endpoint'i Deepgram raw response dondurur.
 * Bu modul Deepgram cevabini plugin'in beklediği TranscriptSegment[]
 * formatina cevirir (eski Whisper parser'ın çıkış sözleşmesi korunur).
 */

const daemon = require("../utils/daemon");

/**
 * @typedef {Object} Word
 * @property {string} text
 * @property {number} start
 * @property {number} end
 * @property {number} [confidence]
 */

/**
 * @typedef {Object} TranscriptSegment
 * @property {string} text
 * @property {number} start
 * @property {number} end
 * @property {Word[]} words
 */

/**
 * @param {string} audioPath
 * @param {object} [options]
 * @returns {Promise<TranscriptSegment[]>}
 */
async function transcribe(audioPath, { language = "tr", keyterm = null } = {}) {
  const res = await daemon.transcribe({ audioPath, language, keyterm });
  return parseDeepgramOutput(res.result);
}

/**
 * Deepgram cevabini TranscriptSegment[]'e cevir.
 * Deepgram results.utterances tek konusmaci icin yeterince granular segment verir.
 */
function parseDeepgramOutput(deepgramJson) {
  if (!deepgramJson || !deepgramJson.results) return [];

  const utterances = Array.isArray(deepgramJson.results.utterances)
    ? deepgramJson.results.utterances
    : [];

  if (utterances.length > 0) {
    return utterances
      .map((u) => normalizeUtterance(u))
      .filter((s) => s && s.text)
      .sort((a, b) => a.start - b.start);
  }

  // Utterance yoksa channel words'ten fallback (Deepgram her durumda words döner)
  const channels = Array.isArray(deepgramJson.results.channels) ? deepgramJson.results.channels : [];
  const alt = channels[0] && Array.isArray(channels[0].alternatives) ? channels[0].alternatives[0] : null;
  if (!alt || !Array.isArray(alt.words) || alt.words.length === 0) return [];

  const words = alt.words.map(normalizeWord).filter(Boolean);
  if (words.length === 0) return [];

  return [
    {
      text: words.map((w) => w.text).join(" "),
      start: words[0].start,
      end: words[words.length - 1].end,
      words,
    },
  ];
}

function normalizeUtterance(u) {
  if (!u) return null;
  const start = Number(u.start);
  const end = Number(u.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;

  const words = Array.isArray(u.words) ? u.words.map(normalizeWord).filter(Boolean) : [];
  const text = (u.transcript || words.map((w) => w.text).join(" ")).trim();
  return { text, start, end, words };
}

function normalizeWord(w) {
  if (!w) return null;
  const text = (w.punctuated_word || w.word || "").trim();
  const start = Number(w.start);
  const end = Number(w.end);
  if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const confidence = Number(w.confidence);
  return Number.isFinite(confidence) ? { text, start, end, confidence } : { text, start, end };
}

module.exports = { transcribe, parseDeepgramOutput };
