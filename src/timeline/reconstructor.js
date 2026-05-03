/**
 * Multi-clip keep-only reconstruction.
 *
 * Analyze tarafinda sequence mixdown timeline zamaninda silence detect ediliyor.
 * Yani keepSegments[] timeline cinsinden {start,end}. Birden fazla kaynak klip,
 * trimli klip veya boslukli sequence'te timeline(t) != source(t) oldugu icin her
 * keep segmentini overlap eden kaynak kliplere bolmek gerekir.
 *
 * Akis:
 *  0) Ön dogrulama: keep segmentleri clipsMeta'ya gore parcalara bol, her parcanin
 *     kaynak dosya path'i icin project item'i cozumle. Herhangi bir kaynak
 *     cozulemezse islem baslatilmadan hata ver (fail-fast).
 *  1) Orijinal track item'larini ripple-delete ile sil.
 *  2) dst cursor'i 0'dan baslat; her parca icin:
 *       - ilgili klibin ClipProjectItem.createSetInOutPointsAction(srcIn, srcOut)
 *       - editor.createInsertProjectItemAction(pi, dst, V, A, true)
 *       - dst = dst.add(srcOut.subtract(srcIn))
 *  3) Son olarak kullanilmis tum bin item'lari icin createClearInOutPointsAction.
 *
 * Not: UXP Premiere API'si programatik sequence duplicate vermedigi ve
 * createInsertProjectItemAction state-bagimli oldugu icin islem teknik olarak
 * tek transaction'a toplanmiyor. Fail-fast validation ve kullaniciyi Cmd+Z
 * ile adim adim geri alabilecegi konusunda uyarma yoluna gidilmistir.
 */

const seqEditor = require("./sequence-editor");
const mapper = require("./timeline-mapper");
const effectsPreserver = require("./effects-preserver");

// Daemon log helper — effects flow'u remote loglama için (kullanıcı testinde
// runtime davranışını görebilmek için). Hata olursa silent skip.
function logFx(tag, msg) {
  try {
    const daemon = require("../utils/daemon");
    daemon.log(tag, msg);
  } catch {}
  console.log(`[${tag}]`, msg);
}

