Page({
  go(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.navigateTo({ url });
  }
});
