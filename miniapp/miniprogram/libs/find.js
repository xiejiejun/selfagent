// 自然语言 / 图片 → 动作库检索层
// 流程：结构化理解（AI 只解析，不检索）→ 全库别名扩展召回 60~90 → AI 重排 + 缺失提示 + 澄清
const data = require('./data/index');

const PART_ALIAS = [
  ['胸', ['胸', '胸肌', '胸大肌', '卧推', '飞鸟', '夹胸', '推胸', '上胸', '下胸', '中缝']],
  ['背', ['背', '背部', '背阔', '背阔肌', '划船', '下拉', '引体', '斜方', '菱形', '后束', '硬拉']],
  ['肩', ['肩', '三角肌', '推举', '侧平举', '前平举', '反向飞鸟', '面拉', '肩袖']],
  ['上臂', ['手臂', '上臂', '二头', '三头', '肱二', '肱三', '弯举', '臂屈伸', '下压', '仰卧撑']],
  ['前臂', ['前臂', '小臂', '腕', '握力', '农夫走']],
  ['腰腹', ['腹', '腹部', '腹肌', '核心', '卷腹', '平板', '举腿', '侧屈', '腰', '腹斜']],
  ['上腿', ['腿', '腿部', '臀', '股四', '腘绳', '内收', '外展', '深蹲', '腿举', '弓步', '髋', '翘臀']],
  ['小腿', ['小腿', '提踵', '腓肠']],
  ['全身', ['全身', '壶铃摆', '波比', '挺举', '抓举', '土耳其', '战绳', '农夫走']],
  ['有氧', ['有氧', '跑步', '慢跑', '单车', '椭圆', '跳绳', '划船机', '爬坡', '快走', '楼梯机']]
];

// 用户口语 → 库里的 e 字段（spec）与筛选分组（group）
const EQUIP_ALIAS = [
  ['绳索', ['绳索', '龙门', '龙门架', '滑轮', '拉力器', '绳索机', 'cable', '高位下拉', '坐姿划船', '绳索下压', '面拉'], ['绳索']],
  ['器械', ['器械', '固定器械', '机器', '史密斯', '史密斯机', 'smith', '蝴蝶机', '夹胸机', '腿举机', '腿屈伸', '腿弯举', '推胸机', '坐姿推肩', '哈克', '倒蹬', '髋外展', '髋内收', '提踵机', '划船机'], ['器械', '史密斯机', '锤式器械', '辅助器械', '炮筒架', '上肢功率车', '台阶机', '动感单车', '椭圆机', '滑雪机', '雪橇机']],
  ['哑铃', ['哑铃', 'dumbbell', '哑铃凳', '壶铃', '棒铃'], ['哑铃', '壶铃', '棒铃']],
  ['杠铃', ['杠铃', 'barbell', '奥杆', '奥林匹克杠', 'ez杠', 'EZ杠', '六角杠', '杠铃片'], ['杠铃', 'EZ杠', '奥林匹克杠', '六角杠', '杠铃片']],
  ['自重', ['自重', '徒手', '无器械', 'bodyweight', '单杠', '双杠', '引体架', '悬吊', 'trx', '吊环'], ['自重', '负重', '悬吊带', '健腹轮', '沙袋', '药球', '瑜伽球', '波速球']],
  ['小器械', ['弹力带', '阻力带', '弹力绳', '瑜伽球', '药球', '健腹轮', '滚轴', '泡沫轴', '沙袋', '波速球', '轮胎', '绳'], ['弹力带', '绳', '滚轴', '按摩球', '轮胎', '瑜伽球', '药球', '健腹轮', '沙袋', '波速球']],
  ['有氧', ['跑步机', '椭圆机', '动感单车', '划船机', '台阶机', '滑雪机', '跳绳', '单车'], ['上腿', '有氧']]
];

const PATTERN_WORDS = ['水平推', '垂直推', '水平拉', '垂直拉', '蹲', '髋铰链', '弯举', '臂屈伸', '核心', '旋转', '提踵', '有氧', '爆发', '夹胸', '飞鸟', '划船', '下拉'];

