// 有氧判定 / 默认计组方式 / 参数文案：训练页、动作详情、计划推荐共用一份口径
function isCardioEx(ex) {
  if (!ex) return false;
  const p = String(ex.p || '');
  const t = String(ex.t || '') + String(ex.m || '');
  return p.indexOf('有氧') >= 0 || t.indexOf('心肺') >= 0 || t.indexOf('有氧') >= 0;
}

// 能计数的动作默认按组，其余按时长；默认只是预选，详情页可改
function defaultCardioMode(name) {
  return /跳绳|波比|登山|开合跳|高抬腿|深蹲跳|波速|壶铃|冲刺|爬绳/.test(String(name || '')) ? 'sets' : 'timer';
}

// 计划/列表右侧参数列：计时 20′；计组 3×12（带距离时补 km）
function cardioLine(c) {
  if (!c) return '';
  const dist = Number(c.dist) || 0;
  const tail = dist > 0 ? ' · ' + dist + 'km' : '';
  if (c.mode === 'sets') return (c.sets || 0) + '×' + (c.reps || 0) + tail;
  return (c.min || c.dur || 0) + '′' + tail;
}

// 有氧模态：把动作名归一到固定几类，统计「有氧构成」用
const CARDIO_MODALS = [
  { k: '跑步', re: /跑|跑步机|慢跑|快跑|户外跑|越野跑/ },
  { k: '椭圆机', re: /椭圆/ },
  { k: '单车', re: /单车|骑行|自行车|动感单车|飞轮/ },
  { k: '划船', re: /划船/ },
  { k: '游泳', re: /游泳/ },
  { k: '跳绳', re: /跳绳|波比|开合跳|高抬腿|登山跑|爬绳/ },
  { k: '爬楼', re: /爬楼|登山机|阶梯|爬坡/ },
  { k: '走路', re: /走路|步行|散步|健走/ }
];

function modalOf(name) {
  const n = String(name || '');
  for (let i = 0; i < CARDIO_MODALS.length; i++) if (CARDIO_MODALS[i].re.test(n)) return CARDIO_MODALS[i].k;
  return '其他';
}

module.exports = { isCardioEx, defaultCardioMode, cardioLine, modalOf, CARDIO_MODALS };
