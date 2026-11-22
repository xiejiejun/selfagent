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
- `syncPush`：把 logs / train(records+cardio) 拆成实体事件写入 `events`，profile/settings 写 `snapshots`，墓碑删云端实体，`sync_state` 记水位。
- `syncPull`：按水位 `ts > since` 拉增量（分页 1000），返回 `{logs:[], train:{records,cardio}, profile, settings}`。
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

`selfagent_logs_v1` / `selfagent_training_v1` / `selfagent_profile_v1` / `selfagent_settings_v1` / `selfagent_theme_v1` / `selfagent_page_v1` / `selfagent_del_v1` / `selfagent_rep_fp` / `selfagent_sync_v1`

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
6. **真机/模拟器**：编译后先用本地存储跑通「训练 / 记录 / 我的」，再点「我的 → 上传本机」验证同步；换设备执行「拉取合并」。
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
- 待验：`wx.requestSubscribeMessage` 只能在真实点击手势下调用（模拟器 automation 会返回 `can only be invoked by user TAP gesture`），需真机点「开启提醒」验证授权；真机扫码与异地拉取同理。

## 还没做（下一步）

- 动作库动图（GIF）：当前只用静态缩略图（`media_map` → 云存储 webp），动图需另外转存并逐张授权，未做。
- 订阅消息实际推送：模板关键词需按上文第 8 步对齐后，用 `notify` 的 `send` 实测一次。
- 图表：目前用 WXML 柱条/进度条 + canvas 三环，`echarts-for-weixin` 未引入（可选）。
- 分包：主包约 548KB（含 244KB 词库），未分包，后续动作数据增多时再拆。
