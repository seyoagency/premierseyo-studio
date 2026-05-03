/**
 * AME (Adobe Media Encoder) audio export wrapper.
 *
 * v1 daemon /build-sequence-audio FFmpeg ile mixdown yapıyordu. v2'de bu işi
 * Premiere'in kendi pipeline'ı yapıyor — Premiere → AME → WAV. Avantaj:
 * effects, track levels, fades, audio gain hepsi Premiere'in render'ı ile dahil.
 *
 * EncoderManager API: Premiere 25.0+ (bizim minVersion 25.6).
 *   - exportSequence(sequence, exportType, outputFile, presetFile, exportFull)
 *   - Events: EVENT_RENDER_PROGRESS, EVENT_RENDER_COMPLETE, EVENT_RENDER_ERROR
 *   - isAMEInstalled property
 *
 * Preset stratejisi:
 *   1. Plugin'in `presets/audio-mixdown.epr` bundle'ı (Plan A) — varsa kullan
 *   2. presetFile=null (Plan B) — Premiere'in default WAV preset'ini kullanır (test edilmemiş, fallback)
 *   3. Hata mesajı + kullanıcıya manuel preset kurma talimatı
 */

let _isExporting = false;

/**
 * Aktif sequence'in tüm audio'sunu WAV'a export et (AME üzerinden).
 *
 * @param {object} sequence — Premiere Sequence object
 * @param {string} outputPath — absolute path, .wav uzantısı bekleniyor
 * @param {object} options
 *   onProgress: (percent: number) => void
 * @returns {Promise<string>} outputPath
 */
async function exportSequenceAudio(sequence, outputPath, options = {}) {
  if (_isExporting) {
    throw new Error("AME zaten render ediyor. Mevcut iş bitmeden tekrar denenemez.");
  }

  const ppro = require("premierepro");
  const manager = ppro.EncoderManager && ppro.EncoderManager.getManager
    ? ppro.EncoderManager.getManager()
    : null;

  if (!manager) {
    throw new Error("AME_NOT_AVAILABLE: EncoderManager API yok (Premiere 25.6+ gerekli).");
  }

  if (!manager.isAMEInstalled) {
    throw new Error(
      "AME_NOT_INSTALLED: Adobe Media Encoder kurulu değil. " +
      "Creative Cloud Desktop'tan ücretsiz yükle: https://creativecloud.adobe.com/apps/all/desktop?subapp=media-encoder"
    );
  }

  const presetFile = await resolvePresetFile();
  const exportType = ppro.Constants && ppro.Constants.ExportType
    ? ppro.Constants.ExportType.IMMEDIATELY
    : "IMMEDIATELY";

  // Output klasörü garantile
  ensureOutputDir(outputPath);

  _isExporting = true;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};

  // Event listener'ları setUp et — promise resolve/reject'i bunlardan tetiklenir
  return new Promise((resolve, reject) => {
    let completed = false;

    const cleanup = () => {
      try { manager.removeEventListener("EVENT_RENDER_COMPLETE", onComplete); } catch {}
      try { manager.removeEventListener("EVENT_RENDER_ERROR", onError); } catch {}
      try { manager.removeEventListener("EVENT_RENDER_PROGRESS", onProgressEvent); } catch {}
      _isExporting = false;
    };

    const onComplete = () => {
      if (completed) return;
      completed = true;
      cleanup();
      resolve(outputPath);
    };

    const onError = (e) => {
      if (completed) return;
      completed = true;
      cleanup();
      const msg = (e && (e.message || e.detail || e.error)) || "AME render hatası";
      reject(new Error(humanizeAMEError(msg)));
    };

    const onProgressEvent = (e) => {
      const pct = e && (e.percent || e.progress || e.detail);
      if (typeof pct === "number") onProgress(pct);
    };

    try {
      manager.addEventListener("EVENT_RENDER_COMPLETE", onComplete);
      manager.addEventListener("EVENT_RENDER_ERROR", onError);
      manager.addEventListener("EVENT_RENDER_PROGRESS", onProgressEvent);
    } catch (e) {
      cleanup();
      reject(new Error(`AME event listener bağlanamadı: ${e.message}`));
      return;
    }

    // Async çağrı; başlangıçta false dönerse hata
    Promise.resolve()
      .then(() => manager.exportSequence(sequence, exportType, outputPath, presetFile || "", true))
      .then((ok) => {
        if (ok === false) {
          cleanup();
          reject(new Error("AME exportSequence çağrısı başarısız (false döndü). Sequence'de ses var mı kontrol et."));
        }
        // ok=true ise event'leri bekleriz
      })
      .catch((e) => {
        cleanup();
        reject(new Error(humanizeAMEError(e.message || String(e))));
      });
  });
}

/**
 * Preset .epr dosyasının yolunu çöz.
 * 1. Plugin'in `presets/audio-mixdown.epr` (bundle edilmişse)
 * 2. Yoksa null döner — caller `presetFile=""` ile Premiere default'unu kullanır
 */
async function resolvePresetFile() {
  try {
    const lfs = require("uxp").storage.localFileSystem;
    const pluginFolder = await lfs.getPluginFolder();
    const presetFile = await pluginFolder.getEntry("presets/audio-mixdown.epr").catch(() => null);
    if (presetFile) {
      return presetFile.nativePath;
    }
  } catch {
    // Plugin folder erişilemiyorsa null döneriz
  }
  return null;
}

function ensureOutputDir(outputPath) {
  const fs = require("fs");
  const path = require("path");
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  } catch {
    // Hata olursa AME zaten failed olur
  }
}

function humanizeAMEError(msg) {
  const m = String(msg || "");
  if (/codec|preset/i.test(m)) {
    return "AME preset/codec hatası. Plugin yeniden kurulmalı veya Premiere güncellenmeli.";
  }
  if (/disk|space|kapasit/i.test(m)) {
    return "Disk dolu — AME çıktı yazamıyor. Yer aç ve tekrar dene.";
  }
  if (/permission|izin|access/i.test(m)) {
    return "AME hedef klasöre yazma izni alamadı. Çıktı yolunu kontrol et.";
  }
  if (/cancel/i.test(m)) {
    return "AME render iptal edildi.";
  }
  return `AME render hatası: ${m}`;
}

module.exports = { exportSequenceAudio };
