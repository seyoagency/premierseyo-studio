/**
 * Zaman donusum yardimcilari
 * Premiere Pro TickTime <-> saniye <-> SRT timestamp
 */

// Premiere Pro ticks/saniye (254016000000 ticks = 1 saniye)
const TICKS_PER_SECOND = 254016000000;

/**
 * Saniyeyi Premiere ticks'e cevir
 * @param {number} seconds
 * @returns {string} ticks string (Premiere TickTime icin)
 */
function secondsToTicks(seconds) {
  return String(Math.round(seconds * TICKS_PER_SECOND));
}

/**
 * Premiere ticks'i saniyeye cevir
 * @param {string|number} ticks
 * @returns {number} seconds
 */
function ticksToSeconds(ticks) {
  return Number(ticks) / TICKS_PER_SECOND;
}

/**
 * Saniyeyi SRT timestamp formatina cevir
 * Format: HH:MM:SS,mmm
 * @param {number} seconds
 * @returns {string}
 */
function secondsToSRT(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;

  return (
    String(h).padStart(2, "0") + ":" +
    String(m).padStart(2, "0") + ":" +
    String(s).padStart(2, "0") + "," +
    String(ms).padStart(3, "0")
  );
}

/**
 * SRT timestamp'i saniyeye cevir
 * @param {string} srt — "HH:MM:SS,mmm"
 * @returns {number}
 */
function srtToSeconds(srt) {
  const [time, ms] = srt.split(",");
  const [h, m, s] = time.split(":").map(Number);
  return h * 3600 + m * 60 + s + Number(ms) / 1000;
}

/**
 * Saniyeyi insan-okunabilir formata cevir (3m 24s)
 * @param {number} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

module.exports = {
  TICKS_PER_SECOND,
  secondsToTicks,
  ticksToSeconds,
  secondsToSRT,
  srtToSeconds,
  formatDuration,
};
