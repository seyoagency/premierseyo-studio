/**
 * Word-level timestamp'lerden altyazi gruplari olustur.
 *
 * Basit algoritma (maxWordsPerCaption tabanli):
 * - Kelimeleri sirayla ayni altyaziya ekle
 * - maxWordsPerCaption dolunca altyaziyi bitir
 * - Manuel satir kirma ekleme; Premiere caption/text stili gerekirse kendi sarar
 * - Cumle sonunda (. ? !) altyaziyi hemen bitir
 * - Uzun duraklamalarda (> 0.5s) altyaziyi bitir
 * - Max/min sure ve CPS (karakter/saniye) kontrolleri uygula
 */

function group(words, options = {}) {
  if (!words || words.length === 0) return [];

  const maxWordsPerCaption = clampInt(
    options.maxWordsPerCaption != null ? options.maxWordsPerCaption : options.maxWordsPerLine,
    6,
    1,
    50
  );
  const maxSubDuration = Number.isFinite(Number(options.maxSubDuration)) ? Number(options.maxSubDuration) : 5;
  const minSubDuration = Number.isFinite(Number(options.minSubDuration)) ? Number(options.minSubDuration) : 1;
  const cpsLimit = Number.isFinite(Number(options.cpsLimit)) ? Number(options.cpsLimit) : 20;
  const splitOnSentence = options.splitOnSentence !== false;
  const splitOnPause = options.splitOnPause !== false;

  const captions = [];
  let currentWords = [];
  let captionStart = null;

  const flush = (endTime) => {
    if (currentWords.length === 0) return;
    if (captionStart === null) return;

    const text = currentWords.join(" ");
    captions.push({
      index: captions.length + 1,
      start: captionStart,
      end: endTime,
      lines: [text],
      text,
    });
    currentWords = [];
    captionStart = null;
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const wordText = (word.text || "").trim();
    if (!wordText) continue;

    if (captionStart === null) captionStart = word.start;

    currentWords.push(wordText);

    if (currentWords.length >= maxWordsPerCaption) {
      flush(word.end);
      continue;
    }

    // Sure kontrolu
    const duration = word.end - captionStart;
    if (duration >= maxSubDuration) {
      flush(word.end);
      continue;
    }

    // Cumle sonu
    if (splitOnSentence && /[.!?]$/.test(wordText)) {
      flush(word.end);
      continue;
    }

    // Dogal durak
    if (splitOnPause && i + 1 < words.length) {
      const gap = words[i + 1].start - word.end;
      if (gap > 0.5) {
        flush(word.end);
        continue;
      }
    }
  }

  // Kalan kelimeleri son altyaziya kapat
  const last = words[words.length - 1];
  if (last) flush(last.end);

  return applyCPSLimit(captions, cpsLimit, minSubDuration);
}

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function applyCPSLimit(captions, cpsLimit, minDur) {
  return captions.map((cap, index) => {
    const charCount = cap.text.replace(/\n/g, " ").length;
    const start = Number(cap.start || 0);
    let end = Math.max(Number(cap.end || start), start + 0.001);

    if (cpsLimit > 0) {
      const duration = Math.max(end - start, 0.001);
      const cps = charCount / duration;
      if (cps > cpsLimit) {
        end = start + (charCount / cpsLimit);
      }
    }

    if (minDur > 0 && (end - start) < minDur) {
      end = start + minDur;
    }

    const next = captions[index + 1];
    if (next && Number.isFinite(next.start)) {
      end = Math.min(end, Math.max(start + 0.001, next.start - 0.001));
    }

    return { ...cap, index: index + 1, start, end: Math.max(start + 0.001, end) };
  });
}

module.exports = { group, applyCPSLimit };