async function reconstruct(inputSequence, onProgress, keepSegments, clipsMeta, onStage) {
  const ppro = require("premierepro");
  const stageLog = (msg) => { if (typeof onStage === "function") onStage(msg); };

  if (!keepSegments || keepSegments.length === 0) {
    return { success: false, message: "Tutulacak bolge yok — ayarlar cok agresif" };
  }
  if (!Array.isArray(clipsMeta) || clipsMeta.length === 0) {
    return { success: false, message: "Clip metadata yok — once Analiz Et'e basin" };
  }

  const pieces = mapper.splitAllKeeps(keepSegments, clipsMeta);
  if (pieces.length === 0) {
    return { success: false, message: "Kesim icin kaynak parca bulunamadi" };
  }
  stageLog(`${pieces.length} parca hesaplandi`);

  let project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Aktif proje yok");

  let sequence = inputSequence;
  let editor = ppro.SequenceEditor.getEditor(sequence);
  if (!editor) throw new Error("SequenceEditor alinamadi");

  const { videoItems, audioItems } = await seqEditor.getTrackItems(sequence);
  const allItems = [...videoItems, ...audioItems];
  if (allItems.length === 0) {
    return { success: false, message: "Sequence bos" };
  }

  const { videoTrackIdx, audioTrackIdx } = pickTargetTracks(videoItems, audioItems);
  const mediaTypeVideo = getMediaType(ppro, "VIDEO", 0);
  const mediaTypeAudio = getMediaType(ppro, "AUDIO", 1);

  // ——— Ön dogrulama: tum kaynaklar icin project item cozumle ———
  const wantedPaths = mapper.uniqueSourcePaths(pieces);
  const pathToItem = await resolveProjectItemsByPaths(ppro, project, wantedPaths);
  const missing = wantedPaths.filter((p) => !pathToItem.has(p));
  if (missing.length > 0) {
    return {
      success: false,
      message: `ProjectItem bulunamadi (${missing.length} klip): ${missing[0].split("/").pop()}`,
    };
  }

  let stage = "baslangic";

  // NOT: Eski "consolidated mode" (tek-source sequence'leri FFmpeg ile yeni bir
  // autocut-merged-*.mp4 olarak render edip timeline'a tek klip insert etme)
  // davranisi v1.1.0'da kaldirildi. Kullanici orijinal kliplerin yerinde
  // kesilmesini ve clip sinirlarinin korunmasini istedi (manuel muduhale icin).
  // Artik her zaman parca-bazli (pieces) mode calisir: orijinaller silinir,
  // her keep parcasi kaynak ClipProjectItem'in in/out point'leri ile yeniden
  // insert edilir. FFmpeg render adimi yok, project'e yeni dosya import edilmez.

  // ——— Phase 0: Effects snapshot ———
  // Orijinal trackitem'lar silinmeden ÖNCE her clipsMeta entry'si için video
  // ve audio component-chain snapshot'ı al. Phase 2 insert sonrası her piece'e
  // path + originalTimelineStart key'i ile eşleşen snapshot yeni TrackItem'a uygulanır.
  //
  // ÖNEMLİ: Önceki sürümde lookup `piece.originalIndex` (flatten slice indeksi)
  // ile yapılıyordu — bu multi-clip senaryolarda tüm piece'leri aynı clipsMeta
  // entry'sine map ediyordu (clip[1] hep kazanırdı). Path-keyed lookup ile her
  // piece kendi orijinal track item'inin effects'ini alıyor.
  const effectsByPath = new Map();
  logFx("fx-phase0-start", `clipsMeta=${clipsMeta.length} V=${videoItems.length} A=${audioItems.length} mtV=${mediaTypeVideo} mtA=${mediaTypeAudio}`);
  try {
    for (let j = 0; j < clipsMeta.length; j++) {
      const meta = clipsMeta[j];
      if (!meta || !meta.path) continue;
      const matchVideo = videoItems.find((vi) => (
        Number(vi.trackIndex) === Number(meta.trackIndex) &&
        Math.abs(vi.start - (meta.timelineStart || 0)) < 0.05
      ));
      const matchAudio = audioItems.find((ai) => (
        Math.abs(ai.start - (meta.timelineStart || 0)) < 0.05
      ));
      const entry = {};
      let vCompCount = -1, aCompCount = -1;
      if (matchVideo) {
        const snap = await effectsPreserver.snapshotChain(matchVideo.item, mediaTypeVideo);
        vCompCount = (snap && snap.components) ? snap.components.length : 0;
        if (effectsPreserver.hasMeaningfulSnapshot(snap)) entry.video = snap;
      }
      if (matchAudio) {
        const snap = await effectsPreserver.snapshotChain(matchAudio.item, mediaTypeAudio);
        aCompCount = (snap && snap.components) ? snap.components.length : 0;
        if (effectsPreserver.hasMeaningfulSnapshot(snap)) entry.audio = snap;
      }
      // Path + timelineStart key — aynı kaynak dosya farklı pozisyonlarda da
      // birden fazla track item olabilir, her birinin effects'i ayrı saklanır.
      const startKey = (meta.timelineStart || 0).toFixed(2);
      const key = `${meta.path}|${startKey}`;
      logFx("fx-snap", `meta#${j} path=${(meta.path||"").split("/").pop()} tlStart=${startKey} trk=${meta.trackIndex} matchV=${!!matchVideo} matchA=${!!matchAudio} V.comp=${vCompCount} A.comp=${aCompCount} stored=${!!(entry.video||entry.audio)}`);
      if (entry.video || entry.audio) effectsByPath.set(key, entry);
    }
    logFx("fx-phase0-end", `snapshots=${effectsByPath.size}`);
    if (effectsByPath.size > 0) {
      stageLog(`Effects snapshot: ${effectsByPath.size} klip için kayıt alındı`);
    }
  } catch (e) {
    logFx("fx-phase0-fail", e.message);
    console.warn("[reconstructor] effects snapshot loop fail:", e.message);
  }

  try {
    // ——— Phase 1: Orijinal klipleri sil (video + audio ayri) ———
    // MediaType "ANY" UXP'de guvenilir olarak cozulemedigi icin video ve audio
    // icin ayri removeItemsAction cagrilir. Phase 1 birden fazla retry ile
    // validate edilir — UXP sequence state refresh gecikmesi nedeniyle ilk check
    // bazen eski durumu gosteriyor.
    stageLog(`Phase 1: ${videoItems.length} video + ${audioItems.length} audio item silinecek`);

    stage = "orijinal video silme";
    if (videoItems.length > 0) {
      runActionTransaction(project, "PremierSEYO: Remove video originals", () => {
        const action = createRemoveActionForItems(ppro, editor, videoItems, true, mediaTypeVideo, true);
        if (!action) throw new Error("createRemoveItemsAction (video) null");
        return action;
      });
      await new Promise((r) => setTimeout(r, 400));
      ({ project, sequence, editor } = await refreshSequenceContext(ppro, sequence));
    }

    stage = "orijinal audio silme";
    if (audioItems.length > 0) {
      runActionTransaction(project, "PremierSEYO: Remove audio originals", () => {
        const action = createRemoveActionForItems(ppro, editor, audioItems, true, mediaTypeAudio, true);
        if (!action) throw new Error("createRemoveItemsAction (audio) null");
        return action;
      });
      await new Promise((r) => setTimeout(r, 400));
      ({ project, sequence, editor } = await refreshSequenceContext(ppro, sequence));
    }

    // Remove sonrasi dogrulama: timeline bosaldi mi?
    // UXP state refresh gecikmesi icin birden fazla retry + uzun wait
    let leftoverCount = -1;
    let retries = 0;
    while (retries < 6) {
      const afterRemove = await seqEditor.getTrackItems(sequence);
      leftoverCount = afterRemove.videoItems.length + afterRemove.audioItems.length;
      if (leftoverCount === 0) break;
      stageLog(`Phase 1 retry ${retries + 1}/6: ${leftoverCount} item hala kaldi`);
      retries++;
      // Tekrar sil, state stale olabilir veya ilk call tam ise yaramadi.
      // Video ve audio ayri media type ister; karisik selection audio artiklarini
      // kacirabiliyor.
      if (retries <= 3) {
        try {
          if (afterRemove.videoItems.length > 0) {
            runActionTransaction(project, `PremierSEYO: Remove leftover video (retry ${retries})`, () => {
              return createRemoveActionForItems(ppro, editor, afterRemove.videoItems, true, mediaTypeVideo, true);
            });
          }
          if (afterRemove.audioItems.length > 0) {
            runActionTransaction(project, `PremierSEYO: Remove leftover audio (retry ${retries})`, () => {
              return createRemoveActionForItems(ppro, editor, afterRemove.audioItems, true, mediaTypeAudio, true);
            });
          }
        } catch (e) {
          console.warn("Retry remove hatasi:", e.message);
        }
      }
      await new Promise((r) => setTimeout(r, 500));
      ({ project, sequence, editor } = await refreshSequenceContext(ppro, sequence));
    }
    if (leftoverCount > 0) {
      throw new Error(`Orijinal klipler silinemedi: ${leftoverCount} item kaldi (6 retry sonrasi). mediaType V=${mediaTypeVideo} A=${mediaTypeAudio}`);
    }
    stageLog("Phase 1 tamam: timeline bosaldi");

    // ——— Phase 2: Her parcayi kaynagindan insert et ———
    // dst cursor'i her iterasyonda sequence sonundan yeniden hesaplariz
    // (Premiere insert davranisi ripple/overwrite farkliliklarinda gap/overlap
    // olusturabildigi icin manual sayim yerine groundtruth track state).
    let successCount = 0;
    const usedClipPIs = new Map();

    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const segmentNumber = i + 1;

      const resolved = pathToItem.get(piece.path);
      if (!resolved) {
        throw new Error(`Parca ${segmentNumber} icin project item kayip: ${piece.path}`);
      }

      let clipPI = resolved.clipPI;
      if (!clipPI) {
        clipPI = await safeCastClipProjectItem(ppro, resolved.projectItem);
        if (!clipPI) throw new Error(`ClipProjectItem.cast basarisiz: ${piece.path}`);
        resolved.clipPI = clipPI;
      }
      usedClipPIs.set(piece.path, clipPI);

      const srcIn = ppro.TickTime.createWithSeconds(piece.sourceIn);
      const srcOut = ppro.TickTime.createWithSeconds(piece.sourceOut);

      // Sequence sonunu bul: tum track item'larinin max end'i. Empty ise 0.
      const currentItems = await seqEditor.getTrackItems(sequence);
      const allEnds = [...currentItems.videoItems, ...currentItems.audioItems].map((i) => i.end);
      const sequenceEnd = allEnds.length > 0 ? Math.max(...allEnds) : 0;
      const dst = ppro.TickTime.createWithSeconds(sequenceEnd);

      stage = `parca ${segmentNumber}/${pieces.length} source in/out`;
      runActionTransaction(project, `PremierSEYO: Source in/out ${segmentNumber}`, () => {
        const action = clipPI.createSetInOutPointsAction(srcIn, srcOut);
        if (!action) throw new Error("createSetInOutPointsAction null");
        return action;
      });

      stage = `parca ${segmentNumber}/${pieces.length} insert @ ${sequenceEnd.toFixed(3)}s`;
      runActionTransaction(project, `PremierSEYO: Insert ${segmentNumber}`, () => {
        const action = editor.createInsertProjectItemAction(
          resolved.projectItem,
          dst,
          videoTrackIdx,
          audioTrackIdx,
          true
        );
        if (!action) throw new Error(`insert action null (parca ${segmentNumber})`);
        return action;
      });

      await new Promise((r) => setTimeout(r, 180));
      ({ project, sequence, editor } = await refreshSequenceContext(ppro, sequence));

      // ——— Effects apply: insert edilen yeni TrackItem'ları bul ve snapshot uygula ———
      // Phase 0'da kaydedilen orijinal effects (Motion + filter + keyframes) bu
      // segmente ait piece'a göre source-time map ile yeniden uygulanır.
      try {
        // path + originalTimelineStart key ile lookup
        const piecePath = piece.path || "";
        const pieceOrigStart = (piece.originalTimelineStart != null
          ? piece.originalTimelineStart
          : piece.timelineStart || 0).toFixed(2);
        const lookupKey = `${piecePath}|${pieceOrigStart}`;
        let entry = effectsByPath.get(lookupKey);
        // Fallback: aynı path'te tek bir entry varsa onu kullan (originalTimelineStart
        // mismatch durumunda — örn. flatten slice merge sonrası start kayması)
        if (!entry) {
          const sameSourceEntries = [...effectsByPath.entries()].filter(([k]) => k.startsWith(piecePath + "|"));
          if (sameSourceEntries.length === 1) {
            entry = sameSourceEntries[0][1];
          }
        }
        logFx("fx-apply-lookup", `seg=${segmentNumber} key=${piecePath.split("/").pop()}|${pieceOrigStart} hasEntry=${!!entry} V.snap=${!!(entry && entry.video)} A.snap=${!!(entry && entry.audio)}`);
        if (entry && (entry.video || entry.audio)) {
          const afterInsert = await seqEditor.getTrackItems(sequence);
          // En yeni track item'ı = belirli track içinde max start (insert ripple
          // sonrası genelde sequence sonunda olur)
          const newVideoItem = afterInsert.videoItems
            .filter((vi) => vi.trackIndex === videoTrackIdx)
            .sort((a, b) => b.start - a.start)[0];
          const newAudioItem = afterInsert.audioItems
            .filter((ai) => ai.trackIndex === audioTrackIdx)
            .sort((a, b) => b.start - a.start)[0];

          logFx("fx-apply-newitem", `seg=${segmentNumber} newV=${!!newVideoItem} newA=${!!newAudioItem} sourceIn=${piece.sourceIn.toFixed(3)} sourceOut=${piece.sourceOut.toFixed(3)} newTLstart=${newVideoItem ? newVideoItem.start.toFixed(3) : '?'}`);

          if (entry.video && newVideoItem) {
            const ctx = {
              mediaType: mediaTypeVideo,
              newSourceIn: piece.sourceIn,
              newSourceOut: piece.sourceOut,
              newTimelineStart: newVideoItem.start,
            };
            const effActions = await effectsPreserver.buildApplyActions(ppro, newVideoItem.item, entry.video, ctx);
            logFx("fx-apply-V-actions", `seg=${segmentNumber} actions=${effActions.length}`);
            if (effActions.length > 0) {
              try {
                runActionTransaction(project, `PremierSEYO: Apply effects ${segmentNumber} V`, () => effActions);
                logFx("fx-apply-V-ok", `seg=${segmentNumber}`);
              } catch (e) {
                logFx("fx-apply-V-fail", `seg=${segmentNumber} err=${e.message}`);
                console.warn(`[effects] video apply ${segmentNumber} fail:`, e.message);
              }
            }
          }
          if (entry.audio && newAudioItem) {
            const ctx = {
              mediaType: mediaTypeAudio,
              newSourceIn: piece.sourceIn,
              newSourceOut: piece.sourceOut,
              newTimelineStart: newAudioItem.start,
            };
            const effActions = await effectsPreserver.buildApplyActions(ppro, newAudioItem.item, entry.audio, ctx);
            logFx("fx-apply-A-actions", `seg=${segmentNumber} actions=${effActions.length}`);
            if (effActions.length > 0) {
              try {
                runActionTransaction(project, `PremierSEYO: Apply effects ${segmentNumber} A`, () => effActions);
                logFx("fx-apply-A-ok", `seg=${segmentNumber}`);
              } catch (e) {
                logFx("fx-apply-A-fail", `seg=${segmentNumber} err=${e.message}`);
                console.warn(`[effects] audio apply ${segmentNumber} fail:`, e.message);
              }
            }
          }
        }
      } catch (e) {
        logFx("fx-apply-phase-fail", `seg=${segmentNumber} err=${e.message}`);
        console.warn("[effects] apply phase fail:", e.message);
      }

      successCount++;
      if (onProgress) {
        onProgress(Math.round((successCount / pieces.length) * 95));
      }
    }

    // Kullanilmis tum bin item'lari icin source in/out temizle
    stage = "clear source in/out";
    for (const [, clipPI] of usedClipPIs) {
      try {
        runActionTransaction(project, "PremierSEYO: Clear source in/out", () => {
          if (typeof clipPI.createClearInOutPointsAction !== "function") return null;
          return clipPI.createClearInOutPointsAction();
        });
      } catch (e) {
        console.warn("clear in/out uyarisi:", e.message);
      }
    }

    if (onProgress) onProgress(100);

    return {
      success: true,
      message: `${successCount}/${pieces.length} parca eklendi (${keepSegments.length} keep segmenti)`,
      mode: "pieces",
    };
  } catch (e) {
    console.error("Reconstruction hatasi:", e);
    throw new Error(`Kesim uygulanamadi (${stage}): ` + (e.message || String(e)));
  }
}

