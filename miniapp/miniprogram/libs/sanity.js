// 上屏前的文案质量门：AI 输出、拼接摘要先过一遍，不合格就退回规则模板。
// 只做“能确定是坏文案”的判断，不追求语文评分；命中任意一条即判不合格：
//   1. 空/纯标点
//   2. 脏词与占位符（undefined / NaN / 分割成 / 替换符 等）
//   3. 句子没说完就断在冒号、逗号、顿号、括号未闭合
//   4. 连续同字 ≥3、连续感叹/问号
//   5. 中文字数占比过低（英文残片、编码乱码）
//   6. 超过长度上限（默认 60 字），或带 markdown 代码块
const PLACE_RE = /(undefined|NaN|[【\[]\s*[】\]]|%s|%d|{{\s*}}|\uFFFD)/;
const BAD_WORD_RE = /(分割成|到滴酒|滴酒定|占位符|placeholder)/;
const TAIL_BAD_RE = /[：:，,、；;（(【\[]$/;
const GARBAGE_RE = /(.)\1{2,}/;

function cjkRatio(s) {
  const t = String(s).replace(/\s/g, '');
  if (!t.length) return 0;
  let cjk = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c >= 0x4e00 && c <= 0x9fff) cjk++;
  }
  return cjk / t.length;
}

function bracketsBalanced(s) {
  const pairs = [['（', '）'], ['(', ')'], ['【', '】'], ['[', ']'], ['「', '」']];
  for (let i = 0; i < pairs.length; i++) {
    const a = (String(s).split(pairs[i][0]).length - 1);
    const b = (String(s).split(pairs[i][1]).length - 1);
    if (a !== b) return false;
  }
  return true;
}

// 返回 { ok, text, reason }；text 已 trim
function inspect(text, opts) {
  const o = opts || {};
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!t) return { ok: false, text: '', reason: '空文案' };
  if (!/[0-9A-Za-z\u4e00-\u9fff]/.test(t)) return { ok: false, text: t, reason: '纯标点' };
  if (t.indexOf('```') >= 0) return { ok: false, text: t, reason: '代码块' };
  if (PLACE_RE.test(t)) return { ok: false, text: t, reason: '占位符/空值' };
  if (BAD_WORD_RE.test(t)) return { ok: false, text: t, reason: '黑名单词' };
  if (TAIL_BAD_RE.test(t)) return { ok: false, text: t, reason: '句子截断' };
  if (!bracketsBalanced(t)) return { ok: false, text: t, reason: '括号未闭合' };
  if (/[!！?？]{2,}/.test(t)) return { ok: false, text: t, reason: '重复标点' };
  if (GARBAGE_RE.test(t)) return { ok: false, text: t, reason: '连续重复字' };
  if (cjkRatio(t) < (o.minCjk == null ? 0.3 : o.minCjk)) return { ok: false, text: t, reason: '中文占比过低' };
  const max = o.max == null ? 60 : o.max;
  if (t.length > max) return { ok: false, text: t, reason: '超过 ' + max + ' 字' };
  return { ok: true, text: t, reason: '' };
}

function ok(text, opts) { return inspect(text, opts).ok; }

// 主入口：不合格就返回 fallback（fallback 也空时给一句安全兜底）
function check(text, fallback, opts) {
  const r = inspect(text, opts);
  if (r.ok) return r.text;
  const fb = String(fallback == null ? '' : fallback).trim();
  if (fb && inspect(fb, { max: 240 }).ok) return fb;
  return '这部分数据先看上面的数字，文字说明稍后重试。';
}

module.exports = { inspect, ok, check, cjkRatio };
