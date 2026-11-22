# SelfAgent 小程序端（分支 `miniapp`）

微信小程序（原生 + 微信云开发）落地代码。`main` 分支继续维护网页版（GitHub Pages），两端共享 `libs/` 里的纯逻辑层。

## 目录

```
miniapp/
├── project.config.json        # 微信开发者工具工程配置（appid 待填）
├── miniprogram/
│   ├── app.js / app.json      # 入口，tabBar 五页
│   ├── pages/
│   │   ├── home/              # 今天
│   │   ├── train/             # 训练
│   │   ├── agent/             # 分析
│   │   ├── log/               # 记录
│   │   └── setting/           # 我的
│   ├── components/            # orb / float-ball / focus-view / ring-set / sheet / kpi-strip
│   ├── libs/
│   │   ├── store/             # 本地存储（键名与网页版一致）
│   │   ├── engine/            # 规则引擎 / 文案生成（纯函数，与网页版共用）
│   │   └── sync/              # 增量同步（水位 / LWW / 墓碑）
│   └── assets/
└── cloudfunctions/
    ├── aiProxy/               # AI 转发，Key 只放服务端环境变量
    ├── syncPush/              # 上行增量
    └── syncPull/              # 下行增量
```

## 本地存储键（与网页版一一对应）

`selfagent_logs_v1` / `selfagent_training_v1` / `selfagent_profile_v1` / `selfagent_settings_v1` / `selfagent_theme_v1` / `selfagent_page_v1` / `selfagent_del_v1` / `selfagent_rep_fp` / `selfagent_sync_v1`

## 云开发集合

`events` / `snapshots` / `sync_state`

## 起步步骤

1. 微信开发者工具导入 `miniapp/`（填入自己小程序 appid）。
2. 开通云开发，把环境 ID 写进 `miniprogram/app.js` 的 `CLOUD_ENV`。
3. 云函数逐个右键「上传并部署：云端安装依赖」；`aiProxy` 需要在云开发控制台配置环境变量 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`。
4. 先跑阶段 1：记录页快记 + 时间线、训练页今日、我的页，纯本地存储；跑通再接云同步。