async function resolveProjectItemsByPaths(ppro, project, wantedPaths) {
  const wanted = new Set(wantedPaths);
  const pathToItem = new Map();
  const rootItem = await project.getRootItem();
  const seen = new Set();
  await walkForPaths(ppro, rootItem, wanted, pathToItem, seen);
  return pathToItem;
}

async function walkForPaths(ppro, projectItem, wanted, pathToItem, seen) {
  if (!projectItem) return;
  if (wanted.size === pathToItem.size) return; // tum hedefler bulundu

  let key = "";
  try { key = String(projectItem.guid || projectItem.name || ""); } catch {}
  if (key && seen.has(key)) return;
  if (key) seen.add(key);

  try {
    const clipItem = await ppro.ClipProjectItem.cast(projectItem);
    if (clipItem) {
      const path = await clipItem.getMediaFilePath();
      if (path && wanted.has(path) && !pathToItem.has(path)) {
        pathToItem.set(path, { projectItem, clipPI: clipItem });
      }
    }
  } catch {}

  try {
    const folderItem = await ppro.FolderItem.cast(projectItem);
    if (folderItem && typeof folderItem.getItems === "function") {
      const children = await folderItem.getItems();
      if (Array.isArray(children)) {
        for (const child of children) {
          await walkForPaths(ppro, child, wanted, pathToItem, seen);
          if (wanted.size === pathToItem.size) return;
        }
      }
    }
  } catch {}
}

