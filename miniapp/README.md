# SelfAgent 小程序端（分支 `miniapp`）

原生小程序 + 微信云开发。`main` 分支继续维护网页版（GitHub Pages）。两端共享 `libs/engine`（纯函数规则引擎）与 `libs/sync`（增量同步），只维护一份大脑。

- appid：`wx71302ef848e2868f`
- 云开发环境：`cloud1-d2g3r78mffbe3ca36`（已写入 `miniprogram/app.js`）

## 已落地功能

| 页面 | 路径 | 内容 |
| --- | --- | --- |
| 今天 | `pages/home` | 今日容量/组数/有氧/连续天数四格、近 7 天容量柱、今日动作 chips、三个跳转 |
| 训练 | `pages/train` | 日期前后切换、当日摘要、点组直接打卡（震动反馈）、⋯ 编辑/删除、＋ 添加动作、＋ 有氧、查看记录 |
| 分析 | `pages/agent` | 7/30/90 天切换、训练天数/总容量/日均、部位分布条、高频动作、问 AI（走 `aiProxy` 云函数） |
| 记录 | `pages/log` | 快记输入并落库、按日期分组时间线、训练卡摘要 + 动作行、⋯ 编辑、＋ 添加动作、删除记录 |
| 我的 | `pages/setting` | 身高/体重/目标、数据统计、导出/导入（剪贴板 JSON）、云同步上传/拉取、清空本机 |
| 选动作 | `pages/picker` | 5,632 条动作词库：搜索 + 部位筛选，选中回传给训练/记录页 |
| 动作库 | `pages/library` | 40/页图卡网格、搜索、部位筛选、★收藏筛选、点击选中回传、无图占位首字 |
| 专注模式 | `pages/focus` | 三环 canvas（组进度/时长/容量）、ready→work→rest→finish 状态机、组间倒计时、逐组打卡即时落库、完成后生成训练日志 |
| 计划 | `pages/plan` | 周节奏柱、每周天数/每天组数/提醒时间、AI 周计划（`aiProxy`）、订阅消息授权与云端登记 |

组件：

- `components/train-editor`：力量（逐组 reps/weight/✓/×、加一组、删一组）与有氧（时长/完成）双模式，`confirm` / `delete` / `close` 三个事件。

云函数：

- `aiProxy`：OpenAI 兼容 `/chat/completions` 转发，Key 只存服务端环境变量，客户端拿不到。
- `syncPush`：只接收客户端标脏的实体（logs / train(records+cardio)）写入 `events`，`profile`/`settings`/`trainmeta` 写 `snapshots`（`trainmeta` 另存 `upd`=客户端编辑时间），墓碑删云端实体，`sync_state` 记水位；集合不存在时自建。
- `syncPull`：按水位 `ts > since` 拉增量（分页 1000），返回 `{logs:[], train:{records,cardio}, profile, settings, trainmeta, metaTs}`。
- `gifMigrate`：把动作缩略图（`media/thumb/<id>.webp`）搬到云存储并写 `media_map`，供动作库图卡读取；单次 ≤40 个 id。
- `notify`：订阅消息登记与发送，`action=bind/unbind/status/send`，定时触发器每天 20:00 扫描 `subscriptions` 发提醒。

## 目录

```
miniapp/
├── project.config.json           # appid / miniprogramRoot / cloudfunctionRoot
├── miniprogram/
│   ├── app.js / app.json / app.wxss
│   ├── pages/{home,train,agent,log,setting,picker}/
│   ├── components/train-editor/
│   └── libs/
│       ├── store/                # 9 个存储键读写（与网页版同名）
│       ├── engine/               # 规则引擎/装配/文案/统计，纯函数无 wx
│       ├── actions.js            # 改训练 → 重建当天 auto 日志 → 落 storage → 墓碑
│       ├── sync/                 # 水位 / LWW / 墓碑合并，传输层是云函数
│       └── data/                 # 动作词库 lib.js（5,632 条，244KB）+ 查询层
└── cloudfunctions/{aiProxy,syncPush,syncPull,gifMigrate,notify}/
```

## 本地存储键（与网页版一一对应）

`selfagent_logs_v1` / `selfagent_training_v1` / `selfagent_profile_v1` / `selfagent_settings_v1` / `selfagent_theme_v1` / `selfagent_page_v1` / `selfagent_del_v1` / `selfagent_rep_fp` / `selfagent_sync_v1` / `selfagent_dirty_v1`（待推实体与快照）/ `selfagent_sync_seed_v1`（首次迁移标志）

## 自动同步（以微信 openid 归属）

身份完全由云开发承担：客户端不传 openid，云函数用 `cloud.getWXContext()` 取可信 OPENID，`events` / `snapshots` / `sync_state` 三个集合权限设为「仅创建者可读写」，记录天然按 `_openid` 隔离。

- **写入即标脏**：`libs/store` 的 `write()` 触发 `onWrite` 钩子，训练记录/日志/收藏/设置分别标记 `train:<uid>`、`logs:<id>`、`snap:trainmeta|settings|profile`，存进 `selfagent_dirty_v1`。
- **自动上行**：`libs/sync` 的 `schedule()` 做 1.5s 防抖，`boot()` 按脏列表拼 `states` 只推改动过的实体，成功后 `clearDirty(sent)`。
- **分包上行（重要）**：`wx.cloud.callFunction` 单次入参上限约 100KB，且按 **UTF-8 字节** 算（中文 1 字≈3 字节）。因此上行按实体切包，单包 ≤45KB 字节，并且每包不超过 5 条日志 / 40 条记录；多包逐包发、逐包清脏。实测：90KB 字节通、120KB 字节失败；一包塞 11 条长笔记会卡死（`Failed to fetch`）。批量导入 MD 后务必走这条路，否则整包超限静默失败。
- **下行分批**：`syncPull` 同样受返回体积限制，`pull()` 按 `logs` / `train` / `profile+settings` / `trainmeta` 分四次拉，避免一次返回过大。
- **自动下行**：`onLaunch`（首次）与 `onShow`（间隔 ≥45s）调 `app.autoSync()`，先 `pull` 按水位拉增量，再用 `mergeByKey` 做逐实体 LWW：实体比 `ts`，`trainmeta` 比客户端编辑时间 `metaTs`（本地一改就立刻记账，避免被更旧的云端快照覆盖）。
- **首次迁移**：升级前的老数据没有 `ts`，首次 `boot` 时 `seedLegacy()` 补时间戳并全部标脏推一次，之后写 `selfagent_sync_seed_v1`，避免换设备丢历史。
- **删除**：删除前写墓碑，云端按墓碑移除实体，避免下次同步把删掉的数据拉回来。
- 设置页「数据 → 自动同步（按微信身份）」可关闭自动链路，保留「上传本机 / 拉取合并」手动按钮。


## 数据模型

- `train = { records:[{date,exId,name,part,sets,reps,weight,dur,uid,groups:[{no,reps,weight,done,warmup,rpe,sec}]}], cardio:[{uid,date,modal,min,sec,done}], custom, favs, renames }`
- `logs = [{id,kind:'train'|'note',type,tags,content,time,date,source:'auto'|'manual',meta:{items,volume}}]`，训练日志 id 固定 `autotr-<date>`，同日唯一
- 墓碑 `selfagent_del_v1 = [{k:'train'|'cardio'|'log', u:uid, t:ts}]`

## 部署步骤

1. **导入工程**：微信开发者工具 → 导入 `miniapp/` 目录（appid 已填）。
2. **开通云开发**：工具顶部「云开发」→ 创建/打开环境 `cloud1-d2g3r78mffbe3ca36`。
3. **建集合**（云开发控制台 → 数据库）：`events`、`snapshots`、`sync_state` 权限「仅创建者可读写」；`media_map` 权限「所有用户可读」；`subscriptions` 权限「仅创建者可读写」。（`gifMigrate`/`notify` 首次运行也会尝试自动建集合，但权限仍需在控制台手动设为上述值）
4. **部署云函数**：`cloudfunctions/` 下五个目录分别右键 →「上传并部署：云端安装依赖」。
   - `notify` 目录含 `config.json`：上传时勾选「上传触发器」，否则 20:00 定时不生效。
5. **aiProxy 环境变量**（云开发控制台 → 云函数 → aiProxy → 配置）：
   - `AI_BASE_URL`：OpenAI 兼容网关根地址（例如 `https://api.deepseek.com`，代码会自动补 `/chat/completions`）
   - `AI_API_KEY`：服务端 Key
   - `AI_MODEL`：默认模型名（如 `deepseek-chat`）
   不配也能跑前 5 个页面，只有「问 AI」会返回 `AI_BASE_URL / AI_API_KEY 未配置`。
6. **真机/模拟器**：编译后直接跑——启动即按 openid 拉云端数据（换设备/清缓存后自动恢复），改数据后 1.5s 自动上行；「我的 → 上传本机 / 拉取合并」保留为手动兜底。
7. **迁移动作缩略图**（可选，影响动作库图卡是否有图）：部署 `gifMigrate` 后在控制台「云函数 → 测试」逐批调用：
   ```json
   {"ids": ["0001","0002","0003"]}
   ```
   返回 `{ok,migrated,failed,total}`；5,632 个 id 建议每批 40 个，失败项重试。未迁移时动作库显示名称首字占位，不影响选用。
8. **订阅消息模板关键词对齐**：模板 id `whCghbXJjZbMzZACF7k5lhLSPynVFAUPzFvf7gXrWqM`，`notify` 默认字段映射为 `thing1` / `time2` / `thing2` / `time3`。若公众平台模板详情里的关键词不同，二选一：
   - 在 `notify` 云函数环境变量配 `SUB_KEYS`，值为 JSON，例如 `{"title":"thing1","time":"time2","tip":"thing3"}`；
   - 或直接改 `cloudfunctions/notify/index.js` 的 `KEY_MAP` 后重新部署。
   发送失败时云函数返回 `failed[]`，错误码 `47003` 即关键词不匹配。
