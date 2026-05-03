/**
 * PremiereCut — UXP Panel entry point
 */

// Erken debug: status bar'a goster
function _earlyStatus(msg) {
  try {
    const bar = document.getElementById("status-bar");
    if (bar) bar.textContent = msg;
  } catch {}
}

// v1.2.1 build signature — bu metnin status bar'da görünmesi yeni bundle'ın
// yüklendiğinin görsel kanıtı. Önceki cache'lenen "JS yukleniyor..." görünüyorsa
// Premiere eski bundle'ı serve ediyor demek.
_earlyStatus("PremierSEYO v1.2.2 mor build yukleniyor...");

let config, daemon, timeUtils, audioExporter, silenceDetector, breathDetector;
let segmentBuilder, transcriber, captionGrouper, srtWriter, vttWriter;
let duplicator, seqEditor, reconstructor;

let secretStore;

try {
  config = require("./utils/config");
  daemon = require("./utils/transport");
  secretStore = require("./utils/secret-store");
  timeUtils = require("./utils/time");
  audioExporter = require("./core/audio-exporter");
  silenceDetector = require("./core/silence-detector");
  breathDetector = require("./core/breath-detector");
  segmentBuilder = require("./core/segment-builder");
  transcriber = require("./core/transcriber");
  captionGrouper = require("./srt/caption-grouper");
  srtWriter = require("./srt/srt-writer");
  vttWriter = require("./srt/vtt-writer");
  duplicator = require("./timeline/duplicator");
  seqEditor = require("./timeline/sequence-editor");
  reconstructor = require("./timeline/reconstructor");
  _earlyStatus("Moduller yuklendi");
} catch (e) {
  _earlyStatus("Modul hatasi: " + e.message);
  console.error("PremiereCut require hatasi:", e);
}

// ——— State ———
let analysisResult = null;
let transcriptResult = null;
let currentAudioPath = null;
let settingsHydrated = false;

// SRT live regroup için Set'ler — setupSliders/setupPersistedInputs init'inden
// önce initialize olmaları gerek (applyChange ilk render'da çağrılıyor).
const SRT_SLIDER_IDS = new Set(["maxSubDuration", "minSubDuration", "cpsLimit", "subtitleOffset"]);
const SRT_PERSISTED_IDS = new Set(["splitOnSentence", "splitOnPause"]);

// ——— Init ———
function init() {
  try {
    _earlyStatus("Init basladi");
    if (!config) throw new Error("config yuklenmedi");
    config.load();
    setupTabs();
    setupSliders();
    setupSteppers();
    setupPersistedInputs();
    setupCollapsibles();
    setupButtons();
    setupSettingsDrawer();
    restoreSettings();
    settingsHydrated = true;
    saveCurrentSettings();
    _earlyStatus("Init tamam — dep check");
    // Legacy v1 daemon kurulumundan key migration (bir kerelik, sessiz)
    if (secretStore) {
      secretStore.migrateFromLegacy().catch(() => {});
    }
    checkDependencies();
    refreshConnectionStatus();
    applyBrandStyles();
  } catch (e) {
    _earlyStatus("Init hatasi: " + e.message);
    console.error("PremiereCut init error:", e);
  }
}

// UXP <button> CSS rule background'larını reddediyor (slider/div çalışıyor — element-spesifik bug).
// Inline style attribute (HTML-level) bypass eder. Tab click + drawer toggle gibi durumlarda
// tekrar çağrılması gerekiyor — DOM class değişimleri inline style'ı düşürmez ama active/inactive
// tab için yeniden uygulamak gerek.
function _setDisabled(el, val) {
  if (!el) return;
  const v = !!val;
  if (v) {
    el.setAttribute('aria-disabled', 'true');
    el.classList.add('is-disabled');
    el.style.setProperty('pointer-events', 'none', 'important');
    el.style.setProperty('opacity', '0.55', 'important');
  } else {
    el.removeAttribute('aria-disabled');
    el.classList.remove('is-disabled');
    el.style.removeProperty('pointer-events');
    el.style.removeProperty('opacity');
  }
  try { el.disabled = v; } catch (e) {}
}

function _setStyle(el, props) {
  // Method 1: CSSStyleDeclaration.setProperty
  for (const k of Object.keys(props)) {
    try { el.style.setProperty(k, props[k], "important"); } catch {}
  }
  // Method 2: setAttribute fallback — UXP'de setProperty bazen butonlarda no-op
  let inline = el.getAttribute("style") || "";
  for (const k of Object.keys(props)) {
    inline += `;${k}:${props[k]} !important`;
  }
  try { el.setAttribute("style", inline); } catch {}
}
function applyBrandStyles() {
  const PRI = "#7b53f4";
  const DARK = "#332272";
  const FG = "#ffffff";
  const map = {
    "btn-primary": { background: PRI, "background-color": PRI, "background-image": "none", color: FG, border: "0" },
    "btn-success": { background: `linear-gradient(180deg, ${PRI}, ${DARK})`, "background-image": `linear-gradient(180deg, ${PRI}, ${DARK})`, color: FG, border: "0" },
    "btn-ghost": { background: DARK, "background-color": DARK, "background-image": "none", color: FG, border: `1px solid ${PRI}` },
    "reset-btn": { background: DARK, "background-color": DARK, "background-image": "none", color: FG, border: `1px solid ${PRI}` },
    "field-toggle": { background: DARK, "background-color": DARK, "background-image": "none", color: FG, border: `1px solid ${PRI}` },
    "drawer-close": { background: DARK, "background-color": DARK, "background-image": "none", color: FG, border: `1px solid ${PRI}` },
    "stepper-btn": { background: DARK, "background-color": DARK, "background-image": "none", color: FG, border: `1px solid ${PRI}` },
    "icon-btn": { background: DARK, "background-color": DARK, "background-image": "none", color: FG, border: `1px solid ${PRI}` },
    "conn-badge": { background: DARK, "background-color": DARK, "background-image": "none", color: FG, border: `1px solid ${PRI}` },
  };
  for (const cls of Object.keys(map)) {
    document.querySelectorAll("." + cls).forEach((el) => _setStyle(el, map[cls]));
  }
  // Tab aktif/pasif inline style — text ortalı + inactive açık mor
  document.querySelectorAll(".tab").forEach((t) => {
    const baseLayout = {
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      "text-align": "center",
    };
    if (t.classList.contains("active")) {
      _setStyle(t, {
        ...baseLayout,
        background: PRI,
        "background-color": PRI,
        "background-image": "none",
        color: FG,
        "font-weight": "800",
        border: `1px solid ${PRI}`,
        "box-shadow": `inset 0 -3px 0 ${DARK}`,
      });
    } else {
      _setStyle(t, {
        ...baseLayout,
        background: "rgba(123, 83, 244, 0.10)",
        "background-color": "rgba(123, 83, 244, 0.10)",
        "background-image": "none",
        color: "#b89bff",
        "font-weight": "600",
        border: "1px solid rgba(123, 83, 244, 0.25)",
        "box-shadow": "none",
      });
    }
  });
  // SVG ikon stroke'ları beyaz (mor üstüne okunaklı)
  document.querySelectorAll(".icon-btn svg, .drawer-close svg, .field-toggle svg").forEach((s) => {
    try {
      s.setAttribute("stroke", "#ffffff");
      s.style.setProperty("stroke", "#ffffff", "important");
    } catch {}
  });
}

