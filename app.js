(function () {
  /* ---------- 常數與小工具 ---------- */
  const TYPES = [
    { k: "red", n: "紅", c: "#e5483b" }, { k: "yellow", n: "黃", c: "#f2c230" }, { k: "blue", n: "藍", c: "#3a7bd5" },
    { k: "purple", n: "紫", c: "#7b4bb7" }, { k: "white", n: "白", c: "#eeeae2" }, { k: "rock", n: "岩石", c: "#8a8f98" },
    { k: "winged", n: "飛翼", c: "#e88fb6" }, { k: "ice", n: "冰", c: "#7fd3e6" }, { k: "normal", n: "一般", c: "#b07a4f" }
  ];
  const SIZES = [{ k: "small", n: "小", r: 12 }, { k: "normal", n: "一般", r: 15 }, { k: "large", n: "大", r: 19 }, { k: "giant", n: "巨大", r: 24 }];
  const KIND = { talk: "💬 討論", mushroom: "🍄 蘑菇", spot: "🌸 花點" };
  const LOOK = { friends: "交朋友", mushroom: "一起打蘑菇", postcards: "交換明信片" };
  const T = Object.fromEntries(TYPES.map(t => [t.k, t])), S = Object.fromEntries(SIZES.map(s => [s.k, s]));
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtCode = c => (c || "").replace(/(\d{4})(?=\d)/g, "$1 ");
  const left = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分` : `${m} 分鐘`; };
  const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? "剛剛" : s < 3600 ? `${Math.floor(s / 60)} 分鐘前` : s < 86400 ? `${Math.floor(s / 3600)} 小時前` : `${Math.floor(s / 86400)} 天前`; };
  const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  let tt; const toast = m => { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 2800); };
  const AV = ["#e5483b", "#e8a91c", "#3a7bd5", "#7b4bb7", "#6f7782", "#d9679a", "#2fa3b8", "#3f8f3a"];
  const avColor = id => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return AV[h % AV.length]; };
  const avatar = (id, name) => `<span class="avatar" style="background:${avColor(id)}" aria-hidden="true">${esc((name || "?").slice(0, 1))}</span>`;
  const isLive = p => p.kind === "mushroom" && p.status === "open" && p.endsAt > Date.now();

  const store = window.createStore();
  let me = null, kindOn = "", lookOn = "", openComments = new Set(), highlight = null;
  let region = ls.get("pc-region") || "";

  /* ---------- 分頁 ---------- */
  const views = ["feed", "map", "friends", "me"];
  function route() {
    const v = views.includes(location.hash.slice(1)) ? location.hash.slice(1) : "feed";
    views.forEach(x => { $("view-" + x).hidden = x !== v; });
    document.querySelectorAll(".tabs a").forEach(a => a.setAttribute("aria-current", a.dataset.tab === v ? "page" : "false"));
    document.querySelector(".regionbar").hidden = v === "me";
    $("hero").hidden = v !== "feed";
    if (v === "map") { map.invalidateSize(); renderMap(); }
    if (v === "friends") renderFriends();
    if (v === "me") renderMe();
  }
  window.addEventListener("hashchange", route);

  /* ---------- 地區 ---------- */
  const myProfile = () => me && store.profile(me);
  function regionOf(p) { return { country: (p.country || "").trim(), city: (p.city || "").trim() }; }
  function inRegion(x) {
    if (!region) return true;
    const [c, city] = region.split("|"); const r = regionOf(x);
    return r.country === c && (!city || r.city === city);
  }
  function renderRegions() {
    const opts = new Map(); const add = (v, label) => { if (!opts.has(v)) opts.set(v, label); };
    add("", "🌏 全球");
    const mp = myProfile();
    if (mp?.country) { add(`${mp.country}|${mp.city || ""}`, `📍 我的地區：${mp.country}${mp.city ? " · " + mp.city : ""}`); }
    const seen = {};
    store.posts().forEach(p => { const r = regionOf(p); if (!r.country) return; seen[r.country] = seen[r.country] || new Set(); if (r.city) seen[r.country].add(r.city); });
    Object.keys(seen).sort().forEach(c => { add(`${c}|`, `${c}（全部）`); [...seen[c]].sort().forEach(city => add(`${c}|${city}`, `${c} · ${city}`)); });
    if (region && !opts.has(region)) { const [c, city] = region.split("|"); add(region, city ? `${c} · ${city}` : `${c}（全部）`); }
    $("regionSel").innerHTML = [...opts].map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
    $("regionSel").value = region;
    const n = store.posts().filter(inRegion).length;
    $("regionHint").textContent = `${n} 則近 30 天的貼文`;
  }
  $("regionSel").onchange = e => { region = e.target.value; ls.set("pc-region", region); renderAll(); };

  /* ---------- 動態 ---------- */
  $("kindFilter").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return; kindOn = b.dataset.kind;
    $("kindFilter").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); renderFeed();
  });

  function postHTML(p) {
    const a = store.profile(p.authorId) || { nickname: "玩家" }, mine = p.authorId === me;
    const r = regionOf(p), live = isLive(p);
    const myReq = store.invites().find(i => i.postId === p.id && i.userId === me);
    const reqs = store.invites().filter(i => i.postId === p.id);
    let mush = "";
    if (p.kind === "mushroom") {
      const t = T[p.mushroomType] || T.normal;
      mush = `<div class="mushline"><span class="dot" style="background:${t.c}"></span><b>${t.n}蘑菇</b> · ${(S[p.mushroomSize] || S.normal).n}
        · ${live ? `剩 <span class="left" data-end="${p.endsAt}">${left(p.endsAt - Date.now())}</span>` : `<span class="ended">已結束</span>`}</div>`;
    }
    const acts = [];
    if (p.kind === "mushroom") {
      if (mine) acts.push(`<a class="act" href="#me">${reqs.filter(i => i.status === "waiting").length} 個邀請請求</a>`);
      else if (live) acts.push(myReq
        ? `<button type="button" class="act on" data-act="unreq">${myReq.status === "invited" ? "對方已邀請你 ✓" : "已請求，等待邀請"}</button>`
        : `<button type="button" class="act primary" data-act="req">請邀請我</button>`);
      acts.push(`<span class="act muted">${p.likes.size} 人想打</span>`);
      if (!mine && live) acts.push(`<button type="button" class="act" data-act="like">${p.likes.has(me) ? "取消想打" : "想打 +1"}</button>`);
    } else {
      acts.push(`<button type="button" class="act${p.likes.has(me) ? " on" : ""}" data-act="like">❤ ${p.likes.size || "讚"}</button>`);
    }
    acts.push(`<button type="button" class="act" data-act="comments">💬 ${p.commentCount || "留言"}</button>`);
    if (p.lat != null) acts.push(`<button type="button" class="act" data-act="map">📍 地圖</button>`);
    if (mine) acts.push(`<button type="button" class="act muted" data-act="del">刪除</button>`);
    else {
      if (live) acts.push(`<button type="button" class="act muted" data-act="end">回報已結束</button>`);
      acts.push(`<button type="button" class="act muted" data-act="report">檢舉</button>`);
    }
    return `<article class="post${highlight === p.id ? " hl" : ""}" id="post-${esc(p.id)}" data-id="${esc(p.id)}">
      <header>${avatar(p.authorId, a.nickname)}
        <div><b>${esc(a.nickname)}</b>${mine ? ' <span class="tag">我</span>' : ""}
        <div class="sub">${esc([r.country, r.city].filter(Boolean).join(" · ") || "未標地區")} · ${ago(p.createdAt)}</div></div>
        <span class="kind k-${p.kind}">${KIND[p.kind]}</span></header>
      ${mush}
      <p class="body">${esc(p.body)}</p>
      ${p.imageUrl ? `<img class="pic" src="${esc(p.imageUrl)}" alt="貼文圖片" loading="lazy">` : ""}
      <div class="acts">${acts.join("")}</div>
      <div class="comments" ${openComments.has(p.id) ? "" : "hidden"}></div>
    </article>`;
  }

  function renderFeed() {
    let list = store.posts().filter(inRegion).filter(p => !kindOn || p.kind === kindOn);
    list.sort((a, b) => (isLive(b) - isLive(a)) * (kindOn === "mushroom" ? 1 : 0) || b.createdAt - a.createdAt);
    const feed = $("feed");
    if (!list.length) {
      feed.innerHTML = `<div class="empty"><span class="bounce" aria-hidden="true">🍄</span><strong>${region ? "這個地區還沒有貼文" : "還沒有人發文"}</strong>
        當第一個分享的人吧：附近的花點、看到的蘑菇，或是想約人一起散步都可以。<br><button class="btn" type="button" data-act="new">＋ 發文</button></div>`;
      return;
    }
    feed.innerHTML = list.map(postHTML).join("");
    openComments.forEach(id => loadComments(id));
  }

  async function loadComments(id) {
    const box = document.querySelector(`#post-${CSS.escape(id)} .comments`); if (!box) return;
    box.hidden = false;
    const cs = await store.comments(id).catch(() => []);
    box.innerHTML = cs.map(c => { const a = store.profile(c.authorId) || { nickname: "玩家" };
      return `<div class="cmt"><b>${esc(a.nickname)}</b> <span class="sub">${ago(c.createdAt)}</span>
        ${c.authorId === me ? `<button type="button" class="link" data-act="delc" data-cid="${esc(c.id)}">刪除</button>` : ""}<div>${esc(c.body)}</div></div>`; }).join("")
      + `<form class="cform" data-id="${esc(id)}"><input maxlength="500" placeholder="留言…" aria-label="留言內容" required><button class="btn small" type="submit">送出</button></form>`;
  }

  document.addEventListener("submit", async e => {
    if (!e.target.classList.contains("cform")) return;
    e.preventDefault();
    if (!(await needProfile())) return;
    const id = e.target.dataset.id, inp = e.target.querySelector("input"), body = inp.value.trim(); if (!body) return;
    try { await store.addComment(id, body); inp.value = ""; await loadComments(id); }
    catch (x) { toast(x.message || "留言失敗"); }
  });

  let reportTarget = null;
  document.addEventListener("click", async e => {
    const btn = e.target.closest("[data-act]"); if (!btn) return;
    const act = btn.dataset.act, card = btn.closest(".post"), id = card?.dataset.id;
    const p = id && store.posts().find(x => x.id === id);
    try {
      if (act === "new") return openPost();
      if (act === "comments") { openComments.has(id) ? (openComments.delete(id), card.querySelector(".comments").hidden = true) : (openComments.add(id), loadComments(id)); return; }
      if (act === "map") { location.hash = "map"; setTimeout(() => focusOnMap(p), 50); return; }
      if (act === "delc") { await store.deleteComment(btn.dataset.cid, id); return loadComments(id); }
      if (act === "report") { reportTarget = id; $("reportDlg").showModal(); return; }
      if (act === "copy") { const c = btn.dataset.code; try { await navigator.clipboard.writeText(c); toast("已複製好友碼，到遊戲裡加好友吧"); } catch { toast("好友碼：" + fmtCode(c)); } return; }
      if (act === "invited") { await store.markInvited(btn.dataset.post, btn.dataset.user); toast("已標記為已邀請"); return; }
      if (!(await needProfile())) return;
      if (act === "like") await store.toggleLike(id);
      if (act === "req") {
        const code = myProfile()?.friendCode;
        if (!code) { toast("請先在「我的」填好好友碼，對方才能加你"); location.hash = "me"; return; }
        await store.requestInvite(id, code); toast("已送出！對方加你好友後會從遊戲裡邀請你");
      }
      if (act === "unreq") { await store.cancelInvite(id); toast("已取消請求"); }
      if (act === "end") { await store.markEnded(id); toast("已標記為結束，謝謝回報"); }
      if (act === "del") { await store.deletePost(id); toast("已刪除"); }
    } catch (x) { console.error(x); toast(x.message || "操作失敗，請稍後再試"); }
  });
  $("reportCancel").onclick = () => $("reportDlg").close();
  $("reportForm").addEventListener("submit", async e => {
    e.preventDefault(); $("reportDlg").close();
    try { await store.report("post", reportTarget, $("rReason").value); toast("已收到檢舉，謝謝你"); } catch (x) { toast(x.message || "檢舉失敗"); }
  });

  /* ---------- 地圖 ---------- */
  const map = L.map("map", { worldCopyJump: true, minZoom: 2 }).setView([23.7, 121], 3);
  const tiles = () => L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' });
  tiles().addTo(map);
  const layer = L.layerGroup().addTo(map), markers = new Map();
  function icon(p) {
    if (p.kind === "spot") return L.divIcon({ className: "mk", iconSize: [30, 30], iconAnchor: [15, 15], html: `<span class="spotmk">🌸</span>` });
    const r = (S[p.mushroomSize] || S.normal).r, col = (T[p.mushroomType] || T.normal).c, w = r * 2 + 6, h = r * 2 + 4;
    return L.divIcon({ className: "mk", iconSize: [w, h], iconAnchor: [w / 2, h - 2], html: `<svg width="${w}" height="${h}" viewBox="${-w / 2} ${-r * 1.3 - 2} ${w} ${h}">
      <rect x="${-r * .32}" y="${-r * .15}" width="${r * .64}" height="${r * .9}" rx="${r * .2}" fill="#f7efe0" stroke="#6b5a43"/>
      <path d="M${-r},0 C${-r},${-r * 1.35} ${r},${-r * 1.35} ${r},0 Z" fill="${col}" stroke="#3b2f22" stroke-width="1.2"/>
      <circle cx="${-r * .38}" cy="${-r * .45}" r="${r * .17}" fill="#fff" opacity=".85"/><circle cx="${r * .3}" cy="${-r * .62}" r="${r * .14}" fill="#fff" opacity=".85"/></svg>` });
  }
  function renderMap() {
    const vis = store.posts().filter(p => p.lat != null && (isLive(p) || p.kind === "spot")).filter(inRegion);
    const keep = new Set(vis.map(p => p.id));
    for (const [id, m] of markers) if (!keep.has(id)) { layer.removeLayer(m); markers.delete(id); }
    vis.forEach(p => {
      let m = markers.get(p.id);
      if (!m) { m = L.marker([p.lat, p.lng], { icon: icon(p) }).addTo(layer); markers.set(p.id, m); }
      const a = store.profile(p.authorId) || { nickname: "玩家" };
      const head = p.kind === "mushroom" ? `${(T[p.mushroomType] || T.normal).n}蘑菇 · ${(S[p.mushroomSize] || S.normal).n} · 剩 ${left(p.endsAt - Date.now())}` : "🌸 花點";
      m.bindPopup(`<b>${esc(head)}</b><br>${esc(p.body.slice(0, 60))}<br><span class="sub">${esc(a.nickname)} · ${p.likes.size} 人想打</span><br>
        <a href="#feed" data-goto="${esc(p.id)}">看貼文${p.kind === "mushroom" ? "、請對方邀請我" : ""} →</a>`);
    });
  }
  function focusOnMap(p) { if (!p) return; map.setView([p.lat, p.lng], 15); markers.get(p.id)?.openPopup(); }
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-goto]"); if (!a) return;
    highlight = a.dataset.goto; region = ""; ls.set("pc-region", ""); kindOn = "";
    $("kindFilter").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x.dataset.kind === ""));
    setTimeout(() => { renderAll(); document.getElementById("post-" + highlight)?.scrollIntoView({ block: "center" }); }, 30);
  });

  /* ---------- 好友碼 ---------- */
  $("lookFilter").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return; lookOn = b.dataset.look;
    $("lookFilter").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); renderFriends();
  });
  async function renderFriends() {
    const box = $("friendList");
    let list = await store.listFriends().catch(() => []);
    list = list.filter(inRegion).filter(p => !lookOn || (p.lookingFor || []).includes(lookOn));
    const mine = myProfile();
    const cta = !mine?.friendCode || !mine?.shareCode
      ? `<div class="panel cta">想讓別人加你？到 <a href="#me">我的</a> 填好好友碼並勾選公開，就會出現在這裡。</div>` : "";
    box.innerHTML = cta + (list.length ? list.map(p => `<div class="friend">
        ${avatar(p.id, p.nickname)}
        <div class="fbody"><b>${esc(p.nickname)}</b>${p.id === me ? ' <span class="tag">我</span>' : ""}
          <div class="sub">${esc([p.country, p.city].filter(Boolean).join(" · ") || "未填地區")}</div>
          ${p.bio ? `<p>${esc(p.bio)}</p>` : ""}
          <div class="tags">${(p.lookingFor || []).map(k => `<span class="tag">${LOOK[k] || ""}</span>`).join("")}</div>
          <button type="button" class="act primary" data-act="copy" data-code="${esc(p.friendCode)}">複製好友碼 <span class="fc">${esc(fmtCode(p.friendCode))}</span></button>
        </div></div>`).join("")
      : `<div class="empty"><strong>${region ? "這個地區還沒有人公開好友碼" : "還沒有人公開好友碼"}</strong>試試切換到「全球」，或先公開你自己的好友碼。</div>`);
  }

  /* ---------- 我的 ---------- */
  function renderMe() {
    const p = myProfile() || {};
    $("pNick").value = p.nickname || ""; $("pCode").value = fmtCode(p.friendCode || ""); $("pCountry").value = p.country || "";
    $("pCity").value = p.city || ""; $("pBio").value = p.bio || ""; $("pShare").checked = p.shareCode ?? true;
    document.querySelectorAll("#profileForm .checks input").forEach(c => c.checked = (p.lookingFor || []).includes(c.value));
    renderInvites();
  }
  function renderInvites() {
    const all = store.invites(), posts = store.posts();
    const forMe = all.filter(i => posts.find(p => p.id === i.postId)?.authorId === me);
    const waiting = forMe.filter(i => i.status === "waiting").length;
    $("meBadge").hidden = !waiting; $("meBadge").textContent = waiting;
    $("inviteList").innerHTML = forMe.length ? forMe.map(i => {
      const u = store.profile(i.userId) || { nickname: "玩家" }, p = posts.find(x => x.id === i.postId), t = T[p.mushroomType] || T.normal;
      return `<div class="inv"><div><b>${esc(u.nickname)}</b> 想打你的 ${t.n}蘑菇<div class="sub">${esc([u.country, u.city].filter(Boolean).join(" · "))} · ${ago(i.createdAt)}</div></div>
        <div class="acts"><button type="button" class="act" data-act="copy" data-code="${esc(i.friendCode)}">複製 <span class="fc">${esc(fmtCode(i.friendCode))}</span></button>
        ${i.status === "invited" ? `<span class="act on">已邀請 ✓</span>` : `<button type="button" class="act primary" data-act="invited" data-post="${esc(i.postId)}" data-user="${esc(i.userId)}">已邀請</button>`}</div></div>`;
    }).join("") : `<p class="hint">目前沒有。分享一朵蘑菇，附近或遠方的玩家就能請你邀請他們。</p>`;
    const mineReq = all.filter(i => i.userId === me);
    $("myRequests").innerHTML = mineReq.length ? mineReq.map(i => {
      const p = posts.find(x => x.id === i.postId); if (!p) return "";
      const a = store.profile(p.authorId) || { nickname: "玩家" };
      return `<div class="inv"><div>${esc(a.nickname)} 的 ${(T[p.mushroomType] || T.normal).n}蘑菇<div class="sub">${esc([p.country, p.city].filter(Boolean).join(" · "))}</div></div>
        <span class="act ${i.status === "invited" ? "on" : "muted"}">${i.status === "invited" ? "對方已邀請 ✓ 到遊戲裡看看" : "等待對方邀請"}</span></div>`;
    }).join("") : `<p class="hint">還沒有。在蘑菇貼文上按「請邀請我」就會出現在這裡。</p>`;
  }
  $("profileForm").addEventListener("submit", async e => {
    e.preventDefault();
    const code = $("pCode").value.replace(/\D/g, ""), err = $("pErr");
    if (code && code.length !== 12) { err.textContent = "好友碼應該是 12 位數字，或先留空。"; return; }
    const p = { nickname: $("pNick").value.trim(), friendCode: code, country: $("pCountry").value.trim(), city: $("pCity").value.trim(),
      bio: $("pBio").value.trim(), shareCode: $("pShare").checked,
      lookingFor: [...document.querySelectorAll("#profileForm .checks input:checked")].map(c => c.value) };
    if (!p.nickname) { err.textContent = "請填暱稱。"; return; }
    try { await store.saveProfile(p); err.textContent = ""; toast("已儲存");
      if (!region && p.country) { region = `${p.country}|${p.city}`; ls.set("pc-region", region); }
      if (pendingAfterProfile) { const f = pendingAfterProfile; pendingAfterProfile = null; location.hash = "feed"; f(); }
    } catch (x) { err.textContent = x.message || "儲存失敗，請再試一次"; }
  });
  let pendingAfterProfile = null;
  async function needProfile(then) {
    if (myProfile()?.nickname) return true;
    pendingAfterProfile = then || null;
    toast("先建立你的玩家檔案（只要填暱稱）"); location.hash = "me"; setTimeout(() => $("pNick").focus(), 50);
    return false;
  }

  /* ---------- 發文 ---------- */
  TYPES.forEach((t, i) => { const l = document.createElement("label");
    l.innerHTML = `<input type="radio" name="ftype" value="${t.k}" ${i === 0 ? "checked" : ""}><span class="dot" style="background:${t.c}"></span>${t.n}`; $("typePick").appendChild(l); });
  $("fSize").innerHTML = SIZES.map(s => `<option value="${s.k}" ${s.k === "normal" ? "selected" : ""}>${s.n}</option>`).join("");
  let pickMap = null, pickPin = null, pick = null, imgBlob = null;
  const kindVal = () => document.querySelector('input[name="kind"]:checked').value;
  function syncKind() {
    const k = kindVal();
    $("mushFields").hidden = k !== "mushroom";
    $("bodyLabel").textContent = k === "mushroom" ? "說明（例如：還差幾個人、晚上幾點前開打）" : k === "spot" ? "介紹這個花點或路線" : "想說什麼？";
    $("locLabel").textContent = k === "mushroom" ? "蘑菇位置（必填，點地圖標出來）" : "位置（選填，點地圖標出來）";
  }
  $("postKind").addEventListener("change", syncKind);
  $("newPostBtn").onclick = () => openPost();
  async function openPost() {
    if (!(await needProfile(openPost))) return;
    const p = myProfile();
    const [rc, rcity] = region ? region.split("|") : [p.country || "", p.city || ""];
    $("fCountry").value = rc || ""; $("fCity").value = rcity || "";
    $("fErr").textContent = ""; syncKind(); $("postDlg").showModal();
    if (!pickMap) {
      pickMap = L.map("pickMap", { worldCopyJump: true }).setView([23.7, 121], 3); tiles().addTo(pickMap);
      pickMap.on("click", async e => {
        const { lat, lng } = e.latlng.wrap(); pick = { lat: +lat.toFixed(5), lng: +lng.toFixed(5) };
        if (pickPin) pickPin.setLatLng([pick.lat, pick.lng]); else pickPin = L.circleMarker([pick.lat, pick.lng], { radius: 8, color: "#fff", weight: 3, fillColor: "#c2402f", fillOpacity: 1 }).addTo(pickMap);
        $("locText").textContent = `已標記：${pick.lat.toFixed(4)}, ${pick.lng.toFixed(4)}（查詢地名中…）`;
        const g = await reverseGeocode(pick.lat, pick.lng);
        if (g.country) { $("fCountry").value = g.country; $("fCity").value = g.city; }
        $("locText").textContent = `已標記：${[g.country, g.city, g.road].filter(Boolean).join(" ") || `${pick.lat.toFixed(4)}, ${pick.lng.toFixed(4)}`}`;
      });
    }
    setTimeout(() => { pickMap.invalidateSize(); if (!pick && p.country) geocodeRegion(rc, rcity); }, 60);
  }
  async function reverseGeocode(lat, lng) {
    try { const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lng}&accept-language=zh-TW`);
      const a = (await r.json()).address || {};
      return { country: a.country || "", city: a.city || a.town || a.county || a.village || a.state || "", road: a.road || a.neighbourhood || a.suburb || "" };
    } catch { return { country: "", city: "", road: "" }; }
  }
  async function geocodeRegion(country, city) {
    if (!country) return;
    try { const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent([city, country].filter(Boolean).join(", "))}`);
      const j = await r.json(); if (j[0]) pickMap.setView([+j[0].lat, +j[0].lon], city ? 12 : 6);
    } catch {}
  }
  $("fImg").onchange = async e => {
    const f = e.target.files[0]; imgBlob = null; $("imgPreview").hidden = true; if (!f) return;
    try { imgBlob = await shrink(f); $("imgPreview").src = URL.createObjectURL(imgBlob); $("imgPreview").hidden = false; }
    catch { $("fErr").textContent = "這張圖片讀不出來，換一張試試。"; }
  };
  async function shrink(file) {
    const bmp = await createImageBitmap(file); const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, "image/jpeg", 0.8));
  }
  $("postCancel").onclick = () => $("postDlg").close();
  $("postForm").addEventListener("submit", async e => {
    e.preventDefault();
    const err = $("fErr"), kind = kindVal(), body = $("fBody").value.trim();
    const post = { kind, body, country: $("fCountry").value.trim(), city: $("fCity").value.trim(), lat: pick?.lat ?? null, lng: pick?.lng ?? null };
    if (!body) { err.textContent = "請寫一點內容。"; return; }
    if (kind === "mushroom") {
      const mins = (+$("fH").value || 0) * 60 + (+$("fM").value || 0);
      if (!pick) { err.textContent = "蘑菇貼文需要在地圖上標出位置。"; return; }
      if (mins < 1 || mins > 72 * 60) { err.textContent = "剩餘時間要在 1 分鐘到 72 小時之間。"; return; }
      Object.assign(post, { mushroomType: document.querySelector('input[name="ftype"]:checked').value, mushroomSize: $("fSize").value, endsAt: Date.now() + mins * 60000 });
      if (!myProfile()?.friendCode) toast("提醒：在「我的」填好好友碼，別人才能請你邀請");
    }
    $("postSave").disabled = true;
    try {
      const id = await store.createPost(post, imgBlob);
      $("postDlg").close(); $("postForm").reset(); imgBlob = null; $("imgPreview").hidden = true; pick = null;
      if (pickPin) { pickMap.removeLayer(pickPin); pickPin = null; } $("locText").textContent = "尚未標記";
      highlight = id; toast("發佈成功！"); location.hash = "feed"; renderAll();
    } catch (x) { console.error(x); err.textContent = x.message || "發佈失敗，請再試一次"; }
    finally { $("postSave").disabled = false; }
  });

  /* ---------- 啟動 ---------- */
  function renderAll() {
    renderRegions(); renderFeed(); renderInvites();
    if (!$("view-map").hidden) renderMap();
  }
  store.onChange(postId => { if (postId && openComments.has(postId)) loadComments(postId); renderAll(); });
  setInterval(() => document.querySelectorAll(".left[data-end]").forEach(el => el.textContent = left(+el.dataset.end - Date.now())), 30000);
  if (store.mode === "demo") $("demoBanner").hidden = false;
  route();
  store.start().then(id => { me = id; renderAll(); route(); })
    .catch(e => { console.error(e); $("feed").innerHTML = `<div class="empty"><strong>連不上資料庫</strong>請檢查網路後重新整理頁面。</div>`; });
})();
