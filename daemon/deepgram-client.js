/**
 * Deepgram REST client — dependency-free (Node built-in https)
 *
 * Görev:
 *   - Audio dosyasını Deepgram pre-recorded API'sine gönder
 *   - Aynı audio için cache: ardışık silence-detect + transcribe çağrıları
 *     tek Deepgram isteğine indirgensin (kuş+kuş)
 *   - Utterances'tan silence regions derive et (eski ffmpeg silencedetect contract'ı)
 *
 * API key kaynak sırası:
 *   1. process.env.DEEPGRAM_API_KEY
 *   2. ~/.config/premier-seyo/deepgram.key (chmod 600)
 */

const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");

const KEY_FILE = path.join(os.homedir(), ".config", "premier-seyo", "deepgram.key");
const CACHE = new Map(); // cacheKey -> { response, expires }
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 saat
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 dk

function getApiKey() {
  if (process.env.DEEPGRAM_API_KEY) return process.env.DEEPGRAM_API_KEY.trim();
  try {
    const k = fs.readFileSync(KEY_FILE, "utf-8").trim();
    if (k) return k;
  } catch {
    // dosya yok, env de yok
  }
  return null;
}

function hasApiKey() {
  return Boolean(getApiKey());
}

function buildCacheKey(audioPath, language, uttSplit) {
  const stat = fs.statSync(audioPath);
  return `${audioPath}::${stat.size}::${stat.mtimeMs}::${language}::${uttSplit}`;
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
  CACHE.set(cacheKey, {
    response,
    expires: Date.now() + CACHE_TTL_MS,
  });
}

function clearCache() {
  CACHE.clear();
}

/**
 * Deepgram REST: POST audio bytes, get JSON.
 * @param {string} audioPath
 * @param {object} options
 *   language: string (default "tr")
 *   uttSplit: number (default 0.8)
 *   keyterm: string[] (optional)
 *   model: string (default "nova-3")
 * @returns {Promise<object>} Deepgram response JSON
 */
async function transcribeFile(audioPath, options = {}) {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio dosyası yok: ${audioPath}`);
  }

  const isAuto = options.language === "auto";
  const language = isAuto ? null : (options.language || "tr");
  const uttSplit = Number.isFinite(options.uttSplit) ? options.uttSplit : 0.8;
  const model = options.model || "nova-3";

  const cacheKey = buildCacheKey(audioPath, isAuto ? "auto" : language, uttSplit);
  const cached = getCached(cacheKey);
  if (cached) {
    return cached;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "DEEPGRAM_API_KEY ayarlanmamış. Şu yollardan biri:\n" +
      "  1. echo 'KEY' > ~/.config/premier-seyo/deepgram.key && chmod 600 ~/.config/premier-seyo/deepgram.key\n" +
      "  2. plist'e EnvironmentVariables/DEEPGRAM_API_KEY ekle"
    );
  }

  // Otomatik dil seçilmişse Deepgram'ın detect_language özelliğini kullan;
  // language parametresini omit et (ikisi birlikte gönderilemez).
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
  if (Array.isArray(options.keyterm) && options.keyterm.length > 0) {
    for (const kt of options.keyterm) {
      if (kt && typeof kt === "string") params.append("keyterm", kt);
    }
  }

  const buffer = fs.readFileSync(audioPath);
  const response = await postBuffer({
    hostname: "api.deepgram.com",
    path: `/v1/listen?${params.toString()}`,
    apiKey,
    buffer,
  });

  setCached(cacheKey, response);
  return response;
}

function humanizeDeepgramHttpError(statusCode, bodyStr) {
  if (statusCode === 401 || statusCode === 403) {
    return "Deepgram API key geçersiz veya yetkisiz. Eklenti içinde Ayarlar (sağ üst ⚙) → 'Bağlantıyı Test Et' ile kontrol et.";
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
  // Genel fallback — Deepgram error JSON parse + detay
  let detail = "";
  try {
    const parsed = JSON.parse(bodyStr);
    detail = parsed.err_msg || parsed.message || parsed.error || parsed.reason || "";
  } catch {
    // body JSON değil
  }
  if (!detail) detail = String(bodyStr || "").slice(0, 200).trim();
  return `Deepgram hata kodu ${statusCode}${detail ? ": " + detail : ""}`;
}

function humanizeDeepgramNetworkError(err) {
  const msg = err && err.message ? err.message : String(err || "");
  if (/ECONNREFUSED|ENOTFOUND|ENETUNREACH|EAI_AGAIN/i.test(msg)) {
    return "İnternet erişimi yok veya api.deepgram.com'a ulaşılamıyor. Ağ bağlantını kontrol et.";
  }
  if (/timeout|zaman aşımı/i.test(msg)) {
    return "Deepgram isteği zaman aşımına uğradı (5 dk). İnternet bağlantını veya audio dosya boyutunu kontrol et.";
  }
  if (/socket hang up|ECONNRESET/i.test(msg)) {
    return "Deepgram bağlantısı kesildi. Tekrar dene.";
  }
  return msg || "Deepgram'a ulaşırken bilinmeyen ağ hatası.";
}

function postBuffer({ hostname, path: reqPath, apiKey, buffer }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        hostname,
        path: reqPath,
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/octet-stream",
          "Content-Length": buffer.length,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const bodyStr = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(bodyStr));
            } catch (e) {
              reject(new Error("Deepgram cevabı çözümlenemedi (JSON bozuk). Tekrar dene."));
            }
          } else {
            reject(new Error(humanizeDeepgramHttpError(res.statusCode, bodyStr)));
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Deepgram isteği zaman aşımına uğradı (5 dk). İnternet bağlantını veya audio dosya boyutunu kontrol et."));
    });
    req.on("error", (err) => reject(new Error(humanizeDeepgramNetworkError(err))));
    req.write(buffer);
    req.end();
  });
}

/**
 * Deepgram response → silence regions (eski ffmpeg silencedetect output formatında)
 * Tier 1: utterances arası gap'ler
 * @returns {Array<{start: number, end: number, duration: number}>}
 */
function deriveSilenceRegions(response, { minSilence = 0.4 } = {}) {
  const utterances = response?.results?.utterances || [];
  const audioDuration = response?.metadata?.duration || 0;
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
  return response?.metadata?.duration || 0;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

module.exports = {
  transcribeFile,
  deriveSilenceRegions,
  getDuration,
  hasApiKey,
  getApiKey,
  clearCache,
  KEY_FILE,
};