9. **上传体验版**：工具右上「上传」→ 微信公众平台设为体验版。

## 静态校验（本轮已执行）

- 全部 `.js` `node --check` 通过；全部 `.json` `json.load` 通过。
- 用 `wx` 桩离线跑通：页面 `onLoad/onShow` 无异常；点组打卡、编辑器保存/删除、有氧保存、快记落库、日志删除、分析统计、词库搜索/筛选均返回预期结果。
- `syncPush` / `syncPull` 用内存版 `wx-server-sdk` 桩跑通：推送实体、按水位增量、墓碑删除、LWW 合并、train 还原成对象结构。
- 模拟器联调（微信开发者工具 + miniprogram-automator，端口 9420）：五页 `onShow` 无报警、无 console error；快记落库、新增有氧、编辑器事件返回结构正确。
- 云函数真机链路：`syncPush` 返回 `{ok:true,pushed:[logs,train,profile,settings]}`，`syncPull` 回读到 2 条日志（含 `autotr-<date>` 训练卡）与 1 条有氧；`aiProxy` 返回真实回答文本。
- 三功能模拟器实测（端口 9420 automation）：动作库 5,632 条、部位筛选（`胸` 40 条）、加载更多 40→80、搜索「卧推」、★收藏写入 `train.favs`；专注模式 `ready→work→rest(59s)→finish`，3 组打满 `volume=1800`，落库 `groups` 三组 `done:true`，生成 `autotr-<date>` 训练日志；计划页 7 根周柱、天数/组数保存、AI 计划按钮可用。
- 云函数桩测：`notify bind/send/status/unbind` 与 `gifMigrate`（写入 `media_map`）跑通。
- 自动同步（本轮）：
  - 离线桩测六项全过：只推脏实体（4 条写入 → 4 个事件）、改 1 条只 +1 事件、云端更旧不覆盖本地、墓碑丢弃云端实体、`trainmeta` 远端更新则覆盖、本地更新则保留。
  - 模拟器：写一条笔记 → `dirty={logs:[id]}` → 1.5s 后脏清空 + 水位前进；清空 storage 走真实冷启动（关闭重开工程 + `cli auto`）后，4 条日志、收藏、`restUser` 全部按 openid 拉回。
  - 云函数 `syncPush` / `syncPull` 已用本机 IDE CLI 部署（`cloud functions deploy --env cloud1-d2g3r78mffbe3ca36 --names syncPush syncPull`）。
  - 批量导入 MD 后的一次实测：本机 68 条力量记录 + 4 条有氧 + 11 条长笔记（中文，约 40KB 字符 / 120KB 字节），旧版整包推送 `Failed to fetch`、`待推 83` 不动；改为 UTF-8 字节切包 + 条数上限后，72 个实体分 3 批上行，3s 内 `待推 83 → 32 → 0`。清空 storage 冷启动后按 openid 拉回 68/4/11，与云端一致。
  - 云函数 `syncPush` 内部改为分批并发写（`PAR=5`），避免批量导入时串行写超时。
  - 待验：真机与第二台设备的实际登录恢复；`mp.reLaunch` 不触发 `App.onLaunch`，冷启动必须关闭工程再开。
- 待验：`wx.requestSubscribeMessage` 只能在真实点击手势下调用（模拟器 automation 会返回 `can only be invoked by user TAP gesture`），需真机点「开启提醒」验证授权；真机扫码与异地拉取同理。

## 还没做（下一步）

- 动作库动图（GIF）：当前只用静态缩略图（`media_map` → 云存储 webp），动图需另外转存并逐张授权，未做。
- 订阅消息实际推送：模板关键词需按上文第 8 步对齐后，用 `notify` 的 `send` 实测一次。
- 图表：目前用 WXML 柱条/进度条 + canvas 三环，`echarts-for-weixin` 未引入（可选）。
- 分包：主包约 548KB（含 244KB 词库），未分包，后续动作数据增多时再拆。

## 有氧计组方式（timer / sets）

- `train.cardio[]` 新增 `mode`：`'timer'`（按时长，旧数据默认）| `'sets'`（按组，与力量同构）。`sets` 型用 `groups:[{no,reps,weight,done,rpe}]`，`weight:0` 即自重；`timer` 型沿用 `min/dur/sec`。
- 动作库映射：`p:'有氧'` 或 `t:'心肺'` 的动作在训练页点＋ → 打开动作详情浮层（`ex-sheet`），不再落力量表单。默认方式按动作名预选：跳绳/波比/登山跑/开合跳/冲刺等 → `sets`；椭圆机/跑步/爬坡 → `timer`，详情页可随时改。
- 详情浮层（`components/ex-sheet`）：标题旁「有氧」琥珀徽章 +「⏱ 计时 / 🔢 计组」分段控件；计时态只调时长，计组态调组/次/kg（0 显示“自重”）；底部「保存方式并加入今日」。已有记录改方式时，若换向会清空已记录数据，先弹确认（“将清除已记录的 X 组/分钟”）。
- 今日列表：`timer` 行右侧显示 `20′`；`sets` 行显示完成组点列与 `x/y`，展开后逐组点打卡（`actions.toggleCardioGroup`）。
- 专注模式：`sets` 型直接进力量卡流程（组行、打勾、RPE、休息），`strip chip` 加琥珀描边 +「有氧」；`timer` 型仍走分幕计时屏。
- 引擎/统计：`engine.cdDayItems` 产出 `mode/groups/doneN/totalN`；`summarize` 把 sets 型计入组数与容量（自重 0kg），`cardioMin` 只累计 timer 型；`dayStat` 新增 `cardioSets`，连续天数与“今天有没有练”都能被纯 sets 有氧触发。
- 徽章统一规格：`#E8A93D` 文字 + 10% 琥珀底、圆角 8rpx、22rpx 字号（深色专注页用 14% 底），出现在今日列表、图卡左上角、记录分段、历史/日志行、专注 strip chip 与动作标题旁。

### 本轮模拟器实测（2026-11-24，端口 9420）

- 引擎纯函数：sets 跳绳 `2×100` + timer 椭圆机 `20′` → `2 动作 · 1/2 组 · 有氧 跳绳 2×100、椭圆机 20′ · —`；`cardioMin=20`、`cardioSets=2`。
- 列表：sets 行 `自重 2×100` + 两粒组点（1/2 完成），timer 行右侧 `30′`；图卡左上角「有氧」徽章正常。
- 详情浮层：跳绳默认 `计组`、椭圆机默认 `计时`；分段切到计时后时长可调，保存生成 `mode:'timer', min:20, sec:1200, exId` 记录；计组保存保留已有组完成态。
- 打卡：`tapCardioGroup` 第 2 组 → `done:true`、行变 `2/2`、日志 `autotr-2026-11-24` 的 cardio 行同步 `doneN 1→2`。
- 专注模式：`uid=sets` 记录进入 `curType=strength`、`curCardio=true`、`第 2/2 组`，组行与 RPE 正常。
- 清场：测试记录用 `deleteCardio` 删除，storage 与日志 meta 无残留，墓碑 2 条随同步上传。
- 未覆盖：原生 `wx.showModal` 的“换向清空”确认只能真机手点，automation 不接管系统弹窗；计划表组件（`train-plan`）只渲染 AI 推荐动作，暂不出现有氧行。
### 三项收口（2026-11-24 晚，版本 1.0.20261124.12）

- **计组方式互转保留**：`actions.saveCardio` 不再在切方式时删 `groups`/清 `min`；两种形态数据并存，`mode` 只决定「哪个计入统计与渲染」。详情浮层切换不再弹「清除」确认，改为 toast「已切换，原数据保留」，并常驻一行「切换不清空：时长与组数各自保留，可随时切回」。
- **距离字段**：`train.cardio[].dist`（km，0 = 不记）。详情浮层计组态新增「距离」步进器（±0.5，0–100，可手输）；引擎 `cdDayItems` 透传 `dist`，`dayContent` / `summaryText` / 今日列表 / 记录页 / 计划参数列都按 `… · 0.5km` 补位；专注模式保存与计时保存都会带上 `dist`，未传时沿用旧值。
- **计划表有氧行**：`libs/cardio.js` 抽出公共口径（`isCardioEx` / `defaultCardioMode` / `cardioLine`），`recommend` 的有氧推荐按动作语义给 `mode`（跳绳/波比类 → 3×30 计组，跑步/椭圆类 → 20′ 计时）。计划卡条目行名称右侧加琥珀「有氧」徽章，右侧参数列为 `20′` / `3×30`；「加入今日训练」按 mode 分别落 `cardio[]`（计组型带 groups，计时型带 min/dur），并按 `exId` 去重（同时查 records 与 cardio）。

本轮实测（模拟器 9420）：建计时记录 20′ → 浮层切计组保存 → 记录 `mode=sets / min=20 保留 / dist=0.5 / groups 3`；再切回计时保存 → `mode=timer / sec=1200 / dist=0.5 / groups 仍 3 组`；计划卡注入 `3×30` 与 `20′` 两条有氧 → 徽章与参数列正常，导入后落库 `测试跳绳计划 sets 3组`、`测试椭圆机计划 timer 20′`，今日列表行为 `自重 3×30` 与 `20 分钟`；测试记录已用 `onEditorDelete` 清场（本地真实数据保留 5 条椭圆机记录）。
## 交互体验三批次（2026-11-24，版本 1.0.20261124.13）

### 批次 1｜添加一步直达（＋ 不再弹 action sheet）

