// 在浏览器里把几张图拼成一张带标签的对比图或分镜（机器上没有 PIL 时用）。
// 图片要能被当前页面加载：放进样稿目录由本地样稿服务提供，或直接传 dataURL。
//   await __compose(['shots/_f/1.jpg', 'shots/_f/2.jpg'], [['0.0 s', '包装完成'], ['0.5 s', '关灯']], { title: '转场分镜' })
// 返回 JPEG dataURL；CDP 返回值过大时会存成文件，用 cdpshot.py 解码。
// bg 不给时取第一张图左上角像素，避免手机圆角外露出别的颜色；文字颜色按背景明暗自动选。
window.__compose = async (urls, labels = [], o = {}) => {
  if (!Array.isArray(urls) || !urls.length) throw new Error('至少需要一张图片');
  const imgs = await Promise.all(urls.map((u) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('加载失败：' + u));
    im.src = /^(data|blob):/.test(u) ? u : u + (u.includes('?') ? '&' : '?') + 'v=' + Date.now();
  })));
  const W = o.width || 470, gap = o.gap ?? 30, m = o.margin ?? 44, top = o.title ? 92 : m, lab = labels.length ? 80 : m;
  const H = Math.round(W * imgs[0].height / imgs[0].width);
  const c = document.createElement('canvas');
  c.width = m * 2 + W * imgs.length + gap * (imgs.length - 1);
  c.height = top + H + lab;
  const g = c.getContext('2d');
  let bg = o.bg;
  if (!bg) {
    const p = document.createElement('canvas');
    p.width = p.height = 4;
    const pg = p.getContext('2d');
    pg.drawImage(imgs[0], 0, 0, 4, 4, 0, 0, 4, 4);
    const d = pg.getImageData(1, 1, 1, 1).data;
    bg = `rgb(${d[0]},${d[1]},${d[2]})`;
  }
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  const probe = document.createElement('canvas').getContext('2d');
  probe.fillStyle = bg; probe.fillRect(0, 0, 1, 1);
  const [r0, g0, b0] = probe.getImageData(0, 0, 1, 1).data;
  const dark = 0.299 * r0 + 0.587 * g0 + 0.114 * b0 < 128;
  const ink = o.ink || (dark ? '#EEE7DB' : '#2A2622'), sub = o.sub || (dark ? '#D9D0C3' : '#4A433C'), accent = o.accent || (dark ? '#CC9E5E' : '#A87436');
  const font = o.font || '"PingFang SC", sans-serif';
  if (o.title) { g.fillStyle = ink; g.font = `600 30px ${font}`; g.fillText(o.title, m, 58); }
  imgs.forEach((im, i) => {
    const x = m + i * (W + gap);
    g.drawImage(im, x, top, W, H);
    const [a, b] = labels[i] || [];
    if (a) { g.fillStyle = accent; g.font = '500 24px "SF Mono", Menlo, monospace'; g.fillText(a, x + 4, top + H + 46); }
    if (b) { g.fillStyle = sub; g.font = `400 24px ${font}`; g.fillText(b, x + (a ? 100 : 4), top + H + 46); }
  });
  return c.toDataURL('image/jpeg', o.quality || 0.9);
};

'compose ready';
