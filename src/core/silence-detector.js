/**
 * Sessizlik tespiti — daemon uzerinden FFmpeg silencedetect
 */

const daemon = require("../utils/daemon");

/**
 * @typedef {Object} SilenceRegion
 * @property {number} start
 * @property {number} end
 * @property {number} duration
 */

/**
 * Sessiz bolgeleri tespit et
 * @param {string} audioPath
 * @param {object} options
 * @returns {Promise<{regions: SilenceRegion[], duration: number}>}
 */
async function detect(audioPath, { noiseThreshold = -35, minDuration = 0.4 } = {}) {
  const res = await daemon.silenceDetect({
    audioPath,
    noiseThreshold,
    minDuration,
  });
  return { regions: res.regions || [], duration: res.duration || 0 };
}

module.exports = { detect };
