/**
 * Auto-Cut "in-place keep-only reconstruction" sırasında orijinal TrackItem
 * silinmeden önce Motion + diğer component param'larını snapshot al, yeni
 * insert edilen TrackItem'a yeniden uygula.
 *
 * UXP `premierepro` API'si (25.0+):
 *   - TrackItem.getComponentChain(MediaType)
 *   - VideoComponentChain.getComponentCount() / getComponentAtIndex(i)
 *   - Component.getMatchName() / getDisplayName() / getParamCount() / getParam(i)
 *   - ComponentParam.areKeyframesSupported() / isTimeVarying() / getValue()
 *   - ComponentParam.getKeyframeListAsTickTimes() / getValueAtTime(TickTime)
 *   - ComponentParam.createKeyframe(value) / createSetValueAction(keyframe, bool)
 *   - ComponentParam.createSetTimeVaryingAction(bool) / createAddKeyframeAction(kf)
 *   - VideoFilterFactory.createComponent(matchName)
 *   - VideoComponentChain.createAppendComponentAction(component)
 *
 * Source-time mapping:
 *   keyframe.position TickTime'ı timeline cinsinden. Snapshot alırken
 *   sourceSeconds = kf_position - originalStart + originalInPoint dönüşümü
 *   ile source-time'a çevirilir; apply tarafında yeni TrackItem'ın
 *   newTimelineStart + (sourceSeconds - newSourceIn) ile timeline'a geri map.
 *
 * Hata toleransı: Snapshot/apply'da exception → warn + skip; kesim akışı
 * bozulmamalı. Phase 0 silmeden önce çağrılır, Phase 2 insert sonrası uygulanır.
 */

function logDeep(tag, msg) {
  try {
    const daemon = require("../utils/daemon");
    daemon.log(tag, msg);
  } catch {}
}

// UXP'de bazı API'ler method, bazıları property — defensive fallback chain
async function getParamValueDefensive(param, trackItem) {
  // 1) getValue() method
  if (typeof param.getValue === "function") {
    try {
      const v = await param.getValue();
      if (v !== undefined && v !== null) return { v, src: "getValue" };
    } catch {}
  }
  // 2) value property (getter)
  try {
    const v = param.value;
    if (v !== undefined && v !== null) return { v, src: "value-prop" };
  } catch {}
  // 3) getValueAtTime(trackItem.start) — Motion intrinsic için sıklıkla bu yöntem
  if (typeof param.getValueAtTime === "function") {
    try {
      const ppro = require("premierepro");
      const startTime = await trackItem.getStartTime();
      const t = startTime || ppro.TickTime.createWithSeconds(0);
      const v = await param.getValueAtTime(t);
      if (v !== undefined && v !== null) return { v, src: "getValueAtTime" };
    } catch {}
  }
  return { v: null, src: "none" };
}

async function isTimeVaryingDefensive(param) {
  if (typeof param.isTimeVarying === "function") {
    try { return !!(await param.isTimeVarying()); } catch {}
  }
  try { return !!param.isTimeVarying; } catch {}
  return false;
}

async function areKfsSupportedDefensive(param) {
  if (typeof param.areKeyframesSupported === "function") {
    try { return !!(await param.areKeyframesSupported()); } catch {}
  }
  try { return !!param.areKeyframesSupported; } catch {}
  return false;
}

async function getKeyframeTimesDefensive(param) {
  if (typeof param.getKeyframeListAsTickTimes === "function") {
    try {
      const kts = await param.getKeyframeListAsTickTimes();
      if (Array.isArray(kts)) return kts;
    } catch {}
  }
  if (typeof param.getKeyframeList === "function") {
    try {
      const kfs = await param.getKeyframeList();
      if (Array.isArray(kfs)) {
        return kfs.map((k) => k && k.position).filter(Boolean);
      }
    } catch {}
  }
  return [];
}

