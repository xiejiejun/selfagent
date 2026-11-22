// 动作缩略图迁移：把 GitHub 上的 webp 缩略图搬到云存储，回写 media_map 映射。
// 客户端按 20~40 个一批调用；单批并发 16，超预算或失败的 id 返回给客户端重试。
const https = require('https');
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const SOURCES = [
  'https://cdn.jsdelivr.net/gh/xiejiejun/selfagent@main/media/thumb/',
  'https://raw.githubusercontent.com/xiejiejun/selfagent/main/media/thumb/'
];
const CONC = 16;
const BUDGET = 8000; // 单次调用内的总预算(ms)，超出的 id 直接返回 failed 让客户端重试

function fetchBuf(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 1600 }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('http ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function ensure(name) {
  try { await db.createCollection(name); } catch (e) {}
}

async function putMap(id, fileID, part) {
  try {
    await db.collection('media_map').doc(id).set({ data: { fileID, part: part || '', ts: Date.now() } });
  } catch (e) {
    try { await db.collection('media_map').add({ data: Object.assign({ _id: id }, { fileID, part: part || '', ts: Date.now() }) }); } catch (e2) {}
  }
}

exports.main = async (event) => {
  await ensure('media_map');
  const t0 = Date.now();
  const ids = Array.isArray(event.ids) ? event.ids.map(String).filter(x => /^\d{4}$/.test(x)) : [];
  const parts = event.parts || {};
  const list = ids.slice(0, 40);
  const failed = [];
  let migrated = 0;

  let cursor = 0;
  async function worker() {
    while (cursor < list.length) {
      if (Date.now() - t0 > BUDGET) return;
      const id = list[cursor++];
      try {
        let buf = null, errs = [];
        for (const base of SOURCES) {
          try { buf = await fetchBuf(base + id + '.webp'); break; } catch (e) { errs.push(base.slice(8, 28) + ':' + e.message); }
        }
        if (!buf) throw new Error(errs.join('|'));
        const up = await cloud.uploadFile({ cloudPath: 'media/thumb/' + id + '.webp', fileContent: buf });
        await putMap(id, up.fileID, parts[id]);
        migrated++;
      } catch (e) {
        failed.push(id);
        if (event.debug) console.log('[gifMigrate]', id, String(e.message).slice(0, 120));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONC, list.length) }, worker));
  const skipped = list.slice(cursor);
  return { ok: true, migrated, failed: failed.concat(skipped), skipped: skipped.length, total: list.length, ms: Date.now() - t0,
    failDetail: event.debug ? failed.slice(0, 3) : undefined };
};
