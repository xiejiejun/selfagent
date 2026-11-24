# 动作短片「预生产」流水线

用户侧只读索引 + CDN 流式播放：不下载、不落盘、不占存储。

## 现状（已跑完，实测）
- 动作库 id 数：5216
- 云端已有短片：**5216 / 5216**（`media/clip/<id>.mp4`，单文件 20–25KB，总计约 125MB）
- 客户端索引：**47KB**，5216 条；小程序主包 **1.19MB**
- 源站覆盖率实际 **100%**（早期“约 40%”是 30 个样本的偏差，已推翻）

## 主选（本次实际使用）：云端批量
前置：云开发控制台把 `gifMigrate` 超时调到 **20 秒**（CLI 部署不会应用 `config.json` 里的 timeout，必须在控制台改）

```powershell
node tools\clip-build.js 999     # 参数为最大分钟数
```

- 32 个 id/批，函数内并发 20，单批预算 12.5s；失败/超预算的 id 自动进重试轮（最多 3 轮）
- 断点：`tools/out/clip-progress.json`；产物：`tools/out/clip-map.json`
- 实测：5148 个 id 约 37 分钟（约 2 条/秒），重试后补齐到 5216
- 改函数后需 `node --check` + `cli cloud functions deploy`（超时值会保留）

## 本机直传（备用，需腾讯云 API 密钥）
```powershell
$env:TCB_SECRET_ID  = "..."
$env:TCB_SECRET_KEY = "..."
node tools\clip-build-local.js 6
```
`@cloudbase/manager-node` 只接受 `secretId/secretKey`（控制台生成的“云开发私钥文件”不适用）。

只下载不传：`node tools\clip-download.js 8` → `tools/out/clips/` + `clips-have.json`（本机 raw.githubusercontent 实测 ~1s/个，全量约 4 分钟）。

## 索引生成
```powershell
node tools\clip-index-gen.js
```
由 `tools/out/clip-map.json` 生成紧凑索引：

```js
module.exports = {
  prefix: 'cloud://<env>/media/clip/',
  ids: { '0001': 1, ... },
  url(id) { ... },   // id 自动补零到 4 位（数据里 2 和 '0002' 都能命中）
  has(id) { ... }
}
```

## 客户端侧（已改为纯流式，无本地缓存）
- `libs/clip-index.js`：静态索引（47KB），`require` 同步读，运行时不发任何迁移请求
- 详情页 `clipID` 直接用云 fileID（走微信 CDN），**不再下载到 `USER_DATA_PATH`**；旧的 `vclip` LRU 已删除，`app.js` 启动时一次性清理残留缓存目录
- 视频单例：`wx:if="{{detail.clipID}}"` 打开才挂载，关闭时 `wx.createVideoContext('dvideo').stop()`，不在列表页预挂载
- 索引未命中：显示占位不阻塞，后台 `batchgen` 单 id 补产（实测约 12s 后自动出现），成功后写回内存索引
- 实测首帧：0002 / 1200 / 4000 分别 **1.48s / 0.67s / 1.01s**（`loadedmetadata` 触发），`src` 始终是云 fileID，无本地文件写入

## 选做
- 有备案域名时把索引前缀换成 COS+CDN 地址，客户端代码不用改
- 热门 Top 50 打进分包做离线兜底
