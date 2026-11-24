/**
 * 发布期流水线 1/2：探测源站到底有哪些动作短片（HEAD，只读）
 * 用法：node tools/clip-probe.js
 * 依赖：微信开发者工具已开启 automation（ws://localhost:9420），小程序已启动
 * 产物：tools/out/clips-have.json  { id: true }
 */
const fs = require('fs');
const path = require('path');
const automator = require(process.env.TEMP + '/sa-auto/node_modules/miniprogram-automator');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const lib = require(path.join(ROOT, 'miniprogram/libs/data/lib.js'));
const arr = Array.isArray(lib) ? lib : (lib.default || lib.list || []);
const ids = Array.from(new Set(arr.map((r) => String(r[0])).filter((i) => /^\d{4}$/.test(i))));

const CHUNK = 16;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const haveFile = path.join(OUT, 'clips-have.json');
  const have = fs.existsSync(haveFile) ? JSON.parse(fs.readFileSync(haveFile, 'utf8')) : {};
  const known = new Set(Object.keys(have));
  const todo = ids.filter((i) => !known.has(i));
  console.log('ids', ids.length, 'known', known.size, 'todo', todo.length);
  if (!todo.length) return;

  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420', timeout: 20000 });
  const call = (data) => mp.evaluate((d) => new Promise((res) => {
    wx.cloud.callFunction({ name: 'gifMigrate', data: d })
      .then((x) => res(x.result || {}))
      .catch((e) => res({ err: String(e).slice(0, 160) }));
  }), data);

  // 预热一次，避免首次冷启动吃掉整个 3s 配额
  await call({ action: 'probe', clip: true, ids: ['0001'] });

  let done = 0, found = 0, fail = 0;
  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK);
    let r = null, tries = 0;
    while (tries < 2 && (!r || r.err)) { tries++; r = await call({ action: 'probe', clip: true, ids: chunk }); if (!r || r.err) await wait(600); }
    if (r && r.have) {
      Object.keys(r.have).forEach((id) => { have[id] = true; });
      found += Object.keys(r.have).length;
    } else fail += chunk.length;
    done += chunk.length;
    if ((i / CHUNK) % 8 === 0) {
      fs.writeFileSync(haveFile, JSON.stringify(have));
      console.log('probe', done, '/', todo.length, 'found', found, 'fail', fail);
    }
    await wait(120);
  }
  fs.writeFileSync(haveFile, JSON.stringify(have));
  console.log('DONE probe; have', Object.keys(have).length, '/', ids.length);
  await mp.disconnect();
})().catch((e) => { console.error('ERR', e && e.message); process.exit(1); });
