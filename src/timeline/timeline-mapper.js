/**
 * Keep segmentlerini (timeline zamani) kaynak klip parcalarina donustur.
 *
 * Sequence mixdown'i timeline zamaninda silence detect edildigi icin keep
 * segmentleri de timeline saniye cinsinden gelir. Multi-clip reconstruct
 * icin her keep segmentini overlap eden kaynak kliplere bolmek gerekir:
 * timeline(t) olan bir konum, ilgili klibin sourceIn + (t - timelineStart)
 * kaynak zamanina denk gelir.
 */

const EPS = 1e-4;

function comparePriority(a, b) {
  const trackA = Number.isFinite(a.trackIndex) ? a.trackIndex : Number.MAX_SAFE_INTEGER;
  const trackB = Number.isFinite(b.trackIndex) ? b.trackIndex : Number.MAX_SAFE_INTEGER;
  if (trackA !== trackB) return trackA - trackB;

  const orderA = Number.isFinite(a.originalIndex) ? a.originalIndex : Number.MAX_SAFE_INTEGER;
  const orderB = Number.isFinite(b.originalIndex) ? b.originalIndex : Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;

  return (a.timelineStart || 0) - (b.timelineStart || 0);
}

/**
 * Cakisan clip'leri tek bir kanonik timeline'a indirger.
 * Her anda en dusuk track index'li clip tercih edilir; boylece multi-track
 * overlap'ler tek bir kaynak akisa donusur.
 *
 * @param {ClipMeta[]} clips
 * @returns {ClipPiece[]}
 */
function flattenTimelineClips(clips) {
  if (!Array.isArray(clips) || clips.length === 0) return [];

  const normalized = clips
    .map((clip, index) => {
      const timelineStart = Number(clip.timelineStart) || 0;
      const duration = Number(clip.duration) || 0;
      const sourceIn = Number(clip.sourceIn) || 0;
      const sourceOut = Number(clip.sourceOut) || (sourceIn + duration);
      const trackIndex = Number.isFinite(Number(clip.trackIndex)) ? Number(clip.trackIndex) : Number.MAX_SAFE_INTEGER;
      if (!clip || !clip.path || duration <= EPS) return null;
      return {
        ...clip,
        timelineStart,
        timelineEnd: timelineStart + duration,
        duration,
        sourceIn,
        sourceOut,
        trackIndex,
        originalIndex: index,
      };
    })
    .filter(Boolean);

  if (normalized.length === 0) return [];

  const boundaries = Array.from(new Set(
    normalized.flatMap((clip) => [clip.timelineStart, clip.timelineEnd])
  )).sort((a, b) => a - b);

  const flattened = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const sliceStart = boundaries[i];
    const sliceEnd = boundaries[i + 1];
    if (sliceEnd - sliceStart <= EPS) continue;

    const covering = normalized
      .filter((clip) => clip.timelineStart < sliceEnd - EPS && clip.timelineEnd > sliceStart + EPS)
      .sort(comparePriority);

    if (covering.length === 0) continue;

    const winner = covering[0];
    const start = Math.max(sliceStart, winner.timelineStart);
    const end = Math.min(sliceEnd, winner.timelineEnd);
    if (end - start <= EPS) continue;

    flattened.push({
      path: winner.path,
      sourceIn: winner.sourceIn + (start - winner.timelineStart),
      sourceOut: winner.sourceIn + (end - winner.timelineStart),
      timelineStart: start,
      duration: end - start,
      trackIndex: winner.trackIndex,
      originalIndex: winner.originalIndex,
    });
  }

  const merged = [];
  for (const piece of flattened) {
    const last = merged[merged.length - 1];
    const pieceEnd = piece.timelineStart + piece.duration;
    if (
      last &&
      last.path === piece.path &&
      last.trackIndex === piece.trackIndex &&
      Math.abs((last.timelineStart + last.duration) - piece.timelineStart) <= EPS &&
      Math.abs(last.sourceOut - piece.sourceIn) <= EPS
    ) {
      last.duration = pieceEnd - last.timelineStart;
      last.sourceOut = piece.sourceOut;
    } else {
      merged.push({ ...piece });
    }
  }

  return merged;
}

