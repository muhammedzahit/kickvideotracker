// Kick VOD Kaldığın Yer — içerik betiği
// Kick bir SPA olduğu için sayfa yenilenmeden URL değişebilir; bu yüzden
// her saniye durumu kontrol eden basit ve sağlam bir döngü kullanıyoruz.

(() => {
  "use strict";

  const KEY_PREFIX = "vod:";
  const SAVE_INTERVAL_MS = 5000; // oynarken en fazla 5 sn'de bir kaydet
  const MIN_RESUME_SEC = 10; // bundan önceyse kaydetme/geri yükleme
  const END_MARGIN_SEC = 30; // sona bu kadar yakınsa "izlendi" say
  const MAX_ENTRIES = 500; // depoda tutulacak en fazla video sayısı
  const RESTORE_MAX_ATTEMPTS = 6;

  const VOD_RE = /\/videos?\/([A-Za-z0-9_-]{6,})/;

  let state = freshState(null);

  function freshState(vodId) {
    return {
      vodId,
      video: null,
      // SPA geçişinde eski <video> elemanı bir süre yerinde kalabilir.
      // Yeni videonun yüklendiğinden emin olmadan geri yükleme/kaydetme yapmayalım.
      staleVideo: null,
      staleSrc: null,
      staleTitle: null, // SPA geçişinde önceki sayfanın başlığı
      title: null,
      channel: getChannel(),
      url: location.origin + location.pathname,
      saved: undefined, // undefined = henüz okunmadı, null = kayıt yok
      loading: false,
      restored: false, // true olunca kaydetmeye izin var
      restoreTarget: null,
      restoreAttempts: 0,
      lastRestoreTry: 0,
      lastSave: 0,
    };
  }

  // ---------- yardımcılar ----------

  function alive() {
    // Eklenti yeniden yüklenince eski içerik betiği "ölü" kalır.
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function getVodId() {
    const m = location.pathname.match(VOD_RE);
    return m ? m[1] : null;
  }

  function hasExplicitTime() {
    // URL'de ?t=... gibi bir zaman varsa kullanıcının isteğine saygı göster.
    const p = new URLSearchParams(location.search);
    return p.has("t") || p.has("time") || p.has("start");
  }

  function getChannel() {
    const seg = location.pathname.split("/").filter(Boolean);
    if (seg.length >= 3 && /^videos?$/.test(seg[1])) return seg[0];
    return null;
  }

  function getTitle() {
    if (state.staleTitle != null && document.title === state.staleTitle) return null;
    let t = (document.title || "").trim();
    t = t.replace(/\s*[|\-–]\s*Kick\s*$/i, "").trim();
    return t || null;
  }

  function findVideo() {
    let best = null;
    let bestArea = 0;
    for (const v of document.querySelectorAll("video")) {
      if (!v.isConnected) continue;
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) {
        best = v;
        bestArea = area;
      }
    }
    return best || document.querySelector("video");
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(key, (res) => resolve(res ? res[key] : undefined));
      } catch {
        resolve(undefined);
      }
    });
  }

  function storageSet(obj) {
    try {
      chrome.storage.local.set(obj);
    } catch {
      /* eklenti bağlamı geçersiz */
    }
  }

  let pruneScheduled = false;
  function schedulePrune() {
    if (pruneScheduled) return;
    pruneScheduled = true;
    setTimeout(() => {
      try {
        chrome.storage.local.get(null, (all) => {
          const keys = Object.keys(all || {}).filter((k) => k.startsWith(KEY_PREFIX));
          if (keys.length <= MAX_ENTRIES) return;
          keys.sort((a, b) => (all[a].updatedAt || 0) - (all[b].updatedAt || 0));
          chrome.storage.local.remove(keys.slice(0, keys.length - MAX_ENTRIES));
        });
      } catch {
        /* yoksay */
      }
    }, 3000);
  }

  // ---------- video hazır mı? ----------

  function videoReady(v) {
    if (!v || v.readyState < 1) return false;
    if (!isFinite(v.duration) || v.duration <= 0) return false;
    // SPA geçişinde eski video hala yerindeyse yeni kaynağı bekle
    if (state.staleVideo && v === state.staleVideo && v.currentSrc === state.staleSrc) {
      return false;
    }
    return true;
  }

  // ---------- kaydetme ----------

  function save(force = false) {
    const v = state.video;
    if (!alive() || !state.vodId || !state.restored || !videoReady(v)) return;
    // URL başka bir sayfaya geçtiyse bu <video> artık bu kayda ait olmayabilir
    if (getVodId() !== state.vodId) return;

    const now = Date.now();
    if (!force && now - state.lastSave < SAVE_INTERVAL_MS) return;
    state.lastSave = now;

    const t = v.currentTime;
    const d = v.duration;
    const finished = t >= d - END_MARGIN_SEC;
    if (t < MIN_RESUME_SEC && !finished && !(state.saved && state.saved.t > 0)) {
      return; // en başta, kaydedecek bir şey yok
    }

    const entry = {
      id: state.vodId,
      t: Math.floor(t),
      d: Math.floor(d),
      finished,
      title: state.title || (state.saved && state.saved.title) || null,
      channel: state.channel || (state.saved && state.saved.channel) || null,
      url: state.url,
      updatedAt: now,
    };
    state.saved = entry;
    storageSet({ [KEY_PREFIX + state.vodId]: entry });
    schedulePrune();
  }

  // ---------- geri yükleme ----------

  function tryRestore() {
    const v = state.video;
    if (state.restored || !videoReady(v)) return;
    if (state.saved === undefined) return; // depo henüz okunmadı

    const s = state.saved;
    if (
      !s ||
      s.finished ||
      hasExplicitTime() ||
      s.t < MIN_RESUME_SEC ||
      s.t >= v.duration - END_MARGIN_SEC
    ) {
      state.restored = true;
      return;
    }

    const now = Date.now();
    if (state.restoreTarget == null) {
      state.restoreTarget = s.t;
    } else if (Math.abs(v.currentTime - state.restoreTarget) < 5) {
      // Atlama tuttu
      state.restored = true;
      showToast(state.restoreTarget);
      return;
    }

    // Oynatıcı bazen ilk atlamayı sıfırlıyor; tutana kadar birkaç kez dene
    if (v.seeking || now - state.lastRestoreTry < 1200) return;
    if (state.restoreAttempts >= RESTORE_MAX_ATTEMPTS) {
      state.restored = true; // pes et, ama kaydetmeye devam et
      return;
    }
    state.restoreAttempts++;
    state.lastRestoreTry = now;
    try {
      v.currentTime = state.restoreTarget;
    } catch {
      /* yoksay */
    }
  }

  // ---------- bildirim ----------

  let toastHost = null;
  function showToast(target) {
    hideToast();
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;left:20px;bottom:20px;z-index:2147483647;pointer-events:auto;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .box{font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#fff;
          background:#18181b;border:1px solid #2f2f35;border-left:4px solid #53fc18;
          border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:12px;
          box-shadow:0 8px 24px rgba(0,0,0,.45);animation:in .2s ease-out}
        b{color:#53fc18}
        button{font:inherit;font-size:13px;cursor:pointer;border-radius:6px;padding:4px 10px;
          border:1px solid #3f3f46;background:#27272a;color:#fff}
        button:hover{background:#3f3f46}
        .x{border:none;background:none;color:#a1a1aa;padding:2px 4px;font-size:16px}
        @keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      </style>
      <div class="box">
        <span>Kaldığın yerden devam: <b>${fmt(target)}</b></span>
        <button class="restart">Baştan başla</button>
        <button class="x" title="Kapat">✕</button>
      </div>`;
    root.querySelector(".restart").addEventListener("click", () => {
      const v = state.video;
      if (v) {
        v.currentTime = 0;
        if (state.vodId) {
          state.saved = null;
          try {
            chrome.storage.local.remove(KEY_PREFIX + state.vodId);
          } catch {
            /* yoksay */
          }
        }
      }
      hideToast();
    });
    root.querySelector(".x").addEventListener("click", hideToast);
    (document.fullscreenElement || document.body).appendChild(host);
    toastHost = host;
    setTimeout(() => {
      if (toastHost === host) hideToast();
    }, 8000);
  }

  function hideToast() {
    if (toastHost) toastHost.remove();
    toastHost = null;
  }

  // ---------- video olayları ----------

  const onPause = () => save(true);
  const onSeeked = () => {
    if (state.video && state.video.paused) save(true);
  };
  const onEnded = () => save(true);

  function bindVideo(v) {
    if (state.video === v) return;
    unbindVideo();
    state.video = v;
    if (!v) return;
    v.addEventListener("pause", onPause);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("ended", onEnded);
  }

  function unbindVideo() {
    const v = state.video;
    if (!v) return;
    v.removeEventListener("pause", onPause);
    v.removeEventListener("seeked", onSeeked);
    v.removeEventListener("ended", onEnded);
    state.video = null;
  }

  // ---------- ana döngü ----------

  function tick() {
    if (!alive()) {
      clearInterval(timer);
      return;
    }

    const id = getVodId();
    if (id !== state.vodId || firstTick) {
      const isSpaNav = !firstTick;
      firstTick = false;
      // Not: burada "son kayıt" yapmıyoruz; URL zaten değişti ve <video> artık
      // yeni videoya ait olabilir. Oynarken 5 sn'de bir kayıt yapıldığı için kayıp en fazla birkaç saniye.
      const prevVideo = state.video;
      unbindVideo();
      hideToast();
      state = freshState(id);
      if (isSpaNav) state.staleTitle = lastSeenTitle;
      if (prevVideo && prevVideo.isConnected) {
        state.staleVideo = prevVideo;
        state.staleSrc = prevVideo.currentSrc;
      }
    }
    lastSeenTitle = document.title;
    if (!state.vodId) return;
    state.title = getTitle() || state.title;

    if (state.saved === undefined && !state.loading) {
      state.loading = true;
      const forId = state.vodId;
      storageGet(KEY_PREFIX + forId).then((val) => {
        if (state.vodId !== forId) return;
        state.saved = val || null;
        state.loading = false;
      });
    }

    bindVideo(findVideo());
    const v = state.video;
    if (!v) return;

    if (!state.restored) {
      tryRestore();
    } else if (!v.paused) {
      save(false);
    }
  }

  let firstTick = true;
  let lastSeenTitle = null;
  const timer = setInterval(tick, 1000);
  tick();

  // Sekme kapanırken / arka plana alınırken son konumu yaz
  window.addEventListener("pagehide", () => save(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save(true);
  });
})();
