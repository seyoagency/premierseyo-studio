/**
 * Sequence'in TUM audio'sunu mixdown olarak WAV'a cikar
 *
 * Yaklasim:
 * 1. Sequence'deki tum audio + video clip'lerin source path, source in/out,
 *    timeline start bilgilerini topla
 * 2. Daemon'daki /build-sequence-audio endpoint'ine gonder
 * 3. Daemon FFmpeg concat+atrim ile mixdown WAV uretir
 *
 * Bu sequence'in trim/split edit'lerini yansitir (onceki "ilk klip" yaklasimi
 * yapmiyordu).
 */

const daemon = require("../utils/daemon");
const timelineMapper = require("../timeline/timeline-mapper");

/**
 * Active sequence'in tum audio mixdown'ini WAV olarak export et.
 * @returns {Promise<{ outputPath: string, clips: object[] }>}
 *   Reconstruct tarafinda timeline → source mapping icin clips metadata'si
 *   birlikte donduruluyor.
 */
async function exportAudio({ sampleRate = 48000, mono = false, suffix = "" } = {}) {
  const ppro = require("premierepro");

  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Aktif proje yok");

  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("Aktif sequence yok");

  const clips = await collectSequenceClips(sequence);
  if (clips.length === 0) {
    throw new Error("Sequence'de ses klibi bulunamadi");
  }

  // Mixdown icin overlap'ler tek kaynaga indirilir (flatten); daemon'a flat liste gider.
  // Reconstructor'a HAM listeyi donduruyoruz ki effects snapshot her track item'a 1-1
  // eslesebilsin (path + timelineStart key'i ile).
  const flattenedForMix = timelineMapper.flattenTimelineClips(clips);

  const res = await daemon.call("/build-sequence-audio", {
    clips: flattenedForMix,
    sampleRate,
    mono,
  }, 600000);

  return { outputPath: res.outputPath, clips };
}

/**
 * Sequence'deki TUM audio track clip'lerini, source info + timeline position
 * ile topla. Eger audio yoksa video track'leri kullan (videonun ses kanalini
 * FFmpeg cikaracak).
 *
 * Her clip objesi: { path, sourceIn, sourceOut, timelineStart, duration, trackIndex }
 */
async function collectSequenceClips(sequence) {
  const ppro = require("premierepro");
  const clips = [];

  const audioTrackCount = await sequence.getAudioTrackCount();
  const videoTrackCount = await sequence.getVideoTrackCount();

  // Audio tracks varsa onu kullan
  const tracks = [];
  if (audioTrackCount > 0) {
    for (let i = 0; i < audioTrackCount; i++) {
      const t = await sequence.getAudioTrack(i);
      if (t) tracks.push({ track: t, trackIndex: i });
    }
  }

  // Hic audio clip yoksa video'lardan cekelim
  const fallbackToVideo = tracks.length === 0 ||
    (await Promise.all(tracks.map(async ({ track }) => {
      const items = await track.getTrackItems(1, false);
      return items && items.length > 0;
    }))).every(x => !x);

  const finalTracks = fallbackToVideo
    ? await (async () => {
        const r = [];
        for (let i = 0; i < videoTrackCount; i++) {
          const t = await sequence.getVideoTrack(i);
          if (t) r.push({ track: t, trackIndex: i });
        }
        return r;
      })()
    : tracks;

  for (const { track, trackIndex } of finalTracks) {
    const items = await track.getTrackItems(1, false); // Clip only
    if (!items) continue;

    for (const item of items) {
      const projectItem = await item.getProjectItem();
      if (!projectItem) continue;

      const clipItem = await ppro.ClipProjectItem.cast(projectItem);
      if (!clipItem) continue;

      const filePath = await clipItem.getMediaFilePath();
      if (!filePath) continue;

      // Zaman bilgileri
      const startTime = await item.getStartTime();
      const endTime = await item.getEndTime();
      const inPoint = await item.getInPoint();
      const outPoint = await item.getOutPoint();

      const timelineStart = startTime.seconds;
      const duration = endTime.seconds - startTime.seconds;
      const sourceIn = inPoint.seconds;
      const sourceOut = outPoint.seconds;

      clips.push({
        path: filePath,
        sourceIn,
        sourceOut,
        timelineStart,
        duration,
        trackIndex: Number.isFinite(trackIndex) ? trackIndex : 0,
      });
    }
  }

  // Aynı source file + aynı range çakışmalarını dedupe et
  // (audio + video track'lerde aynı klip varsa sadece birini al)
  const unique = [];
  const seen = new Set();
  for (const c of clips) {
    const key = [
      c.path,
      c.timelineStart.toFixed(3),
      c.duration.toFixed(3),
      c.sourceIn.toFixed(3),
      c.sourceOut.toFixed(3),
      c.trackIndex,
    ].join("|");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }

  // Ham unique liste donduruyoruz — flatten exportAudio() icinde mixdown icin yapilir.
  // Boylelikle reconstructor effects snapshot loop'u clipsMeta uzerinde her track item'a
  // 1-1 eslesir (flatten slice'lar yerine).
  return unique;
}

module.exports = { exportAudio, collectSequenceClips };
