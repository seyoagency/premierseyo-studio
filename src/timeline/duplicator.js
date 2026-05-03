/**
 * Aktif sequence'i dondurur. "Duplicate" adi iddiali — UXP Premiere Pro API'si
 * programatik sequence duplicate fonksiyonu sunmuyor (createSequence veya
 * cloneSequence yok). Bu yuzden reconstructor orijinal sequence uzerinde
 * yerinde kesim yapar; tum action'lar tek transaction icinde calistigi icin
 * Cmd+Z ile tek adimda geri alinabilir.
 *
 * @param {string} suffix — reserved, UXP clone API destekledigi zaman kullanilacak
 */
async function duplicateActiveSequence(suffix = " - AutoCut") {
  const ppro = require("premierepro");
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Aktif proje yok");
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("Aktif sequence yok");
  return sequence;
}

module.exports = { duplicateActiveSequence };