// UXP'de DOMContentLoaded tetiklenmeyebilir, ikisini de dene
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// ——— Tab Switching ———
function setupTabs() {
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => {
        c.style.display = "none";
      });
      tab.classList.add("active");
      const target = document.getElementById(`tab-${tab.dataset.tab}`);
      if (target) target.style.display = "block";
      // Tab class değişti → inline style yeniden uygula (UXP CSS bg-on-button bug)
      if (typeof applyBrandStyles === "function") applyBrandStyles();
    });
  });
  // Ilk aktif tab'i goster
  document.getElementById("tab-autocut").style.display = "block";
}

// ——— Slider bindings ———
function setupSliders() {
  const sliders = [
    { id: "silenceThreshold", suffix: " dB" },
    { id: "minSilenceDuration", suffix: "s" },
    { id: "padding", suffix: "ms" },
    { id: "minKeepDuration", suffix: "s" },
    { id: "maxSubDuration", suffix: "s" },
    { id: "minSubDuration", suffix: "s" },
    { id: "cpsLimit", suffix: "" },
    { id: "subtitleOffset", suffix: "ms" },
  ];

  sliders.forEach(({ id, suffix }) => {
    const slider = document.getElementById(id);
    const valueEl = document.getElementById(`${id}-val`);
    if (!slider || !valueEl) return;

    // Div-based custom slider (UXP <input type=range> mouse drag bug bypass)
    initCustomSlider(slider);

    const step = parseFloat(slider.dataset.step) || 1;
    const decimals = (String(step).split(".")[1] || "").length;
    const formatValue = (raw) => {
      const num = parseFloat(raw);
      if (isNaN(num)) return raw;
      return decimals > 0 ? num.toFixed(decimals) : String(Math.round(num));
    };

    const applyChange = () => {
      valueEl.textContent = formatValue(slider.dataset.value) + suffix;
      saveCurrentSettings();
      // SRT slider'ları (maxSubDuration, minSubDuration, cpsLimit, subtitleOffset)
      // değiştiğinde transcriptResult varsa preview'ı debounced regroup et.
      // transcriptResult null check + typeof guard: init zamanında applyChange
      // direkt çağrılıyor, debouncedRerenderCaptions hala TDZ'de olabilir.
      if (transcriptResult && SRT_SLIDER_IDS.has(id) && typeof debouncedRerenderCaptions === "function") {
        debouncedRerenderCaptions();
      }
    };

    slider.addEventListener("input", applyChange);
    slider.addEventListener("change", applyChange);

    // Value span'ine tiklayarak number input ile direkt deger girme imkani verelim.
    makeValueEditable(slider, valueEl, suffix, applyChange);

    // Ilk degeri render et
    applyChange();
  });
}

function initCustomSlider(track) {
  const fill = track.querySelector(".cslider-fill");
  const thumb = track.querySelector(".cslider-thumb");
  const min = Number(track.dataset.min || 0);
  const max = Number(track.dataset.max || 100);
  const step = Number(track.dataset.step || 1);
  const decimals = (String(step).split(".")[1] || "").length;

  const clamp = (v) => Math.min(max, Math.max(min, v));
  const snap = (v) => Math.round(v / step) * step;
  const fmt = (v) => decimals > 0 ? Number(v).toFixed(decimals) : String(Math.round(v));

  function setValue(value, emit = true) {
    const next = clamp(snap(value));
    const percent = ((next - min) / (max - min)) * 100;
    track.dataset.value = fmt(next);
    track.style.setProperty("--percent", `${percent}%`);
    track.setAttribute("aria-valuemin", String(min));
    track.setAttribute("aria-valuemax", String(max));
    track.setAttribute("aria-valuenow", track.dataset.value);
    if (emit) {
      track.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    }
  }

  function valueFromClientX(clientX) {
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return min + ratio * (max - min);
  }

  let dragging = false;

  const onDown = (e) => {
    dragging = true;
    try { track.setPointerCapture && track.setPointerCapture(e.pointerId); } catch {}
    setValue(valueFromClientX(e.clientX));
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!dragging) return;
    setValue(valueFromClientX(e.clientX));
  };
  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    try { track.releasePointerCapture && track.releasePointerCapture(e.pointerId); } catch {}
    track.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  };

  track.addEventListener("pointerdown", onDown);
  track.addEventListener("pointermove", onMove);
  track.addEventListener("pointerup", onUp);
  track.addEventListener("pointercancel", onUp);

  // Fallback: mouse events (UXP'de pointer event yoksa)
  track.addEventListener("mousedown", (e) => {
    dragging = true;
    setValue(valueFromClientX(e.clientX));
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    setValue(valueFromClientX(e.clientX));
  });
  document.addEventListener("mouseup", () => {
    dragging = false;
  });

  track.addEventListener("keydown", (e) => {
    const cur = Number(track.dataset.value || min);
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      setValue(cur - step);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      setValue(cur + step);
    }
  });

  // Ilk degeri init et
  setValue(Number(track.dataset.value || min), false);
}

function makeValueEditable(slider, valueEl, suffix, onChange) {
  valueEl.style.cursor = "text";
  valueEl.style.textDecoration = "underline dotted";
  valueEl.style.textUnderlineOffset = "3px";
  valueEl.title = "Degeri degistirmek icin tiklayip yazin";
  valueEl.addEventListener("click", () => {
    const getAttr = (attr) => slider.dataset ? slider.dataset[attr] : slider[attr];
    const min = parseFloat(getAttr("min"));
    const max = parseFloat(getAttr("max"));
    const step = parseFloat(getAttr("step")) || 1;
    const current = slider.dataset.value || slider.value;
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = current;
    input.style.cssText = "flex:0 0 50px;width:50px;background:#1a1a1a;color:#fff;border:1px solid #3a3a3a;border-radius:3px;font-size:11px;text-align:right;padding:2px 4px;";
    valueEl.style.display = "none";
    valueEl.parentElement.insertBefore(input, valueEl);
    input.focus();
    input.select();

    const commit = () => {
      let v = parseFloat(input.value);
      if (isNaN(v)) v = parseFloat(current);
      v = Math.max(min, Math.min(max, v));
      const decimals = (String(step).split(".")[1] || "").length;
      const valStr = decimals > 0 ? v.toFixed(decimals) : String(Math.round(v));
      if (slider.dataset && slider.dataset.min !== undefined) {
        slider.dataset.value = valStr;
        const percent = ((v - min) / (max - min)) * 100;
        slider.style.setProperty("--percent", `${percent}%`);
      } else {
        slider.value = valStr;
      }
      input.remove();
      valueEl.style.display = "";
      onChange();
    };

    const cancel = () => {
      input.remove();
      valueEl.style.display = "";
    };

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      else if (e.key === "Escape") cancel();
    });
  });
}

