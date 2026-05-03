/**
 * Sequence audio mixdown — local helper daemon (FFmpeg) ile.
 *
 * v2 hibrit mimari: plugin self-contained (UI, secret-store, Deepgram client,
 * auto-update) + audio mixdown için lokal daemon (Node + FFmpeg).
 * Daemon tek-tık installer ile kullanıcı bilgisayarına kuruluyor.
 *
 * Daemon endpoint: POST http://127.0.0.1:53117/build-sequence-audio
 *   body: { clips, sampleRate, mono }
 *   resp: { ok, outputPath }
 */

const timelineMapper = require("../timeline/timeline-mapper");

const DAEMON_URL = "http://127.0.0.1:53117";
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000; // 10 dk

async function exportAudio({ sampleRate = 48000, mono = false, suffix = "", onProgress } = {}) {
  const ppro = require("premierepro");

  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Aktif proje yok");

  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("Aktif sequence yok");

  const clips = await collectSequenceClips(sequence);
  if (clips.length === 0) {
    throw new Error("Sequence'de ses klibi bulunamadı");
  }

  // Mixdown için overlap'ler tek kaynağa indirilir (flatten); daemon'a flat liste gider.
  const flattenedForMix = timelineMapper.flattenTimelineClips(clips);

  if (onProgress) onProgress(20);

  const res = await daemonCall("/build-sequence-audio", {
    clips: flattenedForMix,
    sampleRate,
    mono,
    suffix,
  });

  if (onProgress) onProgress(100);

  // Reconstructor effects 1-1 mapping için ham unique listeyi döndür (flatten değil)
  return { outputPath: res.outputPath, clips };
}

async function daemonCall(path, body) {
  const url = DAEMON_URL + path;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers = {
      "Content-Type": "application/json",
      "X-Premiere-Cut-Client": "premierseyo-uxp",
    };
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        errMsg = errBody.error || errMsg;
      } catch {}
      throw new Error(errMsg);
    }

    return await res.json();
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error("Daemon timeout (10dk). FFmpeg çok uzun süredir çalışıyor.");
    }
    if (e.message && /fetch|network|ECONNREFUSED/i.test(e.message)) {
      throw new Error(
        "PremierSEYO daemon'a ulaşılamıyor. Daemon kurulu mu? " +
        "Kurulum: README'deki tek-tık installer'ı indir ve çalıştır."
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

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
    const items = await track.getTrackItems(1, false);
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

      clips.push({
        path: filePath,
        sourceIn: inPoint.seconds,
        sourceOut: outPoint.seconds,
        timelineStart: startTime.seconds,
        duration: endTime.seconds - startTime.seconds,
        trackIndex: Number.isFinite(trackIndex) ? trackIndex : 0,
      });
    }
  }

  // Audio + video track'lerinde aynı clip'i dedupe
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
