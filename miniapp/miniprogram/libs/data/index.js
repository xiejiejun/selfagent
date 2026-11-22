// 动作词库：从网页版 lib.js 的 5,632 条抽出 [id, name, part]，压成数组省体积（约 240KB）。
const RAW = require('./lib.js');

const PARTS = ['胸', '背', '肩', '上臂', '前臂', '腰腹', '上腿', '小腿', '全身', '有氧'];

const ALL = RAW.map(r => ({ id: r[0], n: r[1], p: r[2] || '' }));

function search(q, part, limit) {
  const kw = String(q || '').trim().toLowerCase();
  let list = ALL;
  if (part) list = list.filter(e => e.p === part);
  if (kw) list = list.filter(e => (e.n || '').toLowerCase().indexOf(kw) >= 0);
  return list.slice(0, limit || 40);
}

function byId(id) {
  return ALL.find(e => e.id === id) || null;
}

module.exports = { ALL, PARTS, search, byId, total: ALL.length };