function setupSteppers() {
  const stepperConfig = {
    maxWordsPerCaption: { min: 1, max: 12 },
  };

  document.querySelectorAll(".stepper-btn").forEach(btn => {
    let lastTrigger = 0;
    const handleStep = (e) => {
      // Click + pointerdown çift tetiklemesini engelle (100ms cooldown)
      const now = Date.now();
      if (now - lastTrigger < 100) return;
      lastTrigger = now;

      const target = btn.dataset.target;
      const dir = parseInt(btn.dataset.dir);
      const valEl = document.getElementById(`${target}-val`);
      const conf = stepperConfig[target];
      if (!valEl || !conf) return;

      const before = parseInt(valEl.textContent);
      let val = before + dir;
      val = Math.max(conf.min, Math.min(conf.max, val));
      if (val === before) return; // sınıra geldi, değişiklik yok

      valEl.textContent = val;
      saveCurrentSettings();
      // Stepper SRT'ye özel; transcript varsa Deepgram'a gitmeden yeniden grupla.
      if (transcriptResult && typeof rerenderCaptions === "function") {
        rerenderCaptions();
      }
      if (e && typeof e.preventDefault === "function") e.preventDefault();
    };
    // UXP'de <div role="button"> click bazı sürümlerde çalışmıyor — pointerdown
    // + keyboard fallback ile her durumda tetiklenir.
    btn.addEventListener("click", handleStep);
    btn.addEventListener("pointerdown", handleStep);
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        handleStep(e);
      }
    });
  });
}

function setupPersistedInputs() {
  const persistedIds = [
    "detectBreaths",
    "splitOnSentence",
    "splitOnPause",
    "srt-language",
    "srt-model",
  ];

  persistedIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      saveCurrentSettings();
      // Sadece SRT-relevant checkbox'lar (splitOnSentence, splitOnPause) regroup tetikler.
      if (transcriptResult && SRT_PERSISTED_IDS.has(id) && typeof rerenderCaptions === "function") {
        rerenderCaptions();
      }
    });
  });
}

function setupCollapsibles() {
  ["advanced-cut", "advanced-srt"].forEach(prefix => {
    const toggle = document.getElementById(`${prefix}-toggle`);
    const body = document.getElementById(`${prefix}-body`);
    const arrow = document.getElementById(`${prefix}-arrow`);
    if (toggle && body) {
      toggle.addEventListener("click", () => {
        const isOpen = body.style.display === "block";
        body.style.display = isOpen ? "none" : "block";
        if (arrow) arrow.innerHTML = isOpen ? "&#9654;" : "&#9660;";
      });
    }
  });
}

function setupButtons() {
  document.getElementById("btn-analyze").addEventListener("click", handleAnalyze);
  document.getElementById("btn-apply-cut").addEventListener("click", handleApplyCut);
  document.getElementById("btn-transcribe").addEventListener("click", handleTranscribe);
  document.getElementById("btn-save-srt").addEventListener("click", handleSaveSRT);
  const resetBtn = document.getElementById("resetSettings");
  if (resetBtn) resetBtn.addEventListener("click", handleResetSettings);
}

function handleResetSettings() {
  config.reset();
  restoreSettings();
  // Eski analiz state'ini temizle — yeni ayarlarla tekrar analiz gerekli
  analysisResult = null;
  const resultsEl = document.getElementById("results-cut");
  if (resultsEl) resultsEl.style.display = "none";
  const applyBtn = document.getElementById("btn-apply-cut");
  if (applyBtn) _setDisabled(applyBtn, true);
  setStatus("Ayarlar sifirlandi — Analiz Et'e tekrar basin", "success");
}

// ——— Dependency Check ———
async function checkDependencies() {
  try {
    const res = await daemon.check();
    // v2: ame + deepgram badges. Eski "ffmpeg/whisper/model" badge'leri varsa
    // backward-compat olarak deepgram'a map edilir (UI rebadge Phase 5'te).
    updateDepBadge("ffmpeg", res.ame);     // mixdown engine: AME
    updateDepBadge("whisper", res.deepgram); // STT: Deepgram
    updateDepBadge("model", res.deepgram);

    if (!res.ame || !res.deepgram) {
      const dc = document.getElementById("dep-check-cut");
      if (dc) dc.style.display = "flex";
    }

    setStatus("Hazir", "success");
  } catch (err) {
    console.error("Dependency check failed:", err);
    updateDepBadge("ffmpeg", false);
    updateDepBadge("whisper", false);
    updateDepBadge("model", false);
    const dc = document.getElementById("dep-check-cut");
    if (dc) dc.style.display = "flex";
    setStatus(err.message || "Daemon baglantisi kurulamadi", "error");
  }
}

function updateDepBadge(name, ok) {
  const icon = document.getElementById(`dep-${name}-icon`);
  if (!icon) return;
  icon.textContent = ok ? "\u2713" : "\u2717";
  icon.className = `dep-icon ${ok ? "ok" : "fail"}`;
}

// ——— AUTO-CUT: Analyze ———
async function handleAnalyze() {
  const btn = document.getElementById("btn-analyze");
  const origBtnLabel = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Lütfen bekleyin, analiz ediliyor...';
  _setDisabled(btn, true);
  showProgress("cut", true, "Sıralı işlem başlatılıyor...");
  setStatus("İşlem başladı — sequence uzunluğuna göre 1-3 dakika sürebilir, lütfen bekleyin...");

  try {
    updateProgress("cut", 10, "1/4 — Sequence'den ses çıkarılıyor (FFmpeg ile mixdown, 30 sn–2 dk sürebilir)...");
    const exported = await audioExporter.exportAudio({ sampleRate: 48000, mono: true });
    currentAudioPath = exported.outputPath;
    const clipsMeta = exported.clips;

    updateProgress("cut", 40, "2/4 — Deepgram Nova-3 ile sessizlikler tespit ediliyor (audio yükleniyor, 30 sn–1 dk)...");
    const settings = getCurrentSettings();
    const sd = await silenceDetector.detect(currentAudioPath, {
      noiseThreshold: settings.silenceThreshold,
      minDuration: settings.minSilenceDuration,
    });
    const silenceRegions = sd.regions;
    const totalDuration = sd.duration;

    let breathRegions = [];
    if (settings.detectBreaths) {
      updateProgress("cut", 70, "3/4 — Nefes sesleri tespit ediliyor (yerel hesaplama, hızlı)...");
      breathRegions = breathDetector.findBreathCandidates(silenceRegions);
    }

    updateProgress("cut", 90, "4/4 — Kes/Tut segmentleri hesaplanıyor (yerel, hızlı)...");
    analysisResult = segmentBuilder.build(totalDuration, silenceRegions, breathRegions, {
      paddingBefore: settings.paddingBefore,
      paddingAfter: settings.paddingAfter,
      minKeepDuration: settings.minKeepDuration,
    });
    analysisResult.clipsMeta = clipsMeta;

    updateProgress("cut", 100, "Tamamlandi");
    displayCutResults(analysisResult);
    const applyBtn = document.getElementById("btn-apply-cut");
    if (applyBtn) _setDisabled(applyBtn, !analysisResult.keep || analysisResult.keep.length === 0);
    if (!analysisResult.keep || analysisResult.keep.length === 0) {
      setStatus("Tutulacak bolge yok — esigi dusur (-40 dB gibi) ve 'Sifirla' deneyin", "error");
    } else {
      const s = analysisResult.stats;
      setStatus(
        `Analiz: ${s.silenceCount} sessiz, ${analysisResult.remove.length} remove-bolge, ` +
        `${analysisResult.keep.length} keep, kesilen=${s.totalRemove.toFixed(2)}s, ` +
        `pad=${settings.paddingBefore.toFixed(3)}s`,
        "success"
      );
    }

  } catch (err) {
    console.error("Analiz hatasi:", err);
    setStatus(`Hata: ${err.message}`, "error");
  } finally {
    btn.innerHTML = origBtnLabel;
    _setDisabled(btn, false);
    setTimeout(() => showProgress("cut", false), 1000);
  }
}

