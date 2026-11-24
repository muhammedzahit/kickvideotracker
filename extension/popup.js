const KEY_PREFIX = "vod:";

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function ago(ts) {
  const diff = Math.max(0, Date.now() - ts) / 1000;
  if (diff < 60) return "az önce";
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} sa önce`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} gün önce`;
  return new Date(ts).toLocaleDateString("tr-TR");
}

function el(tag, props = {}, children = []) {
  const e = Object.assign(document.createElement(tag), props);
  for (const c of children) e.append(c);
  return e;
}

function render() {
  chrome.storage.local.get(null, (all) => {
    const entries = Object.entries(all || {})
      .filter(([k]) => k.startsWith(KEY_PREFIX))
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const list = document.getElementById("list");
    list.replaceChildren();
    document.getElementById("empty").hidden = entries.length > 0;
    document.getElementById("clear").hidden = entries.length === 0;

    for (const e of entries) {
      const pct = e.d ? Math.min(100, (e.t / e.d) * 100) : 0;
      const title = e.title || "İsimsiz yayın";
      const status = e.finished
        ? el("span", { className: "done", textContent: "✓ İzlendi" })
        : `${fmt(e.t)} / ${fmt(e.d)}`;

      const link = el("a", { className: "title", href: e.url, textContent: title, title });
      link.addEventListener("click", (ev) => {
        ev.preventDefault();
        chrome.tabs.create({ url: e.url });
      });

      const del = el("button", { className: "ghost del", textContent: "✕", title: "Kaydı sil" });
      del.addEventListener("click", () => chrome.storage.local.remove(e.key, render));

      list.append(
        el("li", {}, [
          el("div", { className: "info" }, [
            link,
            el("div", { className: "meta" }, [
              e.channel ? `${e.channel} · ` : "",
              status,
              ` · ${ago(e.updatedAt)}`,
            ]),
            el("div", { className: "bar" }, [
              el("span", { style: `width:${e.finished ? 100 : pct}%` }),
            ]),
          ]),
          del,
        ])
      );
    }
  });
}

document.getElementById("clear").addEventListener("click", () => {
  if (!confirm("Tüm kayıtlı ilerlemeler silinsin mi?")) return;
  chrome.storage.local.get(null, (all) => {
    const keys = Object.keys(all || {}).filter((k) => k.startsWith(KEY_PREFIX));
    chrome.storage.local.remove(keys, render);
  });
});

render();
