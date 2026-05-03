/**
 * Sequence audio mixdown — Adobe Media Encoder (AME) üzerinden.
 *
 * v1 daemon FFmpeg /build-sequence-audio yerine AME EncoderManager.exportSequence.
 * Plugin sequence'i AME'ye gönderir, AME Premiere'in kendi mixdown logic'iyle WAV
 * üretir (effects, levels, fades dahil — FFmpeg'in concat+atrim'inden daha doğru).
 *
 * collectSequenceClips() reconstructor için clipsMeta sağlamaya devam eder
 * (Auto-Cut Apply'ın source clip mapping'i için gerekli).
 */

const ameExporter = require("./ame-exporter");
const fileSaver = require("../utils/file-saver");

/**
 * Active sequence'in tüm audio mixdown'ını WAV olarak export et.
 * @param {object} options
 *   onProgress: (percent: number) => void  — AME render percent
 * @returns {Promise<{ outputPath: string, clips: object[] }>}
 */
async function exportAudio({ suffix = "", onProgress } = {}) {
  const ppro = require("premierepro");

  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Aktif proje yok");

  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("Aktif sequence yok");

  const clips = await collectSequenceClips(sequence);
  if (clips.length === 0) {
    throw new Error("Sequence'de ses klibi bulunamadı");
  }

  const outputPath = await buildOutputPath(sequence, suffix);

  // AME ile sequence audio render
  await ameExporter.exportSequenceAudio(sequence, outputPath, { onProgress });

  return { outputPath, clips };
}

/**
 * Mixdown WAV için output path. ~/Documents/PremierSEYO Studio/.cache altında.
 */
async function buildOutputPath(sequence, suffix) {
  const path = require("path");
  const seqName = (sequence.name || "sequence").replace(/[^a-zA-Z0-9_-]/g, "_");
  const { documentsDir } = await fileSaver.getHomeDirs();
  const cacheDir = path.join(documentsDir, "PremierSEYO Studio", ".cache");
  const filename = `${seqName}${suffix || ""}-mixdown.wav`;
  return path.join(cacheDir, filename);
}

/**
 * Sequence'deki TUM audio track clip'lerini, source info + timeline position
 * ile topla. Audio yoksa video tracks'ten ses çekilir (videonun audio kanalı).
 */
async function collectSequenceClips(sequence) {
  const ppro = require("premierepro");
  const clips = [];

  const audioTrackCount = await sequence.getAudioTrackCount();
  const videoTrackCount = await sequence.getVideoTrackCount();

  const tracks = [];
  if (audioTrackCount > 0) {
    for (let i = 0; i < audioTrackCount; i++) {
      const t = await sequence.getAudioTrack(i);
      if (t) tracks.push({ track: t, trackIndex: i });
    }
  }

  const fallbackToVideo =
    tracks.length === 0 ||
    (await Promise.all(
      tracks.map(async ({ track }) => {
        const items = await track.getTrackItems(1, false);
        return items && items.length > 0;
      })
    )).every((x) => !x);

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

  // Audio + video track'lerde aynı clip ise dedupe
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

  return unique;
}

module.exports = { exportAudio, collectSequenceClips };