- `pages/train/index.js`：`openAddSheet()` 直接 `openLibrary()`；删除原 4 项 action sheet（从动作库添加 / 用一句话找动作 / 添加有氧 / 拍照识别）与 `addCardio()`。点 ＋ 到选中动作由 4 击降到 2 击。
- `pages/library/index.*`：`autoFocus: true`（搜索框自动聚焦）；`onLoad` 读 `?part=` 预选部位（`PARTS` 含「有氧」，空态「先记一条有氧」仍走这个入口）；顶部新增一行次级入口 `subrow`：`✏️ 用一句话添加` / `📷 拍照识别`（各自 `navigateTo` 到 `aifind` / `scan`，选完通过 `getOpenerEventChannel().emit('pick')` 回传，`navigateBack({delta:2})` 一次退回训练页）。
- 「添加有氧」菜单项删除，有氧统一走动作库（`p:'有氧'` 自动落到有氧浮层）。

### 批次 2｜力量 / 计时两种模式分开

- `libs/settings.js`：`trainCfg().groupTimer`（默认 `false`），`setTrainCfg({groupTimer})` 落 `train.groupTimer` 并 markDirty；`pages/setting` 训练设置面板新增「组内计时」开关 + 说明。
- `pages/focus`（默认关，即无组内秒表）：
  - 力量卡不再默认显示 0:00 计时环；中央改为「本组次数 / 重量 · 第 n/N 组」的轻量盘（`.stage.lite` 336rpx）。
  - 主按钮 = 「完成第 n 组」，点一下即记一组（`doneCurrent`）；组行也可直接点打勾（`tapRow`，当前组高亮 `.row.cur`）。
  - 记完自动进组间休息：卡内画倒计时环（`#rings` canvas + `.rings`，`restPct` 逐秒重绘）+ 文案「第 n 组完成 · 休息 X″，结束做第 n+1 组」；倒计时归零或点「跳过休息」→ 震一下并回到 ready；最后一组完成进 between。
  - 组间休息秒数沿用 `settings.restFor`（大肌群 150 / 孤立 60 / 默认 90，用户自填覆盖）。
  - 打开「组内计时」后恢复原流程：开始 → 计时 → 完成，`sec` 落库（`rows` 显示本组用时）。
  - `draw()` 从「三环空转」改为只画休息倒计时环；canvas 惰性初始化（力量卡未挂载时 onReady 查不到节点，`draw()` 会重试）。
- 计时型（有氧 timer）与 sets 型有氧流程不变。

### 批次 3｜多动作导航与文案闭环

- 顶部 chips 右端新增「☰ 清单」按钮：底部 sheet 列出全部动作（序号 + 名称 + `有氧` 徽章 + 状态 ✓已完成/进行中/未开始），点击 1 击跳转（`jumpTo`）；chips 本身也可点。
- 进度信息双口径：`0/13 动作` + `x/37 组 y%`（`setsDoneAll / setsTotalAll`，按组统计），清单 sheet 头同样显示组进度。
- 文案：训练页悬浮条副标题「逐组计时」→「逐组记录」。
- 计划卡「加入今日训练」：不再只 toast，改为 `wx.showModal`「已加入 · 新增 N 个动作，现在开始专注训练？」→ 确认直接 `navigateTo('/pages/focus/index?date=…')`，完成计划→专注的最后一跳。

### 本轮模拟器实测（端口 9420）

- ＋ → 直接 `pages/library/index`，`autoFocus=true`；空态「有氧」入口进来 `part=有氧`；`subrow` 两个次级 chip 正常渲染。
- 专注页默认 `setTimer=false`：`hint=点「完成第 1 组」，或直接点组行打勾`；`tapRow(0)` → `stage=rest / restTotal=90 / rows[0].done=true`；`skipRest` → `ready` 且 hint 指向第 2 组；13 动作 chips + ☰ + 清单 13 行可滚动；`jumpTo(3)` → `curName=椭圆机`（有氧）且 sheet 关闭。
- 设置页开关：`toggleGroupTimer(true)` → `train.groupTimer=true`（storage 同步）；再进专注页 `setTimer=true`、`start` → `work`、`mmss` 走秒、`finishSet` → `rest 59/60` 且该组 `sec` 落库；测完关回 `false`。
- 未覆盖：`wx.showModal`（计划导入后的「开始训练」）automation 不接管，需真机点；休息环的音效未做（小程序无提示音 API，用 `wx.vibrateShort` 代替）。

### 修复（2026-11-24，版本 1.0.20261124.14）

- **有氧行 ⋯ 无响应**：`openRowMenu` 原先只在 `train.records`（力量）里找记录，有氧在 `train.cardio` 里 → 直接 null 返回、点了等于没点。现在先查力量再查有氧，有氧菜单单独一套（查看动作详情 / 收藏 / 删除，走 `actions.deleteCardio`），不再出现「杠铃片 / 默认休息」这类力量专属项。
- **有氧图卡无图 + 无「详情」**：`buildView` 里 `exId` 直接取 `it.exId || ''`，而自助加的有氧、计划导入部分记录没存 `exId`；图卡 `详情` 的显隐条件是 `!isCardio || exId`，于是整块入口消失。现在有氧按 `exId → 名称回查 matchByName` 兜底解析 `exId`（只用于展示，不改记录），`withImg` 不再跳过有氧、`fillGrid` 预取 id 也包含有氧，图卡能取到缩略图；占位文字从「有氧」改为动作名。
- 实测：造一条没有 `exId` 的「跳绳 1′」记录 → 列表项 `exId=2612`；图卡出现 `详情 · 编辑`；点详情浮层 `exSheetId=2612`、标题「跳绳」；椭圆机有氧 `img=thumb/2141.webp` 正常；测试记录已删，storage 无残留。

## 统计聚焦 + 「进步」tab + AI 赋能（2026-11-24，版本 1.0.20261124.15）

### 一、记录 tab 变成「训练统计页」

- 砍掉：`精力 & 情绪`、`记录时钟` 热力、`类型与标签`。精力/情绪折线仍在分析页概览，作息热力随 `作息` tab 一并下线。
- KPI 改成训练口径：`训练组数 / 训练次数 / 容量 kg / 有氧分钟`，每格带同长度上一时间窗的环比（`stats.rangeStats().kpis`，`trainedDays` 按有记录且有效容量的日期去重）。
- 新增四张卡（全部来自 `train.records / train.cardio` 的现成聚合，`libs/stats.js`）：
  - `部位分布`：**按组数占比**（自重动作没有容量，用容量会把自重部位算成 0，所以口径改成组数，右列同时显示 `N 组 · P%`），占比 <10% 且部位 ≥3 时高亮黄标。
  - `进步榜`：`progressTop()` 按动作取区间内首末训练日的最佳 e1RM，算涨幅，倒序取 Top5，显示 `50→57.5kg ↑12%`；同一动作不足两个训练日不进榜。
  - `有氧构成`：`cardioComp()` + `cardio.js` 新增 `CARDIO_MODALS / modalOf()`，把有氧动作名归一成跑步/椭圆机/单车/划船/游泳/跳绳/爬楼/走路，按分钟算占比。
  - `PR 记录`：`prInRange()` 只在区间内最佳 e1RM **超过区间前历史最佳**时才算 PR（首次记录不算），显示计数 + 前 3 条，点卡跳 `pages/pr/index`。
- 模拟器实测（30 天）：`489 组 / 18 次 / 148,890 kg / 30′`；部位 `背 306 组 63% · 上腿 6% 黄标`；进步榜 `15.9→22.7kg ↑53%`；有氧 `椭圆机 30′ 100%`；PR `10 个`。

### 二、`作息` tab → `进步` tab（`libs/progress.js`）

- 部位均衡雷达：六边形 canvas（`drawRadar`），六轴为 胸/背/肩/臂/核心/腿，值取近 7 天**组数**。
- 进步曲线：`topCurves()` 取区间内 Top5 动作的 e1RM 曲线（按涨幅倒序），chips 切换，`drawCurve` 自绘折线 + 首末日期 + 最新 e1RM。
- 恢复状态：`recoveryOf()` 按部位最近一次训练距今小时数，`<24h 刚练完(红) / <48h 恢复中(黄) / ≥48h 可练(绿) / 没练过(灰)`。
- PR 时间线：近 30 天 `prInRange()` 的涨幅 PR，卡片流显示 `e1RM +N%`，首次记录标注「首次记录」。
- 三条 AI 洞察（规则出数字，AI 只写一句话，见下）：推拉比（按组数的 推:拉）、趋势预测（e1RM 线性回归 + R² 置信度 + 2.5kg 阶梯目标周数）、明日建议（近 7 天组数最低 + 已恢复的部位）。
- 实测：雷达 背 73 组/腿 28 组；预测「按当前趋势，12.5kg 约 2 周后达成（每周 +1.2kg）」R²=0.82 `●●●`；恢复条 `胸 13 天前·可练 / 背 24h·恢复中 / 肩·刚练完`；AI 三句全部返回（`推拉比0.4失衡…` / `力量稳步增长…` / `建议练胸…`）。

### 三、AI 赋能（统一入口 `libs/aipolish.js`）

