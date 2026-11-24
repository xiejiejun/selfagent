// 动作素材迁移：webp 缩略图 / mp4 示范短片搬到云存储，回写映射表。
// 客户端按 20~40 个一批调用；单批并发 4，超预算或失败的 id 返回给客户端重试。
const https = require('https');
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const THUMB_SOURCES = [
  'https://cdn.jsdelivr.net/gh/xiejiejun/selfagent@main/media/thumb/',
  'https://raw.githubusercontent.com/xiejiejun/selfagent/main/media/thumb/'
];
const CLIP_SOURCES = [
  'https://raw.githubusercontent.com/DuarteSantos8/openGym/main/catalogue/media/clip/',
  'https://cdn.jsdelivr.net/gh/DuarteSantos8/openGym@main/catalogue/media/clip/'
];
const CONC = 4;
const BUDGET = 1500; // 单次调用内的总预算(ms)，超出的 id 直接返回 failed 让客户端重试

function fetchBuf(url, left = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 2600 }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && left > 0) {
        res.resume();
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString();
        return fetchBuf(next, left - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('http ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

function headBuf(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'HEAD', timeout: 800 }, res => {
      if (res.statusCode && res.statusCode < 300) { res.resume(); resolve(res.statusCode); }
      else { res.resume(); reject(new Error('http ' + res.statusCode)); }
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function ensure(name) {
  try { await db.createCollection(name); } catch (e) {}
}

async function putMap(coll, id, fileID, part) {
  try {
    await db.collection(coll).doc(id).set({ data: { fileID, part: part || '', ts: Date.now() } });
    return null;
  } catch (e) {
    try { await db.collection(coll).add({ data: Object.assign({ _id: id }, { fileID, part: part || '', ts: Date.now() }) }); return null; }
    catch (e2) { return String((e2 && (e2.errMsg || e2.message)) || e && (e.errMsg || e.message)); }
  }
}

async function readMap(coll, qids) {
  const map = {};
  if (!qids.length) return map;
  try {
    const r = await db.collection(coll).where({ _id: db.command.in(qids) }).limit(40).get();
    (r.data || []).forEach(d => { if (d && d.fileID) map[d._id] = d.fileID; });
  } catch (e) {}
  return map;
}

exports.main = async (event) => {
  // 集合已在环境里，读路径不再 createCollection（这一步会吃掉调用时间，3s 上限下很致命）

  // 读取模式：客户端不直连数据库（映射表为云函数写入，客户端无读权限时也能用）
  if (event.action === 'map') {
    const qids = Array.isArray(event.ids) ? event.ids.map(String).filter(x => /^\d{4}$/.test(x)).slice(0, 40) : [];
    return { ok: true, map: await readMap('media_map', qids) };
  }
  if (event.action === 'clipmap') {
    const qids = Array.isArray(event.ids) ? event.ids.map(String).filter(x => /^\d{4}$/.test(x)).slice(0, 40) : [];
    return { ok: true, map: await readMap('clip_map', qids) };
  }

  // 发布期用：只做 HEAD 探测，判断源站有没有这个 id 的素材（不下载、不上传）
  if (event.action === 'probe') {
    const qids = Array.isArray(event.ids) ? event.ids.map(String).filter(x => /^\d{4}$/.test(x)).slice(0, 40) : [];
    const t0 = Date.now();
    const have = {};
    let cur = 0;
    async function w() {
      while (cur < qids.length) {
        if (Date.now() - t0 > 1400) return;
        const id = qids[cur++];
        const ext = event.clip ? '.mp4' : '.webp';
        const sources = event.clip ? CLIP_SOURCES : THUMB_SOURCES;
        for (const base of sources) {
          try { await headBuf(base + id + ext); have[id] = true; break; } catch (e) {}
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(10, qids.length || 1) }, w));
    return { ok: true, have, checked: qids.length, ms: Date.now() - t0 };
  }

  // 诊断用：逐个源站测耗时/状态，定位云端到底连哪条 CDN 慢
  if (event.action === 'diag') {
    const id = String(event.id || '0002');
    const out = [];
    for (const base of CLIP_SOURCES) {
      const t = Date.now();
      try {
        const b = await fetchBuf(base + id + '.mp4');
        out.push({ src: base.includes('jsdelivr') ? 'jsdelivr' : 'raw', ms: Date.now() - t, bytes: b.length });
      } catch (e) {
        out.push({ src: base.includes('jsdelivr') ? 'jsdelivr' : 'raw', ms: Date.now() - t, err: String(e.message).slice(0, 60) });
      }
    }
    return { ok: true, out };
  }

  // 发布期用：一批最多 40 个，长预算批量转存（发布期管线，20s 超时下可用）
  if (event.action === 'batchgen') {
    const t0 = Date.now();
    const list = (Array.isArray(event.ids) ? event.ids.map(String).filter(x => /^\d{4}$/.test(x)) : []).slice(0, 40);
    const wantClip = !!event.clip;
    const sources = wantClip ? CLIP_SOURCES : THUMB_SOURCES;
    const ext = wantClip ? '.mp4' : '.webp';
    const cloudDir = wantClip ? 'media/clip/' : 'media/thumb/';
    const coll = wantClip ? 'clip_map' : 'media_map';
    const budget = Math.min(Number(event.budget) || 12000, 13000);
    const failed = [];
    const skipped = [];
    let migrated = 0;
    let cur = 0;
    async function w() {
      while (cur < list.length) {
        if (Date.now() - t0 > budget) { skipped.push(...list.slice(cur)); return; }
        const id = list[cur++];
        try {
          let buf = null;
          for (const base of sources) {
            try { buf = await fetchBuf(base + id + ext); break; } catch (e) {}
          }
          if (!buf) throw new Error('404');
          const up = await cloud.uploadFile({ cloudPath: cloudDir + id + ext, fileContent: buf });
          await putMap(coll, id, up.fileID, '');
          migrated++;
        } catch (e) { failed.push(id); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(20, list.length || 1) }, w));
    return { ok: true, migrated, failed, skipped, total: list.length, ms: Date.now() - t0, map: await readMap(coll, list) };
  }

  const t0 = Date.now();
  const wantClip = !!event.clip;
  const ids = Array.isArray(event.ids) ? event.ids.map(String).filter(x => /^\d{4}$/.test(x)) : [];
  const parts = event.parts || {};
  const list = ids.slice(0, 6);
  const failed = [];
  const mapFail = [];
  let migrated = 0;

  const sources = wantClip ? CLIP_SOURCES : THUMB_SOURCES;
  const ext = wantClip ? '.mp4' : '.webp';
  const cloudDir = wantClip ? 'media/clip/' : 'media/thumb/';
  const coll = wantClip ? 'clip_map' : 'media_map';

  let cursor = 0;
  async function worker() {
    while (cursor < list.length) {
      if (Date.now() - t0 > BUDGET) return;
      const id = list[cursor++];
      try {
        let buf = null, errs = [];
        for (const base of sources) {
          try { buf = await fetchBuf(base + id + ext); break; } catch (e) { errs.push(base.slice(8, 28) + ':' + e.message); }
        }
        if (!buf) throw new Error(errs.join('|'));
        const up = await cloud.uploadFile({ cloudPath: cloudDir + id + ext, fileContent: buf });
        const mapErr = await putMap(coll, id, up.fileID, parts[id]);
        if (mapErr) mapFail.push(id + ':' + mapErr.slice(0, 60));
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
    mapFail: mapFail.slice(0, 3) };
};
