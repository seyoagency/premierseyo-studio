/**
 * Deepgram REST client — plugin-side (UXP fetch).
 *
 * v1 daemon/deepgram-client.js'in port'u. Node `https.request` → UXP `fetch`.
 * Audio dosyası UXP fs.readFileSync ile okunur (plugin manifest'te localFileSystem
 * fullAccess izni mevcut), Uint8Array body olarak Deepgram'a POST edilir.
 *
 * Cache: aynı oturumda Auto-Cut + Auto-SRT ardışık çağrıldığında tek istek.
 */

const secretStore = require("../utils/secret-store");

const CACHE = new Map(); // cacheKey -> { response, expires }
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 saat
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 dk

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function buildCacheKey(audioPath, language, uttSplit) {
  try {
    const fs = require("fs");
    const stat = fs.statSync(audioPath);
    return `${audioPath}::${stat.size}::${stat.mtimeMs}::${language}::${uttSplit}`;
  } catch {
    // statSync başarısızsa dosya yok demek; key unique olsun (cache hit olmasın)
    return `${audioPath}::${Date.now()}::${language}::${uttSplit}`;
  }
}

function getCached(cacheKey) {
  const entry = CACHE.get(cacheKey);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    CACHE.delete(cacheKey);
    return null;
  }
  return entry.response;
}

function setCached(cacheKey, response) {
  CACHE.set(cacheKey, { response, expires: Date.now() + CACHE_TTL_MS });
}

function clearCache() {
  CACHE.clear();
}

function humanizeDeepgramHttpError(statusCode, bodyStr) {
  if (statusCode === 401 || statusCode === 403) {
    return "Deepgram API key geçersiz veya yetkisiz. Sağ üst ⚙ ayar → 'Bağlantıyı Test Et' ile kontrol et.";
  }
  if (statusCode === 402 || statusCode === 429) {
    return "Deepgram aylık kredi/quota dolmuş. console.deepgram.com → Usage'dan kontrol et veya yeni bir hesap aç.";
  }
  if (statusCode === 413) {
    return "Audio dosyası Deepgram için çok büyük. Daha kısa bir bölüm seçip tekrar dene.";
  }
  if (statusCode >= 500 && statusCode < 600) {
    return `Deepgram servisinde geçici sorun (HTTP ${statusCode}). Birkaç dakika sonra tekrar dene.`;
  }
  let detail = "";
  try {
    const parsed = JSON.parse(bodyStr);
    detail = parsed.err_msg || parsed.message || parsed.error || parsed.reason || "";
  } catch {
    /* body JSON değil */
  }
  if (!detail) detail = String(bodyStr || "").slice(0, 200).trim();
  return `Deepgram hata kodu ${statusCode}${detail ? ": " + detail : ""}`;
}

function humanizeDeepgramNetworkError(err) {
  const msg = err && err.message ? err.message : String(err || "");
  if (/ECONNREFUSED|ENOTFOUND|ENETUNREACH|EAI_AGAIN|Failed to fetch|Network/i.test(msg)) {
    return "İnternet erişimi yok veya api.deepgram.com'a ulaşılamıyor. Ağ bağlantını kontrol et.";
  }
  if (/timeout|zaman aşımı|abort/i.test(msg)) {
    return "Deepgram isteği zaman aşımına uğradı. İnternet bağlantını veya audio dosya boyutunu kontrol et.";
  }
  if (/socket hang up|ECONNRESET/i.test(msg)) {
    return "Deepgram bağlantısı kesildi. Tekrar dene.";
  }
  return msg || "Deepgram'a ulaşırken bilinmeyen ağ hatası.";
}

/**
 * Audio dosyasını Deepgram'a gönder.
 * @param {string} audioPath
 * @param {object} options - language, uttSplit, model, keyterm[]
 * @returns {Promise<object>} Deepgram response JSON
 */
async function transcribeFile(audioPath, options = {}) {
  const fs = require("fs");
  try {
    fs.statSync(audioPath);
  } catch {
    throw new Error(`Audio dosyası yok: ${audioPath}`);
  }

  const isAuto = options.language === "auto";
  const language = isAuto ? null : options.language || "tr";
  const uttSplit = Number.isFinite(options.uttSplit) ? options.uttSplit : 0.8;
  const model = options.model || "nova-3";

  const cacheKey = buildCacheKey(audioPath, isAuto ? "auto" : language, uttSplit);
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const apiKey = await secretStore.getKey();
  if (!apiKey) {
    throw new Error(
      "Deepgram API key girilmemiş. Sağ üst ⚙ ayar ikonundan key girin."
    );
  }

  const params = new URLSearchParams({
    model,
    punctuate: "true",
    smart_format: "true",
    paragraphs: "true",
    utterances: "true",
    utt_split: String(uttSplit),
    diarize: "false",
  });
  if (isAuto) {
    params.append("detect_language", "true");
  } else {
    params.append("language", language);
  }
  if (Array.isArray(options.keyterm)) {
    for (const kt of options.keyterm) {
      if (kt && typeof kt === "string") params.append("keyterm", kt);
    }
  }

  // Audio binary'yi UXP fs ile oku (manifest'te fullAccess var)
  const buffer = fs.readFileSync(audioPath);
  // Buffer → Uint8Array (fetch body için ArrayBufferView destekli)
  let body;
  if (buffer && buffer.buffer && buffer.byteLength != null) {
    body = new Uint8Array(buffer.buffer, buffer.byteOffset || 0, buffer.byteLength);
  } else {
    body = buffer;
  }

  const url = `https://api.deepgram.com/v1/listen?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/octet-stream",
      },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new Error(humanizeDeepgramHttpError(res.status, errorBody));
    }

    const json = await res.json();
    setCached(cacheKey, json);
    return json;
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error(
        "Deepgram isteği zaman aşımına uğradı (5 dk). İnternet bağlantını veya dosya boyutunu kontrol et."
      );
    }
    // Already humanized?
    if (e.message && /Deepgram|Audio dosyası|İnternet|key|kredi/i.test(e.message)) {
      throw e;
    }
    throw new Error(humanizeDeepgramNetworkError(e));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deepgram response → silence regions (eski ffmpeg silencedetect contract'ı)
 */
function deriveSilenceRegions(response, { minSilence = 0.4 } = {}) {
  const utterances = (response && response.results && response.results.utterances) || [];
  const audioDuration = (response && response.metadata && response.metadata.duration) || 0;
  const regions = [];

  if (utterances.length === 0) {
    if (audioDuration >= minSilence) {
      regions.push({ start: 0, end: audioDuration, duration: audioDuration });
    }
    return regions;
  }

  // Leading
  if (utterances[0].start >= minSilence) {
    regions.push({
      start: 0,
      end: round3(utterances[0].start),
      duration: round3(utterances[0].start),
    });
  }
  // Inter-utterance
  for (let i = 1; i < utterances.length; i++) {
    const prev = utterances[i - 1];
    const cur = utterances[i];
    const gap = cur.start - prev.end;
    if (gap >= minSilence) {
      regions.push({
        start: round3(prev.end),
        end: round3(cur.start),
        duration: round3(gap),
      });
    }
  }
  // Trailing
  const last = utterances[utterances.length - 1];
  if (audioDuration - last.end >= minSilence) {
    regions.push({
      start: round3(last.end),
      end: round3(audioDuration),
      duration: round3(audioDuration - last.end),
    });
  }

  return regions;
}

function getDuration(response) {
  return (response && response.metadata && response.metadata.duration) || 0;
}

module.exports = {
  transcribeFile,
  deriveSilenceRegions,
  getDuration,
  clearCache,
};
