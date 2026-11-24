// 复盘（精力/情绪/睡眠）与身体数据（体重/围度）的本地存储
const CK = 'selfagent_checkin_v1';
const BD = 'selfagent_body_v1';

function read(key, dft) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? dft : v;
  } catch (e) { return dft; }
}

function write(key, val) {
  try { wx.setStorageSync(key, val); return true; } catch (e) { return false; }
}

function allCheckins() { return read(CK, {}); }

function getCheckin(dk) {
  const all = allCheckins();
  return all[dk] || null;
}

function saveCheckin(dk, obj) {
  const all = allCheckins();
  all[dk] = Object.assign({ ts: Date.now() }, obj);
  write(CK, all);
  return all[dk];
}

function recentCheckins(n) {
  const all = allCheckins();
  const days = Object.keys(all).sort((a, b) => b.localeCompare(a)).slice(0, n || 7);
  return days.map(d => Object.assign({ date: d }, all[d]));
}

function bodyList() {
  const arr = read(BD, []);
  return (Array.isArray(arr) ? arr : []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function saveBody(rec) {
  const arr = bodyList().filter(x => x.date !== rec.date);
  arr.push(Object.assign({ ts: Date.now() }, rec));
  arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  write(BD, arr);
  return arr;
}

function delBody(date) {
  const arr = bodyList().filter(x => x.date !== date);
  write(BD, arr);
  return arr;
}

module.exports = { allCheckins, getCheckin, saveCheckin, recentCheckins, bodyList, saveBody, delBody };
