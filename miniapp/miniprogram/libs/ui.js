/* 统一触觉反馈：轻点 light，完成 medium，危险 double */
function buzz(type) {
  try {
    if (wx.vibrateShort) wx.vibrateShort({ type: type || 'light' });
  } catch (e) {}
}
module.exports = {
  light() { buzz('light'); },
  ok() { buzz('medium'); },
  warn() { buzz('heavy'); }
};
