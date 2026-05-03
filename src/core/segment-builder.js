/**
 * Sessizlik + nefes bolgelerinden keep/remove segment listesi uret
 */

/**
 * @typedef {Object} Segment
 * @property {number} start — baslangic saniye
 * @property {number} end — bitis saniye
 * @property {number} duration — sure saniye
 * @property {'keep'|'remove'} type
 */

/**
 * Sessizlik ve nefes bolgelerinden konusma segmentleri uret
 *
 * @param {number} totalDuration — toplam medya suresi (saniye)
 * @param {import('./silence-detector').SilenceRegion[]} silenceRegions
 * @param {import('./breath-detector').BreathRegion[]} breathRegions
 * @param {object} options
 * @param {number} [options.paddingBefore=0.15] — kesim oncesi bosluk (saniye)
 * @param {number} [options.paddingAfter=0.15] — kesim sonrasi bosluk (saniye)
 * @param {number} [options.minKeepDuration=0.3] — minimum konusma suresi (saniye)
 * @returns {{ keep: Segment[], remove: Segment[], stats: object }}
 */
function build(totalDuration, silenceRegions, breathRegions = [], {
  paddingBefore = 0.15,
  paddingAfter = 0.15,
  minKeepDuration = 0.3,
} = {}) {
  // NaN/Infinity guard — UXP slider dönüşlerinde bozuk değerler çıkabildiği için
  // segment-builder son savunma hatti olarak kendi default'larina dusurur.
  if (!isFinite(paddingBefore) || paddingBefore < 0) paddingBefore = 0.15;
  if (!isFinite(paddingAfter) || paddingAfter < 0) paddingAfter = 0.15;
  if (!isFinite(minKeepDuration) || minKeepDuration < 0) minKeepDuration = 0.3;
  if (!isFinite(totalDuration) || totalDuration <= 0) {
    return { keep: [], remove: [], stats: { totalDuration: 0, totalKeep: 0, totalRemove: 0, silenceCount: 0, breathCount: 0, segmentCount: 0, reductionPercent: 0 } };
  }
  // Tum "remove" bolgelerini birlestir (sessizlik + nefes)
  let removeRanges = [
    ...silenceRegions.map(r => ({ start: r.start, end: r.end })),
    ...breathRegions.map(r => ({ start: r.start, end: r.end })),
  ];

  // Siralama
  removeRanges.sort((a, b) => a.start - b.start);

  // Cakisan bolgeleri birlestir (merge overlapping)
  removeRanges = mergeOverlapping(removeRanges);

  // Padding uygula: silence bolgelerine padding uygulanirken silence'in
  // HIC kaybolmayacagi sekilde proportional azalt. Min 30ms silence orta
  // kesim olarak HER ZAMAN kalir (silencedetect zaten min_duration ile gercek
  // silence buldugu icin burada kesim yapmayi red etmek yerine en azindan
  // minimum degeri koru).
  const minKeepCut = 0.03; // her silence en az 30ms kesilsin
  removeRanges = removeRanges.map(r => {
    const dur = r.end - r.start;
    if (dur <= minKeepCut) return { start: r.start, end: r.end };
    const totalPadReq = paddingBefore + paddingAfter;
    // Padding icin kullanilabilir alan: duration - minKeepCut
    const padAvailable = Math.max(0, dur - minKeepCut);
    const padRatio = totalPadReq > 0 ? Math.min(1, padAvailable / totalPadReq) : 0;
    const padA = paddingAfter * padRatio;
    const padB = paddingBefore * padRatio;
    return {
      start: r.start + padA,
      end: r.end - padB,
    };
  }).filter(r => r && r.end > r.start);

  // Komsu remove araliklarini birlestir: padding sonrasi cok yakin kalan iki
  // silence arasinda (minKeepDuration'dan kisa) aslinda anlamli konusma yok;
  // padding buffer'i olarak kabul edip tek remove yap. Boylece timeline'da
  // kopuk kucuk keep parcalari olusmaz.
  for (let i = 0; i < removeRanges.length - 1; i++) {
    const gap = removeRanges[i + 1].start - removeRanges[i].end;
    if (gap < minKeepDuration) {
      removeRanges[i] = { start: removeRanges[i].start, end: removeRanges[i + 1].end };
      removeRanges.splice(i + 1, 1);
      i--;
    }
  }

  // Keep bolgelerini hesapla (remove'un tersi)
  const keepRanges = [];
  let cursor = 0;

  for (const r of removeRanges) {
    if (r.start > cursor) {
      keepRanges.push({ start: cursor, end: r.start });
    }
    cursor = r.end;
  }

  // Son keep bolgesini ekle
  if (cursor < totalDuration) {
    keepRanges.push({ start: cursor, end: totalDuration });
  }

  // Cok kisa keep bolgelerini filtrele (artik merge sonrasi nadir kalir)
  const filteredKeep = keepRanges.filter(r => (r.end - r.start) >= minKeepDuration);

  // Segment nesnelerine cevir
  const keep = filteredKeep.map(r => ({
    start: r.start,
    end: r.end,
    duration: r.end - r.start,
    type: "keep",
  }));

  // Istatistikler
  const totalKeep = keep.reduce((sum, s) => sum + s.duration, 0);
  const totalRemove = totalDuration - totalKeep;

  const stats = {
    totalDuration,
    totalKeep,
    totalRemove,
    silenceCount: silenceRegions.length,
    breathCount: breathRegions.length,
    segmentCount: keep.length,
    reductionPercent: Math.round((totalRemove / totalDuration) * 100),
  };

  // Remove segmentleri de uret (gorsellestirme icin)
  const remove = removeRanges.map(r => ({
    start: r.start,
    end: r.end,
    duration: r.end - r.start,
    type: "remove",
  }));

  return { keep, remove, stats };
}

/**
 * Cakisan araliklari birlestir
 * @param {{ start: number, end: number }[]} ranges — sirali
 * @returns {{ start: number, end: number }[]}
 */
function mergeOverlapping(ranges) {
  if (ranges.length === 0) return [];

  const merged = [{ ...ranges[0] }];

  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    const curr = ranges[i];

    if (curr.start <= last.end) {
      last.end = Math.max(last.end, curr.end);
    } else {
      merged.push({ ...curr });
    }
  }

  return merged;
}

module.exports = { build, mergeOverlapping };
