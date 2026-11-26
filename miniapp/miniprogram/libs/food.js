// 饮食估算：本地常见食物份量表 + 拍照识别 prompt + 文字解析 + 周趋势。
// 定位是「趋势记录」：份量按常见餐具估，误差 ±20-40% 属正常，不做精确计量。
const engine = require('./engine/index');

// [名称, 标准份量文案, 该份量热量 kcal, 单位族（碗/盘/份/个/杯/根/片/把/瓶/勺/块/100g）]
const LIB = [
  ['米饭', '1 碗', 230, '碗'],
  ['炒饭', '1 盘', 450, '盘'],
  ['面条', '1 碗', 350, '碗'],
  ['米线', '1 碗', 350, '碗'],
  ['馄饨', '1 碗', 250, '碗'],
  ['水饺', '10 个', 300, '个'],
  ['粥', '1 碗', 120, '碗'],
  ['馒头', '1 个', 220, '个'],
  ['包子', '1 个', 200, '个'],
  ['油条', '1 根', 250, '根'],
  ['全麦面包', '1 片', 90, '片'],
  ['吐司', '1 片', 110, '片'],
  ['燕麦', '1 碗', 200, '碗'],
  ['玉米', '1 根', 110, '根'],
  ['红薯', '1 个', 130, '个'],
  ['土豆', '1 个', 130, '个'],
  ['鸡蛋', '1 个', 70, '个'],
  ['煎蛋', '1 个', 100, '个'],
  ['牛奶', '1 杯', 150, '杯'],
  ['豆浆', '1 杯', 120, '杯'],
  ['酸奶', '1 杯', 120, '杯'],
  ['拿铁', '1 杯', 190, '杯'],
  ['咖啡', '1 杯', 5, '杯'],
  ['可乐', '1 杯', 140, '杯'],
  ['奶茶', '1 杯', 350, '杯'],
  ['啤酒', '1 瓶', 150, '瓶'],
  ['运动饮料', '1 瓶', 120, '瓶'],
  ['蛋白粉', '1 勺', 110, '勺'],
  ['鸡胸肉', '100 g', 165, '100g'],
  ['鸡腿', '1 个', 220, '个'],
  ['牛肉', '100 g', 250, '100g'],
  ['虾', '100 g', 100, '100g'],
  ['清蒸鱼', '1 份', 180, '份'],
  ['红烧肉', '半盘', 300, '盘'],
  ['红烧鸡块', '半盘', 310, '盘'],
  ['番茄炒蛋', '1 份', 180, '份'],
  ['麻婆豆腐', '1 份', 200, '份'],
  ['豆腐', '1 块', 80, '块'],
  ['炒青菜', '1 份', 60, '份'],
  ['青菜', '1 份', 60, '份'],
  ['白菜', '1 份', 40, '份'],
  ['西兰花', '1 份', 50, '份'],
  ['沙拉', '1 份', 150, '份'],
  ['苹果', '1 个', 90, '个'],
  ['香蕉', '1 根', 105, '根'],
  ['橙子', '1 个', 60, '个'],
  ['坚果', '1 把', 180, '把'],
  ['汉堡', '1 个', 500, '个'],
  ['薯条', '1 份', 300, '份']
];

const NUM = { '半': 0.5, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '0.5': 0.5, '1.5': 1.5 };
const UNIT_RE = /(碗|盘|份|个|杯|根|片|把|瓶|勺|块|克|g|G|毫升|ml|ML|kg|斤)/;
const CN_RE = /(半|一|二|两|三|四|五|六|七|八|九|十|\d+(?:\.\d+)?)/;

function round(n) { return Math.max(0, Math.round(Number(n) || 0)); }

// 最长名称优先，避免「鸡胸肉」被「鸡」抢走
const SORTED = LIB.slice().sort((a, b) => b[0].length - a[0].length);

