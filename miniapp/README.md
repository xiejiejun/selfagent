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

组件：

- `components/train-editor`：力量（逐组 reps/weight/✓/×、加一组、删一组）与有氧（时长/完成）双模式，`confirm` / `delete` / `close` 三个事件。

云函数：

- `aiProxy`：OpenAI 兼容 `/chat/completions` 转发，Key 只存服务端环境变量，客户端拿不到。
- `syncPush`：把 logs / train(records+cardio) 拆成实体事件写入 `events`，profile/settings 写 `snapshots`，墓碑删云端实体，`sync_state` 记水位。
- `syncPull`：按水位 `ts > since` 拉增量（分页 1000），返回 `{logs:[], train:{records,cardio}, profile, settings}`。

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
└── cloudfunctions/{aiProxy,syncPush,syncPull}/
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
3. **建三个集合**（云开发控制台 → 数据库）：`events`、`snapshots`、`sync_state`，权限都选「仅创建者可读写」。
4. **部署云函数**：`cloudfunctions/` 下三个目录分别右键 →「上传并部署：云端安装依赖」。
5. **aiProxy 环境变量**（云开发控制台 → 云函数 → aiProxy → 配置）：
   - `AI_BASE_URL`：OpenAI 兼容网关根地址（例如 `https://api.deepseek.com`，代码会自动补 `/chat/completions`）
   - `AI_API_KEY`：服务端 Key
   - `AI_MODEL`：默认模型名（如 `deepseek-chat`）
   不配也能跑前 5 个页面，只有「问 AI」会返回 `AI_BASE_URL / AI_API_KEY 未配置`。
6. **真机/模拟器**：编译后先用本地存储跑通「训练 / 记录 / 我的」，再点「我的 → 上传本机」验证同步；换设备执行「拉取合并」。
7. **上传体验版**：工具右上「上传」→ 微信公众平台设为体验版。

## 静态校验（本轮已执行）

- 全部 `.js` `node --check` 通过；全部 `.json` `json.load` 通过。
- 用 `wx` 桩离线跑通：页面 `onLoad/onShow` 无异常；点组打卡、编辑器保存/删除、有氧保存、快记落库、日志删除、分析统计、词库搜索/筛选均返回预期结果。
- `syncPush` / `syncPull` 用内存版 `wx-server-sdk` 桩跑通：推送实体、按水位增量、墓碑删除、LWW 合并、train 还原成对象结构。
- 尚未做：微信开发者工具/真机联调（需要扫码登录你的开发者账号）。

## 还没做（下一步）

- 动作库图卡网格 + GIF：网页版 6,554 个 GIF 在 GitHub/jsdelivr 上，小程序需下载白名单域名或转存云存储后才能显示，未迁移。
- 计划页 / 训练提醒 / 断签召回：订阅消息要在公众平台申请模板 id 后接。
- 图表：目前用 WXML 柱条/进度条，`echarts-for-weixin` 未引入（可选）。
- 训练模块的专注模式（分幕状态机、三环计时 canvas）尚未搬到小程序。
