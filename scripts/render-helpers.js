// 在应用页面里用应用自己的渲染器出图、做内存试验、还原并校验。只在本地预览里注入，不进正式代码。
//
// 前提：页面加载前注册了 three-hook.js。注入方式（刷新后要重新注入）：
//   - 页面有 import map 时：插入 <script src="http://127.0.0.1:<样稿端口>/tools/render-helpers.js?v=N">；
//     经典脚本可以跨源加载，里面的 import('three') 走页面的 import map，拿到的是同一份 three。
//   - 打包过的应用（没有 import map）：先把 THREE 挂到 window（开发构建里加一行），本文件会优先用 window.THREE。
//
//   await __shoot({ az: -.4, elev: .14, light: 'soft' })   出图到 window.__last（默认透明底并裁切）
//   const snap = __snap(meshes)                            按网格 id 记下几何与材质；__restore(snap) 还原
//   __sum(canvas)                                          像素校验值，还原后与基线对比
//   __sheetFrom(frames, outH, cols)                        多帧共用裁切框拼成序列帧到 window.__sheet（默认一排；cols 列时逐行排成网格）
//   __dataURL(canvas, 'image/webp', .9)                    导出给 CDP 取回（配合 cdpshot.py 解码）
//   __fit(canvas, maxH)                                    高于 maxH 时等比缩小，出图前控制体积
//   __mad(canvas, refImageData, ox, oy)                    与参考图同位置区域的平均差（0–255），找回丢失的参数时用
//   __goboTex(THREE) / __leafMask()                        叶影贴图（给 light: 'window'）/ 同一张图的透明遮罩（给页面叠层）
//
// __shoot 参数：
//   scene / renderer：默认取网格最多的 Scene（环境贴图生成也会建 Scene）和第一个渲染器。
//   subject(obj) → true 保留 / false 隐藏，判断场景的一级子节点；默认隐藏地面（任一边 > ground）与空节点。
//   ground（默认 20）、fov（26）、elev（俯仰弧度）、az（方位弧度）、margin（1.1）、zoom、lookY（0–1 取景高度）、dx（横移比例）、
//   light: 'spot' | 'soft' | 'glow'（暗而不黑的逆光）| 'window'（叶影窗光）| 'sunset'（日落逆光）| 'flash'（直闪），
//   bg（纯色背景；不给则黑白两次渲染反推透明度）、noCrop、
//   box（固定取景框；多帧动画传第一帧后的 window.__lastBox，避免每帧重新取景导致跳动）。

window.__THREE = async () => window.THREE || (await import('three'));

window.__mainScene = () => {
  let best = null, most = -1;
  for (const s of __captured.scenes) {
    let n = 0;
    s.traverse((o) => { if (o.isMesh) n++; });
    if (n > most) { best = s; most = n; }
  }
  return best;
};

