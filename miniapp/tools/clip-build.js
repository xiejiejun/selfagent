/**
 * 发布期流水线：批量把源站短片转存到云存储，并产出客户端静态索引
 * 用法：node tools/clip-build.js [最大分钟数，默认 999]
 * 依赖：微信开发者工具已开启 automation（ws://localhost:9420）；gifMigrate 超时 >= 20s
 * 产物：tools/out/clip-map.json + miniprogram/libs/clip-index.js
 * 可中断续跑：进度落在 tools/out/clip-progress.json
 *
 * 注意：automator 的 evaluate 固定 10s 超时，而一批要跑 10s+，
 * 所以采用「触发 + 轮询 storage」而不是直接 await 返回值。
 */
const fs = require('fs');
const path = require('path');
const automator = require(process.env.TEMP + '/sa-auto/node_modules/miniprogram-automator');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const INDEX = path.join(ROOT, 'miniprogram', 'libs', 'clip-index.js');
const lib = require(path.join(ROOT, 'miniprogram/libs/data/lib.js'));
const arr = Array.isArray(lib) ? lib : (lib.default || lib.list || []);
const ids = Array.from(new Set(arr.map((r) => String(r[0])).filter((i) => /^\d{4}$/.test(i))));

const CHUNK = 32;
const MAX_MIN = Number(process.argv[2] || 999);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const { gen } = require('./clip-index-gen');

function writeIndex(map) {
  gen(map, INDEX);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const mapFile = path.join(OUT, 'clip-map.json');
  const progFile = path.join(OUT, 'clip-progress.json');
  const map = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : {};
  const prog = fs.existsSync(progFile) ? JSON.parse(fs.readFileSync(progFile, 'utf8')) : { at: 0 };

  // 本机下载阶段已知没有短片的 id，直接跳过，省掉必定的 404 往返
  const haveFile = path.join(OUT, 'clips-have.json');
  const have = fs.existsSync(haveFile) ? JSON.parse(fs.readFileSync(haveFile, 'utf8')) : {};
  const haveKeys = Object.keys(have);
  const missing = haveKeys.length ? new Set(ids.filter((id) => !have[id])) : new Set();
  const work = ids.filter((id) => !missing.has(id));
  console.log('ids', ids.length, 'missing(404)', missing.size, 'work', work.length, 'map', Object.keys(map).length, 'start at', prog.at);

  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420', timeout: 30000 });

  async function batch(data, pollMs = 26000) {
    await mp.evaluate((d) => {
      wx.removeStorageSync('__clipres');
      wx.cloud.callFunction({ name: 'gifMigrate', data: d })
        .then((x) => wx.setStorageSync('__clipres', JSON.stringify(x.result || {})))
        .catch((e) => wx.setStorageSync('__clipres', JSON.stringify({ err: String(e).slice(0, 120) })));
    }, data);
    const t = Date.now();
    while (Date.now() - t < pollMs) {
      await wait(700);
      const s = await mp.evaluate(() => wx.getStorageSync('__clipres') || '');
      if (s) { try { return JSON.parse(s); } catch (e) { return { err: 'bad json' }; } }
    }
    return { err: 'poll timeout' };
  }

  const t0 = Date.now();
  let at = prog.at || 0, migrated = 0, calls = 0, fails = 0;
  const failIds = [];
  while (at < work.length) {
    if ((Date.now() - t0) / 60000 > MAX_MIN) { console.log('time cap reached'); break; }
    const chunk = work.slice(at, at + CHUNK);
    const r = await batch({ action: 'batchgen', clip: true, ids: chunk, budget: 12500 });
    calls++;
    if (r && r.map) {
      Object.assign(map, r.map);
      if (r.migrated) migrated += r.migrated;
      if (Array.isArray(r.failed)) failIds.push(...r.failed);
      if (Array.isArray(r.skipped)) failIds.push(...r.skipped);
    } else { fails++; if (r && r.err) console.log('call err', r.err); failIds.push(...chunk); }
    at += chunk.length;
    if (calls % 3 === 0 || at >= work.length) {
      fs.writeFileSync(mapFile, JSON.stringify(map));
      fs.writeFileSync(progFile, JSON.stringify({ at }));
      console.log('at', at, '/', work.length, 'clips', Object.keys(map).length, 'migrated', migrated, 'fails', fails, 'sec', Math.round((Date.now() - t0) / 1000));
    }
    await wait(150);
  }

  // 失败重试：多轮，直到连续一轮没有进展
  for (let pass = 1; pass <= 3; pass++) {
    const retry = Array.from(new Set(failIds.filter((id) => !map[id])));
    if (!retry.length) break;
    console.log('retry pass', pass, retry.length);
    const again = [];
    for (let i = 0; i < retry.length; i += CHUNK) {
      if ((Date.now() - t0) / 60000 > MAX_MIN) break;
      const r = await batch({ action: 'batchgen', clip: true, ids: retry.slice(i, i + CHUNK), budget: 12500 });
      if (r && r.map) {
        Object.assign(map, r.map);
        if (Array.isArray(r.failed)) again.push(...r.failed);
        if (Array.isArray(r.skipped)) again.push(...r.skipped);
      } else again.push(...retry.slice(i, i + CHUNK));
      fs.writeFileSync(mapFile, JSON.stringify(map));
    }
    failIds.length = 0;
    failIds.push(...again);
    if (!again.length) break;
  }

  fs.writeFileSync(mapFile, JSON.stringify(map));
  fs.writeFileSync(progFile, JSON.stringify({ at }));
  writeIndex(map);
  console.log('DONE at', at, 'clips', Object.keys(map).length, 'index ->', INDEX);
  await mp.disconnect();
})().catch((e) => { console.error('ERR', e && e.message); process.exit(1); });