function byName(raw) {
  const n = String(raw || '').replace(/\s/g, '');
  if (!n) return null;
  let best = null;
  SORTED.forEach(r => {
    if (n.indexOf(r[0]) >= 0 && (!best || r[0].length > best[0].length)) best = r;
  });
  if (best) return best;
  // 「鸡胸」「牛腱」「白米饭」这类：去掉修饰词再找一次
  for (let i = 0; i < SORTED.length; i++) {
    const r = SORTED[i];
    if (r[0].slice(0, 1) && n.indexOf(r[0].slice(0, 2)) === 0) return r;
  }
  return null;
}

// base[1] 里的标准份量本身可能带数字（1 碗 / 半盘 / 10 个 / 100 g），先算出来再折算
function baseQty(base) {
  const s = String(base[1] || '');
  if (/半/.test(s)) return 0.5;
  const m = s.match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 1;
}

// 文字 → 条目：支持「米饭一碗，鸡胸肉100g，两个鸡蛋」这种随手写
function parseText(text) {
  const segs = String(text || '').split(/[，,、;；。\n\s]+/).map(x => x.trim()).filter(Boolean);
  const items = [];
  segs.forEach(seg => {
    const s = seg.replace(/^(今天|昨天|早上|中午|晚上|午餐|晚餐|早餐|加餐|吃了|我吃了|大概|大约|约)+/g, '').trim();
    const base = byName(s);
    // 名称先摘掉，剩下的才是数量+单位，避免「鸡块」里的「块」被当成单位
    const rest = base ? s.split(base[0]).join('') : s;
    const qm = rest.match(CN_RE);
    const qty = qm ? (NUM[qm[1]] || Number(qm[1]) || 1) : (/半/.test(rest) ? 0.5 : 1);
    let unit = '';
    const um = rest.match(UNIT_RE);
    if (um) unit = um[1];
    if (unit === '克' || unit === 'G') unit = 'g';
    if (!base) {
      if (/^\d+\s*(kcal|千卡|大卡)/i.test(s)) return;
      const cleaned = s.replace(UNIT_RE, '').replace(CN_RE, '').replace(/半/g, '').trim() || s.slice(0, 12);
      items.push({ name: cleaned.slice(0, 12), portion: '', kcal: 0, baseKcal: 0, factor: 1, guess: true, confidence: 0.3 });
      return;
    }
    const std = baseQty(base);
    let factor = qty / std;
    let portion = (base[3] === '100g')
      ? (Math.round(qty * 100) + ' g')
      : ((qty === 1 ? base[1] : qty + ' ' + (unit || base[3])));
    if (base[3] === '100g') {
      // 克数按 100g 基准折算；写成「100g」也可
      if (/g|克/i.test(unit)) unit = 'g';
      const g = (unit === 'g' || unit === '') ? qty : qty * 100;
      factor = g / 100;
      portion = Math.round(g) + ' g';
    } else if (unit && unit !== base[3] && base[3] !== '100g') {
      // 单位不同（如「米饭 1 份」）也按份计，避免算不出
      factor = qty;
    }
    items.push({
      name: base[0],
      portion: /半/.test(base[1]) && factor === 1 ? base[1] : portion,
      kcal: round(base[2] * (factor === 1 && /半/.test(base[1]) ? 1 : factor)),
      baseKcal: base[2],
      factor: factor === 1 && /半/.test(base[1]) ? 1 : factor,
      confidence: 1
    });
  });
  return items;
}

// 份量 chips：少半份 / 标准 / 多一倍（相对识别时的标准份量）
function rescale(item, factor) {
  const baseKcal = Number(item.baseKcal) || (Number(item.kcal) / (Number(item.factor) || 1)) || 0;
  const label = factor === 0.5 ? '少半份' : (factor === 2 ? '多一倍' : '标准');
  const std = String(item.portion || '1 份');
  return {
    name: item.name,
    portion: factor === 1 ? std : (label + ' · ' + std),
    kcal: round(baseKcal * factor),
    baseKcal,
    factor,
    confidence: item.confidence
  };
}

function totalOf(items) { return (items || []).reduce((a, x) => a + (Number(x.kcal) || 0), 0); }