window.__shoot = async function (o = {}) {
  const THREE = await __THREE();
  const s = o.scene || __mainScene(), r = o.renderer || __captured.renderers[0], cv = r.domElement;
  const W = cv.width, H = cv.height;
  const ground = o.ground ?? 20;
  const hide = [], keep = [];
  s.children.forEach((ch) => {
    if (ch.isLight || ch.isCamera) return;
    const b = new THREE.Box3().setFromObject(ch);
    if (b.isEmpty()) return;
    const size = b.getSize(new THREE.Vector3());
    const ok = o.subject ? o.subject(ch) : Math.max(size.x, size.z) <= ground;
    if (!ok) hide.push(ch);
    else if (ch.visible) keep.push(ch);
  });
  const box = new THREE.Box3();
  keep.forEach((k) => box.expandByObject(k));
  if (o.box) box.copy(o.box);
  window.__lastBox = box.clone();
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  if (o.dx) c.x += size.x * o.dx;
  if (o.lookY != null) c.y = box.min.y + size.y * o.lookY;
  const fov = o.fov || 26;
  const cam = new THREE.PerspectiveCamera(fov, W / H, 0.05, 1000);
  const elev = o.elev ?? 0.12, az = o.az ?? 0, m = o.margin || 1.1;
  const t = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const dist = Math.max(size.y * m / 2 / t, Math.max(size.x, size.z) * m / 2 / t / (W / H)) / (o.zoom || 1) + Math.max(size.x, size.z) / 2;
  cam.position.set(c.x + dist * Math.sin(az) * Math.cos(elev), c.y + dist * Math.sin(elev), c.z + dist * Math.cos(az) * Math.cos(elev));
  cam.lookAt(c);
  cam.updateMatrixWorld();

  // 灯光预设：只按比例调整已有灯光，再临时加灯；finally 里全部恢复。
  const restore = [];
  const lights = [];
  s.traverse((l) => { if (l.isLight) lights.push(l); });
  const scaleLights = (f, pick = () => true) => lights.filter(pick).forEach((l) => { const v = l.intensity; restore.push(() => (l.intensity = v)); l.intensity = v * f; });
  const envI = s.environmentIntensity;
  restore.push(() => (s.environmentIntensity = envI));
  const added = [];
  const addLight = (L, pos) => { L.position.copy(pos); L.target.position.copy(c); s.add(L, L.target); added.push(L); };
  if (o.light === 'spot') {
    // 压暗原有灯光和环境光，加一盏偏上的暖色主光和两盏背后的轮廓光；深色主体靠轮廓光才不会融进黑底。
    scaleLights(0.08);
    if (envI != null) s.environmentIntensity = envI * 0.15;
    addLight(new THREE.DirectionalLight(0xfff1dc, 2.9), new THREE.Vector3(c.x - 2.2, c.y + 8, c.z + 4.6));
    addLight(new THREE.DirectionalLight(0xffdcb8, 2.6), new THREE.Vector3(c.x + 3.2, c.y + 4.5, c.z - 6));
    addLight(new THREE.DirectionalLight(0xc9d6ff, 1.1), new THREE.Vector3(c.x - 4, c.y + 2, c.z - 5));
  }
  if (o.light === 'soft') {
    scaleLights(1.5, (l) => l.isHemisphereLight || l.isAmbientLight);
    if (envI != null) s.environmentIntensity = Math.max(envI, 0.5);
  }
  if (o.light === 'glow') {
    // 暗而不黑：原有灯光压到四五成，暗部留层次；侧前方主光，背后一盏强的暖色逆光勾轮廓，冷色侧逆光分开深色部分。
    // 配合暖褐径向背景和主体后面的一圈光用。数值是起点，按画面调 ambientK / keyI / backI / sideI。
    scaleLights(o.ambientK ?? 0.45);
    if (envI != null) s.environmentIntensity = Math.max(0.16, envI * 0.5);
    addLight(new THREE.DirectionalLight(0xfff1dc, o.keyI ?? 2.3), new THREE.Vector3(c.x - 3, c.y + 5.5, c.z + 5));
    addLight(new THREE.DirectionalLight(0xffd6a0, o.backI ?? 5.6), new THREE.Vector3(c.x + 1.8, c.y + 6.5, c.z - 6.5));
    addLight(new THREE.DirectionalLight(0xd2dcff, o.sideI ?? 0.9), new THREE.Vector3(c.x - 5.5, c.y + 2.2, c.z - 3));
  }
  // 场景光：一眼能认出的光（下午窗边、日落、闪光灯），“哇”来自影子和光的形状，不靠整体调亮。
  // 投影要渲染器开着 shadowMap、主体网格 castShadow / receiveShadow。灯位按机位换算：[右, 朝镜头, 上] 乘距离。
  const isDirect = (l) => l.isDirectionalLight || l.isSpotLight || l.isPointLight, isAmb = (l) => l.isHemisphereLight || l.isAmbientLight;
  const R = Math.max(size.x, size.y, size.z);
  const rt = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize();
  const tc = cam.position.clone().sub(c).setY(0).normalize();
  const at = ([x, z, y], d) => c.clone().addScaledVector(rt, x * d).addScaledVector(tc, z * d).add(new THREE.Vector3(0, y * d, 0));
  const shadowed = (L, n = 2048) => {
    L.castShadow = true; L.shadow.mapSize.set(n, n); L.shadow.bias = -0.0003; L.shadow.normalBias = 0.02;
    if (L.isDirectionalLight) { const k = L.shadow.camera; k.left = k.bottom = -R; k.right = k.top = R; k.near = 0.01; k.far = R * 12; k.updateProjectionMatrix(); }
    return L;
  };
  if (o.light === 'window') {
    // 一盏聚光当太阳，灯前贴叶影图。SpotLight.map 只在 castShadow 开着时生效（白透光、深挡光）。
    // 环境光、补光合计压到太阳的四分之一左右，叶影才看得出来；补光再亮，叶影就被冲淡。
    scaleLights(o.directK ?? 0.04, isDirect); scaleLights(o.ambientK ?? 0.22, isAmb);
    if (envI != null) s.environmentIntensity = envI * 0.25;
    const sun = shadowed(new THREE.SpotLight(0xffe2b4, o.sunI ?? 6.6, 0, o.sunAngle ?? 0.3, 0.35, 0));
    sun.map = __goboTex(THREE);
    addLight(sun, at(o.sunDir ?? [-0.55, 0.6, 0.58], R * 4));
    addLight(new THREE.DirectionalLight(0xfff0de, o.bounceI ?? 0.3), at([0.8, 0.5, 0.1], R * 3));
  }
  if (o.light === 'sunset') {
    // 原有灯光大部分关掉；低角度暖光在主体后方偏右（投影），左右两道暖色轮廓光，正面只留很弱的桃色补光。
    scaleLights(o.directK ?? 0, isDirect); scaleLights(o.ambientK ?? 0.18, isAmb);
    if (envI != null) s.environmentIntensity = envI * 0.3;
    addLight(shadowed(new THREE.DirectionalLight(0xffa25a, o.sunI ?? 8)), at(o.sunDir ?? [0.35, -0.85, 0.45], R * 3));
    addLight(new THREE.DirectionalLight(0xffb070, o.rimI ?? 5), at([0.75, -0.55, 0.35], R * 3));
    addLight(new THREE.DirectionalLight(0xff8f80, o.rim2I ?? 3.4), at([-0.7, -0.6, 0.3], R * 3));
    addLight(new THREE.DirectionalLight(0xffc4a8, o.frontI ?? 0.4), at([0.2, 1, 0.05], R * 3));
  }
  if (o.light === 'flash') {
    // 相机位置一盏按距离衰减的聚光（decay 2，强度乘距离平方）；投影贴图 4096 才有硬边影子。
    scaleLights(o.directK ?? 0.03, isDirect); scaleLights(o.ambientK ?? 0.09, isAmb);
    if (envI != null) s.environmentIntensity = envI * 0.15;
    const d = cam.position.distanceTo(c);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion), right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    addLight(shadowed(new THREE.SpotLight(0xfff5ea, (o.flashI ?? 3.6) * d * d, 0, 0.5, 0.5, 2), 4096),
      cam.position.clone().addScaledVector(up, d * 0.045).addScaledVector(right, d * 0.02));
  }
  restore.push(() => added.forEach((L) => { s.remove(L, L.target); L.dispose(); }));

  const vis = hide.map((h) => h.visible);
  hide.forEach((h) => (h.visible = false));
  const bg = s.background;
  // 应用的画布通常 preserveDrawingBuffer=false：render 之后同一个任务里立刻 drawImage 才能读到像素。
  const grab = (color) => {
    s.background = new THREE.Color(color);
    r.shadowMap.needsUpdate = true;
    r.render(s, cam);
    const tc = document.createElement('canvas');
    tc.width = W; tc.height = H;
    const x = tc.getContext('2d', { willReadFrequently: true });
    x.drawImage(cv, 0, 0);
    return x.getImageData(0, 0, W, H);
  };
  let out;
  try {
    if (o.bg != null) out = grab(o.bg);
    else {
      // 黑底、白底各渲染一次反推透明度，半透明材质（薄纸、玻璃）也能干净抠出。
      const B = grab(0x000000), Wt = grab(0xffffff);
      out = new ImageData(W, H);
      const b = B.data, w = Wt.data, d = out.data;
      for (let i = 0; i < b.length; i += 4) {
        const a = 1 - ((w[i] - b[i]) + (w[i + 1] - b[i + 1]) + (w[i + 2] - b[i + 2])) / 765;
        const A = a < 0 ? 0 : a > 1 ? 1 : a;
        if (A < 0.004) { d[i + 3] = 0; continue; }
        d[i] = Math.min(255, b[i] / A); d[i + 1] = Math.min(255, b[i + 1] / A); d[i + 2] = Math.min(255, b[i + 2] / A);
        d[i + 3] = Math.round(A * 255);
      }
    }
  } finally {
    s.background = bg;
    hide.forEach((h, i) => (h.visible = vis[i]));
    restore.reverse().forEach((f) => f());
    r.shadowMap.needsUpdate = true;
    window.dispatchEvent(new Event('resize'));
  }
  let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
  if (o.bg == null && !o.noCrop) {
    x0 = W; y0 = H; x1 = 0; y1 = 0;
    const d = out.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < x0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
    const pad = Math.round((y1 - y0) * 0.025);
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  }
  const full = document.createElement('canvas');
  full.width = W; full.height = H;
  full.getContext('2d').putImageData(out, 0, 0);
  const crop = document.createElement('canvas');
  crop.width = x1 - x0 + 1; crop.height = y1 - y0 + 1;
  crop.getContext('2d').drawImage(full, x0, y0, crop.width, crop.height, 0, 0, crop.width, crop.height);
  window.__last = crop;
  return { w: crop.width, h: crop.height, canvas: [W, H] };
};

