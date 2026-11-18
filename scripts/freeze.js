// 把样稿的转场冻结在第 t 毫秒，用来逐帧截图检查。依赖 templates/proto.js 暴露的 window.__lab。
// 用 CDP Runtime.evaluate 注入本文件，然后：
//   __freeze(3, 4, 480)                    第 4 屏切到第 5 屏后 480 ms（屏号从 0 开始）
//   __freeze(3, 4, 2500, { leaveDone: true })  t 超过 --leave 时加 leaveDone，模拟离场屏被移走
//   __unfreeze()                           恢复播放
//
// 注意：
// - 只冻结 CSS 动画和 Web Animations。setTimeout 不会停，所以这里会清掉离场计时器（s._t），
//   否则截图前离场屏就被移走了；t 超过 --leave 时用 leaveDone 手动模拟。
// - requestAnimationFrame 驱动的动画（转台 .tt）也不会停，按真实时间走：要截它的终态就先等够时间再截。
window.__freeze = (from, to, t, { leaveDone = false } = {}) => {
  const L = window.__lab;
  if (!L) throw new Error('页面没有 window.__lab：需要 templates/proto.js');
  L.stop();
  const scr = L.screens;
  const settle = () => scr.forEach((s) => { clearTimeout(s._t); s.classList.remove('off'); });
  document.getAnimations().forEach((a) => { try { a.play(); } catch (e) {} });
  settle();
  L.go(from);
  settle();
  document.getAnimations().forEach((a) => {
    const it = a.effect && a.effect.getComputedTiming().iterations;
    if (it !== Infinity) a.finish();
  });
  L.go(to);
  scr.forEach((s) => clearTimeout(s._t));
  if (leaveDone) scr[from].classList.remove('off');
  document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t; });
  return scr.map((s) => s.className).join(' | ');
};

window.__unfreeze = () => document.getAnimations().forEach((a) => { try { a.play(); } catch (e) {} });

'freeze ready';