- `polish(key, facts, instr, opts)`：规则数字进 prompt，只让模型写一句话；缓存键 = `hash(key + facts + instr)`，24h 内同 facts 不重调（storage `selfagent_ai_polish_v1`，最多 40 条）；`生成失败` 一律回落到规则文案，UI 不会空着。
- 开关：`polish.setPureData(true)` = 纯数据模式，关闭全站 AI 扩写（进度 tab 右上角胶囊、设置页「动作与 AI → 纯数据模式」两处入口，同一份 `settings.ai.pureData`）。
- 接入的触点：
  1. 洞察卡 AI 扩写（概览前 3 张卡，`aiInsights`）；
  2. 问 AI 多轮：`chat` 消息数组承载上下文，最近 6 轮带进 messages，sheet 内左右气泡 + 「清空对话」；
  3. 推拉比 / 4. 趋势预测（进步 tab）；
  5. 训练小结 AI 复盘（专注页 `aiReview`，两句以内，失败回落规则句）；
  6. AI 周报（`pages/report`，三段【训练量】【均衡】【进步】，解析后渲染，失败回落原规则结论）；
  7. AI 计划每个动作一句推荐理由（`recommend.genPlan()` 新增 `why`，计划卡渲染 `✦` 行）；
  8. 拍照识别 / AI 找动作 / 查重保持。

### 四、控件收尾

- 悬浮球随手记：精力/情绪从数字圆点换成 `slider` + 五档文案（很低/偏低/一般/不错/充沛、很糟/低落/一般/不错/很好），滑动即出档位词；记录页快记本来就是滑条，两处口径一致。
- 删除入口：记录卡 ⋯ / 训练行 ⋯ 均已是菜单（训练行走编辑浮层里的删除），无裸露删除。
- AI 视觉签名：`✦` 统一加在「问 AI」胶囊、AI 洞察行、计划理由行、AI 解读理由按钮、AI 周报、拍照识别 / AI 找动作入口；计划卡徽章 `★ AI 推荐` 改 `✦ AI 推荐`。

## Agent 决策参与者：DecisionCard + 四个决策时刻 + L3 授权（2026-11-24，版本 1.0.20261124.16）

### 一、设计：L1 看 → L2 帮选 → L3 代办

| 级 | 模式 | 用户感受 | 本轮实现 |
| --- | --- | --- | --- |
| L1 | 看（建议） | AI 告诉我状态 | 已有：洞察流 / AI 扩写 / AI 复盘 |
| L2 | 帮选（决策辅助） | AI 把选项和理由摆好，点一下就能执行 | 本轮主体：DecisionCard × 4 个决策时刻 |
| L3 | 代办（代理执行） | AI 直接改好，不满意再撤 | 设置页开关（默认关）+ AI 操作日志可撤销 |

### 二、一个组件 + 一个注册表 + 一条管道

- `components/decision/`：统一 DecisionCard。props `title / question / reason / options / evidence / note / meta`；选项卡横排、推荐项带「推荐」角标与绿色描边；「看数据依据」可展开 `evidence`；左侧 4rpx 渐变竖条 + `✦` 作为全站 AI 决策视觉签名。点选触发 `pick` 事件并带 `{key, index, option}`。
- **决策卡的按钮不是文字回复，是操作**：每个 option 的 `key` 绑定一个可执行函数（生成计划 / 预填有氧 / 标记休息 / 套用排布 / 修平台期）。
- `libs/decision.js` 末尾 `DECISION_POINTS` 注册表：

```js
DECISION_POINTS = [
  { key: 'daily',   when: 'appOpen + 数据指纹变化', ctx: 恢复+容量+周目标 },
  { key: 'rest',    when: '组间倒计时开始',        ctx: 上一组表现+历史 },
  { key: 'post',    when: '小结卡渲染',            ctx: 本次全量 },
  { key: 'weekly',  when: '周日 or 周目标达成',    ctx: 均衡度+平台期 },
  { key: 'plateau', when: 'e1RM 停滞检测命中',     ctx: 该动作历史 },
]
```

- 管道：`decision.*` 用规则算决策（零 token）→ `aipolish.polish(key, facts, instr)` 只负责把数字说成人话（带 facts 指纹缓存 24h，失败回落规则文案）→ 用户点执行。AI 含量高、token 消耗低。

### 三、四个决策时刻

**时刻 1｜打开 App：「今天练不练？练什么？」（首页 orb 下方第一张卡）**

- 三种状态（`decision.daily`）：今天已开练 → 单选项「继续今天」；今天是休息日 → 「改成轻有氧 30′（推荐）/ 取消休息」；未开练 → 「部位日计划（推荐）/ 轻有氧 30′ / 休息日」。
- 理由与依据全部是数字：恢复间隔、近 7 天组数、周目标进度（`evidence` 展开可见）。
- 执行：`applyPartPlan` 复用 `recommend.recommendFor` + `actions.saveStrength/saveCardio` 写入今日 → toast → 跳计划页；`applyLightCardio` 用历史最常用有氧 `cardio.modalOf` 预填 30′ → 跳专注页；`markRest` 写休息日 → orb 变「今天休息 ✓ / 休息日 · 连续 N 天不断档」。
- **休息日不 break streak**：`decision.streak()` 把休息日算「不断档但不加天数」，首页已从 `engine.streakDays` 切到这个函数。

**时刻 2｜组间休息：「这组该加重量吗？」**

- 规则 `decision.restAdvice({last, plan, planSec})`：自重 → 次数 +1；RPE ≥ 9 或次数差 ≥ 2 → 降一档（默认 2.5kg）；用时超本动作均值 30% → 维持；否则 → +step。
- 组间屏在倒计时环下方加一行 `✦` 决策行 + 大按钮「下一组 27.5kg × 12 开始」；`applyAdvice` 把建议重量写进下一组再 `skipRest`——建议即操作。
- AI 只补一句话，且**强过滤**：含任何阿拉伯/中文数字、公斤、千克一律丢弃；方向与规则相反（规则建议加重却说「维持/别加/降/减/巩固」，或规则建议降却说「加重」）也丢弃，回落规则文案。

**时刻 3｜练完：小结里的两个决策输出**

- `decision.postSession(items, stat, cardioMin)` → `{next, tomorrow, goal}`：`✦ 下次 器械三头肌伸展 25 → 27.5kg`、`✦ 明天 胸日（周目标已到 99%）`。
- 周目标口径：`max(settings.plan 目标, 近 4 周周均组数)`，避免旧目标偏小导致「107/36 组」这种虚数。
- 「按此排明天 ›」带 `?part=` 跳计划页 → 与时刻 1 的明日简报形成闭环。

**时刻 4｜周日 / 周目标达成：「下周怎么排？」**

- `decision.weekly(train)` 输出 7 格 `拉·腿·推·休·核心·腿·休` + `planText` + `basis`（如「本周 0 组推 / 73 组拉 / 28 组腿；腰腹缺口最大」），带 `[按此生成 7 天计划]` 与 `[我自己排]`。
- `applyWeekly` 写 `settings.plan.text/days` 并记日志；`dismissWeekly` 写 `weeklyDone=今天` 关卡，不再反复打扰。
- `decision.plateau(train)`：近 28 天 e1RM 两段窗口变化 < 2% 的动作（最多 3 个）→ 加量 / 换动作 / deload 三选一，各带理由，`fixPlateau` 写进 `settings.plan.strategy[name]`。

### 四、L3 授权与 AI 操作日志

- 设置页「动作与 AI → 允许 AI 直接调整计划」开关（默认关，`settings.ai.agentAuto`）。
- 开启后：时刻 1 / 时刻 4 的建议自动应用一次（`autoDone` 按日期去重，不重复执行），并把改动写进 AI 操作日志。
- 日志（`selfagent_ai_ops_v1`，最多 60 条）在设置页可逐条查看与**撤销**：`rest` 加/删休息日、`items` 按 uid 删除刚写入的力量/有氧记录、`plan` 回滚 `settings.plan` 字段；也支持一键清空。
- 未开启时全部走 L2 一键确认，不产生任何自动写入。

### 五、实测（模拟器 9420，冷启动三轮）

- 首页：`decision = {key:"daily", done:true, question:"今天已经开练了", reason:"5/36 组、1500 kg…", options:[继续今天]}`；休息日态 orb 文案「今天休息 ✓ / 休息日 · 连续 N 天不断档」。
- 专注页：完成一组 → `stage=rest restLeft≈83`、`TIP=上一组做满 12 次，状态够，建议下一组 27.5kg 试一次。`、`LABEL=下一组 27.5kg × 12 开始 advW=27.5`；AI 侧曾在旧规则下返回「尝试加重至二十六点五公斤…」（数字错）与「完成度低，先维持重量巩固动作，别急着加重。」（与规则相反），两处均被新过滤丢弃并回落规则文案——过滤已复测通过。
- 收工页：`FIN_NEXT=器械三头肌伸展 25→27.5`、`FIN_TOM=明天排「胸」最合理：近 7 天训练量最低，且已恢复 13 天`、`FIN_GOAL={pct:99, weekSets:109, goalSets:110}`（修正后不再出现 107/36）。
- 计划页：`weekly.text=拉·腿·推·休·核心·腿·休`、`planText=周一 拉；周二 腿；周三 推；周五 核心；周六 腿；其余休息`；`plateau=[]`（当前数据未命中）。
- 设置页：`agentAuto=false`、日志空态正常；日志写入/撤销/清空各走过一次，最终 `OPS=0`。
- 测试写入的组点已全部还原，最终基线 `哑铃凳臂屈伸 110 / 器械三头肌伸展 000 / 绳索三头肌下压杠 000 / 杠铃弯举 111`、`ORB 5/36 组`。

### 六、上传路径坑（重要）

- `proj/project.config.json` 的 `miniprogramRoot` 是 `miniprogram/`，`upload.js` 打的是 `proj/miniprogram/`；而 `proj/` 根目录下还残留一份旧副本 `proj/pages`、`proj/libs`。
- 所以文件先落 `proj/<相对路径>` 后，**必须再 `cp proj/<相对路径> proj/miniprogram/<相对路径>`**，否则包体大小与上一版一模一样（`1,250,849`），新代码根本没进包。
- 判据：`getCodeFiles count` 与 `__FULL__ size` 要变化（`.16` 上传时云主机出口 IP 未被白名单放行，最终包体数字待补；zip buffer 已涨到 761,921）。