async function safeCastClipProjectItem(ppro, projectItem) {
  if (!projectItem) return null;
  try {
    const clipPI = await ppro.ClipProjectItem.cast(projectItem);
    if (clipPI) return clipPI;
  } catch {}
  return null;
}

function tickAdd(ppro, a, b) {
  if (a && typeof a.add === "function") {
    try { return a.add(b); } catch {}
  }
  return ppro.TickTime.createWithSeconds(toSeconds(a) + toSeconds(b));
}

function tickSub(ppro, a, b) {
  if (a && typeof a.subtract === "function") {
    try { return a.subtract(b); } catch {}
  }
  return ppro.TickTime.createWithSeconds(toSeconds(a) - toSeconds(b));
}

function toSeconds(tickTime) {
  if (!tickTime) return 0;
  if (typeof tickTime.seconds === "number") return tickTime.seconds;
  try { return Number(tickTime.seconds || 0); } catch { return 0; }
}

function pickTargetTracks(videoItems, audioItems) {
  const videoTrackIdx = videoItems.length > 0
    ? Math.min(...videoItems.map((i) => i.trackIndex))
    : 0;
  const audioTrackIdx = audioItems.length > 0
    ? Math.min(...audioItems.map((i) => i.trackIndex))
    : 0;
  return { videoTrackIdx, audioTrackIdx };
}

