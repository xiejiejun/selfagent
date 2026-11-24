/**
 * 发布期流水线 2/2：把源站短片批量转存到云存储，并生成客户端静态索引
 * 用法：node tools/clip-generate.js
 * 产物：
 *   tools/out/clip-map.json      { id: fileID }
 *   miniprogram/libs/clip-index.json  客户端直接 require 的索引
 */
const fs = require('fs');
const path = require('path');
const automator = require(process.env.TEMP + '/sa-auto/node_modules/miniprogram-automator');

const OUT = path.join(__dirname, 'out');
const INDEX = path.join(__dirname, '..', 'miniprogram', 'libs', 'clip-index.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const haveFile = path.join(OUT, 'clips-have.json');
  if (!fs.existsSync(haveFile)) throw new Error('先跑 tools/clip-probe.js');
  const have = JSON.parse(fs.readFileSync(haveFile, 'utf8'));
  const target = Object.keys(have);
  const mapFile = path.join(OUT, 'clip-map.json');
  const map = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : {};
  console.log('have', target.length, 'already', Object.keys(map).length);

  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  const call = (data) => mp.evaluate((d) => new Promise((res) => {
    wx.cloud.callFunction({ name: 'gifMigrate', data: d })
      .then((x) => res(x.result || {}))
      .catch((e) => res({ err: String(e).slice(0, 160) }));
  }), data);

  // 1) 先把已有映射读回来（40/批）
  const needMap = target.filter((id) => !map[id]);
  for (let i = 0; i < needMap.length; i += 40) {
    const chunk = needMap.slice(i, i + 40);
    for (let t = 0; t < 3; t++) {
      const r = await call({ action: 'clipmap', ids: chunk });
      if (r && r.map) { Object.assign(map, r.map); break; }
      await wait(200);
    }
  }
  fs.writeFileSync(mapFile, JSON.stringify(map));
  console.log('existing map', Object.keys(map).length);

  // 2) 生成还没搬的
  const todo = target.filter((id) => !map[id]);
  console.log('to generate', todo.length);
  await call({ action: 'probe', clip: true, ids: ['0001'] }); // 预热

  let migrated = 0;
  for (let i = 0; i < todo.length; i += 20) {
    const chunk = todo.slice(i, i + 20);
    let r = null, tries = 0;
    while (tries < 3 && (!r || r.err)) { tries++; r = await call({ action: 'batchgen', clip: true, ids: chunk }); await wait(250); }
    if (r && r.migrated) migrated += r.migrated;
    // 回读这批的 fileID
    for (let t = 0; t < 3; t++) {
      const q = await call({ action: 'clipmap', ids: chunk });
      if (q && q.map) { Object.assign(map, q.map); break; }
      await wait(200);
    }
    if ((i / 20) % 5 === 0) {
      fs.writeFileSync(mapFile, JSON.stringify(map));
      console.log('gen', Math.min(i + 20, todo.length), '/', todo.length, 'map', Object.keys(map).length, 'migrated', migrated);
    }
  }
  fs.writeFileSync(mapFile, JSON.stringify(map));
  fs.writeFileSync(INDEX, '// 发布期生成：动作短片索引（id -> 云文件 fileID），勿手改\nmodule.exports = ' + JSON.stringify(map) + ';\n');
  console.log('DONE map', Object.keys(map).length, '->', INDEX);
  await mp.disconnect();
})().catch((e) => { console.error('ERR', e && e.message); process.exit(1); });