/**
 * @typedef {Object} ClipMeta
 * @property {string} path
 * @property {number} timelineStart
 * @property {number} duration
 * @property {number} sourceIn
 * @property {number} sourceOut
 */

/**
 * @typedef {Object} ClipPiece
 * @property {string} path
 * @property {number} sourceIn
 * @property {number} sourceOut
 * @property {number} timelineStart
 * @property {number} duration
 */

/**
 * Tek keep segmentini overlap eden kaynak klip parcalarina bol.
 * @param {{ start: number, end: number }} keep
 * @param {ClipMeta[]} clips
 * @returns {ClipPiece[]}
 */
function splitKeepSegmentByClips(keep, clips) {
  if (!keep || !(keep.end > keep.start)) return [];
  if (!Array.isArray(clips) || clips.length === 0) return [];

  const canonicalClips = flattenTimelineClips(clips);
  return splitKeepSegmentByCanonicalClips(keep, canonicalClips);
}

function splitKeepSegmentByCanonicalClips(keep, canonicalClips) {
  if (!keep || !(keep.end > keep.start)) return [];
  if (!Array.isArray(canonicalClips) || canonicalClips.length === 0) return [];
  const pieces = [];

  for (const clip of canonicalClips) {
    if (!clip || !clip.path) continue;
    const timelineStart = Number(clip.timelineStart) || 0;
    const duration = Number(clip.duration) || 0;
    if (duration <= EPS) continue;

    const clipEnd = timelineStart + duration;
    const overlapStart = Math.max(keep.start, timelineStart);
    const overlapEnd = Math.min(keep.end, clipEnd);
    if (overlapEnd - overlapStart <= EPS) continue;

    const sourceInBase = Number(clip.sourceIn) || 0;
    const srcIn = sourceInBase + (overlapStart - timelineStart);
    const srcOut = sourceInBase + (overlapEnd - timelineStart);

    pieces.push({
      path: clip.path,
      sourceIn: srcIn,
      sourceOut: srcOut,
      timelineStart: overlapStart,
      duration: overlapEnd - overlapStart,
      // effects-preserver eşleşmesi için orijinal clip kaynağı:
      originalIndex: typeof clip.originalIndex === "number" ? clip.originalIndex : null,
      originalTrackIndex: typeof clip.trackIndex === "number" ? clip.trackIndex : null,
      originalTimelineStart: typeof clip.timelineStart === "number" ? clip.timelineStart : null,
    });
  }

  pieces.sort((a, b) => a.timelineStart - b.timelineStart);
  return pieces;
}

/**
 * Tum keep segmentlerini tek bir siralanmis parca listesine donustur.
 * @param {{ start: number, end: number }[]} keepSegments
 * @param {ClipMeta[]} clips
 * @returns {ClipPiece[]}
 */
function splitAllKeeps(keepSegments, clips) {
  if (!Array.isArray(keepSegments)) return [];
  const canonicalClips = flattenTimelineClips(clips);
  const all = [];
  for (const keep of keepSegments) {
    const parts = splitKeepSegmentByCanonicalClips(keep, canonicalClips);
    for (const p of parts) all.push(p);
  }
  all.sort((a, b) => a.timelineStart - b.timelineStart);
  return all;
}

/**
 * Parca listesi icin toplam kesilen sure (saniye).
 * @param {ClipPiece[]} pieces
 */
function totalPieceDuration(pieces) {
  if (!Array.isArray(pieces)) return 0;
  return pieces.reduce((sum, p) => sum + (p.duration || 0), 0);
}

/**
 * Parca listesindeki tum benzersiz kaynak path'leri.
 * @param {ClipPiece[]} pieces
 */
function uniqueSourcePaths(pieces) {
  const set = new Set();
  if (!Array.isArray(pieces)) return [];
  for (const p of pieces) if (p && p.path) set.add(p.path);
  return Array.from(set);
}

module.exports = {
  flattenTimelineClips,
  splitKeepSegmentByClips,
  splitAllKeeps,
  totalPieceDuration,
  uniqueSourcePaths,
};
