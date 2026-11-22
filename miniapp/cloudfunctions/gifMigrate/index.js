// 动作缩略图迁移：把 GitHub 上的 webp 缩略图搬到云存储，回写 media_map 映射。
// 客户端按 20~40 个一批调用，直到全部完成。
const https = require('https');
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const BASE = 'https://raw.githubusercontent.com/xiejiejun/selfagent/main/media/thumb/';

function fetchBuf(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000 }, res => {
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
  const ids = Array.isArray(event.ids) ? event.ids.filter(x => /^\d{4}$/.test(String(x))) : [];
  const parts = event.parts || {};
  let ok = 0;
  const fail = [];
  for (const id of ids.slice(0, 40)) {
    try {
      const buf = await fetchBuf(BASE + id + '.webp');
      const up = await cloud.uploadFile({ cloudPath: 'media/thumb/' + id + '.webp', fileContent: buf });
      await putMap(id, up.fileID, parts[id]);
      ok++;
    } catch (e) {
      fail.push(id);
    }
  }
  return { ok: true, migrated: ok, failed: fail, total: ids.length };
};