### 七、未做 / 待确认

- 「按此生成 7 天计划」目前只写 `settings.plan.text/days` 文本，未落成 7 天日历条目（结构化为每日 plan 未确认口径）。
- 周目标口径已改为 `max(计划目标, 近 4 周周均)`，待用户确认。
- automator 处理不了原生 `wx.showModal / showActionSheet`（会挂住），相关确认交互仍需真机点。

## 交互修补：智能单按钮 + 随手记手感 + 信号条决策入口（2026-11-24）

### 一、专注页主按钮：静默失效改成智能单按钮

- 原 `finishSet()` 第一行 `if (stage !== 'work') return;`，按钮在 ready/rest 等状态点了等于没点（不勾、不报错、不提示）。
- 现在统一入口 `primaryTap()`，按 `stage` 分派且**任何状态都有反馈**：
  - `ready` + 组内计时开 → `beginSet`；`ready` + 计时关 → `doneCurrent`（点一下即记一组）；
  - `work` → `finishSet`（去掉确认弹窗，一步完成；长按同样直记）；
  - `rest` → `applyAdvice`（套用建议重量进下一组）；`between` → `nextItem`；`cardio` → `finishCardio`。
- `finishSet()` 的兜底：`ready` 直接记一组，其余 toast「先跳过休息，再记本组 / 本组还没开始」，不再静默返回。
- 实测：`READY 器械三头肌伸展 ready setTimer=false 1/3` → `primaryTap` → `rest restLeft=89`、`tip=上一组做满 12 次，状态够，建议下一组 27.5kg 试一次。` → 再点 → `ready weight=27.5 setNo=2`。

### 二、随手记弹层三处手感（`components/float-orb`）

- **档位高亮**：`.sl-i.on` 之前只写了情绪（`.sl-i.m.on`），精力选中永远不变色；补上 `.sl-i.on`（绿色加粗 22rpx），选中项跟随滑条高亮。
- **大数字**：右侧值从裸档位词改成「4 分 · 不错」，未打分时仍显示「滑动打分」。
- **识别预览**：`libs/mdimport.js` 导出 `parseStrength`；输入 debounce 500ms 后规则解析，弹层出现 `✦ 将被识别为 训练 · 卧推 · 60kg · 5 组 × 5 次` / `有氧 · 跑步 · 5km` / `记录 · 附精力/情绪`，不调 AI、零 token。
- **关闭手势**：右上「关闭」文字换成 `✕`，顶部加拖拽条，弹层支持下滑 >70px 关闭（`sheetDy` 跟手位移）。

### 三、信号条 → 决策入口（首页）

- `buildSignals` 里「胸 已经 13 天没练」这类信号现在带 `act:'part'` + 部位 + 天数。
- 点它直接生成同位置决策卡：`补练 胸 吗？` + `[胸日计划（推荐）] [轻有氧 30′] [先不补]`，理由「胸 已 13 天没练，点下面第一条会追加到今天（已练的不重复加）」；选项沿用 `applyDaily` 的 plan/cardio/rest 分支，点「胸日计划」走 `applyPartPlan` 生成并加入今日（按 `exId` 去重）。
- 卡片挂进 `#dailyCard` 容器，点击后 `pageScrollTo` 滚到卡上。
- 实测：`SIG_DEC {"q":"补练 胸 吗？","reason":"胸 已 13 天没练，点下面第一条会追加到今天（已练的不重复加）。","opts":["胸日计划","轻有氧 30′","先不补"]}`。

### 四、折叠行单行化（训练页）

- `ex-head` 里「名称行 + 参数行」两行改为：折叠态名称与参数同一行（`.line.one`，省略号截断），展开态才分两行。
- 实测 `TRAIN_LIST 13`：`杠铃弯举|25kg 3×12 · 3″`、`哑铃凳臂屈伸|25kg 3×12`、`椭圆机|30 分钟`；截图行高明显压缩。

### 五、验证与还原

- 冷启动 3 次（改 lib/组件/page 方法都必须整轮冷启动，热更新不生效）；自动化脚本 `h1/h2/i2/i3/i5/i7`。
- 期间完成 1 组器械三头肌伸展做验证，已用 `tapDot` 反向还原，最终 `器械三头肌伸展 000 / 哑铃凳 110 / 杠铃弯举 111 / ORB 5/36 组`。
- `wx.pageScrollTo({selector})` 与自定义组件内部节点（`.ta/.mopt`）在 automator 下取不到，属工具限制；弹层靠 `home.openQuickNote()`（`selectComponent('#orb').openNote()`）验证渲染。

## 体验版 1.0.29：拍照识别详情补短片 / 图片

### 一、媒体区

- 弹窗在标题与部位标签之间加 `.dmedia`（340rpx 高、16rpx 圆角），三层回落：短片 → 静态图 → 首字占位。
- 短片：`libs/clip-index.js` 命中即播 `media/clip/<4位id>.mp4`；`muted loop autoplay playsinline`、`controls=false`、隐藏中心播放键，效果等同动图（一直循环、无控件）。
- 索引未命中：调 `gifMigrate` `{action:'batchgen',clip:true,ids:[id],budget:12000}` 后台补产一次（`clipPending` 去重），成功写入 `clip.ids` 再播。
- 短片 `binderror`：cloud:// 先换临时 https 重试一次（`clipTempTried`），仍失败才撤视频。

### 二、图片回落

| 顺序 | 来源 | 处理 |
|---|---|---|
| 1 | 动作条目 `img` / `fileID` | 非 cloud:// 直接用 |
| 2 | 同上但为 cloud:// | `cloudurl.resolve` 换临时 https |
| 3 | 条目没有图 | `gifMigrate` `{action:'map',ids:[id]}` 补一张，再 resolve |
| 4 | 仍无 | `.ph` 占位，显示动作名首字 |

### 三、验证（模拟器）

| # | 用例 | 结果 |
|---|---|---|
| 1 | 打开 `0001 3/4仰卧起坐` | `clipID` = `.../media/clip/0001.mp4` 临时 https，媒体区循环播放，无进度条 |
| 2 | 手动触发 `onClipErr` | `clipID` 清空、`fileID` 有值，回落静态解剖图 |
| 3 | 打开 `0002 45度侧屈` | 索引命中，同样出短片 |
| 4 | 关闭弹窗 | 视频 stop，无残留 |

截图：`t9/s1-scan-clip.png`、`t9/s2-scan-fallback.png`、`t9/s3-scan-noclip.png`。

## 体验版 1.0.28：休息态环手势 + 建议轮播，去「下一组」按钮

### 一、休息态三态（与 work 同语言）

| 态 | 单击 | 长按 650ms | 弧色 | 环内文案 |
|---|---|---|---|---|
| rest（倒计时中） | 暂停 | 提前结束休息 | 绿 | 点击暂停 · 长按结束休息 |
| rest 暂停 | 继续 | 提前结束休息 | 绿 | 已暂停 · 点击继续 |
| 走完 | — | — | — | 自动结束 → 下一组 ready |

单击不承担「跳过休息」：休息中碰环多是擦汗/扶手机，跳过该有意图——所以放长按。倒计时走完即自动结束，仍是零操作主路径。
实现：`_restRemain` 存暂停冻结的剩余毫秒，暂停时 `_restEnd=0`、继续时 `_restEnd=now+remain`；`tick` 只在 `_restEnd` 有效时递减。

### 二、建议轮播卡（决策不进按钮）

- 3–4 张：① 建议下一组 `用 32.5kg`（只预填，不打断休息）② 节奏「休息 90″，上次间隔 3″」+`休息 +15s` ③ 流程预告「还剩 2 组，之后是哑铃飞鸟」④ RPE≥9 加一条恢复提醒。
- 3.5s 自动轮播，左右滑（>30px）切换，指示点同步；卡内链接 `catchtap` 执行，`+15s` 走 `extendRest`（暂停时加在 remain 上）。
- AI 一句话（`polish`）作为第①张的副行，带数字/方向冲突的仍丢弃，数字以规则为准。

### 三、布局与口径

- 删「下一组 32.5kg×12 开始」全宽按钮；休息区 = 环 + 轮播卡 + 组行，省约 72px。
- 环内 meta 换成「下组 32.5kg×12 · 8/12」，下组重量不再依赖按钮传达。
- 进休息时 `hideToast()`，避免 PR toast 与环内文案叠字。

### 四、验证

| # | 用例 | 结果 |
|---|---|---|
| 1 | rest 单击 → 暂停 | `restLeft 88` 1.5s 后仍 88；继续后 87 |
| 2 | 长按 720ms → 提前结束 | `ready 0:00`、`setNo 2`、`weight 32.5` 保留 |
| 3 | 轮播自动切 | `restIdx 1→0`（4s 后）；点 `用 32.5kg` 后 meta/组行同步 |
| 4 | `休息 +15s` | `restTotal 90→105` |
| 5 | 走完自动结束 | `tick` left≤0 → `skipRest(true)` → ready |

截图：`t9/r4-rest-final.png`、`t9/r5-rest-paused-final.png`、`t9/r3-ready-next.png`。

## 体验版 1.0.27：长按完成回归 + 去大按钮

### 一、手势层（绕开 movable 吞长按）

`.fmc-in`（环内圆盘）自建状态机，不用合成 `longpress`：

| 事件 | 行为 |
|---|---|
| touchstart | 记起点/时间，起蓄能，650ms 扫满一圈 |
| touchmove | 位移 >10px → 判为拖动，取消蓄能（movable 接管移动） |
| touchend | 未满 650ms → 回弹 + 环内提示「再按久一点」；已满 → 已在阈值处执行，松手忽略 |

### 二、分态语义：颜色即说明书