// 各部位的高频动作词：用来把「猫式/摇摆」这类冷门动作用后（库内没有热度数据）
const PART_MOVE = {
  '胸': ['卧推', '飞鸟', '夹胸', '推胸', '俯卧撑', '上拉'],
  '背': ['划船', '下拉', '引体', '高位', '硬拉', '面拉', '直臂', '挺身'],
  '肩': ['推举', '平举', '飞鸟', '面拉', '耸肩', '推肩'],
  '上臂': ['弯举', '臂屈伸', '下压', '撑', '窄距'],
  '前臂': ['弯举', '腕', '握', '农夫'],
  '腰腹': ['卷腹', '平板', '举腿', '仰卧', '侧屈', '登山', '屈膝', '两头'],
  '上腿': ['深蹲', '硬拉', '腿举', '弓步', '腿屈伸', '腿弯举', '臀桥', '髋', '蹬'],
  '小腿': ['提踵'],
  '全身': ['波比', '壶铃摆', '挺举', '抓举', '农夫', '战绳'],
  '有氧': ['跑', '单车', '椭圆', '跳绳', '划船机', '爬', '走']
};

// 口语关键词 → 库里的写法（上胸=上斜、背阔=下拉/划船…）
const KW_EXPAND = {
  '上胸': ['上斜', '上拉'],
  '下胸': ['下斜', '双杠'],
  '中缝': ['飞鸟', '夹胸'],
  '背阔': ['下拉', '划船', '引体'],
  '臀': ['臀', '髋'],
  '翘臀': ['臀桥', '髋', '后踢'],
  '核心': ['平板', '卷腹', '举腿'],
  '二头': ['弯举'],
  '三头': ['臂屈伸', '下压', '窄距'],
  '后束': ['反向飞鸟', '面拉'],
  '侧肩': ['侧平举'],
  '腘绳': ['腿弯举', '罗马尼亚'],
  '股四': ['深蹲', '腿举', '腿屈伸']
};

// 伤病/限制 → 本地降权词
const CONSTRAINT_WORDS = {
  '腰': ['硬拉', '俯身', '早安', '山羊', '躬身', '负重前屈'],
  '膝': ['深蹲', '弓步', '跳', '跑', '蹲跳', '腿举'],
  '肩': ['推举', '颈后', '直立划船', '过顶'],
  '腕': ['弯举', '腕', '农夫走'],
  '颈': ['颈', '耸肩']
};

function toArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(x => x && String(x).trim()).map(x => String(x).trim());
  return String(v).split(/[、,，/|]+/).map(x => x.trim()).filter(Boolean);
}

function normPart(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const p = data.PARTS.indexOf(s) >= 0 ? s : '';
  if (p) return p;
  for (let i = 0; i < PART_ALIAS.length; i++) {
    if (PART_ALIAS[i][1].some(w => s.indexOf(w) >= 0)) return PART_ALIAS[i][0];
  }
  return '';
}

function equipSlots(list) {
  const spec = new Set();
  const groups = new Set();
  toArr(list).forEach(t => {
    const s = String(t).toLowerCase();
    // 已经是分组名（「器械」「小器械」）时直接按组算，避免「小器械」被「器械」子串误判
    const exact = EQUIP_ALIAS.find(g => g[0] === t);
    if (exact) {
      groups.add(exact[0]);
      exact[2].forEach(x => spec.add(x));
      return;
    }
    EQUIP_ALIAS.forEach(([g, words, groupList]) => {
      if (words.some(w => s.indexOf(String(w).toLowerCase()) >= 0)) {
        groups.add(g);
        groupList.forEach(x => spec.add(x));
      }
    });
  });
  return { spec, groups };
}