window.__sheetFrom = function (frames, outH, cols = frames.length) {
  let x0 = 1e9, y0 = 1e9, x1 = 0, y1 = 0;
  for (const f of frames) {
    const W = f.width, H = f.height, d = f.getContext('2d').getImageData(0, 0, W, H).data;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      if (d[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  const pad = Math.round((y1 - y0) * 0.03);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(frames[0].width - 1, x1 + pad); y1 = Math.min(frames[0].height - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, k = outH / ch, fw = Math.round(cw * k), fh = outH;
  const n = frames.length, rows = Math.ceil(n / cols);
  if (fw * cols > 16383 || fh * rows > 16383) throw new Error(`序列帧 ${fw * cols}×${fh * rows}px 超过 WebP 上限 16383，改用网格（cols）或降低 outH`);
  const sheet = document.createElement('canvas');
  sheet.width = fw * cols; sheet.height = fh * rows;
  const x = sheet.getContext('2d');
  frames.forEach((f, i) => x.drawImage(f, x0, y0, cw, ch, (i % cols) * fw, Math.floor(i / cols) * fh, fw, fh));
  window.__sheet = sheet;
  return { fw, fh, n, cols, rows };
};

// 内存试验前先 __snap。换内容时应用常会重建网格，旧网格仍挂在已移出场景的旧组下（parent 不为空），
// 所以缓存必须按网格 id 校验：id 变了就重新 snap，否则还原会写到旧网格上，试验效果在新网格上层层累加。
// 挂在 window 上而不是顶层 const：同一页面改完再注入一次时，顶层 const 会报重复声明。
window.__MAT_KEYS = ['roughness', 'metalness', 'sheen', 'sheenRoughness', 'sheenColor', 'specularIntensity', 'emissive', 'emissiveIntensity',
  'color', 'opacity', 'transparent', 'normalMap', 'normalScale', 'alphaMap', 'alphaTest', 'alphaToCoverage', 'map', 'side'];
window.__snap = function (meshes) {
  const own = (mt, k) => Object.prototype.hasOwnProperty.call(mt, k);
  return {
    ids: meshes.map((m) => m.id).join(','),
    items: meshes.map((m) => {
      const g = m.geometry, mt = m.material, attrs = {}, mat = {};
      for (const [k, a] of Object.entries(g.attributes)) attrs[k] = { array: a.array.slice(), itemSize: a.itemSize, normalized: a.normalized, Ctor: a.constructor };
      for (const k of __MAT_KEYS) if (k in mt) mat[k] = mt[k] && mt[k].clone && !mt[k].isTexture ? mt[k].clone() : mt[k];
      return { m, attrs, mat, obc: own(mt, 'onBeforeCompile') ? mt.onBeforeCompile : null, key: own(mt, 'customProgramCacheKey') ? mt.customProgramCacheKey : null };
    }),
  };
};
window.__snapValid = (snap, meshes) => snap && snap.ids === meshes.map((m) => m.id).join(',');
window.__restore = function (snap) {
  snap.items.forEach(({ m, attrs, mat, obc, key }) => {
    const g = m.geometry, mt = m.material;
    for (const k of Object.keys(g.attributes)) if (!(k in attrs)) g.deleteAttribute(k);
    for (const [k, a] of Object.entries(attrs)) {
      const cur = g.attributes[k];
      if (cur && cur.array.length === a.array.length) { cur.array.set(a.array); cur.needsUpdate = true; }
      else g.setAttribute(k, new a.Ctor(a.array.slice(), a.itemSize, a.normalized));
    }
    g.computeBoundingBox(); g.computeBoundingSphere();
    for (const [k, v] of Object.entries(mat)) {
      if (v && (v.isColor || v.isVector2) && mt[k] && mt[k].copy) mt[k].copy(v);
      else mt[k] = v;
    }
    if (obc) mt.onBeforeCompile = obc; else delete mt.onBeforeCompile;
    if (key) mt.customProgramCacheKey = key; else delete mt.customProgramCacheKey;
    mt.needsUpdate = true;
  });
  return snap.items.length;
};

window.__sum = (c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < d.length; i += 7) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
  return c.width + 'x' + c.height + ':' + h.toString(16);
};

window.__dataURL = (c, type = 'image/webp', q = 0.9) => c.toDataURL(type, q);
window.__fit = (c, maxH) => {
  if (c.height <= maxH) return c;
  const o = document.createElement('canvas');
  o.width = Math.round(c.width * maxH / c.height); o.height = maxH;
  const g = o.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, o.width, o.height);
  return o;
};

window.__mad = (c, ref, ox = 0, oy = 0) => {
  const W = c.width, H = c.height, d = c.getContext('2d').getImageData(0, 0, W, H).data;
  let sum = 0, n = 0;
  for (let y = 0; y < H && oy + y < ref.height; y++) for (let x = 0; x < W && ox + x < ref.width; x++) {
    const i = (y * W + x) * 4, j = ((oy + y) * ref.width + ox + x) * 4;
    sum += Math.abs(d[i] - ref.data[j]) + Math.abs(d[i + 1] - ref.data[j + 1]) + Math.abs(d[i + 2] - ref.data[j + 2]); n += 3;
  }
  return sum / n;
};

// 叶影贴图：白色透光，深色是叶子；几根带叶的枝条从画面边缘伸进来，边缘柔化。固定随机种子，每次一样。
window.__goboTex = function (THREE) {
  if (window.__gobo) return window.__gobo.tex;
  const N = 1024, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const x = cv.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, N, N);
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const leaf = (px, py, len, a) => {
    const w = len * (0.3 + rnd() * 0.12);
    x.save(); x.translate(px, py); x.rotate(a);
    x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(len * 0.5, -w, len, 0); x.quadraticCurveTo(len * 0.5, w, 0, 0); x.fill();
    x.restore();
  };
  x.filter = 'blur(6px)';
  x.fillStyle = x.strokeStyle = 'rgb(34,34,34)';
  const branches = [[-60, 180, 640, 380, 1080, 300], [1090, 760, 560, 560, 120, 900], [300, -60, 420, 360, 700, 620], [1100, 60, 820, 260, 640, 120]];
  for (const [ax, ay, bx, by, cx2, cy2] of branches) {
    x.lineWidth = 6; x.beginPath(); x.moveTo(ax, ay); x.quadraticCurveTo(bx, by, cx2, cy2); x.stroke();
    for (let k = 0; k < 22; k++) {
      const t = k / 21, it = 1 - t;
      const px = it * it * ax + 2 * it * t * bx + t * t * cx2, py = it * it * ay + 2 * it * t * by + t * t * cy2;
      const tx = 2 * it * (bx - ax) + 2 * t * (cx2 - bx), ty = 2 * it * (by - ay) + 2 * t * (cy2 - by);
      leaf(px, py, 70 + rnd() * 70, Math.atan2(ty, tx) + (k % 2 ? 1 : -1) * (0.6 + rnd() * 0.5));
    }
  }
  x.filter = 'none';
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  window.__gobo = { tex, canvas: cv };
  return tex;
};

// 同一张叶影图转成透明遮罩（叶子不透明、空隙透明），给页面里墙上的叶影用。
// 画布合成的 destination-out 和 CSS 遮罩都看 alpha：反相后的不透明图会把整块擦掉。
window.__leafMask = function () {
  const src = window.__gobo.canvas, N = src.width, c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  const d = x.getImageData(0, 0, N, N);
  for (let i = 0; i < d.data.length; i += 4) { const a = 255 - d.data[i]; d.data[i] = d.data[i + 1] = d.data[i + 2] = 0; d.data[i + 3] = a; }
  x.putImageData(d, 0, 0);
  return c;
};

'render helpers ready';
