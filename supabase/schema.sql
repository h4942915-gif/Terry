-- 蘑菇雷達 資料庫結構（Supabase / Postgres）
-- 在 Supabase 後台 SQL Editor 貼上整份執行一次即可。
-- 需先在 Authentication → Sign In / Providers 開啟「Anonymous sign-ins」。

-- ---------- 玩家 ----------
-- 每位訪客都會用匿名登入拿到一個 auth.uid()，之後可升級成正式帳號。
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  nickname     text check (char_length(nickname) <= 30),
  friend_code  text check (friend_code ~ '^[0-9]{12}$'),
  -- Phase 2（好友碼交換）會用到：是否公開在好友碼廣場、所在地區、偏好
  share_code   boolean not null default false,
  region       text check (char_length(region) <= 60),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- 蘑菇回報（Phase 1） ----------
create table if not exists public.mushrooms (
  id           uuid primary key default gen_random_uuid(),
  type         text not null check (type in ('red','yellow','blue','purple','white','rock','winged','ice','normal')),
  size         text not null check (size in ('small','normal','large','giant')),
  lat          double precision not null check (lat between -85 and 85),
  lng          double precision not null check (lng between -180 and 180),
  country      text check (char_length(country) <= 60),
  place        text check (char_length(place) <= 60),
  note         text check (char_length(note) <= 80),
  friend_code  text check (friend_code is null or friend_code ~ '^[0-9]{12}$'),
  ends_at      timestamptz not null check (ends_at <= now() + interval '3 days'),
  status       text not null default 'open' check (status in ('open','ended')),
  reporter_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now()
);
create index if not exists mushrooms_ends_at_idx on public.mushrooms (ends_at);

-- 誰想打哪一朵（一人一朵一筆）
create table if not exists public.mushroom_joins (
  mushroom_id  uuid not null references public.mushrooms(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (mushroom_id, user_id)
);

-- ---------- Phase 3（組隊匹配）預留 ----------
create table if not exists public.parties (
  id           uuid primary key default gen_random_uuid(),
  host_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mushroom_id  uuid references public.mushrooms(id) on delete set null,
  title        text check (char_length(title) <= 60),
  max_members  int not null default 10 check (max_members between 2 and 10),
  starts_at    timestamptz,
  status       text not null default 'open' check (status in ('open','full','closed')),
  created_at   timestamptz not null default now()
);
create table if not exists public.party_members (
  party_id     uuid not null references public.parties(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (party_id, user_id)
);

-- ---------- 權限（Row Level Security） ----------
alter table public.profiles       enable row level security;
alter table public.mushrooms      enable row level security;
alter table public.mushroom_joins enable row level security;
alter table public.parties        enable row level security;
alter table public.party_members  enable row level security;

-- profiles：自己讀寫自己；公開分享好友碼的人大家都看得到
drop policy if exists "profiles self" on public.profiles;
create policy "profiles self" on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "profiles shared" on public.profiles;
create policy "profiles shared" on public.profiles for select using (share_code);

-- mushrooms：大家都能看；登入者能新增；只有回報者能改或刪
drop policy if exists "mushrooms read" on public.mushrooms;
create policy "mushrooms read" on public.mushrooms for select using (true);
drop policy if exists "mushrooms insert" on public.mushrooms;
create policy "mushrooms insert" on public.mushrooms for insert to authenticated
  with check (reporter_id = auth.uid() and ends_at > now());
drop policy if exists "mushrooms update own" on public.mushrooms;
create policy "mushrooms update own" on public.mushrooms for update to authenticated
  using (reporter_id = auth.uid()) with check (reporter_id = auth.uid());
drop policy if exists "mushrooms delete own" on public.mushrooms;
create policy "mushrooms delete own" on public.mushrooms for delete to authenticated
  using (reporter_id = auth.uid());

-- 任何登入者都可以回報「這朵已經打完了」（只改狀態，不能改其他欄位）
create or replace function public.mark_mushroom_ended(mid uuid)
returns void language sql security definer set search_path = public as $$
  update public.mushrooms set status = 'ended' where id = mid and auth.uid() is not null;
$$;
revoke all on function public.mark_mushroom_ended(uuid) from public, anon;
grant execute on function public.mark_mushroom_ended(uuid) to authenticated;

-- mushroom_joins：大家看得到人數；只能新增或取消自己的
drop policy if exists "joins read" on public.mushroom_joins;
create policy "joins read" on public.mushroom_joins for select using (true);
drop policy if exists "joins insert own" on public.mushroom_joins;
create policy "joins insert own" on public.mushroom_joins for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "joins delete own" on public.mushroom_joins;
create policy "joins delete own" on public.mushroom_joins for delete to authenticated
  using (user_id = auth.uid());

-- parties / party_members：先開放讀取，寫入只限本人（Phase 3 再細修）
drop policy if exists "parties read" on public.parties;
create policy "parties read" on public.parties for select using (true);
drop policy if exists "parties host" on public.parties;
create policy "parties host" on public.parties for all to authenticated
  using (host_id = auth.uid()) with check (host_id = auth.uid());
drop policy if exists "members read" on public.party_members;
create policy "members read" on public.party_members for select using (true);
drop policy if exists "members self" on public.party_members;
create policy "members self" on public.party_members for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 即時更新 ----------
do $$ begin
  alter publication supabase_realtime add table public.mushrooms, public.mushroom_joins;
exception when duplicate_object then null; end $$;

-- ---------- 清理：刪掉結束超過 1 天的蘑菇（可用 Supabase Cron 每小時跑一次） ----------
create or replace function public.cleanup_old_mushrooms()
returns void language sql security definer set search_path = public as $$
  delete from public.mushrooms where ends_at < now() - interval '1 day';
$$;
revoke all on function public.cleanup_old_mushrooms() from public, anon, authenticated;
