-- 皮克敏玩家社群 資料庫結構（Supabase / Postgres）
-- 使用方式：Supabase 後台 → SQL Editor → 貼上整份 → Run。可以重複執行。
-- 事前設定：Authentication → Sign In / Providers → 開啟「Anonymous sign-ins」。

-- ======================= 玩家檔案 =======================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  nickname     text not null check (char_length(nickname) between 1 and 24),
  friend_code  text check (friend_code is null or friend_code ~ '^[0-9]{12}$'),
  country      text check (char_length(country) <= 40),
  city         text check (char_length(city) <= 40),
  bio          text check (char_length(bio) <= 200),
  looking_for  text[] not null default '{}',   -- 例：{'friends','mushroom','postcards'}
  share_code   boolean not null default true,  -- 是否出現在「好友碼交換」
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ======================= 貼文 =======================
-- kind：talk = 一般討論、mushroom = 蘑菇分享、spot = 花點／散步路線
create table if not exists public.posts (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind          text not null check (kind in ('talk','mushroom','spot')),
  body          text not null check (char_length(body) between 1 and 1000),
  country       text check (char_length(country) <= 40),
  city          text check (char_length(city) <= 40),
  lat           double precision check (lat between -85 and 85),
  lng           double precision check (lng between -180 and 180),
  image_path    text check (char_length(image_path) <= 200),
  mushroom_type text check (mushroom_type in ('red','yellow','blue','purple','white','rock','winged','ice','normal')),
  mushroom_size text check (mushroom_size in ('small','normal','large','giant')),
  ends_at       timestamptz,
  status        text not null default 'open' check (status in ('open','ended','hidden')),
  created_at    timestamptz not null default now(),
  constraint mushroom_fields check (
    kind <> 'mushroom' or (mushroom_type is not null and mushroom_size is not null and ends_at is not null and lat is not null and lng is not null)
  )
);
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_region_idx  on public.posts (country, city);

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  author_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 500),
  created_at  timestamptz not null default now()
);
create index if not exists comments_post_idx on public.comments (post_id, created_at);