function getMediaType(ppro, name, fallback) {
  const mediaType = (ppro.Constants || ppro.constants || {}).MediaType || {};
  const variants = [name, name.toLowerCase(), name[0] + name.slice(1).toLowerCase()];
  for (const variant of variants) {
    if (mediaType[variant] !== undefined) return mediaType[variant];
  }
  return fallback;
}

function createRemoveActionForItems(ppro, editor, items, ripple, mediaType, shiftOverLapping) {
  const factory = ppro.TrackItemSelection;
  if (!factory || typeof factory.createEmptySelection !== "function") {
    throw new Error("TrackItemSelection API bulunamadi");
  }

  let action = null;
  let callbackError = null;

  try {
    factory.createEmptySelection((selection) => {
      try {
        addItemsToSelection(selection, items);
        action = createRemoveItemsAction(editor, selection, ripple, mediaType, shiftOverLapping);
      } catch (e) {
        callbackError = e;
      }
    });
  } catch (e) {
    callbackError = e;
  }

  if (callbackError && !action) {
    console.warn("TrackItemSelection callback yolu basarisiz:", callbackError.message || callbackError);
  }
  if (action) return action;

  let selection = null;
  try {
    const result = factory.createEmptySelection();
    if (result && typeof result.addItem === "function") selection = result;
  } catch (e) {
    throw new Error("Track item selection olusturulamadi: " + (e.message || String(e)));
  }

  if (!selection) {
    throw new Error("Track item selection olusturulamadi");
  }

  addItemsToSelection(selection, items);
  return createRemoveItemsAction(editor, selection, ripple, mediaType, shiftOverLapping);
}

