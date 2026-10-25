(function () {
  const TYPES = [
    { k: "red", n: "紅", c: "#e5483b" }, { k: "yellow", n: "黃", c: "#f2c230" }, { k: "blue", n: "藍", c: "#3a7bd5" },
    { k: "purple", n: "紫", c: "#7b4bb7" }, { k: "white", n: "白", c: "#eeeae2" }, { k: "rock", n: "岩石", c: "#8a8f98" },
    { k: "winged", n: "飛翼", c: "#e88fb6" }, { k: "ice", n: "冰", c: "#7fd3e6" }, { k: "normal", n: "一般", c: "#b07a4f" }
  ];
  const SIZES = [{ k: "small", n: "小", r: 13 }, { k: "normal", n: "一般", r: 16 }, { k: "large", n: "大", r: 20 }, { k: "giant", n: "巨大", r: 26 }];
  const T = Object.fromEntries(TYPES.map(t => [t.k, t])), S = Object.fromEntries(SIZES.map(s => [s.k, s]));
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtCode = c => (c || "").replace(/(\d{4})(?=\d)/g, "$1 ");
  const left = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分` : `${m} 分鐘`; };

  const store = window.createStore();
  let me = null, docs = [], sel = null, pick = null, picking = false;
  const typeOn = new Set();

  /* ---------- 地圖 ---------- */
  const map = L.map("map", { worldCopyJump: true, minZoom: 2 }).setView([23.7, 121], 3);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  const markers = new Map();
  let pinMarker = null;

  function glyph(type, size, selected) {
    const r = (S[size] || S.normal).r, col = (T[type] || T.normal).c, w = r * 2 + 8, h = r * 2 + 6;
    return L.divIcon({
      className: "mk" + (selected ? " sel" : ""), iconSize: [w, h], iconAnchor: [w / 2, h - 2],
      html: `<svg width="${w}" height="${h}" viewBox="${-w / 2} ${-r * 1.3 - 3} ${w} ${h}">
        ${selected ? `<circle r="${r + 3}" cy="${-r * 0.35}" fill="none" stroke="currentColor" stroke-width="2.5"/>` : ""}
        <rect x="${-r * .32}" y="${-r * .15}" width="${r * .64}" height="${r * .9}" rx="${r * .2}" fill="#f7efe0" stroke="#6b5a43"/>
        <path d="M${-r},0 C${-r},${-r * 1.35} ${r},${-r * 1.35} ${r},0 Z" fill="${col}" stroke="#3b2f22" stroke-width="1.2"/>
        <circle cx="${-r * .38}" cy="${-r * .45}" r="${r * .17}" fill="#fff" opacity=".85"/>
        <circle cx="${r * .3}" cy="${-r * .62}" r="${r * .14}" fill="#fff" opacity=".85"/></svg>`
    });
  }

  function drawMarks(vis) {
    const keep = new Set(vis.map(d => d.id));
    for (const [id, m] of markers) if (!keep.has(id)) { layer.removeLayer(m); markers.delete(id); }
    vis.forEach(d => {
      let m = markers.get(d.id);
      const key = d.type + d.size + (d.id === sel);
      if (!m) {
        m = L.marker([d.lat, d.lng], { title: `${(T[d.type] || T.normal).n}蘑菇 · ${d.place || d.country}` })
          .on("click", () => { if (!picking) select(d.id, false); });
        m.addTo(layer); markers.set(d.id, m);
      }
      if (m._key !== key) { m.setIcon(glyph(d.type, d.size, d.id === sel)); m.setZIndexOffset(d.id === sel ? 1000 : 0); m._key = key; }
    });
  }

  map.on("click", async e => {
    if (!picking) return;
    const { lat, lng } = e.latlng.wrap();
    pick = { lat: +lat.toFixed(5), lng: +lng.toFixed(5), country: "" };
    stopPicking(); drawPin(); openForm();
    $("locText").textContent = `${pick.lat.toFixed(4)}, ${pick.lng.toFixed(4)}（查詢地名中…）`;
    const geo = await reverseGeocode(pick.lat, pick.lng);
    if (!pick || pick.lat !== +lat.toFixed(5)) return;
    pick.country = geo.country;
    if (!$("fPlace").value && geo.place) $("fPlace").value = geo.place;
    $("locText").textContent = fmtLoc(pick);
  });
  map.on("moveend", () => { if ($("inView").checked) render(); });

  // OpenStreetMap Nominatim：只在使用者點地圖時查一次，符合其使用規範（每秒最多 1 次）
  async function reverseGeocode(lat, lng) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lng}&accept-language=${navigator.language || "zh-TW"}`);
      const j = await r.json(); const a = j.address || {};
      return { country: a.country || "", place: [a.city || a.town || a.village || a.county, a.road || a.neighbourhood || a.suburb].filter(Boolean).join(" ").slice(0, 60) };
    } catch { return { country: "", place: "" }; }
  }
  const fmtLoc = p => (p.country ? p.country + " · " : "") + p.lat.toFixed(4) + ", " + p.lng.toFixed(4);
  function startPicking() { picking = true; $("mapbox").classList.add("picking"); $("pickbar").hidden = false; $("dlg").close(); $("mapbox").scrollIntoView({ block: "nearest" }); }
  function stopPicking() { picking = false; $("mapbox").classList.remove("picking"); $("pickbar").hidden = true; }
  $("pickCancel").onclick = () => { stopPicking(); openForm(); };
  function drawPin() {
    if (pinMarker) { map.removeLayer(pinMarker); pinMarker = null; }
    if (pick && $("dlg").open) pinMarker = L.circleMarker([pick.lat, pick.lng], { radius: 8, color: "#fff", weight: 3, fillColor: "#c2402f", fillOpacity: 1 }).addTo(map);
  }

  /* ---------- 列表 ---------- */
  TYPES.forEach(t => {
    const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.setAttribute("aria-pressed", "false");
    b.innerHTML = `<span class="dot" style="background:${t.c}"></span>${t.n}`;
    b.onclick = () => { typeOn.has(t.k) ? typeOn.delete(t.k) : typeOn.add(t.k); b.setAttribute("aria-pressed", typeOn.has(t.k)); render(); };
    $("typeFilter").appendChild(b);
  });
  $("q").oninput = render; $("sort").onchange = render; $("inView").onchange = render;

  function active() { const now = Date.now(); return docs.filter(d => d.status !== "ended" && d.endsAt > now); }
  function visible() {
    const q = $("q").value.trim().toLowerCase(), bounds = $("inView").checked ? map.getBounds() : null;
    let v = active();
    if (typeOn.size) v = v.filter(d => typeOn.has(d.type));
    if (q) v = v.filter(d => [d.place, d.country, d.note].join(" ").toLowerCase().includes(q));
    if (bounds) v = v.filter(d => bounds.contains([d.lat, d.lng]));
    const s = $("sort").value;
    v.sort(s === "new" ? (a, b) => b.createdAt - a.createdAt : s === "pop" ? (a, b) => b.joiners.size - a.joiners.size || a.endsAt - b.endsAt : (a, b) => a.endsAt - b.endsAt);
    return v;
  }

  function render() {
    const v = visible(), now = Date.now(), list = $("list");
    drawMarks($("inView").checked ? visibleIgnoringBounds() : v);
    $("count").textContent = docs.length ? `顯示 ${v.length} 朵 · 全球進行中 ${active().length} 朵` : "";
    if (!v.length) {
      list.innerHTML = active().length
        ? `<div class="empty"><strong>沒有符合條件的蘑菇</strong>試著清除篩選、搜尋其他地區，或把地圖拉遠一點。</div>`
        : `<div class="empty"><strong>地圖上還沒有蘑菇</strong>看到蘑菇時，按「＋ 回報蘑菇」，選好屬性、大小、剩餘時間，再到地圖上點位置。回報後全球玩家都看得到。</div>`;
      return;
    }
    list.innerHTML = v.map(d => {
      const t = T[d.type] || T.normal, ms = d.endsAt - now, mine = d.reporterId === me, joined = d.joiners.has(me);
      return `<article class="card${d.id === sel ? " sel" : ""}" data-id="${esc(d.id)}">
        <svg class="ic" width="34" height="34" viewBox="-17 -22 34 34" aria-hidden="true"><rect x="-4" y="-2" width="8" height="11" rx="2" fill="#f7efe0" stroke="#6b5a43"/><path d="M-13,0 C-13,-18 13,-18 13,0 Z" fill="${t.c}" stroke="#3b2f22" stroke-width="1.2"/><circle cx="-5" cy="-6" r="2.2" fill="#fff" opacity=".85"/><circle cx="4" cy="-8.5" r="1.9" fill="#fff" opacity=".85"/></svg>
        <h3>${t.n}蘑菇 <span class="sz">${(S[d.size] || S.normal).n}</span></h3>
        <div class="meta">${esc(d.place || "未命名地點")}${d.country ? " · " + esc(d.country) : ""}</div>
        <div class="meta">剩 <span class="left${ms < 30 * 60000 ? " soon" : ""}" data-end="${d.endsAt}">${left(ms)}</span> · ${d.joiners.size} 人想打${d.note ? " · " + esc(d.note) : ""}</div>
        <div class="acts">
          ${d.friendCode ? `<button type="button" data-act="copy">複製好友碼 <span class="fc">${esc(fmtCode(d.friendCode))}</span></button>` : ""}
          <button type="button" data-act="join" class="join${joined ? " on" : ""}">${joined ? "已表示想打 ✓" : "我想打"}</button>
          ${mine ? `<button type="button" data-act="del">刪除</button>` : `<button type="button" data-act="end">回報已結束</button>`}
        </div></article>`;
    }).join("");
  }
  function visibleIgnoringBounds() { const c = $("inView").checked; $("inView").checked = false; const v = visible(); $("inView").checked = c; return v; }

  $("list").addEventListener("click", async e => {
    const card = e.target.closest(".card"); if (!card) return;
    const id = card.dataset.id, d = docs.find(x => x.id === id), act = e.target.closest("button")?.dataset.act;
    if (!act) { select(id, true); return; }
    try {
      if (act === "copy") { try { await navigator.clipboard.writeText(d.friendCode); toast("已複製好友碼，到遊戲裡加好友吧"); } catch { toast("好友碼：" + fmtCode(d.friendCode)); } }
      if (act === "join") toast((await store.toggleJoin(id)) ? "已登記，記得加對方好友等邀請" : "已取消");
      if (act === "end") { await store.markEnded(id); toast("已標記為結束，謝謝回報"); }
      if (act === "del") { await store.remove(id); toast("已刪除"); }
    } catch (err) { console.error(err); toast("操作失敗，請稍後再試一次。"); }
  });

  function select(id, fly) {
    sel = id; render();
    const d = docs.find(x => x.id === id); if (!d) return;
    if (fly) map.flyTo([d.lat, d.lng], Math.max(map.getZoom(), 15), { duration: .6 });
    else document.querySelector(`.card[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  setInterval(() => {
    const now = Date.now(); let gone = false;
    document.querySelectorAll(".left[data-end]").forEach(el => { const ms = +el.dataset.end - now; if (ms <= 0) gone = true; el.textContent = left(ms); el.classList.toggle("soon", ms < 30 * 60000); });
    if (gone) render();
  }, 30000);

  /* ---------- 回報表單 ---------- */
  TYPES.forEach((t, i) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="radio" name="ftype" value="${t.k}" ${i === 0 ? "checked" : ""}><span class="dot" style="background:${t.c}"></span>${t.n}`;
    $("typePick").appendChild(l);
  });
  $("fSize").innerHTML = SIZES.map(s => `<option value="${s.k}" ${s.k === "normal" ? "selected" : ""}>${s.n}</option>`).join("");
  try { const c = localStorage.getItem("pb-code"); if (c) $("fCode").value = fmtCode(c); } catch {}

  function openForm() { if (!$("dlg").open) $("dlg").showModal(); drawPin(); }
  $("reportBtn").onclick = () => { $("fErr").textContent = ""; $("locText").textContent = pick ? fmtLoc(pick) : "尚未選擇"; openForm(); };
  $("pickBtn").onclick = startPicking;
  $("cancelBtn").onclick = () => $("dlg").close();
  $("dlg").addEventListener("close", drawPin);
  $("repForm").addEventListener("submit", async e => {
    e.preventDefault();
    const err = $("fErr"), code = $("fCode").value.replace(/\D/g, ""), mins = (+$("fH").value || 0) * 60 + (+$("fM").value || 0);
    if (!pick) { err.textContent = "請先在地圖上點選蘑菇的位置。"; return; }
    if (mins < 1) { err.textContent = "剩餘時間至少要 1 分鐘。"; return; }
    if (mins > 72 * 60) { err.textContent = "剩餘時間最多 72 小時。"; return; }
    if (code && code.length !== 12) { err.textContent = "好友碼應該是 12 位數字，或留空。"; return; }
    try { localStorage.setItem("pb-code", code); } catch {}
    $("saveBtn").disabled = true;
    try {
      const id = await store.add({
        type: document.querySelector('input[name="ftype"]:checked').value, size: $("fSize").value,
        lat: pick.lat, lng: pick.lng, country: pick.country, place: $("fPlace").value.trim(),
        note: $("fNote").value.trim(), friendCode: code, endsAt: Date.now() + mins * 60000
      });
      $("dlg").close(); pick = null; drawPin(); $("fPlace").value = ""; $("fNote").value = "";
      toast("回報成功！"); select(id, false);
    } catch (x) { console.error(x); err.textContent = "儲存失敗，請檢查網路後再試一次。"; }
    finally { $("saveBtn").disabled = false; }
  });

  let tt; function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 2600); }

  /* ---------- 啟動 ---------- */
  store.onChange(list => { docs = list; render(); });
  render();
  if (store.mode === "demo") $("demoBanner").hidden = false;
  store.start().then(id => {
    me = id; $("status").textContent = store.mode === "online" ? "即時同步中" : "示範模式"; render();
  }).catch(e => { console.error(e); $("status").textContent = "無法連線到資料庫，請重新整理頁面"; });
})();
