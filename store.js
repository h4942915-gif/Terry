// 資料層：有 Supabase 設定就用線上資料庫，否則用瀏覽器 localStorage 的示範模式。
// 兩種 store 提供相同的介面，app.js 不需要知道背後是哪一種。
//
// Mushroom 物件（app 內部使用的格式）：
// { id, type, size, lat, lng, country, place, note, friendCode, endsAt(ms), createdAt(ms),
//   status, reporterId, joiners: Set<userId> }

(function () {
  const HISTORY_MS = 6 * 3600e3; // 只抓結束不到 6 小時的蘑菇

  function fromRow(r, joins) {
    return {
      id: r.id, type: r.type, size: r.size, lat: r.lat, lng: r.lng,
      country: r.country || "", place: r.place || "", note: r.note || "",
      friendCode: r.friend_code || "", endsAt: Date.parse(r.ends_at), createdAt: Date.parse(r.created_at),
      status: r.status, reporterId: r.reporter_id, joiners: joins || new Set()
    };
  }

  function SupabaseStore(cfg) {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const mushrooms = new Map();
    let me = null, listeners = [];
    const emit = () => listeners.forEach(fn => fn([...mushrooms.values()]));

    async function ensureUser() {
      const { data } = await sb.auth.getSession();
      if (data.session) { me = data.session.user.id; return me; }
      const { data: d, error } = await sb.auth.signInAnonymously();
      if (error) throw error;
      me = d.user.id; return me;
    }

    async function loadAll() {
      const since = new Date(Date.now() - HISTORY_MS).toISOString();
      const { data: rows, error } = await sb.from("mushrooms").select("*").gt("ends_at", since).order("ends_at").limit(2000);
      if (error) throw error;
      const ids = rows.map(r => r.id);
      const joins = new Map(ids.map(id => [id, new Set()]));
      for (let i = 0; i < ids.length; i += 200) {
        const { data: js, error: e2 } = await sb.from("mushroom_joins").select("mushroom_id,user_id").in("mushroom_id", ids.slice(i, i + 200));
        if (e2) throw e2;
        js.forEach(j => joins.get(j.mushroom_id)?.add(j.user_id));
      }
      mushrooms.clear();
      rows.forEach(r => mushrooms.set(r.id, fromRow(r, joins.get(r.id))));
      emit();
    }

    function subscribeRealtime() {
      sb.channel("radar")
        .on("postgres_changes", { event: "*", schema: "public", table: "mushrooms" }, p => {
          if (p.eventType === "DELETE") mushrooms.delete(p.old.id);
          else mushrooms.set(p.new.id, fromRow(p.new, mushrooms.get(p.new.id)?.joiners));
          emit();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "mushroom_joins" }, p => {
          const r = p.eventType === "DELETE" ? p.old : p.new;
          const m = mushrooms.get(r.mushroom_id); if (!m) return;
          // DELETE 事件預設只帶主鍵，剛好包含 mushroom_id 與 user_id
          p.eventType === "DELETE" ? m.joiners.delete(r.user_id) : m.joiners.add(r.user_id);
          emit();
        })
        .subscribe();
    }

    return {
      mode: "online",
      async start() { await ensureUser(); await loadAll(); subscribeRealtime(); setInterval(() => loadAll().catch(() => {}), 5 * 60e3); return me; },
      onChange(fn) { listeners.push(fn); },
      async add(m) {
        const { data, error } = await sb.from("mushrooms").insert({
          type: m.type, size: m.size, lat: m.lat, lng: m.lng, country: m.country || null, place: m.place || null,
          note: m.note || null, friend_code: m.friendCode || null, ends_at: new Date(m.endsAt).toISOString()
        }).select().single();
        if (error) throw error;
        mushrooms.set(data.id, fromRow(data)); emit(); return data.id;
      },
      async toggleJoin(id) {
        const m = mushrooms.get(id); const on = !m.joiners.has(me);
        const q = on ? sb.from("mushroom_joins").insert({ mushroom_id: id })
                     : sb.from("mushroom_joins").delete().match({ mushroom_id: id, user_id: me });
        const { error } = await q; if (error) throw error;
        on ? m.joiners.add(me) : m.joiners.delete(me); emit(); return on;
      },
      async markEnded(id) {
        const { error } = await sb.rpc("mark_mushroom_ended", { mid: id }); if (error) throw error;
        const m = mushrooms.get(id); if (m) m.status = "ended"; emit();
      },
      async remove(id) {
        const { error } = await sb.from("mushrooms").delete().eq("id", id); if (error) throw error;
        mushrooms.delete(id); emit();
      }
    };
  }

  function LocalStore() {
    const KEY = "mushroom-radar-demo";
    let me, listeners = [];
    const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
    const write = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} };
    const hydrate = list => list.map(m => ({ ...m, joiners: new Set(m.joiners || []) }));
    const save = list => write(list.map(m => ({ ...m, joiners: [...m.joiners] })));
    let list = [];
    const emit = () => listeners.forEach(fn => fn(list.slice()));
    return {
      mode: "demo",
      async start() {
        try { me = localStorage.getItem(KEY + "-me"); if (!me) { me = crypto.randomUUID(); localStorage.setItem(KEY + "-me", me); } } catch { me = "local"; }
        list = hydrate(read()).filter(m => m.endsAt > Date.now() - HISTORY_MS); emit(); return me;
      },
      onChange(fn) { listeners.push(fn); },
      async add(m) { const id = crypto.randomUUID(); list.push({ ...m, id, createdAt: Date.now(), status: "open", reporterId: me, joiners: new Set() }); save(list); emit(); return id; },
      async toggleJoin(id) { const m = list.find(x => x.id === id); const on = !m.joiners.has(me); on ? m.joiners.add(me) : m.joiners.delete(me); save(list); emit(); return on; },
      async markEnded(id) { const m = list.find(x => x.id === id); if (m) m.status = "ended"; save(list); emit(); },
      async remove(id) { list = list.filter(x => x.id !== id); save(list); emit(); }
    };
  }

  const cfg = window.MUSHROOM_RADAR_CONFIG || {};
  window.createStore = () => (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase) ? SupabaseStore(cfg) : LocalStore();
})();