// 拍照识别 prompt：按常见餐具估份量，输出严格 JSON
function visionMessages(url, habitHint) {
  const table = LIB.slice(0, 30).map(r => r[0] + '=' + r[1] + '≈' + r[2] + 'kcal').join('；');
  const prompt = [
    '你在看一张饮食照片。识别画面里所有食物，按常见餐具份量估算热量。',
    '只输出 JSON，不要解释、不要代码块：',
    '{"isFood":true,"meal":"午餐","items":[{"name":"米饭","portion":"1 碗","kcal":230,"confidence":0.8}],"totalKcal":680,"note":"份量按常见餐具估算"}',
    '规则：',
    '1. 逐个列出看得见的食物，最多 8 项；每项 kcal 是整数，按图上份量估。',
    '2. portion 用「1 碗 / 半盘 / 1 份 / 1 个 / 1 杯」这种常见餐具说法，不要写克数。',
    '3. confidence 0-1：看不清、被遮挡、份量拿不准就给 0.3-0.6。',
    '4. 画面不是食物 → {"isFood":false}。',
    '5. 常见份量参考：' + table + '。',
    habitHint ? ('6. 这个用户以前修正过的份量习惯：' + habitHint + '。') : ''
  ].filter(Boolean).join('\n');
  return [{
    role: 'user',
    content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url } }]
  }];
}

// 修正样本：用户每次改份量都记一条，做下次 prompt 的 few-shot
const HABIT_KEY = 'selfagent_meal_habit_v1';
function remember(name, portion) {
  try {
    const all = wx.getStorageSync(HABIT_KEY) || {};
    const k = String(name || '').trim();
    if (!k) return;
    all[k] = { portion: String(portion || ''), at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > 30) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 30).forEach(kk => { delete all[kk]; });
    wx.setStorageSync(HABIT_KEY, all);
  } catch (e) {}
}

function habitHint() {
  try {
    const all = wx.getStorageSync(HABIT_KEY) || {};
    return Object.keys(all).slice(-8).map(k => k + '→' + all[k].portion).join('，');
  } catch (e) { return ''; }
}

/* ---------------- 汇总 / 趋势 ---------------- */
function mealLogs(logs, date) {
  return (logs || []).filter(l => l && l.kind === 'meal' && (!date || l.date === date));
}

function kcalOfDay(logs, date) {
  return mealLogs(logs, date).reduce((a, l) => a + (Number((l.meta || {}).totalKcal) || 0), 0);
}

// 近 N 天热量：每天一根条，另给训练日 / 休息日均值
function trend(logs, days, train) {
  const n = Math.max(1, Number(days) || 7);
  const today = new Date();
  const bars = [];
  let sum = 0, cnt = 0, trainSum = 0, trainN = 0, restSum = 0, restN = 0;
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const dk = engine.dayKey(d);
    const kcal = kcalOfDay(logs, dk);
    const hasTrain = !!(train && (train.records || []).some(r => r && r.date === dk));
    if (kcal > 0) {
      sum += kcal; cnt++;
      if (hasTrain) { trainSum += kcal; trainN++; } else { restSum += kcal; restN++; }
    }
    bars.push({ dk, label: dk.slice(5).replace('-', '/'), kcal, train: hasTrain });
  }
  const max = bars.reduce((a, x) => Math.max(a, x.kcal), 0) || 1;
  bars.forEach(b => { b.h = Math.round(b.kcal / max * 100); });
  const avg = cnt ? Math.round(sum / cnt) : 0;
  const trAvg = trainN ? Math.round(trainSum / trainN) : 0;
  const rsAvg = restN ? Math.round(restSum / restN) : 0;
  let text = '';
  if (!cnt) text = '这几天还没记饮食';
  else if (trAvg && rsAvg) text = '训练日平均 ' + trAvg + ' kcal，休息日 ' + rsAvg + ' kcal';
  else if (trAvg) text = '训练日平均 ' + trAvg + ' kcal';
  else text = '记录日均 ' + avg + ' kcal';
  return { bars, max, avg, trainAvg: trAvg, restAvg: rsAvg, dayCount: cnt, text };
}

module.exports = {
  LIB, byName, parseText, rescale, totalOf, visionMessages,
  remember, habitHint, mealLogs, kcalOfDay, trend, round
};