// ——— AUTO-CUT: Apply ———
async function handleApplyCut() {
  if (!analysisResult) {
    setStatus("Once analiz yapin", "error");
    return;
  }
  if (!analysisResult.keep || !analysisResult.keep.length) {
    setStatus("Tutulacak bolge yok — ayarlar cok agresif", "error");
    return;
  }
  if (!analysisResult.remove || !analysisResult.remove.length) {
    setStatus("Silinecek sessizlik bulunamadi — esigi yukselt veya min. sessizligi dusur", "error");
    return;
  }

  // Sequence-koruma uyarısı: Auto-Cut yerinde keser, Cmd+Z tek-adım değil.
  // Kullanıcı her seferinde sequence kopyasını aldığını onaylasın.
  const proceed = await showConfirm({
    title: "Sequence kopyası aldın mı?",
    body: 'Auto-Cut <strong>aktif sequence\'i yerinde keser</strong>. Cmd+Z birden fazla undo gerektirir, tek adımda geri almıyor. Lütfen önce <strong>Project paneli\'nde sequence\'e sağ tık → "Duplicate"</strong> yaparak kopya al, sonra devam et.',
    confirmLabel: "Kopya aldım, devam et",
    cancelLabel: "İptal",
  });
  if (!proceed) {
    setStatus("İptal edildi — sequence kopyası al, sonra tekrar başlat", "");
    return;
  }

  const btn = document.getElementById("btn-apply-cut");
  const origBtnLabel = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Lütfen bekleyin, kesim uygulanıyor...';
  _setDisabled(btn, true);
  showProgress("cut", true, "Kesim başlatılıyor (Cmd+Z ile geri alınabilir)...");
  setStatus("Kesim uygulanıyor — segment sayısına göre 30 sn–2 dk sürebilir, lütfen bekleyin...");

  try {
    updateProgress("cut", 10, "1/3 — Aktif sequence alınıyor...");
    const seq = await duplicator.duplicateActiveSequence(" - AutoCut");

    updateProgress("cut", 20, "2/3 — Orijinal klipler siliniyor + yeni parçalar yerleştiriliyor (effects korunarak)...");
    await daemon.log("reconstruct", `START keep=${analysisResult.keep.length} clipsMeta=${(analysisResult.clipsMeta||[]).length}`);
    const result = await reconstructor.reconstruct(
      seq,
      (pct) => updateProgress("cut", 20 + Math.round(pct * 0.7), `Parça yerleştiriliyor — %${pct}`),
      analysisResult.keep,
      analysisResult.clipsMeta,
      (stageMsg) => {
        updateProgress("cut", null, stageMsg);
        setStatus(stageMsg);
        daemon.log("reconstruct", stageMsg);
      }
    );
    await daemon.log("reconstruct", `END success=${result.success} message=${result.message}`);

    updateProgress("cut", 100, "3/3 — Tamamlandı");
    setStatus(`AutoCut: ${result.message}`, result.success ? "success" : "error");
  } catch (err) {
    console.error("Cut hatasi:", err);
    setStatus(`Hata: ${err.message}`, "error");
  } finally {
    btn.innerHTML = origBtnLabel;
    _setDisabled(btn, false);
    setTimeout(() => showProgress("cut", false), 1500);
  }
}