async function snapshotChain(trackItem, mediaType) {
  try {
    const chain = await trackItem.getComponentChain(mediaType);
    if (!chain) return { components: [] };
    const count = await safeCall(chain.getComponentCount, chain);
    if (!Number.isFinite(count) || count <= 0) return { components: [] };

    const startTime = await safeCall(trackItem.getStartTime, trackItem);
    const inPoint = await safeCall(trackItem.getInPoint, trackItem);
    const tiStart = (startTime && typeof startTime.seconds === "number") ? startTime.seconds : 0;
    const tiInPoint = (inPoint && typeof inPoint.seconds === "number") ? inPoint.seconds : 0;

    const components = [];
    for (let i = 0; i < count; i++) {
      try {
        const comp = await chain.getComponentAtIndex(i);
        if (!comp) continue;
        const matchName = await safeCall(comp.getMatchName, comp);
        const displayName = await safeCall(comp.getDisplayName, comp);
        if (/time.*remap/i.test(String(matchName) + String(displayName))) {
          components.push({ matchName, displayName, params: [], skipped: "time-remap" });
          continue;
        }

        const paramCount = await safeCall(comp.getParamCount, comp);
        const params = [];
        // UXP bazı versiyonlarda getParamCount=0 dönebilir → fallback: 32 param dene
        const safeParamCount = (Number.isFinite(paramCount) && paramCount > 0) ? paramCount : 32;
        logDeep("fx-snap-comp", `mt=${mediaType} comp#${i} match=${matchName} disp=${displayName} paramCount=${paramCount}`);

        for (let p = 0; p < safeParamCount; p++) {
          let param;
          try { param = await comp.getParam(p); } catch { continue; }
          if (!param) {
            if (!Number.isFinite(paramCount)) break; // fallback loop'u boşa dönmesin
            continue;
          }

          const supportsKf = await areKfsSupportedDefensive(param);
          const isTV = await isTimeVaryingDefensive(param);

          const valueResult = await getParamValueDefensive(param, trackItem);
          const staticValue = valueResult.v;

          const keyframes = [];
          if (supportsKf && isTV) {
            try {
              const kfTimes = await getKeyframeTimesDefensive(param);
              for (const kt of kfTimes) {
                if (!kt || typeof kt.seconds !== "number") continue;
                let value = null;
                let interpolationMode = null;
                if (typeof param.getValueAtTime === "function") {
                  try { value = await param.getValueAtTime(kt); } catch {}
                }
                if (typeof param.getKeyframePtr === "function") {
                  try {
                    const kfPtr = await param.getKeyframePtr(kt);
                    if (kfPtr && typeof kfPtr.getTemporalInterpolationMode === "function") {
                      interpolationMode = await kfPtr.getTemporalInterpolationMode();
                    }
                  } catch {}
                }
                keyframes.push({
                  sourceSeconds: kt.seconds - tiStart + tiInPoint,
                  value,
                  interpolationMode,
                });
              }
            } catch (e) {
              console.warn("[effects/snapshot] keyframe read fail:", e.message);
            }
          }

          // Per-param diagnostic log (sadece kompakt — match için)
          if (i === 0 && p < 6) {
            logDeep("fx-snap-param", `comp#${i} p=${p} valSrc=${valueResult.src} val=${staticValue!==null?'set':'null'} supKf=${supportsKf} isTV=${isTV} kfs=${keyframes.length}`);
          }

          // Eskiden: keyframes.length===0 && staticValue==null → skip.
          // Şimdi: param'ı yine kayda al — apply tarafında null'a karşı defansif.
          // Bu şekilde clamp/restore garanti.
          params.push({
            paramIndex: p,
            isTimeVarying: !!isTV && keyframes.length > 0,
            staticValue,
            keyframes,
          });
        }

        components.push({ matchName, displayName, params });
      } catch (e) {
        console.warn("[effects/snapshot] component read fail:", i, e.message);
      }
    }
    return { components };
  } catch (e) {
    console.warn("[effects/snapshot] chain fail:", e.message);
    return { components: [] };
  }
}

function hasMeaningfulSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.components)) return false;
  return snapshot.components.some((c) => Array.isArray(c.params) && c.params.length > 0);
}

