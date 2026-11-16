-- SelfAgent 云端数据表（Supabase / 任意 Postgres）
-- 在 Supabase 控制台 → SQL Editor 里整段执行即可。

-- 1) 主表：前端按 key 整包同步（logs / settings / profile / training）
create table if not exists public.selfagent_state (
  k          text        primary key,
  secret     text        not null default 'default',
  v          jsonb       not null,
  updated_at timestamptz not null default now()
);

alter table public.selfagent_state enable row level security;

-- 个人自用：anon 可读写，靠 secret 列做逻辑隔离（前端配置里填同一个口令）
drop policy if exists "sa_state_select" on public.selfagent_state;
create policy "sa_state_select" on public.selfagent_state
  for select to anon using (true);

drop policy if exists "sa_state_insert" on public.selfagent_state;
create policy "sa_state_insert" on public.selfagent_state
  for insert to anon with check (true);

drop policy if exists "sa_state_update" on public.selfagent_state;
create policy "sa_state_update" on public.selfagent_state
  for update to anon using (true) with check (true);

drop policy if exists "sa_state_delete" on public.selfagent_state;
create policy "sa_state_delete" on public.selfagent_state
  for delete to anon using (true);

-- 2) 可选：把日志展开成可查询的明细表（后续接数据分析 / 报表时用）
create table if not exists public.sa_logs (
  id         text        primary key,
  secret     text        not null default 'default',
  created_at timestamptz,
  type       text,
  tags       text[],
  energy     int,
  mood       int,
  body       text
);
create index if not exists sa_logs_secret_time on public.sa_logs (secret, created_at desc);
alter table public.sa_logs enable row level security;
drop policy if exists "sa_logs_all" on public.sa_logs;
create policy "sa_logs_all" on public.sa_logs for all to anon using (true) with check (true);

-- 3) 可选：健身日志明细
create table if not exists public.sa_workouts (
  id         text        primary key,
  secret     text        not null default 'default',
  day        date,
  part       text,
  items      jsonb,
  note       text
);
create index if not exists sa_workouts_secret_day on public.sa_workouts (secret, day desc);
alter table public.sa_workouts enable row level security;
drop policy if exists "sa_workouts_all" on public.sa_workouts;
create policy "sa_workouts_all" on public.sa_workouts for all to anon using (true) with check (true);

-- 4) 查询示例
-- select k, updated_at from public.selfagent_state where secret = 'my-pass';
-- select v from public.selfagent_state where secret = 'my-pass' and k = 'logs';