| 态 | 单击 | 长按 650ms | 蓄能弧 | 环内文案 |
|---|---|---|---|---|
| ready | 开始 | — | — | 点击开始 |
| work | 暂停 | 完成本组 | 绿 `#3DDCBF` | 点击暂停 · 长按完成 |
| paused | 继续 | 重置本组 | 琥珀 `#E8A93D` | 点击继续 · 长按重置 |

- 误触防护：本组 <3s 长按，弧转琥珀 + 「刚开始就要完成？」，防「点开始的手没松开被当完成」。
- 阈值处即执行（不依赖松手时刻），执行后 `touchend` 不再触发单击语义。

### 三、去按钮边界

- 删「完成本组 · 第 N 组」大按钮（ready 的「开始第 N 组」同删）；完成 = 长按环 或 组行打勾，两条路径都在。
- 休息/组间的「跳过休息」「下一个动作」保留（无替代入口）。
- 下方只剩 steppers + RPE + 组行，环成为视觉中心；暂停/继续 toast 删除，状态只写在环内。
- 一次性 coach：`selfagent_coach_ring_v1`，气泡「点按开始 · 练完长按环完成」，点击或开始后消失。

### 四、验证（automator 直驱手势方法）

| # | 用例 | 结果 |
|---|---|---|
| 1 | ready 单击 → work | `work 0:01`，coach 消隐 |
| 2 | work 长按 700ms | 蓄能 0.81 → rest，`setsDoneAll 5/12` |
| 3 | paused 长按 → 重置 | `ready 0:00`，琥珀弧 0.50 抓图 |
| 4 | 蓄能 300ms 松手 | 弧回弹、`tip=再按久一点`、仍 work |
| 5 | <3s 长按 | 琥珀 + 「刚开始就要完成？」（本组 1s 时实测） |
| 6 | 暂停态文案 | 「点击继续 · 长按重置」accent 绿，无重叠 toast |

截图：`t9/x1-ready-coach.png`、`t9/x2-charging-green.png`、`t9/x4-too-short.png`、`t9/y6-paused-copy.png`、`t9/y7-amber.png`。

## 体验版 1.0.26：圆环三态状态机修补 + 重置下放

### 一、三个真 Bug 与修法

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| A | 进新组 / 重进页面，`mmss` 带着 1:07 直接开跑 | `prepare()` 用「上次 workStart」恢复本组，且默认进 work 自动计时 | 每组进 `ready`：`mmss=0:00`、`_workStart=0`；重进只恢复 items/idx 与整场 startAt |
| B | 暂停后继续，数字冻住 | 继续时只改 `timerPaused`，`_workStart` 仍按旧基准算，`pauseAcc` 与 interval 状态都不对 | 继续时 `_workStart = Date.now() - frozen`，清 `pauseAcc/pauseAt`，`!timer` 时重建 interval，补一次 `tick()` |
| C | 长按环完成本组没反应 | 环叠在 movable 区，原生拖拽判定吞掉长按 | 环上只留单击（开始/暂停/继续）；完成走大按钮与组行打勾 |

### 二、重置的落位

- 暂停态（用户已停下审视）环内下方出现「重置本组」小字链接——Apple 秒表 lap/reset 也在暂停时出现。
- 点击 → 绿弧蓄能 800ms（`chargePct` 0→1）→ 执行重置；蓄能期间点环 = 取消。重置后回 `ready 0:00`，点环重新开始。
- 双击重置已删除（丢数据不该靠难察觉的手势），环上不再有长按语义。

### 三、汇总口径

顶部 `动作 x/y · 组 a/b pct%` 与环内 meta 同取 `doneTotal/total`、`setsDoneAll/setsTotalAll/setsPct`，组百分比按组算（此前文字用的是动作百分比）。

### 四、验证

- 冷启动 + automator：进页面 `ready 0:00`（历史 3/12 组仍在，不串秒表）→ 点环 2 秒 → 暂停（`0:03` 冻结）→ 继续 `0:03→0:05`（Bug B 修好）→ 暂停出「重置本组」→ 蓄能 0.39/1.0 → 回 `ready 0:00` → 蓄能中途点环取消（仍 paused）→ 完成本组进 rest、`all=4/12` → 重进页面 `ready 0:00`、进度 `4/12` 保留。
- 截图：`t9/w1-ready.png`、`t9/w3-reset-link.png`、`t9/w4-charging.png`、`t9/w7-reenter.png`。

## 体验版 1.0.25：专注圆环 = 计时器本体

### 一、问题

环原来只是显示器，开始/暂停/重置/完成分散在环外四个控件里，一屏四行按钮，状态文案另起一行。计时器类 App（Apple Watch 秒表、Interval Timer、Stretch）的一致语言是「环就是按钮」。

### 二、三态一手势

| 状态 | 环 | 中央 | 单击环 | 长按环 800ms | 双击环 |
|---|---|---|---|---|---|
| ready | 暗灰轨道 + 顶部呼吸光点 | `0:00` +「点击开始」 | 开始计时 | — | — |
| running | 每秒推进 1/60 圈，满分钟白光脉冲后归零；12 个 5 分钟刻度按完成时长点亮 | `mm:ss` +「本组用时」 | 暂停 | 完成本组（白色蓄能弧长满 + 震动） | 重置本组计时 |
| paused | 弧冻结 + 环呼吸 | `已暂停 · 点击继续` | 继续 | 完成本组 | 重置 |

- 完成本组大按钮保留为主路径（12 组就要点 12 次，单击最省事）；长按环是给老手的快捷补充，双路径并存。
- 「暂停计时 / 重置本组」两个胶囊按钮与 `hint` 状态行删除，垂直空间省约 80px；控件区只剩 steppers + RPE + 完成按钮。
- 实现：`ringTap` 按 `stage` 分发（ready→`beginSet`、work→`togglePause`、双击→`resetTimer`）；`ringHoldStart` 用 50ms 定时器把 `chargePct` 推到 1 再 `finishSet`，`touchend/touchcancel` 取消；canvas 仍 `pointer-events:none`，上面盖一层等尺寸圆形 `.ring-hit` 收手势。
- 数据层零改动：`_workStart/_pauseAcc/_pauseAt` + `elapsedMs()`；暂停时 `mmss` 冻结，续跑从冻结值继续；组间休息仍走倒计时环。

### 三、验证

- IDE 冷启动 + automator：ready 渲染（`0:00`/呼吸点）→ 单击进 work → 单击 pause（`mmss` 冻住）→ 单击续跑 → 双击归零 → 长按 800ms 记组并进入 rest（组行 `✓` 带用时）→ 跨 1 分钟满圈归零。
- 截图：`t9/z8-ready-force.png`、`t9/z7-pause.png`、`t9/z10-rest.png`、`t9/z11-min1.png`。

## 体验版 1.0.24：AI 找动作 / 拍照识别改为「解析 → 全库召回 → 重排 → 反问」

### 一、旧链路的问题

旧版先正则抽部位/器械 → 本地 filter 到 200 条 → 只把排在前 20 的候选交给 AI 重排。候选已被本地规则筛掉，AI 再聪明也只在残局里挑；也不理解别名（龙门架/缆绳）、伤病限制、家里没器械这类条件。

### 二、新链路

1. **解析（AI 第一次调用）**：只输出 `{intent, part, parts, equips, names, patterns, keywords, constraints, needClarify}`，不检索。器械不猜，用户没提就留空。
2. **召回（`libs/find.js`）**：部位/器械别名展开（龙门架=绳索、史密斯=器械、上胸=上斜、夹胸=飞鸟…），全库 5632 条打分（部位+器械+名称+目标肌+动作模式），伤病词降权，取前 90 条；同部位优先常见动作，避免「猫式/摇摆」这类冷门动作霸榜。
3. **重排（AI 第二次调用）**：候选表 `id|名称|部位|器械|目标肌`，输出 `picks(id+why)` / `notFound` / `clarify`。规则允许少给、点名缺失、按语义匹配别名；id 支持补零容错。
4. **澄清**：只有选出不足 4 个时才显示反问按钮（如「健身房器械 / 只有哑铃 / 自重在家」），点击追加条件重跑。

### 三、拍照识别复用同一套

视觉模型先输出 `{scene, equipment, part, actions, keywords}`（要求必须给一个主要部位），然后：
- 画面动作名按 `ACTION_ALIAS` 直配动作库（高位下拉→下拉、龙门架夹胸→飞鸟），并用画面器械/部位过滤掉不一致版本；
- 剩余候选走同一套召回 + 重排，画面器械与部位写进重排上下文。

### 四、实测

- `我想练背但是腰不好`：7 个坐姿/卧姿护腰动作，why 均说明护腰点；「用时」无关。
- `在家练胸 只有哑铃和弹力带`：哑铃卧推/飞鸟 + 弹力带卧推/飞鸟，不混杠铃。
- `龙门架夹胸`：8 个绳索飞鸟/交叉（旧版会判「库里没有」）。
- `想练臀 家里只有弹力带`：弹力带臀桥/髋顶髋/硬拉。
- 龙门架照片：`绳索高位下拉全程幅度`、`坐姿绳索划船` 直配，另有 8 个绳索动作；不再出现弹力带/哑铃动作。
- 截图：`t9/y1-aifind-back.png`、`y2-aifind-cable.png`、`y4-scan.png`。

## 体验版 1.0.23：收工页「加练」+ 整场用时修正

### 一、加练

收工页按钮区新增「＋ 加练，再挑个动作」：打开动作库，选中动作后回来自动追加到本次训练末尾（3 组 × 10 次、重量 0，按 1.0.18/1.0.19 的组编辑继续改），并直接跳到该动作第 1 组开始计时，练完自然回到收工页。