// ——— AUTO-SRT: Transcribe ———
async function handleTranscribe() {
  const btn = document.getElementById("btn-transcribe");
  const origBtnLabel = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Lütfen bekleyin, transkript ediliyor...';
  _setDisabled(btn, true);
  showProgress("srt", true, "Sıralı işlem başlatılıyor...");
  setStatus("Transkript başladı — sequence uzunluğuna göre 1-2 dakika sürebilir, lütfen bekleyin...");

  try {
    updateProgress("srt", 10, "1/5 — Sequence'den ses çıkarılıyor (FFmpeg ile mixdown, 30 sn–1 dk)...");
    const { outputPath: audioPath } = await audioExporter.exportAudio({
      sampleRate: 16000,
      mono: true,
      suffix: "-srt",
    });
    currentAudioPath = audioPath;

    // Auto-offset icin: gercek konusma baslangicini bul (silence detect)
    updateProgress("srt", 15, "2/5 — Konuşma başlangıcı tespit ediliyor (auto-offset, hızlı)...");
    let realSpeechStart = 0;
    let silenceRegions = [];
    try {
      const sd = await silenceDetector.detect(audioPath, {
        noiseThreshold: -40,
        minDuration: 0.25,
      });
      silenceRegions = Array.isArray(sd.regions) ? sd.regions : [];
      // Eger ilk silence dosyanin basindan basliyorsa, gercek konusma silence
      // bittiginde baslar.
      if (silenceRegions.length > 0 && silenceRegions[0].start <= 0.05) {
        realSpeechStart = silenceRegions[0].end;
      }
    } catch (e) {
      console.warn("Auto-offset silence detect hatasi:", e.message);
    }

    updateProgress("srt", 20, "3/5 — Deepgram Nova-3 ile transkripsiyon (audio yükleniyor + işleniyor, 30 sn–1 dk)...");
    const preTranscribeSettings = getCurrentSettings();
    const language = preTranscribeSettings.language || "tr";

    let segments = await transcriber.transcribe(audioPath, { language });

    segments = sanitizeTranscriptSegments(segments);
    // rawSegments: sanitize sonrası, offset/strip öncesi referans —
    // stepper/slider değişiminde Deepgram'a tekrar gitmeden regroup için saklanır.
    const rawSegments = segments;

    // Auto-offset + stripSilenceOnlyWords KAPATILDI:
    // Deepgram word-level timestamp'leri zaten dogru (mixdown'in 0'indan itibaren).
    // Mixdown sequence'in mevcut halinden alindigi icin SRT timestamp'leri
    // sequence timeline'iyla 1-1 ortusur — kullanicinin video sonunda yaptigi
    // edit'lere gore konusmalar nerede baslarsa SRT de orada baslar.
    //
    // Onceki post-processing (auto-offset, stripSilenceOnlyWords) Deepgram'in
    // dogru timestamp'lerini eski Whisper migration'i icin kaydiriyor + kelime
    // atiyordu — bu yanlis yonde kaymaya neden oluyordu.
    //
    // Artik sadece manual offset slider'i uygulaniyor (default 0, kullanici
    // ince ayar yapmak isterse).
    const autoOffsetSec = 0;
    const whisperFirstWord = findFirstSpeechStart(segments);

    const manualOffsetSec = (preTranscribeSettings.subtitleOffsetMs || 0) / 1000;
    if (manualOffsetSec) {
      segments = applyOffsetToSegments(segments, manualOffsetSec);
    }

    setStatus(
      `Konusma baslangici: ${Number.isFinite(whisperFirstWord) && whisperFirstWord < Infinity ? whisperFirstWord.toFixed(2) : "?"}s — manuel offset: ${Math.round(manualOffsetSec * 1000)}ms`
    );

    if (segments.length === 0) {
      throw new Error("Anlamli konusma segmenti bulunamadi");
    }

    updateProgress("srt", 85, "4/5 — Altyazı segmentleri oluşturuluyor (yerel, hızlı)...");

    // Kelime listesi topla (word-level yoksa segment-level kullan)
    const allWords = [];
    for (const seg of segments) {
      if (seg.words && seg.words.length > 0) {
        allWords.push(...seg.words);
      } else {
        // Word-level yoksa segment'i parcalara bol
        const text = seg.text.trim();
        const words = text.split(/\s+/).filter(w => w.length > 0);
        const wordDuration = (seg.end - seg.start) / Math.max(words.length, 1);
        words.forEach((w, i) => {
          allWords.push({
            text: w,
            start: seg.start + i * wordDuration,
            end: seg.start + (i + 1) * wordDuration,
          });
        });
      }
    }

    if (allWords.length === 0) {
      throw new Error("Altyazi icin kullanilabilir kelime bulunamadi");
    }

    const settings = getCurrentSettings();
    let captions = captionGrouper.group(allWords, settings);

    // Speech-relative: ilk caption'in start'ini 0'a sifirla, tum caption'lari
    // sola kaydir. Boylelikle SRT konusmanin baslangicindan itibaren saymaya
    // baslar (mixdown'in ilk N saniyelik bosluk kismi atlanir).
    //
    // Kullanici SRT'yi Premiere'e import ettiginde sequence'de konusmanin
    // basladigi yere surukleyecek -> birebir senkronize. Onceden mixdown-absolute
    // mod sequence basinda bosluk varsa SRT N saniye gec basliyor gibi
    // gorunuyordu (kullanicinin "baslangicta kayma" gorbildirimi).
    if (captions.length > 0 && captions[0].start > 0.05) {
      const shift = captions[0].start;
      captions = captions.map((c) => ({
        ...c,
        start: Math.max(0, c.start - shift),
        end: Math.max(0, c.end - shift),
      }));
    }

    transcriptResult = {
      rawSegments,
      autoOffsetSec,
      silenceRegions,
      segments,
      captions,
    };
    updateProgress("srt", 100, "5/5 — Tamamlandı");
    displaySRTPreview(captions);
    setStatus(`Transkript hazır: ${captions.length} altyazı oluşturuldu. Önizlemeyi inceleyip Kaydet'e bas.`, "success");

  } catch (err) {
    console.error("SRT hatasi:", err);
    setStatus(`Hata: ${err.message}`, "error");
  } finally {
    btn.innerHTML = origBtnLabel;
    _setDisabled(btn, false);
    setTimeout(() => showProgress("srt", false), 1500);
  }
}

// ——— SRT live regroup pipeline ———
// Stepper/slider/checkbox değişiminde Deepgram'a tekrar gitmeden, rawSegments
// üzerinden offset + strip + group pipeline'ını yeniden çalıştırır.

function flattenWordsFromSegments(segments) {
  const allWords = [];
  for (const seg of (segments || [])) {
    if (seg.words && seg.words.length > 0) {
      allWords.push(...seg.words);
    } else {
      const text = (seg.text || "").trim();
      const words = text.split(/\s+/).filter(Boolean);
      if (words.length === 0) continue;
      const wd = (seg.end - seg.start) / words.length;
      words.forEach((w, i) => allWords.push({
        text: w,
        start: seg.start + i * wd,
        end: seg.start + (i + 1) * wd,
      }));
    }
  }
  return allWords;
}

function applyTranscriptPipeline(rawSegments, autoOffsetSec, settings, silenceRegions) {
  let segs = rawSegments || [];
  if (autoOffsetSec) segs = applyOffsetToSegments(segs, autoOffsetSec);
  if (Array.isArray(silenceRegions) && silenceRegions.length > 0) {
    segs = stripSilenceOnlyWords(segs, silenceRegions);
  }
  const manualOffsetSec = (settings.subtitleOffsetMs || 0) / 1000;
  if (manualOffsetSec) segs = applyOffsetToSegments(segs, manualOffsetSec);
  return segs;
}

function rerenderCaptions() {
  if (!transcriptResult || !Array.isArray(transcriptResult.rawSegments)) return;
  const settings = getCurrentSettings();
  const segments = applyTranscriptPipeline(
    transcriptResult.rawSegments,
    transcriptResult.autoOffsetSec || 0,
    settings,
    transcriptResult.silenceRegions || []
  );
  const allWords = flattenWordsFromSegments(segments);
  if (allWords.length === 0) return;
  try {
    let captions = captionGrouper.group(allWords, settings);
    // Speech-relative: handleTranscribe ile ayni shift'i uygula
    if (captions.length > 0 && captions[0].start > 0.05) {
      const shift = captions[0].start;
      captions = captions.map((c) => ({
        ...c,
        start: Math.max(0, c.start - shift),
        end: Math.max(0, c.end - shift),
      }));
    }
    transcriptResult.segments = segments;
    transcriptResult.captions = captions;
    displaySRTPreview(captions);
    setStatus(`Yeniden gruplandi: ${captions.length} altyazi`, "success");
  } catch (e) {
    console.warn("[regroup]", e.message);
    setStatus(`Gruplama hatasi: ${e.message}`, "error");
  }
}

function debounce(fn, ms) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), ms);
  };
}

const debouncedRerenderCaptions = debounce(rerenderCaptions, 250);