async function buildApplyActions(ppro, trackItem, snapshot, ctx) {
  const actions = [];
  if (!hasMeaningfulSnapshot(snapshot)) return actions;
  if (!trackItem || !ctx) return actions;

  const { mediaType, newSourceIn, newSourceOut, newTimelineStart } = ctx;
  let chain;
  try {
    chain = await trackItem.getComponentChain(mediaType);
  } catch (e) {
    console.warn("[effects/apply] getComponentChain fail:", e.message);
    return actions;
  }
  if (!chain) return actions;

  // Mevcut chain'deki component'leri matchName -> Component map'le
  const compsByMatch = new Map();
  try {
    const newCount = await safeCall(chain.getComponentCount, chain);
    if (Number.isFinite(newCount)) {
      for (let i = 0; i < newCount; i++) {
        try {
          const c = await chain.getComponentAtIndex(i);
          if (!c) continue;
          const mn = await safeCall(c.getMatchName, c);
          if (mn) compsByMatch.set(String(mn), c);
        } catch {}
      }
    }
  } catch (e) {
    console.warn("[effects/apply] enumerate chain fail:", e.message);
  }

  for (const compSnap of snapshot.components) {
    if (compSnap.skipped) continue; // time-remap vs.
    if (!Array.isArray(compSnap.params) || compSnap.params.length === 0) continue;

    let targetComp = compsByMatch.get(String(compSnap.matchName));

    if (!targetComp) {
      // Custom video filter: factory ile oluştur + chain'e append.
      // Audio filter factory UXP'de yok varsayım — audio custom filter skip.
      try {
        const factory = ppro && ppro.VideoFilterFactory;
        if (factory && typeof factory.createComponent === "function" && isVideoMediaType(ppro, mediaType)) {
          const newComp = await factory.createComponent(compSnap.matchName);
          if (newComp) {
            const appendAction = await safeCall(chain.createAppendComponentAction, chain, newComp);
            if (appendAction) actions.push(appendAction);
            targetComp = newComp;
          }
        }
      } catch (e) {
        console.warn("[effects/apply] custom filter create fail:", compSnap.matchName, e.message);
      }
    }

    if (!targetComp) continue;

    for (const paramSnap of compSnap.params) {
      try {
        const param = await targetComp.getParam(paramSnap.paramIndex);
        if (!param) continue;
        const paramActions = await buildParamActions(ppro, param, paramSnap, {
          newSourceIn,
          newSourceOut,
          newTimelineStart,
        });
        for (const a of paramActions) if (a) actions.push(a);
      } catch (e) {
        console.warn("[effects/apply] param fail:", compSnap.matchName, paramSnap.paramIndex, e.message);
      }
    }
  }

  return actions;
}

async function buildParamActions(ppro, param, paramSnap, range) {
  const actions = [];
  const { newSourceIn, newSourceOut, newTimelineStart } = range;

  if (paramSnap.keyframes && paramSnap.keyframes.length > 0) {
    // Range filtresi: yalnızca yeni segmentin source aralığına düşen kf'ler
    const filtered = [];
    for (const kf of paramSnap.keyframes) {
      if (typeof kf.sourceSeconds !== "number") continue;
      if (kf.sourceSeconds + 1e-6 >= newSourceIn && kf.sourceSeconds - 1e-6 <= newSourceOut) {
        filtered.push(kf);
      }
    }

    if (filtered.length > 0) {
      // Time-varying'i aç
      try {
        const tvAction = await safeCall(param.createSetTimeVaryingAction, param, true);
        if (tvAction) actions.push(tvAction);
      } catch (e) {
        console.warn("[effects/apply] setTimeVarying fail:", e.message);
      }

      for (const kf of filtered) {
        try {
          const timelineSec = newTimelineStart + (kf.sourceSeconds - newSourceIn);
          const kfObj = await createKeyframeForValue(ppro, param, kf.value, timelineSec);
          if (!kfObj) continue;
          if (Number.isFinite(kf.interpolationMode) && typeof kfObj.setTemporalInterpolationMode === "function") {
            try { await kfObj.setTemporalInterpolationMode(kf.interpolationMode); } catch {}
          }
          const addAction = await param.createAddKeyframeAction(kfObj);
          if (addAction) actions.push(addAction);
        } catch (e) {
          console.warn("[effects/apply] kf add fail:", e.message);
        }
      }
    } else if (paramSnap.staticValue != null) {
      // Range dışında kaldı → staticValue ile sabitle (clamp)
      try {
        const a = await createSetValueActionForValue(ppro, param, paramSnap.staticValue);
        if (a) actions.push(a);
      } catch (e) {
        console.warn("[effects/apply] setValue (clamp) fail:", e.message);
      }
    }
  } else if (paramSnap.staticValue != null) {
    try {
      const a = await createSetValueActionForValue(ppro, param, paramSnap.staticValue);
      if (a) actions.push(a);
    } catch (e) {
      console.warn("[effects/apply] setValue fail:", e.message);
    }
  }

  return actions;
}