实现：`pages/focus` 抽出 `openPicker / appendItem`，`addMore`（中途加动作）与新的 `addExtra`（收工页加练）共用；`addExtra` 追加后把 `idx` 指到新项并 `prepare()`，因此会从 `finish` 回到 `work`。

### 二、用时修正

原「用时」只累加有氧 `min`，力量训练整场显示 `0 秒`。现改为按真实时钟计算：`onLoad` 记 `_sessionStart`，`persistFocus` 存 `startAt`，重进 12 小时内接着算；`showFinish` 用 `Date.now() - _sessionStart`，不足 1 分钟显示「不足 1 分钟」。

实测（IDE + automator，1.0.23）：收工页显示「用时 2 秒」与「＋ 加练，再挑个动作」；点加练 → 动作库 40 张卡 → 选「3/4 仰卧起坐」→ 返回后 `stage=work`、队列 11→12 项、当前动作即新动作、计时从 `0:02` 起走。截图 `t9/x1-finish-extra.png`、`t9/x2-extra-work.png`。

## 体验版 1.0.22：拍照识图链路修复（多模态 + 通道诊断）

### 一、报错根因

- 现象 `cloud.callFunction:fail errCode -504003 Invoking task timed out after 3 seconds`：调用走到云函数 `aiProxy`，而该函数云端超时仍是 3 秒（IDE 部署改不了，需控制台手动改），带图片的请求必然超时。
- 走到云函数的原因：`ai.ask` 只有在读得到 `settings.ai.baseUrl + apiKey` 时才直连；配置只存在做过设置的那台设备的本地存储里，手机体验版读不到就回落。
- 另一个硬伤：`maskMessages` 把多模态 `content` 数组当字符串匿名化，`image_url` 块被拍平，模型收不到图（即使直连也认不出）。

### 二、改法

- `maskMessages` 改为按块处理：`text` 块走 `maskText`，`image_url` 原样保留；非数组仍整体匿名化。
- 预览用 `previewContent()`、字符统计用 `contentChars()`，数组只写文字 + `[图片]`，不再把 base64 存进 `settings.ai.preview`。
- 新增 `ai.usingCustom()`；`pages/scan` 首屏显示「通道：…」。
- `pages/scan` 的 `fail()` 分类提示：域名未白名单 → 给出要加的域名；`-504003/3 seconds` → 给出两条解法；401/403 → 查 Key；并附当前通道与原始错误。
- `pages/apiconfig` 增「识图测试」：1×1 红图 + 提示词，返回「红色」即通。

### 三、实测

- 接口直连（PowerShell 复现页面请求）：`agnes-3.0-flash` 文本 200；1×1 红图回答「红色」，151 tokens。
- 真实健身房龙门架照片（640px q60，2.6s，583 tokens）→ `["高位下拉","绳索夹胸","绳索卷腹","平板卧推","窄距划船","站姿绳索侧平举"]`。
- IDE + automator 端到端：apiconfig 保存后 `CHANNEL 直连 apihub.agnes-ai.com/v1 · agnes-3.0-flash`；`callAI` 320px 图 12s 内返回，动作库命中 `绳索高位下拉全程幅度 / 弹力带站姿划船 / 绳索面拉（外旋旋转）`，未匹配项列在「未匹配」。截图 `t9/v2-scan.png`。

### 四、手机端需要做的两件事

1. 设置 → 动作与 AI → 高级 → 「Agent API 配置」（`pages/apiconfig`）填 `https://apihub.agnes-ai.com/v1`、Key、`agnes-3.0-flash` 并保存（配置只在本机）。
2. 小程序后台「开发管理 → 服务器域名 → request 合法域名」加 `https://apihub.agnes-ai.com`；开发阶段可在开发者工具勾「不校验合法域名」。
3. 若还想保留云端兜底：云开发控制台把 `aiProxy` 超时从 3s 改成 45s。

## 体验版 1.0.21：本组计时暂停 / 继续、重置

### 一、交互

- 做组态（`stage === 'work'`）在 `hint` 下方出现两个胶囊按钮：`.tc`「暂停计时」/「继续计时」、`.tc`「重置本组」；其余状态不显示。
- 暂停后圆环下方 unit 文案变「已暂停」，chip 高亮为青绿（`.tc.on`），主按钮仍是「完成本组」。

### 二、实现

- 时间基准仍是 `_workStart`；`elapsedMs() = now - _workStart - _pauseAcc - (_pauseAt ? now - _pauseAt : 0)`，`elapsedSec()` 至少 1 秒。
- `togglePause()`：暂停时 `_pauseAt = Date.now()`，`setData({ timerPaused: true, mmss: 冻结值 })`；继续时 `_pauseAcc += now - _pauseAt`、`_pauseAt = 0`，`tick()` 立即补帧。
- `resetTimer()`：`_workStart = Date.now()`、`_pauseAcc = 0`、`_pauseAt = 0`、`mmss '0:00'`、`timerPaused false`，从零重计。
- `tick()` 在 `timerPaused` 时不再更新 `mmss`；休息/有氧分支不受影响。
- 落盘：`persistFocus` 增 `pauseAcc/pauseAt/timerPaused`；`restoreFocus` 读回，`prepare` 恢复暂停态，重开页面仍是冻结秒数。
- `beginSet` / `completeGroup` 进入新组或收组时清空暂停累计。

### 三、实测（本机 IDE + automator 冷启动）

- `RUN 0:06` → 暂停 → 5 秒后仍 `0:06(暂停)` → 继续 → 2 秒后 `0:08`。
- 重置 → `0:00` → 3 秒后 `0:03`。
- 暂停态落盘后退出重进：`0:04 → 0:04 paused=true stage=work`。
- 继续 2.5 秒后完成：该组入账 `7″`（4 秒冻结 + 2.5 秒新增，扣暂停）。截图 `t9/s1-work-controls.png`。

## 体验版 1.0.20：息屏/切后台后本组计时继续走

### 一、问题与根因

- 现象：手机上先做一组、息屏几分钟再亮屏，计时显示仍停在息屏前的秒数。
- 两层原因：
  1. 小程序进入后台后页面 `setInterval` 被系统挂起，`tick` 不再执行，画面停在最后一帧；
  2. 1.0.19 写的 `onHide` 记 `_hideAt`、`onShow` 执行 `_workStart += Date.now() - _hideAt`，属于"主动剔除后台时长"，即使时间基准正确也会被减回去。
- 结论：不是"没有后台计时"，而是计时基准被代码平移了；`Date.now()` 本身跨后台仍然有效。

### 二、修法

- `onShow` 改为只做 `this.tick()`：用系统时间差一次补齐，画面立刻跳到正确秒数。
- `onHide` 改为 `this.persistFocus()`：把当前组的 `workStart` 落盘，不修改时间基准。
- `persistFocus()` 增加 `workStart` 字段；`restoreFocus()` 读回并校验 6 小时内有效，赋给 `_resumeWorkStart`。
- `prepare()` 取 `_resumeWorkStart` 作为本组起始时刻（否则 `Date.now()`），`mmss` 初始值按已过时长显示，`hint` 不变。
- 组完成仍以 `elapsedSec()` 落 `g.sec`，因此息屏那段会计入该组时长并写进日志。

### 三、实测（本机 IDE + automator 冷启动）

- 计时推进：`T0 mmss 0:01` → 5 秒后 `0:06`。
- 模拟息屏：`onHide` → 6 秒 → `onShow`，`mmss 0:13`，完成该组记 `13″`。
- 页面销毁重开：练 3 秒 → `persistFocus` → `navigateBack` → 3.2 秒 → 重进，`stage work setNo 1 mmss 0:09`，完成后该组 `9″`（截图 `t9/r2-rest.png`：组行显示 `13″`）。

## 体验版 1.0.19：专注模式每组自动计时 + 每组时长进日志

### 一、每组自动计时（`pages/focus`）

- `prepare()` 对力量动作直接进入 `stage: 'work'` 并 `_workStart = Date.now()`，圆环中间即 `m:ss`（`tick` 每 500ms 刷新）；不再有「开始第 N 组」这一步。
- `elapsedSec()`：`Math.max(1, round((now - _workStart)/1000))`；`finishSet` / `doneCurrent` / `tapRow` / `completeGroup` 统一用它，完成即写 `g.sec`。
- `completeGroup` 落库顺序：写 `sec` → `saveStrength` → `persistFocus`；组行 `rowsOf` 的 `sec` 用 `secText`（`45″` / `1′05″`）。
- 切后台：`onHide` 记 `_hideAt`，`onShow` 执行 `_workStart += Date.now() - _hideAt`，锁屏时间不计入本组（此行为与诉求相反，已在 1.0.20 移除）。
- 休息中点组行：改为 `beginSet(true)`（结束休息、开始计时），不再把未做的一组记成 0 秒。
- 点非当前组（前面的空组）：只写该组完成与时长，`if (!isCur) { ...; return; }` 提前返回，不清 `_workStart`、不触发休息。
- 重做 `redoRow`：`sec=0` 且 `_sessionSec` 扣回原 `wasSec`，`prepare` 重新计时；收工页 `finishTime` 取真实累计 `_sessionSec`。
- 修复 `saveStrength` 中 `rpe: 0` 的硬编码（改为 `g.rpe || 0`）。
- 设置页删除「组内计时」开关与旧说明，改为「专注训练里每组自动计时」一句话；`libs/settings` 的 `groupTimer` 字段保留兼容，页面不再读取。

### 二、日志里的每组时长

- 记录页展开动作后每行：`1 | 自重 × 10 | 45″ | ✓`（`pages/log/index.wxml` 的 `.gsec`）。
- 动作标题行追加总时长：`engine.groupLine` 汇总 `sec > 0` 的组，`自重 3×10 · 1′35″`。
- 链路：`records[].groups[].sec` → `engine.syncTrainLog` → `logs[].meta.items[].groups[].sec` → `log/buildTimeline`，无新增存储键。

