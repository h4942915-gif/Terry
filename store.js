// 資料層：有 Supabase 設定就用線上資料庫，否則用瀏覽器 localStorage 的「示範模式」。
// 兩種 store 介面相同，app.js 不需要知道背後是哪一種。
//
// Profile { id, nickname, friendCode, country, city, bio, lookingFor[], shareCode }
// Post    { id, authorId, kind('talk'|'mushroom'|'spot'), body, country, city, lat, lng, imageUrl,
//           mushroomType, mushroomSize, endsAt(ms|null), status, createdAt(ms), likes:Set, commentCount }
// Comment { id, postId, authorId, body, createdAt(ms) }

(function () {
  const POST_WINDOW_DAYS = 30;

  function Emitter() {
    const fns = [];
    return { on: f => fns.push(f), emit: (...a) => fns.forEach(f => f(...a)) };
  }

  /* ======================= Supabase ======================= */
  function SupabaseStore(cfg) {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    const ev = Emitter();
    const posts = new Map(), profiles = new Map();
    let me = null, invites = [];
    const toInvite = r => ({ postId: r.post_id, userId: r.user_id, friendCode: r.friend_code, status: r.status, createdAt: Date.parse(r.created_at) });
    async function loadInvites() {
      const { data, error } = await sb.from("invite_requests").select("*").order("created_at").limit(1000); fail(error);
      invites = data.map(toInvite); await loadProfiles(invites.map(i => i.userId));
    }

    const toProfile = r => ({ id: r.id, nickname: r.nickname, friendCode: r.friend_code || "", country: r.country || "", city: r.city || "",
      bio: r.bio || "", lookingFor: r.looking_for || [], shareCode: !!r.share_code });
    const imgUrl = p => p ? sb.storage.from("post-images").getPublicUrl(p).data.publicUrl : "";
    const toPost = (r, prev) => ({ id: r.id, authorId: r.author_id, kind: r.kind, body: r.body, country: r.country || "", city: r.city || "",
      lat: r.lat, lng: r.lng, imageUrl: imgUrl(r.image_path), imagePath: r.image_path, mushroomType: r.mushroom_type, mushroomSize: r.mushroom_size,
      endsAt: r.ends_at ? Date.parse(r.ends_at) : null, status: r.status, createdAt: Date.parse(r.created_at),
      likes: prev?.likes || new Set(), commentCount: prev?.commentCount || 0 });
    const toComment = r => ({ id: r.id, postId: r.post_id, authorId: r.author_id, body: r.body, createdAt: Date.parse(r.created_at) });
    const ensure = () => { if (!me) throw new Error("網站的登入功能還沒開啟，暫時只能瀏覽。（管理員：到 Supabase → Authentication → Sign In / Providers 開啟 Anonymous sign-ins）"); };
    const fail = (error) => { if (error) throw new Error(error.message || "操作失敗"); };

    async function loadProfiles(ids) {
      const need = [...new Set(ids)].filter(id => id && !profiles.has(id));
      for (let i = 0; i < need.length; i += 100) {
        const { data, error } = await sb.from("profiles_public").select("*").in("id", need.slice(i, i + 100)); fail(error);
        data.forEach(r => profiles.set(r.id, toProfile(r)));
      }
    }

    async function loadPosts() {
      const since = new Date(Date.now() - POST_WINDOW_DAYS * 864e5).toISOString();
      const { data, error } = await sb.from("posts").select("*").gt("created_at", since).neq("status", "hidden").order("created_at", { ascending: false }).limit(500);
      fail(error);
      posts.clear(); data.forEach(r => posts.set(r.id, toPost(r)));
      const ids = [...posts.keys()];
      for (let i = 0; i < ids.length; i += 150) {
        const chunk = ids.slice(i, i + 150);
        const [{ data: ls, error: e1 }, { data: cs, error: e2 }] = await Promise.all([
          sb.from("likes").select("post_id,user_id").in("post_id", chunk),
          sb.from("comments").select("post_id").in("post_id", chunk)]);
        fail(e1); fail(e2);
        ls.forEach(l => posts.get(l.post_id)?.likes.add(l.user_id));
        cs.forEach(c => { const p = posts.get(c.post_id); if (p) p.commentCount++; });
      }
      await loadProfiles(data.map(r => r.author_id));
      await loadInvites();
      ev.emit();
    }

    function realtime() {
      sb.channel("community")
        .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, async p => {
          if (p.eventType === "DELETE" || p.new.status === "hidden") posts.delete((p.old || p.new).id);
          else { posts.set(p.new.id, toPost(p.new, posts.get(p.new.id))); await loadProfiles([p.new.author_id]); }
          ev.emit();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "likes" }, p => {
          const r = p.eventType === "DELETE" ? p.old : p.new, post = posts.get(r.post_id); if (!post) return;
          p.eventType === "DELETE" ? post.likes.delete(r.user_id) : post.likes.add(r.user_id); ev.emit();
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "comments" }, async p => {
          const post = posts.get(p.new.post_id); if (post) post.commentCount++;
          await loadProfiles([p.new.author_id]); ev.emit(p.new.post_id);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "invite_requests" }, async () => { await loadInvites(); ev.emit(); })
        .subscribe();
    }

    return {
      mode: "online",
      onChange: ev.on,
      async start() {
        const { data } = await sb.auth.getSession();
        if (data.session) me = data.session.user.id;
        else {
          const { data: d, error } = await sb.auth.signInAnonymously();
          if (error) { console.error(error); this.authError = error.message || "sign-in failed"; } else me = d.user.id;
        }
        if (me) await loadProfiles([me]);
        await loadPosts(); realtime();
        setInterval(() => loadPosts().catch(() => {}), 10 * 60e3);
        return me;
      },
      me: () => me,
      profile: id => profiles.get(id),
      posts: () => [...posts.values()],
      async saveProfile(p) { ensure();
        const { error } = await sb.rpc("save_profile", { p_nickname: p.nickname, p_friend_code: p.friendCode || "", p_country: p.country || "",
          p_city: p.city || "", p_bio: p.bio || "", p_looking_for: p.lookingFor || [], p_share_code: !!p.shareCode });
        fail(error); profiles.set(me, { ...p, id: me }); ev.emit();
      },
      async listFriends() {
        const { data, error } = await sb.from("profiles_public").select("*").eq("share_code", true).not("friend_code", "is", null).order("created_at", { ascending: false }).limit(1000);
        fail(error); data.forEach(r => profiles.set(r.id, toProfile(r))); return data.map(toProfile);
      },
      async createPost(p, image) { ensure();
        let image_path = null;
        if (image) {
          image_path = `${me}/${crypto.randomUUID()}.jpg`;
          const { error } = await sb.storage.from("post-images").upload(image_path, image, { contentType: "image/jpeg" }); fail(error);
        }
        const { data, error } = await sb.from("posts").insert({ kind: p.kind, body: p.body, country: p.country || null, city: p.city || null,
          lat: p.lat ?? null, lng: p.lng ?? null, image_path, mushroom_type: p.mushroomType || null, mushroom_size: p.mushroomSize || null,
          ends_at: p.endsAt ? new Date(p.endsAt).toISOString() : null }).select().single();
        fail(error); posts.set(data.id, toPost(data)); ev.emit(); return data.id;
      },
      async deletePost(id) { ensure();
        const p = posts.get(id);
        const { error } = await sb.from("posts").delete().eq("id", id); fail(error);
        if (p?.imagePath) sb.storage.from("post-images").remove([p.imagePath]);
        posts.delete(id); ev.emit();
      },
      async markEnded(id) { ensure(); const { error } = await sb.rpc("mark_mushroom_ended", { pid: id }); fail(error); const p = posts.get(id); if (p) p.status = "ended"; ev.emit(); },
      async toggleLike(id) { ensure();
        const p = posts.get(id), on = !p.likes.has(me);
        const { error } = on ? await sb.from("likes").insert({ post_id: id }) : await sb.from("likes").delete().match({ post_id: id, user_id: me });
        fail(error); on ? p.likes.add(me) : p.likes.delete(me); ev.emit(); return on;
      },
      async comments(postId) {
        const { data, error } = await sb.from("comments").select("*").eq("post_id", postId).order("created_at").limit(300); fail(error);
        await loadProfiles(data.map(c => c.author_id)); return data.map(toComment);
      },
      async addComment(postId, body) { ensure();
        const { error } = await sb.from("comments").insert({ post_id: postId, body }); fail(error);
      },
      async deleteComment(id, postId) { ensure(); const { error } = await sb.from("comments").delete().eq("id", id); fail(error); const p = posts.get(postId); if (p) p.commentCount--; ev.emit(); },
      invites: () => invites.slice(),
      async requestInvite(postId, friendCode) { ensure();
        const { error } = await sb.from("invite_requests").insert({ post_id: postId, friend_code: friendCode }); fail(error);
        await loadInvites(); ev.emit();
      },
      async cancelInvite(postId) { ensure();
        const { error } = await sb.from("invite_requests").delete().match({ post_id: postId, user_id: me }); fail(error);
        await loadInvites(); ev.emit();
      },
      async markInvited(postId, userId) { ensure();
        const { error } = await sb.from("invite_requests").update({ status: "invited" }).match({ post_id: postId, user_id: userId }); fail(error);
        await loadInvites(); ev.emit();
      },
      async report(type, id, reason) { ensure();
        const { error } = await sb.from("reports").insert({ target_type: type, target_id: id, reason });
        if (error && !/duplicate/i.test(error.message)) fail(error);
      }
    };
  }

  /* ======================= 示範模式（localStorage） ======================= */
  function LocalStore() {
    const KEY = "pikmin-community-demo";
    const ev = Emitter();
    let me, db = { profiles: {}, posts: [], comments: [], invites: [] };
    const load = () => { try { const d = JSON.parse(localStorage.getItem(KEY)); if (d) db = { invites: [], ...d }; } catch {} };
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
    const hyd = p => ({ ...p, likes: new Set(p.likes), commentCount: db.comments.filter(c => c.postId === p.id).length });
    const blobToData = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
    const raw = id => db.posts.find(p => p.id === id);
    return {
      mode: "demo",
      onChange: ev.on,
      async start() {
        load();
        try { me = localStorage.getItem(KEY + "-me") || crypto.randomUUID(); localStorage.setItem(KEY + "-me", me); } catch { me = "local-user"; }
        return me;
      },
      me: () => me,
      profile: id => db.profiles[id],
      posts: () => db.posts.filter(p => p.createdAt > Date.now() - POST_WINDOW_DAYS * 864e5).map(hyd),
      async saveProfile(p) { db.profiles[me] = { ...p, id: me }; save(); ev.emit(); },
      async listFriends() { return Object.values(db.profiles).filter(p => p.shareCode && p.friendCode); },
      async createPost(p, image) {
        const id = crypto.randomUUID();
        db.posts.unshift({ ...p, id, authorId: me, status: "open", createdAt: Date.now(), likes: [], imageUrl: image ? await blobToData(image) : "" });
        save(); ev.emit(); return id;
      },
      async deletePost(id) { db.posts = db.posts.filter(p => p.id !== id); db.comments = db.comments.filter(c => c.postId !== id); save(); ev.emit(); },
      async markEnded(id) { raw(id).status = "ended"; save(); ev.emit(); },
      async toggleLike(id) { const p = raw(id), i = p.likes.indexOf(me); i < 0 ? p.likes.push(me) : p.likes.splice(i, 1); save(); ev.emit(); return i < 0; },
      async comments(postId) { return db.comments.filter(c => c.postId === postId); },
      async addComment(postId, body) { db.comments.push({ id: crypto.randomUUID(), postId, authorId: me, body, createdAt: Date.now() }); save(); ev.emit(postId); },
      async deleteComment(id) { db.comments = db.comments.filter(c => c.id !== id); save(); ev.emit(); },
      invites: () => db.invites.filter(i => i.userId === me || raw(i.postId)?.authorId === me),
      async requestInvite(postId, friendCode) { db.invites.push({ postId, userId: me, friendCode, status: "waiting", createdAt: Date.now() }); save(); ev.emit(); },
      async cancelInvite(postId) { db.invites = db.invites.filter(i => !(i.postId === postId && i.userId === me)); save(); ev.emit(); },
      async markInvited(postId, userId) { const i = db.invites.find(i => i.postId === postId && i.userId === userId); if (i) i.status = "invited"; save(); ev.emit(); },
      async report() {}
    };
  }

  const cfg = window.MUSHROOM_RADAR_CONFIG || {};
  window.createStore = () => (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase) ? SupabaseStore(cfg) : LocalStore();
})();