function isMeaningfulWordText(text) {
  if (!text) return false;
  const stripped = String(text).replace(/[\s\.,!?;:…\-"'`()\[\]{}]+/g, "");
  return stripped.length > 0;
}

function sanitizeTranscriptSegments(segments) {
  return (segments || [])
    .map((seg) => {
      const words = (seg.words || []).filter((w) => (
        isMeaningfulWordText(w.text) &&
        Number.isFinite(w.start) &&
        Number.isFinite(w.end) &&
        w.end > w.start
      ));
      return {
        ...seg,
        words,
      };
    })
    .filter((seg) => seg.words.length > 0 || isMeaningfulWordText(seg.text));
}

function findFirstSpeechStart(segments) {
  let first = Infinity;
  for (const seg of (segments || [])) {
    if (Array.isArray(seg.words)) {
      for (const w of seg.words) {
        if (isMeaningfulWordText(w.text) && Number.isFinite(w.start)) {
          first = Math.min(first, w.start);
          break;
        }
      }
    }
    if (Number.isFinite(first) && first < Infinity) break;
    if (isMeaningfulWordText(seg.text) && Number.isFinite(seg.start)) {
      first = Math.min(first, seg.start);
    }
  }
  return first;
}

function applyOffsetToSegments(segments, offsetSec) {
  if (!offsetSec) return segments;
  return (segments || []).map((seg) => ({
    ...seg,
    start: Math.max(0, seg.start + offsetSec),
    end: Math.max(0, seg.end + offsetSec),
    words: (seg.words || []).map((w) => ({
      ...w,
      start: Math.max(0, w.start + offsetSec),
      end: Math.max(0, w.end + offsetSec),
    })),
  }));
}

function stripSilenceOnlyWords(segments, silenceRegions) {
  return (segments || [])
    .map((seg) => {
      const filteredWords = (seg.words || []).filter((word) => !isWordInsideSilence(word, silenceRegions));
      if (filteredWords.length > 0) {
        return {
          ...seg,
          start: filteredWords[0].start,
          end: filteredWords[filteredWords.length - 1].end,
          text: filteredWords.map((w) => w.text).join(" "),
          words: filteredWords,
        };
      }

      if (isMeaningfulWordText(seg.text) && !isWordInsideSilence(seg, silenceRegions)) {
        return { ...seg, words: [] };
      }

      return null;
    })
    .filter(Boolean);
}

function isWordInsideSilence(item, silenceRegions) {
  if (!item || !Array.isArray(silenceRegions) || silenceRegions.length === 0) return false;
  const start = Number(item.start);
  const end = Number(item.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
  const midpoint = (start + end) / 2;

  return silenceRegions.some((region) => (
    region &&
    region.duration >= 0.25 &&
    midpoint >= region.start + 0.05 &&
    midpoint <= region.end - 0.05
  ));
}

// ——— AUTO-SRT: Save ———
async function handleSaveSRT() {
  if (!transcriptResult || !transcriptResult.captions.length) {
    setStatus("Once transkript yapin", "error");
    return;
  }

  try {
    const ppro = require("premierepro");
    const project = await ppro.Project.getActiveProject();
    const sequence = await project.getActiveSequence();
    const seqName = sequence.name || "sequence";
    const safeName = String(seqName).replace(/[^a-zA-Z0-9_-]/g, "_");

    // Daemon'dan gercek home dizinini al (UXP'de os.userInfo guvenilmez)
    const { documentsDir } = await daemon.getHomeDirs();
    const outputDir = `${documentsDir}/PremierSEYO`;
    const savedFiles = [];

    if (document.getElementById("output-srt").checked) {
      const srtPath = `${outputDir}/${safeName}.srt`;
      const saved = await srtWriter.write(srtPath, transcriptResult.captions);
      savedFiles.push(saved);
    }

    if (document.getElementById("output-vtt").checked) {
      const vttPath = `${outputDir}/${safeName}.vtt`;
      const saved = await vttWriter.write(vttPath, transcriptResult.captions);
      savedFiles.push(saved);
    }

    if (savedFiles.length > 0) {
      // SRT'yi otomatik olarak proje bin'e import et
      try {
        const srtFile = savedFiles.find(f => f.endsWith(".srt"));
        if (srtFile) {
          const rootItem = await project.getRootItem();
          await project.importFiles([srtFile], true, rootItem, false);
          setStatus(`Kaydedildi ve proje paneline eklendi (${savedFiles.length} dosya)`, "success");
        } else {
          setStatus(`Kaydedildi: ${savedFiles.length} dosya`, "success");
        }
      } catch (importErr) {
        console.warn("SRT import hatasi:", importErr);
        await daemon.reveal(savedFiles[0]);
        setStatus(`Kaydedildi (import manuel): ${savedFiles.length} dosya`, "success");
      }
    } else {
      setStatus("Cikti formati secin", "error");
    }
  } catch (err) {
    console.error("Save hatasi:", err);
    setStatus(`Hata: ${err.message}`, "error");
  }
}

// ——— UI Helpers ———

function displayCutResults(result) {
  const { stats } = result;
  const container = document.getElementById("results-cut");
  container.style.display = "block";

  document.getElementById("stat-silence-count").textContent = stats.silenceCount;
  document.getElementById("stat-breath-count").textContent = stats.breathCount;
  document.getElementById("stat-remove-time").textContent = timeUtils.formatDuration(stats.totalRemove);
  document.getElementById("stat-keep-time").textContent = timeUtils.formatDuration(stats.totalKeep);
  document.getElementById("stat-reduction").textContent = stats.reductionPercent + "%";
  renderWaveform(result);
}

function renderWaveform(result) {
  const container = document.getElementById("waveform");
  container.innerHTML = "";

  const totalDuration = result.stats.totalDuration;
  if (totalDuration === 0) return;

  const all = [
    ...result.keep.map(s => ({ ...s, type: "keep" })),
    ...result.remove.map(s => ({ ...s, type: "remove" })),
  ].sort((a, b) => a.start - b.start);

  for (const seg of all) {
    const widthPercent = (seg.duration / totalDuration) * 100;
    const el = document.createElement("div");
    el.className = `waveform-segment ${seg.type}`;
    el.style.width = `${Math.max(widthPercent, 0.5)}%`;
    container.appendChild(el);
  }
}

function displaySRTPreview(captions) {
  const container = document.getElementById("results-srt");
  container.style.display = "block";

  const preview = document.getElementById("srt-preview");
  const maxPreview = Math.min(captions.length, 10);

  let html = "";
  for (let i = 0; i < maxPreview; i++) {
    const cap = captions[i];
    const startTS = timeUtils.secondsToSRT(cap.start);
    const endTS = timeUtils.secondsToSRT(cap.end);
    html += `<div><span class="srt-index">${cap.index}</span></div>`;
    html += `<div><span class="srt-time">${startTS} --> ${endTS}</span></div>`;
    html += `<div><span class="srt-text">${escapeHtml(cap.text)}</span></div>`;
    html += `<br/>`;
  }

  if (captions.length > maxPreview) {
    html += `<div style="color:var(--text-muted)">... ve ${captions.length - maxPreview} altyazi daha</div>`;
  }

  preview.innerHTML = html;
}

function showProgress(tab, visible, text) {
  const container = document.getElementById(`progress-${tab}`);
  if (!container) return;
  container.style.display = visible ? "block" : "none";
  if (visible && text) {
    const textEl = document.getElementById(`progress-${tab}-text`);
    if (textEl) textEl.textContent = text;
  }
}

function updateProgress(tab, percent, text) {
  const fill = document.getElementById(`progress-${tab}-fill`);
  const textEl = document.getElementById(`progress-${tab}-text`);
  if (fill && typeof percent === "number" && isFinite(percent)) {
    fill.style.width = `${percent}%`;
  }
  if (text && textEl) textEl.textContent = text;
}

function setStatus(text, type = "") {
  const bar = document.getElementById("status-bar");
  if (!bar) return;
  bar.textContent = text;
  bar.className = `status-bar ${type}`;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ——— Settings ———

function readSliderValue(id) {
  const el = document.getElementById(id);
  if (!el) return NaN;
  // UXP'de dataset property bazen NaN/undefined dönüyor; getAttribute daha güvenilir
  if (el.getAttribute) {
    const attr = el.getAttribute("data-value");
    if (attr !== null && attr !== undefined && attr !== "") {
      const n = parseFloat(attr);
      if (!isNaN(n)) return n;
    }
  }
  if (el.dataset && el.dataset.value !== undefined) {
    const n = parseFloat(el.dataset.value);
    if (!isNaN(n)) return n;
  }
  return parseFloat(el.value);
}

function safeNumber(val, fallback) {
  return (typeof val === "number" && isFinite(val)) ? val : fallback;
}

function readStepperInt(id, fallback) {
  const el = document.getElementById(`${id}-val`);
  return safeNumber(parseInt(el && el.textContent, 10), fallback);
}

function getCurrentSettings() {
  const paddingMs = safeNumber(readSliderValue("padding"), 150);
  const langSel = document.getElementById("srt-language");
  const maxWordsPerCaption = readStepperInt("maxWordsPerCaption", 6);
  return {
    silenceThreshold: safeNumber(parseInt(readSliderValue("silenceThreshold")), -40),
    minSilenceDuration: safeNumber(readSliderValue("minSilenceDuration"), 0.4),
    paddingBefore: paddingMs / 1000,
    paddingAfter: paddingMs / 1000,
    detectBreaths: document.getElementById("detectBreaths").checked,
    minKeepDuration: safeNumber(readSliderValue("minKeepDuration"), 0.3),
    maxWordsPerCaption,
    maxLinesPerSub: 1,
    maxWordsPerLine: maxWordsPerCaption,
    maxCharsPerLine: 999,
    maxSubDuration: safeNumber(readSliderValue("maxSubDuration"), 5),
    minSubDuration: safeNumber(readSliderValue("minSubDuration"), 0),
    cpsLimit: safeNumber(parseInt(readSliderValue("cpsLimit")), 20),
    subtitleOffsetMs: safeNumber(readSliderValue("subtitleOffset"), 0),
    language: (langSel && langSel.value) || "tr",
    splitOnSentence: document.getElementById("splitOnSentence").checked,
    splitOnPause: document.getElementById("splitOnPause").checked,
  };
}

function saveCurrentSettings() {
  if (!settingsHydrated) return;
  config.save(getCurrentSettings());
}

function restoreSettings() {
  const s = config.get();
  setSlider("silenceThreshold", s.silenceThreshold, " dB");
  setSlider("minSilenceDuration", s.minSilenceDuration, "s");
  setSlider("padding", Math.round((s.paddingBefore || 0.15) * 1000), "ms");
  setSlider("minKeepDuration", s.minKeepDuration, "s");
  setSlider("maxSubDuration", s.maxSubDuration, "s");
  setSlider("minSubDuration", s.minSubDuration, "s");
  setSlider("cpsLimit", s.cpsLimit, "");
  setSlider("subtitleOffset", s.subtitleOffsetMs != null ? s.subtitleOffsetMs : 0, "ms");
  const langSel = document.getElementById("srt-language");
  if (langSel && s.language) langSel.value = s.language;
  setStepperVal("maxWordsPerCaption", s.maxWordsPerCaption != null ? s.maxWordsPerCaption : s.maxWordsPerLine);
  setCheckbox("detectBreaths", s.detectBreaths);
  setCheckbox("splitOnSentence", s.splitOnSentence);
  setCheckbox("splitOnPause", s.splitOnPause);
}

function setSlider(id, value, suffix) {
  const slider = document.getElementById(id);
  const valEl = document.getElementById(`${id}-val`);
  if (slider) {
    const num = parseFloat(value);
    if (slider.dataset && slider.dataset.min !== undefined) {
      // cslider: data-value + CSS custom property
      const min = parseFloat(slider.dataset.min);
      const max = parseFloat(slider.dataset.max);
      const step = parseFloat(slider.dataset.step) || 1;
      const decimals = (String(step).split(".")[1] || "").length;
      const clamped = Math.max(min, Math.min(max, num));
      slider.dataset.value = decimals > 0 ? clamped.toFixed(decimals) : String(Math.round(clamped));
      const percent = ((clamped - min) / (max - min)) * 100;
      slider.style.setProperty("--percent", `${percent}%`);
    } else {
      slider.value = value;
    }
  }
  if (valEl) {
    const step = slider ? parseFloat(
      (slider.dataset && slider.dataset.step) || slider.step
    ) || 1 : 1;
    const decimals = (String(step).split(".")[1] || "").length;
    const num = parseFloat(value);
    const display = decimals > 0 ? num.toFixed(decimals) : String(Math.round(num));
    valEl.textContent = display + suffix;
  }
}

function setStepperVal(id, value) {
  const valEl = document.getElementById(`${id}-val`);
  if (valEl) valEl.textContent = value;
}

function setCheckbox(id, checked) {
  const cb = document.getElementById(id);
  if (cb) cb.checked = checked;
}

// ——— Settings drawer + API key onboarding ———
function setupSettingsDrawer() {
  const backdrop = document.getElementById("drawer-backdrop");
  const drawer = document.getElementById("drawer-settings");
  const closeBtn = document.getElementById("drawer-close");
  const settingsBtn = document.getElementById("btn-settings");
  const onboardingBtn = document.getElementById("btn-onboarding-open");
  const connBadge = document.getElementById("conn-badge");
  const keyInput = document.getElementById("api-key-input");
  const keyToggle = document.getElementById("api-key-toggle");
  const testBtn = document.getElementById("btn-test-key");
  const saveBtn = document.getElementById("btn-save-key");
  const signupLink = document.getElementById("link-deepgram-signup");
  const getKeyLink = document.getElementById("link-get-key");

  const open = () => {
    if (!drawer) return;
    drawer.classList.add("open");
    if (backdrop) backdrop.classList.add("open");
    setTimeout(() => { if (keyInput && document.body.classList.contains("no-key")) keyInput.focus(); }, 280);
  };
  const close = () => {
    if (drawer) drawer.classList.remove("open");
    if (backdrop) backdrop.classList.remove("open");
  };

  if (settingsBtn) settingsBtn.addEventListener("click", open);
  if (onboardingBtn) onboardingBtn.addEventListener("click", open);
  if (connBadge) connBadge.addEventListener("click", open);
  if (closeBtn) closeBtn.addEventListener("click", close);
  if (backdrop) backdrop.addEventListener("click", close);

  if (keyToggle && keyInput) {
    keyToggle.addEventListener("click", () => {
      keyInput.type = keyInput.type === "password" ? "text" : "password";
    });
  }

  if (testBtn) {
    testBtn.addEventListener("click", async () => {
      const typed = keyInput && keyInput.value.trim();
      // Kaydetmeden test: typed varsa daemon'a geçici key olarak gönderilir,
      // stored key korunur. Test başarılıysa kullanıcı "Kaydet ve Bağlan" basar.
      await runConnectionTest(testBtn, typed || null);
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const key = keyInput && keyInput.value.trim();
      if (!key) {
        showToast("Key boş", "error");
        return;
      }
      _setDisabled(saveBtn, true);
      const orig = saveBtn.innerHTML;
      saveBtn.innerHTML = '<span class="spinner"></span> Kaydediliyor';
      try {
        await daemon.setDeepgramKey(key);
        keyInput.value = "";
        keyInput.type = "password";
        await runConnectionTest(testBtn);
        await refreshConnectionStatus();
        showToast("key kaydedildi", "success");
        setTimeout(close, 800);
      } catch (e) {
        showToast(`hata: ${e.message}`, "error");
      } finally {
        _setDisabled(saveBtn, false);
        saveBtn.innerHTML = orig;
      }
    });
  }

  if (signupLink) {
    signupLink.addEventListener("click", () => showToast("console.deepgram.com", ""));
  }
  if (getKeyLink) {
    getKeyLink.addEventListener("click", () => showToast("console.deepgram.com", ""));
  }
}

async function runConnectionTest(testBtn, tempKey = null) {
  const card = document.getElementById("conn-status-card");
  const stateEl = document.getElementById("conn-card-state");
  const detailEl = document.getElementById("conn-card-detail");
  let origLabel = null;
  if (testBtn) {
    _setDisabled(testBtn, true);
    origLabel = testBtn.innerHTML;
    testBtn.innerHTML = '<span class="spinner"></span> test ediliyor';
  }
  try {
    const res = await daemon.deepgramTest(tempKey);
    if (card) {
      card.classList.remove("live", "error");
      if (res.status === "valid") {
        card.classList.add("live");
        if (stateEl) stateEl.textContent = tempKey ? "test başarılı · henüz kaydedilmedi" : "bağlı · nova-3 hazır";
        if (detailEl) detailEl.textContent = tempKey
          ? `${res.projectCount || 0} proje · "Kaydet ve Bağlan" ile saklayın`
          : `${res.projectCount || 0} proje görüldü`;
      } else if (res.status === "no_key") {
        if (stateEl) stateEl.textContent = "key girilmedi";
        if (detailEl) detailEl.textContent = "Yukarıdaki alana key yapıştır";
      } else {
        card.classList.add("error");
        if (stateEl) stateEl.textContent = "geçersiz key";
        if (detailEl) detailEl.textContent = res.message || "tekrar dene";
      }
    }
  } catch (e) {
    if (card) {
      card.classList.remove("live");
      card.classList.add("error");
      if (stateEl) stateEl.textContent = "test başarısız";
      if (detailEl) detailEl.textContent = e.message;
    }
  } finally {
    if (testBtn) {
      _setDisabled(testBtn, false);
      testBtn.innerHTML = origLabel || "Bağlantıyı Test Et";
    }
  }
}

async function refreshConnectionStatus() {
  const badge = document.getElementById("conn-badge");
  const badgeText = document.getElementById("conn-badge-text");
  try {
    const check = await daemon.check();
    const hasKey = !!check.deepgram;
    const hasAme = !!check.ame;

    // Öncelik: AME yoksa kritik (mixdown çalışmaz), key yoksa Auto-SRT çalışmaz
    if (!hasAme) {
      document.body.classList.remove("no-key");
      if (badge) {
        badge.classList.remove("live");
        badge.classList.add("error");
      }
      if (badgeText) badgeText.textContent = "AME yok";
      return;
    }

    if (hasKey) {
      document.body.classList.remove("no-key");
      if (badge) {
        badge.classList.remove("error");
        badge.classList.add("live");
      }
      if (badgeText) badgeText.textContent = "deepgram · canlı";
    } else {
      document.body.classList.add("no-key");
      if (badge) {
        badge.classList.remove("live");
        badge.classList.remove("error");
      }
      if (badgeText) badgeText.textContent = "key girilmedi";
    }
  } catch (e) {
    document.body.classList.remove("no-key");
    if (badge) {
      badge.classList.remove("live");
      badge.classList.add("error");
    }
    if (badgeText) badgeText.textContent = "baglanti hatasi";
  }
}

function showToast(message, type) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = message;
  t.className = "toast";
  if (type) t.classList.add(type);
  void t.offsetWidth;
  t.classList.add("show");
  if (showToast._timer) clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove("show"), 2400);
}

// ——— Confirmation Modal ———
// HTML markup index.html'de sabit (#modal-backdrop + #modal-confirm).
// Promise<boolean> döner: true = onayla, false = iptal/backdrop click.
function showConfirm({ title, body, confirmLabel = "Devam et", cancelLabel = "İptal" } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById("modal-backdrop");
    const titleEl = document.getElementById("modal-title");
    const bodyEl = document.getElementById("modal-body");
    const okBtn = document.getElementById("modal-confirm-ok");
    const cancelBtn = document.getElementById("modal-cancel");

    if (!backdrop || !okBtn || !cancelBtn) {
      // Fallback: modal markup yoksa onaysız geç (defensif)
      resolve(true);
      return;
    }

    if (title && titleEl) titleEl.textContent = title;
    if (body && bodyEl) bodyEl.innerHTML = body;
    okBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelLabel;

    const cleanup = (result) => {
      backdrop.classList.remove("open");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      backdrop.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };

    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (e) => { if (e.target === backdrop) cleanup(false); };
    const onKey = (e) => {
      if (e.key === "Escape") cleanup(false);
      else if (e.key === "Enter") cleanup(true);
    };

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    backdrop.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);

    backdrop.classList.add("open");
    setTimeout(() => okBtn.focus(), 280);
  });
}

// ——— UXP Entrypoint ———
const { entrypoints } = require("uxp");

entrypoints.setup({
  panels: {
    "premierseyo-panel": {
      show() { console.log("PremierSEYO panel acildi"); },
      hide() { console.log("PremierSEYO panel kapandi"); },
    },
  },
});