// 把 AI 解析结果整理成可检索的 slots
function normalize(raw) {
  const r = raw || {};
  const part = normPart(r.part);
  const parts = toArr(r.parts).map(normPart).filter(Boolean);
  const equips = toArr(r.equips || r.equip || r.equipment);
  const keywords = toArr(r.keywords);
  const names = toArr(r.names);
  const patterns = toArr(r.patterns);
  const constraints = toArr(r.constraints);
  const es = equipSlots(equips);
  return {
    intent: String(r.intent || '').slice(0, 24),
    part, parts, equips, keywords, names, patterns, constraints,
    eqSpec: es.spec, eqGroups: es.groups,
    clarify: r.needClarify || r.clarify || null
  };
}

function slotLabel(s) {
  const t = [];
  if (s.part) t.push(s.part);
  if (s.equips.length) t.push(s.equips.join('/'));
  if (!t.length && s.keywords.length) t.push(s.keywords.slice(0, 2).join('/'));
  return t.join(' · ');
}

// 全库打分召回：部位/器械/名称/目标肌/动作模式，器械条件满足时硬过滤
function recall(slots, limit) {
  const cap = limit || 90;
  const all = data.all();
  const specHas = slots.eqSpec.size > 0;
  const kw = slots.keywords.concat(slots.patterns, slots.names).filter(Boolean);
  const cons = slots.constraints.join(' ');
  const rows = [];
  for (let i = 0; i < all.length; i++) {
    const x = all[i];
    let sc = 0;

    // 器械：明确条件时不满足的降权（不直接删，避免别名没覆盖到就空结果）
    if (specHas) {
      const okSpec = slots.eqSpec.has(x.e);
      const grp = EQUIP_ALIAS.find(g => g[2].indexOf(x.e) >= 0);
      const okGrp = grp && slots.eqGroups.has(grp[0]);
      sc += okSpec || okGrp ? 4 : -7;
    }

    if (slots.part && x.p === slots.part) sc += 4;
    else if (slots.parts.indexOf(x.p) >= 0) sc += 3;

    // 同部位里优先「常见动作」，冷门名字自然沉底
    const mv = PART_MOVE[x.p] || [];
    if (mv.some(w => x.n.indexOf(w) >= 0)) sc += 3;

    slots.names.forEach(nm => {
      const nn = String(nm).replace(/\s/g, '');
      const xn = x.n.replace(/\s/g, '');
      if (xn === nn) sc += 9;
      else if (nn.length >= 2 && (xn.indexOf(nn) >= 0 || nn.indexOf(xn) >= 0)) sc += 4;
    });

    kw.forEach(w => {
      const ww = String(w).toLowerCase();
      if (!ww) return;
      if (x.n.toLowerCase().indexOf(ww) >= 0) sc += 3;
      else if (x.t && x.t.toLowerCase().indexOf(ww) >= 0) sc += 2;
      // 口语词换成本地写法（上胸→上斜、背阔→下拉/划船）
      const ex = KW_EXPAND[w];
      if (ex && ex.some(v => x.n.indexOf(v) >= 0)) sc += 2;
    });

    // 中文要点：目标肌与关键词逐字重逢
    if (x.t) {
      slots.keywords.forEach(w => {
        if (w.length >= 2 && x.t.indexOf(w) >= 0 && x.n.indexOf(w) < 0) sc += 1;
      });
    }

    // 伤病限制降权（不是删除，交给重排做最终判断）
    Object.keys(CONSTRAINT_WORDS).forEach(k => {
      if (cons.indexOf(k) >= 0 && CONSTRAINT_WORDS[k].some(w => x.n.indexOf(w) >= 0)) sc -= 6;
    });

    if (sc > 0) rows.push({ x, sc });
  }
  if (!rows.length) {
    // 完全没命中：按部位/最常见兜底，保证不空
    const base = slots.part || slots.parts[0] || '';
    const fb = base ? all.filter(x => x.p === base) : all;
    return fb.slice(0, Math.min(cap, 40));
  }
  rows.sort((a, b) => b.sc - a.sc || a.x.n.length - b.x.n.length);
  // 同名去重（库里存在同动作不同 id 的情况）
  const seen = {};
  const out = [];
  for (let i = 0; i < rows.length && out.length < cap; i++) {
    const it = rows[i].x;
    const key = it.n + '|' + it.e;
    if (seen[key]) continue;
    seen[key] = 1;
    out.push(it);
  }
  return out;
}

