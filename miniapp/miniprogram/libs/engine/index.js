// 规则引擎 / 文案生成。纯函数、无 DOM、无 wx API —— 与网页版共享同一份实现。
// 网页版对应：index.html 内的 dayItems / dayContent / lgd / dots 等纯逻辑段。

function volumeOf(items) {
  return (items || []).reduce((acc, it) => {
    if (!it || it.type === 'cardio') return acc;
    return acc + (it.groups || []).reduce(
      (a, g) => a + (g.done && !g.warmup ? (g.reps || 0) * (g.weight || 0) : 0), 0
    );
  }, 0);
}

function setsOf(items) {
  let done = 0, total = 0;
  (items || []).forEach(it => {
    if (!it || it.type === 'cardio') return;
    const gs = it.groups || [];
    total += gs.length || it.sets || 0;
    done += gs.filter(g => g.done).length;
  });
  return { done, total };
}

function summarize(items) {
  const strength = (items || []).filter(i => i.type !== 'cardio');
  const cardio = (items || []).filter(i => i.type === 'cardio');
  const { done, total } = setsOf(strength);
  return {
    exerciseCount: strength.length,
    done, total,
    cardio: cardio.map(c => ({ name: c.name, min: c.min || 0 })),
    volume: Math.round(volumeOf(strength))
  };
}

// 组数据压缩成一行文案：42kg 4×12 / 混合组取前三条
function groupLine(groups) {
  const a = (groups || []).filter(g => !g.warmup);
  if (!a.length) return '';
  const one = g => (g.weight > 0 ? g.weight + 'kg' : '自重') + '×' + (g.reps || 0);
  const same = a.every(g => (g.weight || 0) === (a[0].weight || 0) && (g.reps || 0) === (a[0].reps || 0));
  if (same) return (a[0].weight > 0 ? a[0].weight + 'kg' : '自重') + ' ' + a.length + '×' + (a[0].reps || 0);
  const parts = a.map(one);
  return parts.length > 3 ? parts.slice(0, 3).join(' · ') + ' · +' + (parts.length - 3) : parts.join(' · ');
}

module.exports = { volumeOf, setsOf, summarize, groupLine };
