// 抓取页面里的 Three.js 场景和渲染器。Three.js 创建 Scene / WebGLRenderer 时会向
// window.__THREE_DEVTOOLS__ 派发 observe 事件，所以必须在页面脚本运行前注册：
//   CDP Page.addScriptToEvaluateOnNewDocument { source: <本文件内容> }，然后刷新页面。
// 之后 window.__captured.scenes / renderers 就是应用自己的对象。
if (!window.__captured) {
  window.__captured = { scenes: [], renderers: [] };
  window.__THREE_DEVTOOLS__ ||= new EventTarget();
  window.__THREE_DEVTOOLS__.addEventListener('observe', (e) => {
    const o = e.detail;
    if (o && o.isScene) window.__captured.scenes.push(o);
    else if (o && o.isWebGLRenderer) window.__captured.renderers.push(o);
  });
}
