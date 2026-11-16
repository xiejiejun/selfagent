# 云端数据库接入说明

GitHub 本身不提供数据库服务（GitHub Pages 只是静态托管，没有后端），所以数据库放在 Supabase（免费 Postgres + 自动生成 REST 接口），前端已内置同步逻辑。

## 一次性配置（约 2 分钟）

1. 打开 https://supabase.com 注册，新建一个 project（Region 选 Singapore 或 Tokyo）。
2. Project Settings → API：复制 `Project URL` 和 `anon public` key。
3. SQL Editor → 粘贴 `db/schema.sql` 全文 → Run。
4. 打开网页 → 设置 → 云端数据库：填入 URL、anon key、自定义访问口令 → 保存并连接。
5. 之后每次写入日志/档案/训练都会自动 upsert 到 `selfagent_state`；换设备时填同样三项，点「从云端拉取」即可恢复。

## 接口（Supabase 自动生成的 REST）

- 读取：`GET {url}/rest/v1/selfagent_state?secret=eq.<口令>&select=k,v,updated_at`
- 写入：`POST {url}/rest/v1/selfagent_state`，头 `Prefer: resolution=merge-duplicates`，body `[{"k":"logs","secret":"<口令>","v":{...}}]`
- 明细表 `sa_logs` / `sa_workouts` 结构见 schema.sql，可按需把前端写入改成逐条 insert，用于报表或外部 Agent 调用。

## 安全边界

- `anon key` 会随网页公开（GitHub Pages 是公开静态页），这是 Supabase 的正常设计；`secret` 只是逻辑隔离，不等于鉴权。
- 要真正防止他人读写，请在 Supabase 开启 Auth（邮箱 OTP），把 RLS 策略改成 `auth.uid()` 判定，前端登录后再同步。
- 不要在前端放置 `service_role` key。
