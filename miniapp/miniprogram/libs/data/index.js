// 动作词库（网页版 lib.js 的精简版：id / 名称 / 部位 / 方式 / 目标肌 / 要领）
// 字段顺序：[id, n, p, e, t, s]；s 为换行分隔的动作要领文本
const LIB = require('./lib.js');

const PARTS = ['全部', '胸', '背', '肩', '上臂', '前臂', '腰腹', '上腿', '小腿', '全身', '有氧'];

// 方式筛选：网页版 e 字段共 32 种，收敛成用户能一眼看懂的 8 组
const EQUIPS = [
  { k: '全部', list: [] },
  { k: '哑铃', list: ['哑铃', '壶铃', '棒铃'] },
  { k: '杠铃', list: ['杠铃', 'EZ杠', '奥林匹克杠', '六角杠', '杠铃片'] },
  { k: '器械', list: ['器械', '史密斯机', '锤式器械', '辅助器械', '炮筒架', '上肢功率车', '台阶机', '动感单车', '椭圆机', '滑雪机', '雪橇机'] },
  { k: '绳索', list: ['绳索'] },
  { k: '自重', list: ['自重', '负重', '悬吊带', '健腹轮', '沙袋', '药球', '瑜伽球', '波速球'] },
  { k: '小器械', list: ['弹力带', '绳', '滚轴', '按摩球', '轮胎'] }
];

function mk(r) {
  return { id: r[0], n: r[1], p: r[2], e: r[3], t: r[4], s: r[5] || '' };
}

function partOk(p, part) {
  if (!part || part === '全部') return true;
  return p === part;
}

function equipOk(e, equip) {
  if (!equip || equip === '全部') return true;
  const g = EQUIPS.find(x => x.k === equip);
  if (!g) return true;
  return g.list.indexOf(e) >= 0;
}

// q 关键字 / part 部位 / equip 方式 / limit 条数
function search(q, part, equip, limit) {
  const kw = String(q || '').trim().toLowerCase();
  const out = [];
  const cap = limit || 40;
  for (let i = 0; i < LIB.length; i++) {
    const r = LIB[i];
    if (!partOk(r[2], part) || !equipOk(r[3], equip)) continue;
    if (kw && r[1].toLowerCase().indexOf(kw) < 0) continue;
    out.push(mk(r));
    if (out.length >= cap) break;
  }
  return out;
}

function byId(id) {
  for (let i = 0; i < LIB.length; i++) if (LIB[i][0] === id) return mk(LIB[i]);
  return null;
}

// 全量动作（给 AI 召回层打分用，5632 条；只读，勿改）
function all() {
  const out = new Array(LIB.length);
  for (let i = 0; i < LIB.length; i++) out[i] = mk(LIB[i]);
  return out;
}

// 名称模糊匹配（给 md 导入、过往记录补 exId 用）
function matchByName(name) {
  const n = String(name || '').replace(/\s/g, '');
  if (!n) return null;
  let best = null;
  for (let i = 0; i < LIB.length; i++) {
    const r = LIB[i];
    if (r[1] === name) return mk(r);
    if (!best && r[1].replace(/\s/g, '').indexOf(n) >= 0) best = mk(r);
  }
  return best;
}

module.exports = { search, byId, matchByName, all, PARTS, EQUIPS, total: LIB.length };
