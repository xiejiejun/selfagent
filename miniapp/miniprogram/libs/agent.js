// Agent 三阶段分析：画像 → 规划 → 趋势推演。纯规则词典，无 wx/DOM 依赖。
// 对应网页版 index.html 的 ENGINE 闭包（analyze / genPersona / genPlan / genTrend）。

const LEX = {
  time: {
    morning: ['早上', '清晨', '早起', '上午', '六点', '7点', '8点', '早饭'],
    noon: ['中午', '下午', '午后'],
    night: ['晚上', '深夜', '凌晨', '熬夜', '晚睡', '睡前', '十点', '11点', '12点', '一点', '两点']
  },
  energy: {
    high: ['精力好', '状态好', '清醒', '专注', '高效', '精神', '有劲', '满血', '干劲', '状态在线', '投入'],
    low: ['累', '疲惫', '困', '没精神', '疲倦', '昏沉', '乏力', '状态差', '撑不住', '虚', '精疲力尽', '犯困']
  },
  action: {
    delay: ['拖延', '拖', '赶', '临时', '截止', 'deadline', '压线', '来不及', '最后', '踩点', '拖延症'],
    focus: ['专注', '坚持', '一口气', '进入状态', '心流', '一口气写完', '连做', '认真'],
    giveup: ['放弃', '半途', '坚持不下去', '中断', '搁置', '没做完', '三天打鱼', '中途']
  },
  fit: {
    types: ['跑步', '跑', '撸铁', '力量', '健身', '瑜伽', '游泳', '打球', '篮球', '跳绳', '拉伸', '深蹲', '卧推', '引体', '训练', '骑行', '爬山', '有氧', '无氧'],
    body: ['体重', '腰', '膝盖', '背', '肩', '伤病', '疼', '酸痛', '恢复', '睡眠不足', '睡不够', '肌肉', '力竭', '拉伸', '体检']
  },
  work: {
    task: ['开会', '代码', '写代码', '需求', '项目', '汇报', '报告', '方案', '客户', '团队', 'review', '迭代', '改bug', '测试', '文档', '评审', '例会'],
    pressure: ['加班', '通宵', '赶工', '压', '忙', '加急', '连轴', 'deadline', '排期', '紧张']
  },
  mood: {
    pos: ['开心', '轻松', '满意', '平静', '充实', '愉快', '舒服', '放松', '爽', '稳', '顺'],
    neg: ['焦虑', '烦躁', '低落', '压力', '崩溃', '委屈', '心累', '慌', 'emo', '烦', '丧', '内耗', '紧绷']
  },
  value: {
    growth: ['成长', '学习', '进步', '技能', '提升', '读书', '课', '学', '技术', '深耕'],
    money: ['收入', '工资', '钱', '副业', '赚钱', '理财', '涨薪', '奖金'],
    health: ['健康', '身体', '早睡', '作息', '锻炼', '体检', '元气'],
    freedom: ['自由', '节奏', '可控', '时间', '自主', '掌控', '平衡']
  }
};

