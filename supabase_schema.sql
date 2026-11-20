-- SelfAgent 云端数据结构 v2（Supabase / Postgres）
-- 在 Supabase → SQL Editor 整段执行一次即可（幂等）。
-- 设计：事件流(events) + 大对象快照(snapshots) + 水位(sync_state)

-- ① 核心事件表：所有个人行为数据的唯一事实源
create table if not exists events (
  id            uuid primary key,          -- 客户端生成 UUID（幂等，重复上传自动去重）
  client_id     text not null,             -- 用户隔离键（现有 cloudSecret 口令体系）
  kind          text not null,             -- 'log' | 'train' | 'cardio'
  type          text,                      -- 工作/生活…（log 用）
  tags          text[],
  score         smallint,                  -- 精力 1-5
  mood          smallint,                  -- 情绪 1-5
  content       text,
  ts            timestamptz not null,      -- 业务时间
  date          date not null,             -- 按天分组/补记
  source        text,                      -- manual | auto | agent
  meta          jsonb,                     -- 训练组数据/有氧/扩展，逃生舱
  deleted       boolean default false,     -- 软删除墓碑（同步协议必需）
  updated_at    timestamptz default now(), -- LWW 水位（服务端时间！）
  synced_at     timestamptz default now()
);
create index if not exists events_client_ts  on events(client_id, ts desc);
create index if not exists events_client_upd on events(client_id, updated_at);
create index if not exists events_client_date on events(client_id, date desc);

-- ② 快照表：低频更新的"大对象"单独放，不混进事件流
create table if not exists snapshots (
  client_id   text,
  kind        text,          -- 'persona' | 'settings' | 'agent_memory' | 'custom_exercises' | 'archive'
  payload     jsonb not null,
  data_hash   text,          -- 数据指纹（现有缓存机制直接复用）
  updated_at  timestamptz default now(),
  primary key (client_id, kind)
);

-- ③ 同步水位表：客户端断点续传的锚点
create table if not exists sync_state (
  client_id    text primary key,
  last_pulled  timestamptz,   -- 上次拉取水位（服务端维护可防多端漂移）
  push_count   int default 0, -- 诊断用
  schema_ver   int default 2
);

-- ④ 拉取游标（二期多端启用；单端阶段可不用）
create table if not exists pull_cursors (
  client_id  text,
  device_id  text,
  last_pulled timestamptz default now(),
  primary key (client_id, device_id)
);

-- ============ 行级安全：除 service_role 外只允许 RPC 入口 ============
alter table events      enable row level security;
alter table snapshots   enable row level security;
alter table sync_state  enable row level security;
alter table pull_cursors enable row level security;

drop policy if exists events_isolated on events;
create policy events_isolated on events
  using (client_id = current_setting('app.secret', true))
  with check (client_id = current_setting('app.secret', true));

drop policy if exists snapshots_isolated on snapshots;
create policy snapshots_isolated on snapshots
  using (client_id = current_setting('app.secret', true))
  with check (client_id = current_setting('app.secret', true));

-- ============ 批量推送事件（幂等 upsert，1 次请求任意多条） ============
create or replace function push_events(p_client text, p_batch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
  v_at timestamptz := now();
begin
  if p_client is null or length(p_client) = 0 then
    raise exception 'client_id required';
  end if;
  perform set_config('app.secret', p_client, true);

  insert into events (id, client_id, kind, type, tags, score, mood, content, ts, date, source, meta, deleted, updated_at, synced_at)
  select
    (x->>'id')::uuid, p_client, x->>'kind', x->>'type',
    case when jsonb_typeof(x->'tags') = 'array'
         then array(select jsonb_array_elements_text(x->'tags'))
         else null end,
    (x->>'score')::smallint, (x->>'mood')::smallint,
    x->>'content', coalesce((x->>'ts')::timestamptz, v_at),
    coalesce((x->>'date')::date, (v_at at time zone 'Asia/Shanghai')::date),
    x->>'source', x->'meta', coalesce((x->>'deleted')::boolean, false), v_at, v_at
  from jsonb_array_elements(p_batch) as x
  on conflict (id) do update set
    kind = excluded.kind, type = excluded.type, tags = excluded.tags,
    score = excluded.score, mood = excluded.mood, content = excluded.content,
    ts = excluded.ts, date = excluded.date, source = excluded.source,
    meta = excluded.meta, deleted = excluded.deleted,
    updated_at = v_at, synced_at = v_at;
  get diagnostics v_n = row_count;

  insert into sync_state (client_id, push_count, schema_ver, last_pulled)
  values (p_client, v_n, 2, null)
  on conflict (client_id) do update set push_count = sync_state.push_count + v_n, schema_ver = 2;

  return jsonb_build_object('upserted', v_n, 'at', v_at);
end $$;

-- ============ 增量拉取（按服务端水位） ============
create or replace function pull_events(p_client text, p_since timestamptz default '1970-01-01')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_rows jsonb;
begin
  if p_client is null or length(p_client) = 0 then
    raise exception 'client_id required';
  end if;
  perform set_config('app.secret', p_client, true);
  select coalesce(jsonb_agg(to_jsonb(e) order by e.updated_at), '[]'::jsonb)
    into v_rows
  from events e
  where e.client_id = p_client and e.updated_at > p_since;
  update sync_state set last_pulled = now() where client_id = p_client;
  return v_rows;
end $$;

-- ============ 快照推送 / 拉取 ============
create or replace function push_snapshot(p_client text, p_kind text, p_payload jsonb, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_at timestamptz := now();
begin
  if p_client is null or length(p_client) = 0 then raise exception 'client_id required'; end if;
  perform set_config('app.secret', p_client, true);
  insert into snapshots (client_id, kind, payload, data_hash, updated_at)
  values (p_client, p_kind, p_payload, p_hash, v_at)
  on conflict (client_id, kind) do update set
    payload = excluded.payload, data_hash = excluded.data_hash, updated_at = v_at;
  return jsonb_build_object('at', v_at);
end $$;

create or replace function pull_snapshots(p_client text, p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_rows jsonb;
begin
  if p_client is null or length(p_client) = 0 then raise exception 'client_id required'; end if;
  perform set_config('app.secret', p_client, true);
  select coalesce(jsonb_agg(to_jsonb(s) order by s.kind), '[]'::jsonb)
    into v_rows
  from snapshots s
  where s.client_id = p_client
    and (p_since is null or s.updated_at > p_since);
  return v_rows;
end $$;

-- ============ 墓碑清理：90 天后物理删除 ============
create or replace function purge_tombstones(p_days int default 90)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  delete from events where deleted = true and updated_at < now() - (p_days || ' days')::interval;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- 可选：每天自动清理（需要 pg_cron 扩展；没有就手动调 purge_tombstones）
-- select cron.schedule('purge-tombstones', '0 4 * * *', $$select purge_tombstones(90)$$);
