// 本地存储层。键名与网页版 index.html 完全一致，便于两端对拷/合并。
const KEYS = {
  logs: 'selfagent_logs_v1',
  train: 'selfagent_training_v1',
  profile: 'selfagent_profile_v1',
  settings: 'selfagent_settings_v1',
  theme: 'selfagent_theme_v1',
  page: 'selfagent_page_v1',
  tomb: 'selfagent_del_v1',
  repFp: 'selfagent_rep_fp',
  sync: 'selfagent_sync_v1'
};

function read(key, dft) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? dft : v;
  } catch (e) {
    return dft;
  }
}

function write(key, val) {
  try {
    wx.setStorageSync(key, val);
    return true;
  } catch (e) {
    console.warn('[store] write failed', key, e);
    return false;
  }
}

function uid(prefix) {
  return (prefix || 't') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function dayKey(d) {
  const dt = d ? new Date(d) : new Date();
  const p = n => String(n).padStart(2, '0');
  return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
}

module.exports = {
  KEYS, read, write, uid, dayKey,
  getLogs() { return read(KEYS.logs, []); },
  setLogs(v) { return write(KEYS.logs, v); },
  getTrain() { return read(KEYS.train, {}); },
  setTrain(v) { return write(KEYS.train, v); },
  getTomb() { return read(KEYS.tomb, []); },
  setTomb(v) { return write(KEYS.tomb, v); }
};