-- 讚／想打（蘑菇貼文上顯示為「想打」）
create table if not exists public.likes (
  post_id     uuid not null references public.posts(id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- 「請邀請我」：想打某朵蘑菇的人留下好友碼，只有發文者和本人看得到
create table if not exists public.invite_requests (
  post_id      uuid not null references public.posts(id) on delete cascade,
  user_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  friend_code  text not null check (friend_code ~ '^[0-9]{12}$'),
  status       text not null default 'waiting' check (status in ('waiting','invited')),
  created_at   timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- 檢舉
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  target_type  text not null check (target_type in ('post','comment','profile')),
  target_id    uuid not null,
  reporter_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason       text check (char_length(reason) <= 200),
  created_at   timestamptz not null default now(),
  unique (target_type, target_id, reporter_id)
);

-- ======================= 組隊（之後的功能，先預留） =======================
create table if not exists public.parties (
  id           uuid primary key default gen_random_uuid(),
  host_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  post_id      uuid references public.posts(id) on delete set null,
  title        text check (char_length(title) <= 60),
  max_members  int not null default 10 check (max_members between 2 and 10),
  starts_at    timestamptz,
  status       text not null default 'open' check (status in ('open','full','closed')),
  created_at   timestamptz not null default now()
);
create table if not exists public.party_members (
  party_id     uuid not null references public.parties(id) on delete cascade,
  user_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (party_id, user_id)
);

-- ======================= 防洗版 =======================
create or replace function public.rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if tg_table_name = 'posts' then
    select count(*) into n from public.posts where author_id = auth.uid() and created_at > now() - interval '10 minutes';
    if n >= 5 then raise exception '發文太頻繁，請稍後再試'; end if;
  elsif tg_table_name = 'comments' then
    select count(*) into n from public.comments where author_id = auth.uid() and created_at > now() - interval '1 minute';
    if n >= 6 then raise exception '留言太頻繁，請稍後再試'; end if;
  end if;
  return new;
end $$;
drop trigger if exists posts_rate on public.posts;
create trigger posts_rate before insert on public.posts for each row execute function public.rate_limit();
drop trigger if exists comments_rate on public.comments;
create trigger comments_rate before insert on public.comments for each row execute function public.rate_limit();

-- 被 3 個不同的人檢舉的貼文自動隱藏
create or replace function public.auto_hide() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.target_type = 'post' and (select count(*) from public.reports where target_type = 'post' and target_id = new.target_id) >= 3 then
    update public.posts set status = 'hidden' where id = new.target_id;
  end if;
  return new;
end $$;
drop trigger if exists reports_hide on public.reports;
create trigger reports_hide after insert on public.reports for each row execute function public.auto_hide();

-- ======================= 權限（Row Level Security） =======================
alter table public.profiles      enable row level security;
alter table public.posts         enable row level security;
alter table public.comments      enable row level security;
alter table public.likes         enable row level security;
alter table public.reports       enable row level security;
alter table public.invite_requests enable row level security;
alter table public.parties       enable row level security;
alter table public.party_members enable row level security;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select using (true);
drop policy if exists "profiles write own" on public.profiles;
create policy "profiles write own" on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- 好友碼只給「公開分享」的人看：前端一律從這個 view 讀取，view 會把不公開的好友碼變成 null。
-- （view 以擁有者權限執行，所以下面可以把 profiles 的 friend_code 欄位讀取權拿掉）
drop view if exists public.profiles_public;
create view public.profiles_public as
  select id, nickname, country, city, bio, looking_for, share_code, created_at,
         case when share_code or id = auth.uid() then friend_code end as friend_code
  from public.profiles;
revoke select on public.profiles from anon, authenticated;
grant select on public.profiles_public to anon, authenticated;
grant select (id, nickname, country, city, bio, looking_for, share_code, created_at, updated_at) on public.profiles to anon, authenticated;

-- 儲存自己的檔案：因為上面把 profiles 的直接讀取權拿掉了，改用這個函式新增或更新
create or replace function public.save_profile(p_nickname text, p_friend_code text, p_country text, p_city text,
  p_bio text, p_looking_for text[], p_share_code boolean) returns void
language sql security definer set search_path = public as $$
  insert into public.profiles (id, nickname, friend_code, country, city, bio, looking_for, share_code, updated_at)
  values (auth.uid(), p_nickname, nullif(p_friend_code, ''), nullif(p_country, ''), nullif(p_city, ''), nullif(p_bio, ''),
          coalesce(p_looking_for, '{}'), coalesce(p_share_code, true), now())
  on conflict (id) do update set nickname = excluded.nickname, friend_code = excluded.friend_code, country = excluded.country,
    city = excluded.city, bio = excluded.bio, looking_for = excluded.looking_for, share_code = excluded.share_code, updated_at = now();
$$;
revoke all on function public.save_profile(text, text, text, text, text, text[], boolean) from public, anon;
grant execute on function public.save_profile(text, text, text, text, text, text[], boolean) to authenticated;

drop policy if exists "posts read" on public.posts;
create policy "posts read" on public.posts for select using (status <> 'hidden' or author_id = auth.uid());
drop policy if exists "posts insert" on public.posts;
create policy "posts insert" on public.posts for insert to authenticated
  with check (author_id = auth.uid() and status = 'open' and (ends_at is null or ends_at between now() and now() + interval '3 days'));
drop policy if exists "posts update own" on public.posts;
create policy "posts update own" on public.posts for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid() and status <> 'hidden');
drop policy if exists "posts delete own" on public.posts;
create policy "posts delete own" on public.posts for delete to authenticated using (author_id = auth.uid());

-- 任何登入者都可以回報「這朵蘑菇已經打完了」
create or replace function public.mark_mushroom_ended(pid uuid) returns void
language sql security definer set search_path = public as $$
  update public.posts set status = 'ended' where id = pid and kind = 'mushroom' and status = 'open' and auth.uid() is not null;
$$;
revoke all on function public.mark_mushroom_ended(uuid) from public, anon;
grant execute on function public.mark_mushroom_ended(uuid) to authenticated;

drop policy if exists "comments read" on public.comments;
create policy "comments read" on public.comments for select using (true);
drop policy if exists "comments insert" on public.comments;
create policy "comments insert" on public.comments for insert to authenticated with check (author_id = auth.uid());
drop policy if exists "comments delete own" on public.comments;
create policy "comments delete own" on public.comments for delete to authenticated using (author_id = auth.uid());

drop policy if exists "likes read" on public.likes;
create policy "likes read" on public.likes for select using (true);
drop policy if exists "likes own" on public.likes;
create policy "likes own" on public.likes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "invites read" on public.invite_requests;
create policy "invites read" on public.invite_requests for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));
drop policy if exists "invites insert own" on public.invite_requests;
create policy "invites insert own" on public.invite_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'waiting' and exists (select 1 from public.posts p where p.id = post_id and p.kind = 'mushroom' and p.status = 'open'));
drop policy if exists "invites delete own" on public.invite_requests;
create policy "invites delete own" on public.invite_requests for delete to authenticated using (user_id = auth.uid());
drop policy if exists "invites author marks" on public.invite_requests;
create policy "invites author marks" on public.invite_requests for update to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

drop policy if exists "reports insert" on public.reports;
create policy "reports insert" on public.reports for insert to authenticated with check (reporter_id = auth.uid());

drop policy if exists "parties read" on public.parties;
create policy "parties read" on public.parties for select using (true);
drop policy if exists "parties host" on public.parties;
create policy "parties host" on public.parties for all to authenticated using (host_id = auth.uid()) with check (host_id = auth.uid());
drop policy if exists "members read" on public.party_members;
create policy "members read" on public.party_members for select using (true);
drop policy if exists "members self" on public.party_members;
create policy "members self" on public.party_members for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ======================= 圖片（Storage） =======================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', true, 1048576, array['image/jpeg','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg','image/webp'];

drop policy if exists "images upload own folder" on storage.objects;
create policy "images upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "images delete own" on storage.objects;
create policy "images delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ======================= 即時更新 =======================
do $$ begin
  alter publication supabase_realtime add table public.posts, public.comments, public.likes, public.invite_requests;
exception when duplicate_object then null; end $$;