function addItemsToSelection(selection, items) {
  if (!selection || typeof selection.addItem !== "function") {
    throw new Error("Track item selection gecersiz");
  }

  for (const ti of items) {
    const ok = selection.addItem(ti.item, true);
    if (ok === false) {
      console.warn("Selection addItem basarisiz:", ti.start, ti.end);
    }
  }
}

function createRemoveItemsAction(editor, selection, ripple, mediaType, shiftOverLapping) {
  try {
    return editor.createRemoveItemsAction(selection, ripple, mediaType, shiftOverLapping);
  } catch (e) {
    if (!/parameter/i.test(e.message || "")) throw e;
    return editor.createRemoveItemsAction(selection, ripple, mediaType);
  }
}

async function refreshSequenceContext(ppro, previousSequence) {
  const project = await ppro.Project.getActiveProject();
  if (!project) throw new Error("Aktif proje yok");

  let sequence = await project.getActiveSequence();
  if (!sequence && previousSequence) sequence = previousSequence;
  if (!sequence) throw new Error("Aktif sequence yok");

  const editor = ppro.SequenceEditor.getEditor(sequence);
  if (!editor) throw new Error("SequenceEditor alinamadi");

  return { project, sequence, editor };
}

function runActionTransaction(project, label, actionFactory) {
  let ok = true;
  let callbackError = null;

  try {
    project.lockedAccess(() => {
      ok = project.executeTransaction((ca) => {
        try {
          const actions = normalizeActions(actionFactory());
          for (const action of actions) ca.addAction(action);
        } catch (e) {
          callbackError = e;
        }
      }, label);
    });
  } catch (e) {
    throw new Error(`${label} fail: ${(e.message || String(e)).substring(0, 160)}`);
  }

  if (callbackError) {
    throw new Error(`${label} action fail: ${(callbackError.message || String(callbackError)).substring(0, 160)}`);
  }
  if (ok === false) throw new Error(`${label} transaction basarisiz`);
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) actions = [actions];
  const filtered = actions.filter(Boolean);
  if (filtered.length === 0) throw new Error("Transaction action listesi bos");
  return filtered;
}

module.exports = { reconstruct };