function fmtT(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function find(log, words) {
  const t = (log.type || '') + ' ' + (log.tags || '') + ' ' + (log.content || '');
  return words.filter(w => t.indexOf(w) >= 0);
}
function hitsIn(dimKey, subKey, logs) {
  const arr = [];
  logs.forEach(log => {
    const h = find(log, LEX[dimKey][subKey]);
    if (h.length) arr.push({ log, h });
  });
  return arr;
}
const count = arr => arr.length;
const uniqWords = arr => Array.from(new Set(arr.flatMap(x => x.h))).slice(0, 6);

function conf(n) { return n >= 3 ? { s: '高置信', c: 3 } : n >= 1 ? { s: '中置信', c: 2 } : { s: '暂无足够记录', c: 0 }; }

function analyze(logs) {
  const d = {};
  d.time_m = hitsIn('time', 'morning', logs);
  d.time_n = hitsIn('time', 'noon', logs);
  d.time_ng = hitsIn('time', 'night', logs);
  d.energy_h = hitsIn('energy', 'high', logs);
  d.energy_l = hitsIn('energy', 'low', logs);
  d.act_delay = hitsIn('action', 'delay', logs);
  d.act_focus = hitsIn('action', 'focus', logs);
  d.act_giveup = hitsIn('action', 'giveup', logs);
  d.fit_types = hitsIn('fit', 'types', logs);
  d.fit_body = hitsIn('fit', 'body', logs);
  d.work_task = hitsIn('work', 'task', logs);
  d.work_pres = hitsIn('work', 'pressure', logs);
  d.mood_pos = hitsIn('mood', 'pos', logs);
  d.mood_neg = hitsIn('mood', 'neg', logs);
  d.val_growth = hitsIn('value', 'growth', logs);
  d.val_money = hitsIn('value', 'money', logs);
  d.val_health = hitsIn('value', 'health', logs);
  d.val_freedom = hitsIn('value', 'freedom', logs);
  const byType = { work: 0, fit: 0, life: 0 };
  logs.forEach(l => { if (byType[l.type] != null) byType[l.type]++; });
  d.byType = byType;
  return d;
}

function line(text, warn, confTag) {
  return { text, warn: !!warn, conf: confTag || '' };
}

/* ---------------- 画像 ---------------- */
function buildPersona(logs, d, train) {
  const N = logs.length;
  const sections = [];

  // 一、事实快照
  const typeMap = [['工作', d.byType.work], ['健身', d.byType.fit], ['生活习惯', d.byType.life]]
    .filter(x => x[1] > 0).map(x => x[0] + ' ' + x[1] + ' 条').join('，');
  const snap = logs.slice(-3).map(l => {
    const tp = l.type === 'work' ? '工作' : l.type === 'fit' ? '健身' : '生活';
    return line('[' + tp + '] ' + (l.content || '') + ' · ' + fmtT(l.time));
  });
  sections.push({ title: '一、事实快照', lines: [line('共 ' + N + ' 条记录，类型分布：' + (typeMap || '暂无') + '。以下是抽样片段：')].concat(snap) });

  // 二、精力节律
  const cm = count(d.time_m), cng = count(d.time_ng), ch = count(d.energy_h), cl = count(d.energy_l);
  const s2 = [];
  const morningFav = cm >= ch && cm > 0;
  if (cm >= 2 || ch >= 2) {
    s2.push(line('活动记录偏集中在' + (cm >= cng ? '白天时段' : '夜间') + '；' + (ch >= 2 ? '多次提到「' + uniqWords(d.energy_h).join('、') + '」等状态词，判断白天尤其是上午精力较充沛。' : '精力状态描述有限，仅作中置信参考。'), !morningFav, conf(Math.max(cm, ch)).s));
  } else {
    s2.push(line('精力状态线索不足，暂无法推断偏好时段。', false, conf(0).s));
  }
  if (cl >= 2) {
    s2.push(line('存在明显的疲惫信号（命中「' + uniqWords(d.energy_l).join('、') + '」），且 ' + (cng >= 2 ? '晚间/后半夜活动频繁，作息与精力恢复可能相互拖累' : '尚未见对应作息数据') + '。需留意恢复', true, conf(cl).s));
  } else if (cl >= 1) {
    s2.push(line('偶尔出现疲惫记录，暂未成稳定模式。', false, conf(cl).s));
  }
  if (cng >= 2) {
    s2.push(line('记录显示晚间/后半夜仍有活动（命中「' + uniqWords(d.time_ng).join('、') + '」），若与低精力同时出现，是画像中的矛盾点。', false, conf(cng).s));
  }
  sections.push({ title: '二、精力节律画像', lines: s2 });

  // 三、行为与执行力
  const cd = count(d.act_delay), cf = count(d.act_focus), cg = count(d.act_giveup);
  const s3 = [];
  if (cd >= 1 || cf >= 1 || cg >= 1) {
    if (cd >= cf && cd >= 1) s3.push(line('存在启动阻力：多次出现「' + uniqWords(d.act_delay).join('、') + '」，说明在缺少明确截止或兴趣的任务上，启动阶段易拖延。', false, conf(cd).s));
    else if (cf >= 1) s3.push(line('执行力偏积极：多次出现「' + uniqWords(d.act_focus).join('、') + '」，说明进入状态后可持续投入。', false, conf(cf).s));
    if (cg >= 1) s3.push(line('有中断记录（「' + uniqWords(d.act_giveup).join('、') + '」），可能反映坚持模式易受外部干扰。', true, conf(cg).s));
    if (cd >= 1 && cf >= 1) s3.push(line('矛盾点：既存在启动拖延、又存在进入状态后的专注，推测核心卡点可能在「开始」而非「过程」。', false, '推断'));
  } else {
    s3.push(line('暂无足够记录推断行为特质。' + conf(0).s));
  }
  sections.push({ title: '三、行为与执行力特质', lines: s3 });

  // 四、身体 & 健身
  const cft = count(d.fit_types), cfb = count(d.fit_body);
  const s4 = [];
  if (cft >= 1) {
    s4.push(line('有规律的运动倾向，涉及「' + uniqWords(d.fit_types).join('、') + '」等，身体活跃度' + (cft >= 3 ? '较高' : '中等') + '。', false, conf(cft).s));
    if (cfb >= 1) s4.push(line('同时出现身体反馈词（「' + uniqWords(d.fit_body).join('、') + '」），建议把恢复与睡眠纳入计划、与训练强度平衡。', true, conf(cfb).s));
  } else {
    s4.push(line('暂无运动类记录，无法判断健身倾向。' + conf(0).s));
  }
  sections.push({ title: '四、身体 & 健身画像', lines: s4 });

  // 五、工作认知模式
  const cwt = count(d.work_task), cwp = count(d.work_pres);
  const s5 = [];
  if (cwt >= 1) {
    s5.push(line('工作记录以「' + uniqWords(d.work_task).join('、') + '」为主，处于' + (cwt >= 4 ? '多任务并行' : '常规推进') + '状态。', false, conf(cwt).s));
    if (cwp >= 1) s5.push(line('存在压力信号（「' + uniqWords(d.work_pres).join('、') + '」），高强度节奏若持续，可能挤占恢复与健身。', true, conf(cwp).s));
  } else {
    s5.push(line('暂无工作类记录。' + conf(0).s));
  }
  sections.push({ title: '五、工作认知模式', lines: s5 });

  // 六、情绪反应模式
  const cp = count(d.mood_pos), cn = count(d.mood_neg);
  const s6 = [];
  if (cp >= 1 || cn >= 1) {
    if (cn > cp) s6.push(line('近期负面情绪词偏多（「' + uniqWords(d.mood_neg).join('、') + '」），可能与工作压力/睡眠相关，是画像中的关注点。', true, conf(cn).s));
    else if (cp >= 1) s6.push(line('情绪记录偏正向（「' + uniqWords(d.mood_pos).join('、') + '」），整体状态较稳定。', false, conf(cp).s));
    if (cn >= 1 && cwp >= 1) s6.push(line('矛盾点：负面情绪与工作压力词重叠出现，提示「情绪低谷」很可能由工作节奏触发。', false, '推断'));
  } else {
    s6.push(line('暂无情绪类记录。' + conf(0).s));
  }
  sections.push({ title: '六、情绪反应模式', lines: s6 });

  // 七、价值优先级
  const vals = [['成长', count(d.val_growth)], ['健康', count(d.val_health)], ['金钱', count(d.val_money)], ['自由/平衡', count(d.val_freedom)]]
    .sort((a, b) => b[1] - a[1]);
  sections.push({
    title: '七、内在价值优先级',
    lines: vals[0][1] > 0
      ? [line('从记录中的关注点反推，当前价值排序：' + vals.filter(v => v[1] > 0).map(v => v[0] + '(' + v[1] + ')').join(' → '))]
      : [line(conf(0).s + '，暂无足够记录推断价值偏好。')]
  });

  // 八、校验清单
  const missing = [];
  if (cft === 0) missing.push('健身');
  if (cwt === 0) missing.push('工作');
  if (count(d.mood_pos) + count(d.mood_neg) === 0) missing.push('情绪');
  if (cm + count(d.time_n) + cng === 0) missing.push('作息时段');
  sections.push({
    title: '八、画像校验清单',
    lines: [
      line('矛盾点：暂无明显矛盾（或数据不足）'),
      line('缺失信息：' + (missing.length ? missing.join('、') + ' —— 建议补充对应记录以提升画像精度' : '当前维度基本覆盖，可继续累积样本'))
    ]
  });

  // 九、摘要
  const sum = 'N=' + N + '; 精力=' + (ch >= 2 ? '白天高' : '待观察') + '; 执行=' + (cd && cf ? '启动拖/过程专' : '待观察') + '; 健身=' + (cft ? '活跃' : '不足') + '; 情绪=' + (cn > cp ? '偏负压' : '偏稳') + '; 价值top=' + (vals[0][1] > 0 ? vals[0][0] : '待观察');
  sections.push({ title: '九、画像摘要', lines: [line('SUMMARY: ' + sum)] });

  // 十、训练压力与恢复（可选，依赖训练数据）
  try {
    const recs = (train && train.records ? train.records : []).filter(r => r.date);
    if (recs.length >= 2) {
      const day = {};
      recs.forEach(r => {
        const dd = day[r.date] = day[r.date] || { vol: 0, hard: 0 };
        const uni = engine.uniOf(r);
        (r.groups || []).forEach(g => {
          if (!g.done) return;
          dd.vol += engine.setVolume(g, uni);
          if (g.rpe === 'hard') dd.hard++;
        });
      });
      const dates = Object.keys(day).sort();
      const avgScore = ds => {
        const arr = [];
        ds.forEach(d2 => logs.forEach(l => { if ((l.date || '').slice(0, 10) === d2 && typeof l.score === 'number') arr.push(l.score); }));
        return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      };
      const nxt = d2 => { const t = new Date(d2 + 'T00:00:00'); t.setDate(t.getDate() + 1); return t.toISOString().slice(0, 10); };
      const hardDates = dates.filter(d2 => day[d2].hard >= 3);
      const otherDates = dates.filter(d2 => day[d2].hard < 3);
      const s10 = [];
      if (hardDates.length >= 2 && otherDates.length >= 1) {
        const a = avgScore(hardDates.map(nxt)), b = avgScore(otherDates.map(nxt));
        if (a != null && b != null) {
          const diff = a - b;
          s10.push(line('力竭组 ≥3 的训练日共 ' + hardDates.length + ' 天，次日平均精力 ' + a.toFixed(1) + '；其余训练日次日 ' + b.toFixed(1) + '，差 ' + (diff >= 0 ? '+' : '') + diff.toFixed(1) + '。' + (diff < -0.3 ? '高强度后恢复偏慢，建议连续高力竭日之间插入轻量日' : ''), diff < -0.3, conf(hardDates.length).s));
        } else {
          s10.push(line('已有 ' + hardDates.length + ' 个高力竭训练日，但缺少对应次日的精力记录，补记后才能对比恢复情况。'));
        }
      } else {
        s10.push(line('高力竭训练日（单日力竭组 ≥3）目前 ' + hardDates.length + ' 天，样本不足，暂不做压力-恢复对比。'));
      }
      const week = {};
      dates.forEach(d2 => {
        const t = new Date(d2 + 'T00:00:00');
        const k = t.getFullYear() + '-' + Math.ceil(((t - new Date(t.getFullYear(), 0, 1)) / 864e5 + 1) / 7);
        week[k] = (week[k] || 0) + day[d2].vol;
      });
      const wk = Object.keys(week).sort();
      if (wk.length >= 2) {
        const cur = week[wk[wk.length - 1]], prev = week[wk[wk.length - 2]];
        const pct = prev > 0 ? Math.round((cur - prev) / prev * 100) : null;
        s10.push(line('本周总容量 ' + Math.round(cur) + ' kg（训练容量=重量×次数），上周 ' + Math.round(prev) + ' kg' + (pct != null ? '，变化 ' + (pct >= 0 ? '+' : '') + pct + '%' : '') + '。' + (pct != null && Math.abs(pct) >= 30 ? '周间波动较大，注意渐进节奏' : ''), pct != null && Math.abs(pct) >= 30, conf(wk.length).s));
      } else {
        s10.push(line('容量趋势需要跨周数据，当前仅 ' + wk.length + ' 周，继续累积。'));
      }
      const rpeN = recs.reduce((a, r) => a + ((r.groups || []).filter(g => g.rpe).length), 0);
      s10.push(line('已采集带 RPE 的组共 ' + rpeN + ' 组' + (rpeN < 10 ? '（样本偏少，结论仅供参考）' : '。')));
      sections.push({ title: '十、训练压力与恢复', lines: s10 });
    }
  } catch (e) { /* 数据不足时跳过 */ }

  return sections;
}

/* ---------------- 规划 ---------------- */
function buildPlan(logs, d) {
  const cd = count(d.act_delay);
  const cg = count(d.act_giveup);
  const morning = count(d.time_m) >= count(d.time_ng);
  const workHeavy = count(d.work_task) >= 2;
  const pressure = count(d.work_pres) >= 1;
  const fitAct = count(d.fit_types) >= 1;
  const bodyWarn = count(d.fit_body) >= 1;
  const peak = morning ? '上午 9:00–11:30' : (count(d.energy_h) >= count(d.energy_l) ? '状态进入后（约 10:00 起）' : '按实际精力峰值');
  const fragile = pressure || bodyWarn;
  const sections = [];

  sections.push({ title: '一、目标对齐校验', lines: [line('依据画像：当前是' + (workHeavy ? '任务负载较高的节奏' : '') + (pressure ? '、伴有压力信号' : '') + (fitAct ? '、有运动习惯' : '') + (bodyWarn ? '、但存在身体恢复提示' : '') + '。规划以「稳住工作产出的同时，把恢复与节奏放回可控制范围」为底层目标。')] });

  const s2 = [line('把高难度任务排在' + peak + '——这是你的精力高区，不要反着用。', false, count(d.energy_h) ? conf(count(d.energy_h)).s : '')];
  s2.push(line(morning ? '早间是相对清醒时段，适合列清单与低摩擦启动；' : '晚间活动偏多，把「复盘」放在入睡前而非深度工作前。'));
  if (cd) s2.push(line('存在启动拖延：用「只做 5 分钟」的微启动降低心理门槛，先把引擎点着。'));
  if (cg) s2.push(line('有中断倾向：给任务设「最小完成单元」，完成一个单元即算一次闭合，减少半途感。'));
  sections.push({ title: '二、核心原则（由画像推导）', lines: s2 });

  sections.push({
    title: '三、本周滚动计划',
    lines: [
      line('P0 · 高优先：' + (workHeavy ? '把 1 个关键产出切分为 3 个半天小步，每天完成一段' : '为本周立 1 个可交付的小产出，用 5 个工作日各推进 20%')),
      line('P0 · 恢复：' + (fitAct ? '保留健身 2 次，控制在不造成第二日疲劳的强度' : '安排 3 次 30 分钟轻运动，作为精力充电而非消耗')),
      line('P1 · 中优先：睡前 30 分钟离开屏幕，记录当天气力/情绪评分'),
      line('P1 · 中优先：每日固定 2 个「不被打断」的时间块，各 45 分钟'),
      line('P2 · 可舍弃：低价值刷信息流限时 1 次/天，作为状态切换的出口而非逃避')
    ]
  });

  sections.push({
    title: '四、典型单日节律模板',
    lines: [line(peak + '：处理最难的一件事。'), line('午后：轻量协同、会议、琐事。'), line((morning ? '晚 18 点前后' : '夜间') + '：' + (fitAct ? '运动' : '散步/拉伸') + ' 30 分钟。'), line('入睡前 30 分钟：复盘打分，不接触高强度内容。')]
  });

  sections.push({
    title: '五、降级预案（状态差时自动简化）',
    lines: [line(fragile ? '检测到压力/恢复风险，若某日精力极低：只保留 P0 的最小版本（当日 1 个产出单元 + 不运动），其余全部降级，别自责。' : '若某日精力不足，压缩为「1 个产出 + 1 次轻运动」，保底不崩。')]
  });

  sections.push({
    title: '六、追踪指标（用于迭代画像）',
    lines: [line('每日精力评分（1–5）、入睡时间、完成产出单元数'), line('记录一次「今天卡在哪一步」（启动/中途/结束），用于校准行为画像')]
  });

  return sections;
}

/* ---------------- 趋势推演 ---------------- */
function buildTrend(logs, d) {
  const workHeavy = count(d.work_task) >= 3;
  const pressure = count(d.work_pres) >= 1;
  const fitAct = count(d.fit_types) >= 2;
  const bodyWarn = count(d.fit_body) >= 1;
  const cn = count(d.mood_neg), cp = count(d.mood_pos);
  const moodNeg = cn > cp && cn >= 1;
  const delay = count(d.act_delay) >= 1;
  const night = count(d.time_ng) >= 2;

  const ampPos = [], ampNeg = [];
  if (fitAct) ampPos.push('运动习惯是显著的正向复利源：随恢复改善，工作耐力和情绪稳定性同步抬升');
  if (!night && !moodNeg) ampPos.push('作息与情绪整体稳定，是长期产出的底层保障');
  if (delay) ampNeg.push('启动拖延是负向放大器：单次拖延叠加到任务累积，会周期性制造赶工与焦虑');
  if (night && moodNeg) ampNeg.push('「夜间活动 + 情绪偏负」形成循环：睡得越晚状态越差，状态越差越容易刷手机熬夜');
  if (pressure && bodyWarn) ampNeg.push('高压工作挤占恢复，身体反馈与压力叠加，存在过劳信号');

  const interventions = [];
  if (delay) interventions.push('把最难任务固定在每天精力高区，用「5 分钟微启动」拆掉拖延门槛');
  if (night) interventions.push('把入睡时间向前移 30 分钟，切段「熬夜—低状态」循环');
  if (fitAct) interventions.push('保住运动频率这一复利源，并平衡强度保护恢复');
  if (pressure) interventions.push('为高压周主动预排降级预案，避免连轴转');

  const obs = [];
  if (moodNeg) obs.push('情绪低谷频率（每周负面记录次数）');
  if (night) obs.push('入睡时间的中位数与波动');
  if (fitAct) obs.push('运动周频与体感疲劳的匹配');
  if (workHeavy) obs.push('工作产出的完成单元数趋势');
  if (!obs.length) obs.push('开始累积记录后，先观察精力、情绪与作息的基线');

  const sections = [];
  sections.push({ title: '一、推演前提假设', lines: [line('在「保持当前行为模式、外部机遇与突发变量不变」的假设下推演'), line('以下为可能性参考，不构成对未来结果的确定性预言')] });

  const scnB = '若启动干预点（' + interventions.slice(0, 2).map(x => x.split('：')[0]).join('、') + '）执行 4–6 周，预计：恢复改善 → 精力与情绪更稳 → 工作产出质量与可持续性同时提升，进入正向复利。';
  sections.push({
    title: '二、三条情景分支',
    lines: [
      line('情景A · 基准（最可能）：保持现状，' + (workHeavy ? '工作量维持高位，产出稳定但节奏紧绷' : '节奏平稳') + (delay ? '，拖延偶发但在可接受范围' : '，执行顺畅') + '。' + (night && moodNeg ? '代价是恢复不足，状态小幅下行' : '长期看状态缓慢改善。')),
      line('情景B · 乐观（需满足条件）：' + scnB, false, 'good'),
      line('情景C · 风险（预警）：若' + (pressure ? '高压节奏 + ' : '') + (night ? '长期熬夜 + ' : '') + (moodNeg ? '情绪负循环' : '恢复不足') + '持续叠加而无人为干预，最可能滑向过度疲劳与效率下行的阶段，届时健身与作息会成为最早被挤掉的项。', true)
    ]
  });

  sections.push({
    title: '三、正向 & 负向放大器',
    lines: (ampPos.length ? ampPos : ['持续记录本身就是正向行为：数据积累会让画像越来越准，干预越来越精准']).map(t => line('+ ' + t, false, 'good'))
      .concat((ampNeg.length ? ampNeg : ['暂无显著负向循环信号，但数据量仍少，需继续观察']).map(t => line('− ' + t, true)))
  });

  sections.push({ title: '四、关键干预控制点（最小改动即可改变走向）', lines: (interventions.length ? interventions : ['先从每天固定记录开始，让画像有数据可依']).map(t => line(t)) });
  sections.push({ title: '五、需持续观测的信号', lines: obs.map(t => line(t)) });
  sections.push({ title: '六、推演局限性', lines: [line('本推演仅基于你过往行为模式做逻辑外推，外部机遇、突发变量会大幅改变走向；不构成职业、医疗、理财或任何重大决策依据。记录越多，推演越贴近真实。')] });

  return sections;
}

// 入口：一次性产出三阶段
function buildReport(logs, train) {
  const d = analyze(logs || []);
  return {
    persona: buildPersona(logs || [], d, train),
    plan: buildPlan(logs || [], d),
    trend: buildTrend(logs || [], d),
    count: (logs || []).length
  };
}

module.exports = { analyze, buildPersona, buildPlan, buildTrend, buildReport, conf };