// 动作俗称 → 库里可能的名字片段（拍照识别普遍说的是俗称）
const ACTION_ALIAS = {
  '高位下拉': ['下拉'], '坐姿划船': ['划船'], '绳索夹胸': ['飞鸟'], '龙门架夹胸': ['飞鸟'],
  '龙门架': ['绳索'], '绳索下压': ['下压'], '绳索弯举': ['弯举'], '史密斯深蹲': ['深蹲'],
  '平板卧推': ['卧推'], '双杠臂屈伸': ['臂屈伸'], '侧平举': ['平举'], '面拉': ['面拉'],
  '腿举': ['腿举'], '腿屈伸': ['腿屈伸'], '腿弯举': ['腿弯举'], '臀桥': ['臀桥'], '硬拉': ['硬拉']
};

// 仅按名称匹配（拍照识别、md 导入用），直接名没命中时按俗称展开
function byNames(names, limit) {
  const out = [];
  const miss = [];
  toArr(names).forEach(nm => {
    let ex = data.matchByName(nm);
    if (ex) {
      if (!out.some(x => x.id === ex.id)) out.push(ex);
      return;
    }
    const al = [];
    Object.keys(ACTION_ALIAS).forEach(k => { if (nm.indexOf(k) >= 0) al.push.apply(al, ACTION_ALIAS[k]); });
    let got = false;
    al.forEach(v => {
      data.search(v, '', '', 30).forEach(c => {
        if (!got && !out.some(x => x.id === c.id)) { out.push(c); got = true; }
      });
    });
    if (!got) miss.push(nm);
  });
  return { list: out.slice(0, limit || 6), miss };
}

// 没有 AI 时的本地理解：直接从原话里扫部位/器械/动作名
function guess(q) {
  const s = String(q || '').toLowerCase();
  const raw = { intent: String(q || '').slice(0, 18), part: normPart(s), equips: [], names: [], patterns: [], keywords: [], constraints: [] };
  EQUIP_ALIAS.forEach(([g, words]) => {
    if (words.some(w => s.indexOf(String(w).toLowerCase()) >= 0)) raw.equips.push(g);
  });
  // 动作名：长度 ≥3 的片段命中库名才收（避免「想练」这类噪音）
  data.all().forEach(x => {
    if (x.n.length >= 3 && s.indexOf(x.n.toLowerCase()) >= 0 && raw.names.length < 3) raw.names.push(x.n);
  });
  ['腰', '膝', '肩', '腕', '颈'].forEach(k => { if (s.indexOf(k + '疼') >= 0 || s.indexOf(k + '不好') >= 0 || s.indexOf(k + '伤') >= 0) raw.constraints.push(k); });
  return normalize(raw);
}

/* ---------- prompt ---------- */

function understandMessages(q) {
  const sys = [
    '你是健身教练兼动作检索专家。把用户的一句话解析成检索条件，不负责挑动作。',
    '只输出 JSON，不要 markdown、不要解释：',
    '{"intent":"≤18字的意图","part":"胸|背|肩|上臂|前臂|腰腹|上腿|小腿|全身|有氧|","parts":[],"equips":[""],"names":[""],"patterns":[""],"keywords":[""],"constraints":[""],"needClarify":null}',
    '规则：',
    '1. part 只填一个最主要部位，拿不准就空字符串；次要部位放 parts。',
    '2. equips 用用户口语里的器械（龙门架/绳索、哑铃、杠铃、史密斯机、自重、弹力带、跑步机…），用户没提就空数组，绝对不要猜。',
    '3. names 只放用户明确说出的动作名或俗称（如「高位下拉」「腹肌撕裂者」），没有就空。',
    '4. patterns 放动作模式：水平推/垂直推/水平拉/垂直拉/蹲/髋铰链/弯举/臂屈伸/核心屈曲/旋转/提踵/有氧。',
    '5. keywords 放目标肌群、身体感受、口语要点（如「背阔」「下胸」「腰不好别做硬拉」拆成 constraints）。',
    '6. constraints 放伤病、场地、时间、器械缺失（如「腰不适」「只有 20 分钟」「膝盖疼」）。',
    '7. 只有「缺部位或缺器械」会明显改变结果时才 needClarify：{"q":"≤14字","options":["2~4个具体可选条件"]}，选项要具体（如「健身房器械」「只有哑铃」「自重在家」）；否则 null。'
  ].join('\n');
  return [{ role: 'system', content: sys }, { role: 'user', content: String(q || '') }];
}

