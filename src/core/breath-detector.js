/**
 * Nefes sesi tespiti
 *
 * Strateji: Bilinen sessizlik bolgeleri arasindaki kisa sesli bolumler
 * genelde nefes veya dudak seslerine denk gelir.
 */

/**
 * @typedef {Object} BreathRegion
 * @property {number} start
 * @property {number} end
 * @property {number} duration
 */

/**
 * Sessiz bolgelerin hemen oncesindeki/sonrasindaki kisa sesleri nefes olarak isaretle
 *
 * @param {import('./silence-detector').SilenceRegion[]} silenceRegions
 * @param {object} options
 * @param {number} [options.minDuration=0.15]
 * @param {number} [options.maxDuration=1.5]
 * @returns {BreathRegion[]}
 */
function findBreathCandidates(silenceRegions, {
  minDuration = 0.05,
  maxDuration = 0.25,
} = {}) {
  // Gercek nefes/dudak sesleri genellikle <250ms. Daha uzun bolumler konusma
  // sayilir ve keep'te kalmali. Onceki default (0.15-1.5s) konusma kisimlarini
  // yanlislikla breath olarak isaretliyordu.
  if (silenceRegions.length < 2) return [];

  const breaths = [];

  for (let i = 0; i < silenceRegions.length - 1; i++) {
    const gapStart = silenceRegions[i].end;
    const gapEnd = silenceRegions[i + 1].start;
    const gapDuration = gapEnd - gapStart;

    // Iki sessizlik arasi cok kisa sesli bolge = muhtemelen nefes
    if (gapDuration >= minDuration && gapDuration <= maxDuration) {
      breaths.push({
        start: gapStart,
        end: gapEnd,
        duration: gapDuration,
      });
    }
  }

  return breaths;
}

module.exports = { findBreathCandidates };
