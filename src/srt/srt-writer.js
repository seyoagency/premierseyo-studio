/**
 * SRT dosya yazici — daemon uzerinden yazar (UXP filesystem sandbox disina)
 */

const daemon = require("../utils/transport");
const timeUtils = require("../utils/time");

/**
 * Caption listesinden SRT string uret
 * @param {import('./caption-grouper').Caption[]} captions
 * @returns {string}
 */
function generate(captions) {
  return captions.map(cap => {
    const startTS = timeUtils.secondsToSRT(cap.start);
    const endTS = timeUtils.secondsToSRT(cap.end);
    return `${cap.index}\n${startTS} --> ${endTS}\n${cap.text}`;
  }).join("\n\n") + "\n";
}

/**
 * SRT dosyasini diske yaz (daemon araciligiyla)
 * @param {string} filePath
 * @param {import('./caption-grouper').Caption[]} captions
 * @returns {Promise<string>}
 */
async function write(filePath, captions) {
  const content = generate(captions);
  const res = await daemon.writeFile({ filePath, content });
  return res.path;
}

module.exports = { generate, write };