async function createSetValueActionForValue(ppro, param, value) {
  const kfObj = await createKeyframeForValue(ppro, param, value);
  if (!kfObj) return null;

  // Adobe UXP docs: createSetValueAction expects a Keyframe, not the raw value.
  // Older/beta builds were inconsistent, so keep narrow fallbacks after the
  // documented call shape.
  return (
    await safeCall(param.createSetValueAction, param, kfObj, true) ||
    await safeCall(param.createSetValueAction, param, kfObj) ||
    await safeCall(param.createSetValueAction, param, value, true) ||
    await safeCall(param.createSetValueAction, param, value)
  );
}

async function createKeyframeForValue(ppro, param, value, timelineSec) {
  if (value === undefined || value === null || typeof param.createKeyframe !== "function") {
    return null;
  }

  let lastError = null;
  for (const candidate of getValueCandidates(ppro, value)) {
    try {
      const kfObj = await param.createKeyframe(candidate);
      if (!kfObj) continue;
      if (Number.isFinite(timelineSec)) {
        kfObj.position = ppro.TickTime.createWithSeconds(timelineSec);
      }
      return kfObj;
    } catch (e) {
      lastError = e;
    }
  }

  if (lastError) {
    console.warn("[effects/apply] createKeyframe fail:", describeValue(value), lastError.message);
  }
  return null;
}

function getValueCandidates(ppro, value) {
  const candidates = [];
  const seen = [];
  const push = (v) => {
    if (v === undefined || v === null) return;
    if (seen.includes(v)) return;
    seen.push(v);
    candidates.push(v);
  };

  push(value);

  if (Array.isArray(value)) {
    if (value.length >= 2) push(makePointF(ppro, value[0], value[1]));
    if (value.length >= 4) push(makeColor(ppro, value[0], value[1], value[2], value[3]));
  } else if (value && typeof value === "object") {
    const x = firstFinite(value.x, value.X, value.horizontal, value.h, value[0]);
    const y = firstFinite(value.y, value.Y, value.vertical, value.v, value[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) push(makePointF(ppro, x, y));

    const r = firstFinite(value.red, value.r, value[0]);
    const g = firstFinite(value.green, value.g, value[1]);
    const b = firstFinite(value.blue, value.b, value[2]);
    const a = firstFinite(value.alpha, value.a, value[3], 1);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      push(makeColor(ppro, r, g, b, a));
    }

    if (value.value !== undefined && value.value !== value) push(value.value);
  }

  return candidates;
}

function makePointF(ppro, x, y) {
  const Ctor = ppro && ppro.PointF;
  if (typeof Ctor !== "function") return null;
  try {
    const pt = new Ctor(x, y);
    pt.x = Number(x);
    pt.y = Number(y);
    return pt;
  } catch {}
  try {
    const pt = new Ctor();
    pt.x = Number(x);
    pt.y = Number(y);
    return pt;
  } catch {}
  return null;
}

function makeColor(ppro, red, green, blue, alpha) {
  const Ctor = ppro && ppro.Color;
  if (typeof Ctor !== "function") return null;
  const safeAlpha = Number.isFinite(Number(alpha)) ? Number(alpha) : 1;
  try {
    const color = new Ctor(red, green, blue, safeAlpha);
    color.red = Number(red);
    color.green = Number(green);
    color.blue = Number(blue);
    color.alpha = safeAlpha;
    return color;
  } catch {}
  try {
    const color = new Ctor();
    color.red = Number(red);
    color.green = Number(green);
    color.blue = Number(blue);
    color.alpha = safeAlpha;
    return color;
  } catch {}
  return null;
}

function firstFinite(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function describeValue(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value !== "object") return `${typeof value}:${String(value)}`;
  const ctor = value.constructor && value.constructor.name ? value.constructor.name : "object";
  const keys = Object.keys(value).slice(0, 6).join(",");
  return `${ctor}{${keys}}`;
}

function isVideoMediaType(ppro, mediaType) {
  try {
    const consts = (ppro && (ppro.Constants || ppro.constants)) || {};
    const mt = consts.MediaType || {};
    if (mediaType === mt.VIDEO || mediaType === mt.Video || mediaType === mt.video) return true;
    return mediaType === 0;
  } catch {
    return mediaType === 0;
  }
}

async function safeCall(fn, ctx, ...args) {
  if (typeof fn !== "function") return null;
  try {
    const r = fn.apply(ctx, args);
    return r && typeof r.then === "function" ? await r : r;
  } catch (e) {
    return null;
  }
}

module.exports = {
  snapshotChain,
  buildApplyActions,
  hasMeaningfulSnapshot,
};