function candRows(cands) {
  return cands.map(x => x.id + '|' + x.n + '|' + x.p + '|' + (x.e || '自重') + '|' + (x.t || '')).join('\n');
}

// AI 偶尔把 id 写成 "227"，库里是 "0227"：补零后再查一次
function fixId(id, map) {
  const s = String(id || '').trim();
  if (!s) return '';
  if (map[s]) return s;
  const p = s.padStart(4, '0');
  return map[p] ? p : '';
}

function rerankMessages(ctx, slots, cands) {
  const sys = [
    '你是健身教练，从候选动作里替用户挑最合适的。',
    '只输出 JSON，不要 markdown、不要解释：',
    '{"picks":[{"id":"","why":""}],"notFound":[""],"clarify":null}',
    '硬规则：',
    '1. id 必须来自候选；按匹配度从高到低给 6–10 个，宁少勿滥。',
    '2. why ≤12 字，必须说清匹配点（器械/部位/动作模式/限制），不许空话；同一 why 不要重复。',
    '3. 用户有伤病或器械限制时，不适配的动作不要选；器械条件不满足的不要选。',
    '4. 名称按语义匹配，不要求字面一致：龙门架=绳索、夹胸=飞鸟/交叉、高位下拉=下拉、坐姿划船=划船、史密斯=器械、引体=引体向上。候选里有别名对应的动作就必须选，不要因为名字不同判「没有」。',
    '5. 只有候选里连同类动作都没有（同部位 + 同器械都找不到）才写 notFound，且只能填用户原话里明确点名的动作；泛指需求不要写 notFound（≤3 个）。',
    '6. 必须用户补一个关键条件（器械或部位）才选得准时，clarify 给 {"q":"≤14字","options":["2~4个"]}；否则 null。'
  ].join('\n');
  const usr = '用户原话：' + ctx +
    '\n解析结果：' + JSON.stringify({
      intent: slots.intent, part: slots.part, parts: slots.parts, equips: slots.equips,
      patterns: slots.patterns, keywords: slots.keywords, constraints: slots.constraints, names: slots.names
    }) +
    '\n候选（id|名称|部位|器械|目标肌）：\n' + candRows(cands);
  return [{ role: 'system', content: sys }, { role: 'user', content: usr }];
}

function visionMessages(url) {
  const prompt = [
    '你在看一张健身照片（器械、训练场景或动作截图）。判断画面里有什么器械、最可能对应什么训练动作。',
    '只输出 JSON：{"scene":"≤14字","equipment":[""],"part":"","parts":[],"actions":[""],"keywords":[""]}',
    '规则：',
    '1. equipment 用中文常见叫法（龙门架/绳索、史密斯机、哑铃、杠铃、跑步机…），只写看得见的。',
    '2. part 必须给一个最主要部位（胸/背/肩/上臂/前臂/腰腹/上腿/小腿/全身/有氧）；画面是器械时按这台器械的主要训练部位判断。',
    '3. actions 写画面对得上、通用的动作名，最多 5 个（如「高位下拉」「绳索夹胸」）；keywords 放目标肌或动作模式。',
    '4. 看不清或不是健身场景就少写，绝对不要编。'
  ].join('\n');
  return [{
    role: 'user',
    content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url } }]
  }];
}

module.exports = {
  normalize, slotLabel, recall, byNames, guess, fixId, understandMessages, rerankMessages, visionMessages,
  candRows, PART_ALIAS, EQUIP_ALIAS
};
