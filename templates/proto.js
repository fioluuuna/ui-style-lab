// 样稿播放器：一部手机里的多屏流程。约定见 lab-kit.md。
// 页面结构：.phone > .scr（每屏一个，data-name / data-hold），.ctrl（自动填按钮），.strip（自动填五屏一览）。
(function () {
  const params = new URLSearchParams(location.search);
  const shot = params.get('shot');
  const phone = document.querySelector('.phone');
  if (!phone) return;
  const screens = [...phone.querySelectorAll(':scope > .scr')];
  if (!screens.length) return;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const leaveMs = parseFloat(getComputedStyle(phone).getPropertyValue('--leave')) || 900;
  const variants = (phone.dataset.variants || '').split(',').filter(Boolean);
  const baseSkin = [...phone.classList].filter(c => c !== 'phone' && !variants.includes(c)).join(' ');
  const PW = 390, PH = 844, DW = 1440, DH = 900;
  let cur = 0, playing = false, timer = 0, runId = 0, finishWait = null;

  const setVariant = v => {
    variants.forEach(x => phone.classList.toggle(x, x === v));
    document.querySelectorAll('.ctrl .vt button').forEach(b => b.classList.toggle('cur', (b.dataset.v || '') === (v || '')));
    document.documentElement.dataset.variant = v || '';
  };
  setVariant(variants.find(v => params.get(v) === '1') || '');

  // ?shot=N：只留第 N 屏的最终状态，给总览页的 iframe 缩略图用。
  if (shot !== null) {
    document.documentElement.classList.add('shot');
    const i = Math.max(0, Math.min(screens.length - 1, parseInt(shot, 10) || 0));
    screens.forEach((s, k) => (k === i ? s.classList.add('on') : s.remove()));
    phone.classList.add('static');
    return;
  }

  const fit = () => {
    const s = Math.min(1, (innerHeight - 190) / PH, (innerWidth - 40) / PW);
    document.documentElement.style.setProperty('--s', Math.max(.1, s).toFixed(3));
    document.querySelectorAll('.desk-wrap').forEach(w => {
      const d = w.querySelector('.desk');
      if (!d) return;
      const k = w.clientWidth / DW;
      d.style.transform = `scale(${k})`;
      w.style.height = DH * k + 'px';
    });
  };
  addEventListener('resize', fit);
  fit();

  const ctrl = document.querySelector('.ctrl');
  const stepBtns = [];
  let playBtn;
  if (ctrl) {
    if (variants.length) {
      const vt = document.createElement('div');
      vt.className = 'vt';
      const labels = JSON.parse(phone.dataset.variantLabels || '{}');
      ['', ...variants].forEach(v => {
        const b = document.createElement('button');
        b.dataset.v = v;
        b.textContent = labels[v || 'base'] || v || '默认';
        b.onclick = () => { stop(); setVariant(v); replay(false); };
        vt.appendChild(b);
      });
      ctrl.appendChild(vt);
      setVariant(document.documentElement.dataset.variant);
    }
    playBtn = document.createElement('button');
    playBtn.className = 'play';
    playBtn.textContent = '▶ 播放全流程';
    playBtn.onclick = () => (playing ? stop() : play());
    ctrl.appendChild(playBtn);
    screens.forEach((s, k) => {
      const b = document.createElement('button');
      b.textContent = `${k + 1} ${s.dataset.name || ''}`;
      b.onclick = () => { stop(); go(k); };
      ctrl.appendChild(b);
      stepBtns.push(b);
    });
    const r = document.createElement('button');
    r.textContent = '↻ 重播本屏';
    r.onclick = () => { stop(); replay(false); };
    ctrl.appendChild(r);
  }

  document.querySelectorAll('.strip').forEach(strip => {
    const v = strip.dataset.variant || '';
    screens.forEach((s, k) => {
      const fig = document.createElement('figure');
      const mini = document.createElement('div');
      mini.className = `mini ${baseSkin} ${v} static`;
      const c = s.cloneNode(true);
      c.classList.add('on');
      c.inert = true;
      mini.appendChild(c);
      const cap = document.createElement('figcaption');
      cap.textContent = `${k + 1} · ${s.dataset.name || ''}`;
      fig.append(mini, cap);
      fig.tabIndex = 0;
      fig.setAttribute('role', 'button');
      fig.setAttribute('aria-label', `${v || '默认'}：${s.dataset.name || k + 1}`);
      fig.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fig.click(); } };
      fig.onclick = () => { stop(); setVariant(v); go(k); scrollTo({ top: 0, behavior: 'smooth' }); };
      strip.appendChild(fig);
    });
  });

  // 转台：.tt 的背景是序列帧（--sprite、--frames；帧多时加 --cols 排成网格，逐行排）。两层交叉淡化。
  // 平滑程度需按素材、转角、速度和显示尺寸实际预览。
  // data-front 停在哪一帧，data-delay 进场后多久开转，data-swing 转到正面用时，之后小幅来回摆。
  const ttFrame = (layer, f, cols, rows) => {
    const c = f % cols, r = Math.floor(f / cols);
    layer.style.backgroundPosition = `${cols > 1 ? c / (cols - 1) * 100 : 0}% ${rows > 1 ? r / (rows - 1) * 100 : 0}%`;
  };
  function startTT(screen) {
    screen.querySelectorAll('.tt').forEach(el => {
      const cs = getComputedStyle(el);
      const n = parseInt(cs.getPropertyValue('--frames'), 10) || 17;
      const cols = parseInt(cs.getPropertyValue('--cols'), 10) || n, rows = Math.ceil(n / cols);
      el.style.setProperty('--rows', rows);
      const front = Math.max(0, Math.min(n - 1, Number(el.dataset.front ?? Math.floor((n - 1) / 2))));
      if (!el._a) {
        el._a = document.createElement('i');
        el._b = document.createElement('i');
        el.append(el._a, el._b);
        el.classList.add('live');
      }
      cancelAnimationFrame(el._raf);
      if (reducedMotion.matches) { ttFrame(el._a, front, cols, rows); el._b.style.opacity = 0; return; }
      const ed = parseFloat(getComputedStyle(el).getPropertyValue('--ed')) || 0;
      const delay = ed * 1000 + (+el.dataset.delay || 800);
      const swing = +el.dataset.swing || 2400;
      const sway = Math.min(3, n - 1 - front);
      const t0 = performance.now();
      const step = now => {
        const t = now - t0 - delay;
        const p = t < 0 ? 0 : t < swing ? front * (1 - Math.pow(1 - t / swing, 3)) : front + sway * Math.sin((t - swing) / 9000 * Math.PI * 2);
        const f0 = Math.max(0, Math.floor(p));
        ttFrame(el._a, f0, cols, rows);
        ttFrame(el._b, Math.min(n - 1, f0 + 1), cols, rows);
        el._b.style.opacity = (p - f0).toFixed(3);
        el._raf = requestAnimationFrame(step);
      };
      el._raf = requestAnimationFrame(step);
    });
  }
  const stopTT = screen => screen.querySelectorAll('.tt').forEach(el => cancelAnimationFrame(el._raf));

  function sync() {
    phone.dataset.at = cur;
    screens.forEach((s, k) => { s.inert = k !== cur; s.setAttribute('aria-hidden', String(k !== cur)); });
    stepBtns.forEach((b, k) => b.classList.toggle('cur', k === cur));
  }
  function replay(via) {
    const s = screens[cur];
    clearTimeout(s._t);
    phone.classList.toggle('via', !!via);
    s.classList.remove('on', 'off');
    void s.offsetWidth;
    s.classList.add('on');
    startTT(s);
    sync();
  }
  // 离场屏保留 .off 到 --leave 毫秒，让离场动画播完；进场屏在 .via 下用更长的 --ed 等它。
  function go(i) {
    i = Math.max(0, Math.min(screens.length - 1, i));
    if (i === cur) return replay(false);
    const prev = screens[cur];
    prev.classList.remove('on');
    prev.classList.add('off');
    clearTimeout(prev._t);
    prev._t = setTimeout(() => { prev.classList.remove('off'); stopTT(prev); }, leaveMs);
    cur = i;
    replay(true);
  }
  const wait = ms => new Promise(r => { finishWait = r; timer = setTimeout(() => { finishWait = null; r(); }, ms); });
  async function play() {
    stop();
    const run = ++runId;
    playing = true;
    playBtn && (playBtn.textContent = '■ 停止', playBtn.classList.add('on'));
    if (cur !== 0) go(0); else replay(false);
    for (let i = 0; i < screens.length && playing; i++) {
      if (i > 0) go(i);
      await wait(+screens[i].dataset.hold || 3600);
      if (run !== runId) return;
    }
    stop();
  }
  function stop() {
    playing = false;
    ++runId;
    clearTimeout(timer);
    if (finishWait) { const resolve = finishWait; finishWait = null; resolve(); }
    playBtn && (playBtn.textContent = '▶ 播放全流程', playBtn.classList.remove('on'));
  }

  phone.addEventListener('click', e => {
    const t = e.target.closest('[data-go]');
    if (!t) return;
    e.preventDefault();
    stop();
    go(t.dataset.go === 'next' ? cur + 1 : +t.dataset.go);
  });
  addEventListener('keydown', e => {
    if (e.target.closest('input,textarea,select,button,a,[role=button],[contenteditable]')) return;
    if (e.key === 'ArrowRight') { stop(); go(cur + 1); }
    else if (e.key === 'ArrowLeft') { stop(); go(cur - 1); }
    else if (e.key === ' ') { e.preventDefault(); playing ? stop() : play(); }
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });

  window.__lab = { go, replay, stop, setVariant, screens, phone, leaveMs, get cur() { return cur; } };

  screens[0].classList.add('on');
  startTT(screens[0]);
  sync();
})();