### 三、验证（无本机 IDE 时用 Node 逻辑桩）

本机（Windows IDE）离线，改为在云主机用 Node 桩跑页面逻辑（`wx` storage / toast / selectorQuery 全打桩，`Page` 捕获配置），脚本 `harness/focus_timer_check.js`、`focus_timer_check2.js`：

- 三组分别模拟 45s / 32s / 18s → `RECORD_GROUPS [[1,true,45],[2,true,32],[3,true,18]]`。
- 日志 `LOG_ITEMS` 每组 sec 为 45/32/18，`LOG_LINE = 自重 3×10 · 1′35″`。
- `redoRow` 第 2 组：`done=false, sec=0`，会话 95→63，`stage work setNo 2`。
- 非当前组点勾：`_workStart` 仍在；随后完成当前组 `sec=10`，会话 73。
- 收工：`finishText 3 组 · 0 kg`，`finishTime 1 分钟`。

未覆盖：真机/IDE 上的圆环渲染与触摸时序（Windows 环境离线，未跑 automator）。

## 体验版 1.0.18：专注页运动项增删查改 + 重做某一组 + 休息圆环修复

包体 1,325,907 B（`__FULL__ size`），`getCodeFiles count: 104`；上传成功，版本号 `1.0.18`，描述「专注页运动项增删查改 + 重做某一组 + 休息圆环修复」。

### 一、运动项增删查改（`pages/focus`）

- 动作清单（`.listsheet`）每行两行式排版：首行 `序号 · 名称 · 有氧标记 · 状态`，次行右对齐「详情 / 改 / 删」三个 `.ls-op`。
- 详情 `openItemDetail`：打开 `ex-sheet`（动图 + 部位/器械/要领）；条目无 `exId` 时按名称匹配兜底，仍无则 toast。
- 改 `openItemEdit`：复用 `components/train-editor`，payload 带 `mode/uid/name/part/exId/date/groups`；确认后回写 `it.groups`，有氧计组型走 `actions.saveCardio({mode:'sets'})`，力量走 `saveStrength`；非当前项编辑后仍 `prepare()` 刷新。
- 删 `openItemDelete`：`wx.showModal` 二次确认 → `removeItem(i)`，按 `isCardio/type` 调 `deleteCardio`/`deleteStrength`，移除、重排序号、`persistFocus`、`refreshQueue`；删空自动 `showFinish()`。
- 加：非收工态清单底部「＋ 中途加个动作」（`addMore`）；收工页新增「本次 N 个动作 · X/Y 组 管理 ⌄」（`.fin-mgr` → `openList`）。

### 二、重做某一组

- 组行中已完成的组出现 `.redo` chip（`redoRow`）：`done=false`、`sec=0`、`rpe=0`，先存 `wasSec` 再从 `_sessionSec` 扣回，同步 `saveStrength`、`persistFocus`、`refreshQueue`、`doneSets/doneVolume`，并 `prepare()` 定位到该组。
- 收工页可经「管理」清单点任意一项回到该动作（`jumpTo` 在 `stage==='finish'` 时允许回跳当前项），再在组行点「重做」。

### 三、组间休息圆环

- 根因：`initCanvas` 只在 `onReady` 量一次 canvas；准备态容器 520×336rpx 时量到位图 520×336，却按宽 520 的正方形算圆心半径，进入休息态（520×520）后位图被竖向拉伸 → 椭圆、弧线冲出 `.dial`。
- 修复：记录 `w/h` 两维，位图 `round(w*dpr) × round(h*dpr)`；尺寸为 0 时 250ms 重试最多 6 次；`draw()` 用 `w/h` 各自算 `cx/cy`，半径 `min(w,h)/2 - 26`，`r<=10` 直接返回；`.stage.lite .rings{display:none}`。
- 环内 meta 口径：`setsDoneAll/setsTotalAll`（原为动作组数，出现「1/1 组」与页头「1/4 组」冲突）。

### 四、编辑弹层深色

- `train-editor` 新增 `theme` 属性，root `sheet {{theme==='dark'?'dark':''}}`，补一整套 `.sheet.dark`（背景 #16211F、输入 #101615/边框 #22302D、文字 #E8F2EE/#9FB0AB、`chip.on` #3DDCBF）；专注页传 `theme="dark"`，log 页保持浅色。

### 五、实测（automator 冷启动）

- 环：`t9/q1-rest.png` 正圆、与 `.dial` 对齐、弧线在圆内，meta `3/34 组 · 900 kg`。
- 重做：`doneCurrent` 后 `3/34`，`redoRow(i=1)` 后 `rows 1✓,2-,3-`、`doneSets 3→2`、meta 回到 `2/34`。
- 收工回跳：`showFinish` → `openList` → `jumpTo(3)` → `stage ready · 椭圆机 · cardio`。
- 删除：`removeItem(11)` 后 `total 12→11`，meta `2/34→2/31`。
- 编辑弹层：`t9/p1-edit-dark.png` 深色下与页面一致；清单 `t9/p3-finish-list.png` 两行式 + 三操作右对齐。

## 体验版 1.0.17：AI 找动作接意图分析 + 编辑动作弹层统一

包体 1,318,431 B（`__FULL__ size`），`getCodeFiles count: 104`；上传成功，版本号 `1.0.17`，描述「AI 找动作接 AI 意图分析 + 编辑动作弹层按钮统一」。

### 一、AI 找动作（`pages/aifind`）真的调 AI

- 入口：`libs/ai.js` 的 `ai.ask`（配了自定义 baseUrl/apiKey 就直连 `/chat/completions`，否则走云函数 `aiProxy`）。
- 流程：本地规则先出结果（按部位/器械过滤 + 兜底打分：命中名称 +3、部位 +2、器械 +1）→ 页面立刻有列表，不空白；随后 `aiRank()` 把前 20 个候选压成 `id|名称|部位|器械` 交给 AI。
- Prompt：先判断意图（部位/器械/目标/限制），再**只从候选里**挑 6–8 个；硬规则「每个 pick 必须带 why」「why 必须说明匹配点」「候选不匹配宁可少给」；`temperature 0.2`、`max_tokens 420`，只输出 JSON `{"intent":"","picks":[{"id":"","why":""}]}`。
- 容错：失败/格式异常最多 3 次，间隔 4s（格式异常 1.2s）；无 why 的 pick 直接丢弃（理由不许留空）；最终失败写 `aiNote`（「AI 暂不可用 / 返回格式异常 / 未给出推荐理由 / 请求失败，已按本地规则排」）+ `aiErr` 诊断串（不入界面）。
- 缓存：`selfagent_aifind_v1`，key 为查询原句，1 小时内复用、最多 30 条；**只有 picks 非空才写缓存**，避免把失败结果缓存住。
- UI：顶部 `.intent` 意图条（`✦ AI 判断` + 意图句，busy 时「正在读你的训练意图…」）；每行 `.why` 绿色理由；有 AI 结果时 meta 改「AI 依据动作详情与训练部位选出 N 个」；副标题「先由 AI 判断训练意图，再从动作库按部位/器械/动作模式选」；底部说明「AI 只在这 36 个候选里挑…失败自动退回本地规则结果，页面不会空着」。
- 实测（冷启动后）：
  - `在家练胸 只有哑铃` → 意图「在家哑铃胸肌训练」，8 个候选 7 个带理由：`哑铃卧推::基础平板推胸`、`哑铃上斜卧推::上斜推胸中束`、`哑铃下斜卧推::下斜推胸下束`、`哑铃飞鸟::平飞鸟夹胸`。
  - `腹 自重` → 意图「腰腹自重训练」，8 个：`交叉身体卷腹::核心卷腹，基础自重`、`卷腹地面::地面卷腹，易入门`…（4.6s）
  - `腿 器械 深蹲` → 意图「腿部器械深蹲」，8 个：`杠杆器械坐姿单腿宽距深蹲::单腿宽距深蹲`…（3.6s）
  - 冷启动后第一次查询约 15.5s（3 次重试跨过云函数冷启动）；列表在此期间已显示本地结果。

### 二、编辑动作弹层按钮统一（`components/train-editor`）

- 行内小控件统一高 56rpx、圆角 12rpx：`.tag` 44→56、`.num` 60→56（拆 `.num.reps` 74rpx / `.num.weight` 96rpx）、`.chip` 52→56 且固定宽 56、`.no` 28rpx；`.unit` 20rpx；`.row` 最小高 76rpx、gap 8rpx。
- `.chip.on` 浅绿底 `#F0FAF7`，`.chip.del` 透明边框 + `#EFF2F1` 底，不再和「勾」抢视觉。
- 「＋ 加一组」由裸文字改成通栏按钮 `.addset`（64rpx 高、浅绿底、居中）。
- 底部按钮统一 88rpx 高、16rpx 圆角、28rpx 字号；删除不再 `flex: 0 0 150rpx`，与取消/保存三等分等宽，保存加粗 600。
- 实测截图 `t9/j2-editor.png`：`杠铃弯举` 三组「常规／12／次 ×／25／kg／✓／×」同高对齐，＋加一组通栏，取消/删除/保存同宽同高。

### 三、云函数 aiProxy 超时

- `cloudfunctions/aiProxy/config.json` 的 `timeout` 由 20 改为 45，`cli cloud functions deploy` 返回 `success:true, filesCount:3, packSize:'1.5 KB'`。
- 但 `cli cloud functions info` 仍显示 `timeout 3`、`Nodejs16.13`：IDE 侧 deploy 不覆盖云端函数超时，需在云开发控制台手动改（未改前，冷启动首次调用仍可能超时，页面已用 3 次重试兜住）。
