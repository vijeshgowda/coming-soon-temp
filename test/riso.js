(function () {
  const V = window.VIJE, { esc, store } = V;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement, RM = () => V.RM.matches;
  const riso = (text, cls = '') => `<span class="riso ${cls}" data-text="${esc(text)}">${esc(text)}</span>`;
  const redraws = [];

  /* ---------- Paper stock ---------- */
  const stockBtns = $$('.stock button');
  const setStock = p => { root.dataset.paper = p; stockBtns.forEach(b => b.setAttribute('aria-pressed', b.dataset.paper === p)); store.set('vije-riso-red-paper', p); };
  stockBtns.forEach(b => b.addEventListener('click', () => { setStock(b.dataset.paper); requestAnimationFrame(() => redraws.forEach(f => f())); }));
  setStock(root.dataset.paper || 'cream');

  /* ---------- Ink drums: red + black, or pink + blue ---------- */
  const drumBtns = $$('.drums button');
  const setInks = k => { if (k === 'pb') root.dataset.inks = 'pb'; else delete root.dataset.inks; drumBtns.forEach(b => b.setAttribute('aria-pressed', b.dataset.inks === k)); store.set('vije-riso-red-inks', k); };
  drumBtns.forEach(b => b.addEventListener('click', () => { if (b.getAttribute('aria-pressed') === 'true') return; setInks(b.dataset.inks); requestAnimationFrame(reprint); }));
  setInks(root.dataset.inks === 'pb' ? 'pb' : 'red');

  /* ---------- Shared state: desk posts and notice-wall moderation (this browser only) ---------- */
  const DESK = 'vije-riso-red-desk', MOD = 'vije-riso-red-mod';
  const posts = () => store.get(DESK, []).filter(p => p.status === 'live').concat(V.posts).sort((a, b) => b.date.localeCompare(a.date));
  const F = V.forum('vije-riso-red-forum');
  const mod = () => ({ pin: {}, lock: {}, hide: {}, ...store.get(MOD, {}) });
  const toggleMod = (kind, key, now) => { const m = mod(); m[kind][key] = !now; store.set(MOD, m); };
  const modView = t => { const m = mod(); return { ...t, pinned: m.pin[t.id] ?? !!t.pinned, locked: !!m.lock[t.id] }; };
  const threads = () => F.list().map(modView).sort((a, b) => b.pinned - a.pinned);

  /* ---------- Reprint: new misregistration, a roller sweeps across ---------- */
  const jitter = () => (Math.random() * 2 - 1);
  function reprint() {
    root.style.setProperty('--rx', (jitter() * 4.5).toFixed(1) + 'px'); root.style.setProperty('--ry', (jitter() * 3.5).toFixed(1) + 'px');
    $$('.wm .ch').forEach(c => { c.style.setProperty('--dx', (jitter() * 4).toFixed(1) + 'px'); c.style.setProperty('--dy', (jitter() * 3).toFixed(1) + 'px'); });
    redraws.forEach(f => f());
    if (!RM()) $('.roller').animate([{ translate: '-120% 0' }, { translate: '120% 0' }], { duration: 900, easing: 'cubic-bezier(.6,0,.3,1)' });
  }

  /* ---------- Mobile menu: links and print settings fold into one panel ---------- */
  const nav = $('.nav');
  if (nav) {
    nav.querySelector('.links').id = 'navLinks'; nav.querySelector('.nav-end').id = 'navEnd';
    nav.insertAdjacentHTML('beforeend', '<button class="menu-btn" type="button" aria-expanded="false" aria-controls="navLinks navEnd"><span class="sr">Menu</span><i aria-hidden="true"></i></button>');
    const mb = $('.menu-btn', nav);
    const setOpen = o => { nav.classList.toggle('open', o); mb.setAttribute('aria-expanded', o); };
    mb.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
    addEventListener('keydown', e => { if (e.key === 'Escape' && nav.classList.contains('open')) { setOpen(false); mb.focus(); } });
    matchMedia('(min-width: 44.01rem)').addEventListener('change', e => { if (e.matches) setOpen(false); });
  }

  /* ---------- Halftone renderer: two plates screened at different angles ---------- */
  function halftone(cv, plates, opt = {}) {
    const draw = () => {
      const r = cv.getBoundingClientRect(); if (!r.width) return;
      const dpr = Math.min(devicePixelRatio || 1, 2), W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d'), cs = getComputedStyle(root), get = k => cs.getPropertyValue(k).trim();
      ctx.fillStyle = get('--sheet'); ctx.fillRect(0, 0, W, H);
      const pw = Math.ceil(W / 3), ph = Math.ceil(H / 3), off = document.createElement('canvas'); off.width = pw; off.height = ph;
      const p = off.getContext('2d', { willReadFrequently: true });
      ctx.globalCompositeOperation = get('--blend') === 'screen' ? 'screen' : 'multiply';
      const rx = parseFloat(get('--rx')) || 0, ry = parseFloat(get('--ry')) || 0;
      [['red', 15, rx * 1.5, ry * 1.5], ['key', 45, 0, 0]].forEach(([ink, ang, ox, oy]) => {
        p.setTransform(1, 0, 0, 1, 0, 0); p.fillStyle = '#fff'; p.fillRect(0, 0, pw, ph);
        plates(p, pw, ph, ink);
        const data = p.getImageData(0, 0, pw, ph).data, c = (opt.cell ? opt.cell() : 7) * dpr, lv = opt.levels ? opt.levels() : 0;
        const a = ang * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a), D = Math.hypot(W, H) / 2, cx = W / 2, cy = H / 2;
        ctx.beginPath();
        for (let u = -D; u < D; u += c) for (let v = -D; v < D; v += c) {
          const x = cx + u * cos - v * sin, y = cy + u * sin + v * cos;
          if (x < -c || y < -c || x > W + c || y > H + c) continue;
          const sx = Math.min(pw - 1, Math.max(0, (x / W * pw) | 0)), sy = Math.min(ph - 1, Math.max(0, (y / H * ph) | 0));
          let d = 1 - data[(sy * pw + sx) * 4] / 255;
          if (lv) d = Math.round(d * (lv - 1)) / (lv - 1);
          const rad = c * .64 * Math.sqrt(d);
          if (rad > .35) { ctx.moveTo(x + ox * dpr + rad, y + oy * dpr); ctx.arc(x + ox * dpr, y + oy * dpr, rad, 0, Math.PI * 2); }
        }
        ctx.fillStyle = get('--' + ink); ctx.fill();
      });
      ctx.globalCompositeOperation = 'source-over';
      if (opt.after) opt.after(ctx, W, H, dpr, get);
    };
    redraws.push(draw);
    new ResizeObserver(draw).observe(cv);
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(draw);
    return draw;
  }

  /* Cover plates for a post: the red plate is a sun, the key plate a seeded motif. */
  function coverPlates(slug, cat) {
    const r = V.rng(V.hash(slug)), k = [r(), r(), r(), r(), r()], motif = Math.floor(r() * 3);
    return (p, w, h, ink) => {
      if (ink === 'red') {
        const cx = w * (.28 + k[0] * .44), cy = h * (.22 + k[1] * .25), rad = w * (.26 + k[2] * .16);
        const g = p.createRadialGradient(cx - rad * .3, cy - rad * .3, rad * .05, cx, cy, rad); g.addColorStop(0, '#111'); g.addColorStop(1, '#9a9a9a');
        p.fillStyle = g; p.beginPath(); p.arc(cx, cy, rad, 0, 7); p.fill();
        const lg = p.createLinearGradient(0, h * .7, 0, h); lg.addColorStop(0, '#fff'); lg.addColorStop(1, '#555'); p.fillStyle = lg; p.fillRect(0, h * .7, w, h * .3);
      } else if (motif === 0) {
        for (let i = 0; i < 6; i++) {
          const y0 = h * (.45 + i * .1); p.fillStyle = `rgb(${200 - i * 30},${200 - i * 30},${200 - i * 30})`;
          p.beginPath(); p.moveTo(0, h); for (let x = 0; x <= w; x += 4) p.lineTo(x, y0 + Math.sin(x / w * Math.PI * (2 + k[3] * 2) + i) * h * .03); p.lineTo(w, h); p.fill();
        }
      } else if (motif === 1) {
        p.save(); p.translate(w / 2, h / 2); p.rotate(-.5 + k[3]); for (let i = -12; i < 12; i++) { p.fillStyle = i % 2 ? '#222' : '#ddd'; p.fillRect(i * w * .09, -h, w * .045, h * 2); } p.restore();
        p.globalCompositeOperation = 'lighten'; const g = p.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#fff'); g.addColorStop(.5, '#000'); p.fillStyle = g; p.fillRect(0, 0, w, h); p.globalCompositeOperation = 'source-over';
      } else {
        p.fillStyle = '#222'; p.font = `900 ${h * .9}px Archivo, sans-serif`; p.textBaseline = 'alphabetic'; p.fillText(cat[0].toUpperCase(), w * (.05 + k[4] * .2), h * .95);
      }
    };
  }
  const heroPlates = (p, w, h, ink) => {
    if (ink === 'red') {
      const g = p.createRadialGradient(w * .62, h * .36, 4, w * .66, h * .4, w * .3); g.addColorStop(0, '#000'); g.addColorStop(1, '#aaa');
      p.fillStyle = g; p.beginPath(); p.arc(w * .66, h * .4, w * .27, 0, 7); p.fill();
      const lg = p.createLinearGradient(0, 0, 0, h * .6); lg.addColorStop(0, '#d0d0d0'); lg.addColorStop(1, '#fff'); p.globalCompositeOperation = 'darken'; p.fillStyle = lg; p.fillRect(0, 0, w, h * .6); p.globalCompositeOperation = 'source-over';
    } else {
      for (let i = 0; i < 7; i++) {
        const y0 = h * (.58 + i * .065); p.fillStyle = `rgb(${190 - i * 26},${190 - i * 26},${190 - i * 26})`;
        p.beginPath(); p.moveTo(0, h); for (let x = 0; x <= w; x += 3) p.lineTo(x, y0 + Math.sin(x / w * 9 + i * 1.7) * h * .018); p.lineTo(w, h); p.fill();
      }
      // Saltbound: a small ship on the horizon
      const sx = w * .22, sy = h * .6, s = w * .16; p.fillStyle = '#111';
      p.beginPath(); p.moveTo(sx - s * .5, sy); p.lineTo(sx + s * .55, sy); p.lineTo(sx + s * .38, sy + s * .2); p.lineTo(sx - s * .36, sy + s * .2); p.fill();
      p.fillStyle = '#444'; p.beginPath(); p.moveTo(sx - s * .05, sy - s * .9); p.lineTo(sx - s * .05, sy - s * .05); p.lineTo(sx - s * .45, sy - s * .08); p.fill();
      p.beginPath(); p.moveTo(sx + s * .05, sy - s * .75); p.lineTo(sx + s * .05, sy - s * .05); p.lineTo(sx + s * .4, sy - s * .08); p.fill();
    }
  };

  const coverCard = (p, i, href) => `<a class="cv" href="${href}" style="--rot:${[-2.2, 1.6, -1, 2.4][i % 4]}deg"><canvas data-slug="${esc(p.slug)}" data-cat="${esc(p.cat)}" aria-hidden="true"></canvas>
    <p class="t">${esc(p.title)}</p><span class="m">${esc(p.cat)} · ${esc(V.fmtDate(p.date))} · ${p.read} min</span></a>`;
  const mountCovers = host => $$('canvas[data-slug]', host).forEach(cv => halftone(cv, coverPlates(cv.dataset.slug, cv.dataset.cat)));

  window.RISO = { halftone, coverPlates, riso };
  const page = document.body.dataset.page;

  /* =================== ABOUT =================== */
  if (page === 'about') {
    /* Wordmark: each letter's width and weight follow the pointer (variable font axes) */
    const wm = $('.wm'), chars = $$('.ch', wm);
    let px = null, lastMove = 0, raf = 0, visible = true;
    const apply = x => chars.forEach(c => {
      const narrow = wm.clientWidth < 700, sg = narrow ? 70 : 150, lo = narrow ? 92 : 72;
      const r = c.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - x), t = Math.exp(-(d * d) / (2 * sg * sg));
      c.style.setProperty('--wd', (lo + t * (125 - lo)).toFixed(1)); c.style.setProperty('--wt', Math.round(620 + t * 280));
    });
    const reset = () => chars.forEach(c => { c.style.setProperty('--wd', 100); c.style.setProperty('--wt', 900); });
    addEventListener('pointermove', e => { if (e.pointerType !== 'mouse') return; px = e.clientX; lastMove = performance.now(); if (!raf) raf = requestAnimationFrame(tick); }, { passive: true });
    function tick(now) {
      raf = 0; if (!visible || document.hidden) return;
      if (px !== null && now - lastMove < 2500) apply(px);
      else if (!RM()) { const r = wm.getBoundingClientRect(); apply(r.left + (Math.sin(now / 1600) * .5 + .5) * r.width); }
      else return reset();
      raf = requestAnimationFrame(tick);
    }
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible && !raf) raf = requestAnimationFrame(tick); }).observe(wm);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !raf) raf = requestAnimationFrame(tick); });

    /* On narrow screens, size the wordmark so it fits at the widest point of the sweep. */
    const fitWm = () => {
      wm.style.fontSize = '';
      if (wm.clientWidth >= 700) return;
      chars.forEach(c => { c.style.transition = 'none'; });
      for (let pass = 0; pass < 2; pass++) {
        const r = wm.getBoundingClientRect(); let max = 0;
        for (let k = 0; k <= 24; k++) { apply(r.left + k / 24 * r.width); max = Math.max(max, wm.scrollWidth); }
        wm.style.fontSize = (parseFloat(getComputedStyle(wm).fontSize) * (wm.clientWidth - 14) / max).toFixed(2) + 'px';
      }
      if (RM()) reset();
      chars.forEach(c => { c.style.transition = ''; });
    };
    addEventListener('resize', fitWm);
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(fitWm);

    halftone($('#heroArt'), heroPlates, { cell: () => 6.5 });

    /* Marquee: speed follows scroll velocity */
    const track = $('.track');
    track.innerHTML += track.innerHTML;
    if (!RM()) {
      const anim = track.animate([{ translate: '0 0' }, { translate: '-50% 0' }], { duration: 38000, iterations: Infinity });
      let lastY = scrollY, boost = 0;
      addEventListener('scroll', () => { boost = Math.min(10, boost + Math.abs(scrollY - lastY) * .04); lastY = scrollY; }, { passive: true });
      (function ease() { boost *= .92; anim.playbackRate = 1 + boost; requestAnimationFrame(ease); })();
    }

    /* Stickers: drag and throw */
    const sheet = $('.stickers'), sts = $$('.sticker', sheet), S = [];
    let z = 10;
    const layout = () => {
      const W = sheet.clientWidth, H = sheet.clientHeight, cols = W < 560 ? 1 : 2;
      sts.forEach((el, i) => {
        const s = S[i] || (S[i] = { vx: 0, vy: 0, rot: 0, base: [-6, 4, -3, 7][i] });
        const cw = W / cols, ch = H / Math.ceil(sts.length / cols);
        s.x = Math.min(W - el.offsetWidth - 10, (i % cols) * cw + (cw - el.offsetWidth) * (.2 + .6 * ((i * 37) % 10) / 10));
        s.y = Math.min(H - el.offsetHeight - 10, Math.floor(i / cols) * ch + (ch - el.offsetHeight) * .45);
        s.x = Math.max(10, s.x); s.y = Math.max(10, s.y); paint(el, s);
      });
    };
    const paint = (el, s) => { el.style.transform = `translate(${s.x}px, ${s.y}px) rotate(${(s.base + s.rot).toFixed(2)}deg)`; };
    let drag = null, phys = 0;
    sts.forEach((el, i) => {
      el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); el.style.zIndex = ++z; drag = { i, ox: e.clientX - S[i].x, oy: e.clientY - S[i].y }; S[i].vx = S[i].vy = 0; });
      el.addEventListener('pointermove', e => {
        if (!drag || drag.i !== i) return; const s = S[i], W = sheet.clientWidth, H = sheet.clientHeight;
        const nx = Math.min(W - el.offsetWidth, Math.max(0, e.clientX - drag.ox)), ny = Math.min(H - el.offsetHeight, Math.max(0, e.clientY - drag.oy));
        s.vx = nx - s.x; s.vy = ny - s.y; s.x = nx; s.y = ny; s.rot += (Math.max(-18, Math.min(18, s.vx * 1.4)) - s.rot) * .3; paint(el, s);
      });
      const up = () => { if (!drag || drag.i !== i) return; drag = null; if (!phys) phys = requestAnimationFrame(step); };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    function step() {
      phys = 0; let moving = false; const W = sheet.clientWidth, H = sheet.clientHeight;
      sts.forEach((el, i) => {
        const s = S[i]; if (drag && drag.i === i) return;
        s.x += s.vx; s.y += s.vy; s.vx *= .93; s.vy *= .93; s.rot *= .9;
        const mw = W - el.offsetWidth, mh = H - el.offsetHeight;
        if (s.x < 0) { s.x = 0; s.vx = Math.abs(s.vx) * .6; } if (s.x > mw) { s.x = mw; s.vx = -Math.abs(s.vx) * .6; }
        if (s.y < 0) { s.y = 0; s.vy = Math.abs(s.vy) * .6; } if (s.y > mh) { s.y = mh; s.vy = -Math.abs(s.vy) * .6; }
        if (Math.abs(s.vx) + Math.abs(s.vy) + Math.abs(s.rot) > .05) moving = true;
        paint(el, s);
      });
      if (moving) phys = requestAnimationFrame(step);
    }
    layout(); new ResizeObserver(layout).observe(sheet);

    /* Lab: fewer bits, coarser screen and fewer tone levels */
    const chips = $('#bits'), range = $('#params');
    chips.insertAdjacentHTML('beforeend', V.bits.map((b, i) => `<input type="radio" name="bits" id="b${i}" value="${b}" ${b === 1.58 ? 'checked' : ''}><label for="b${i}">${b === 1.58 ? '1.58' : b}</label>`).join(''));
    const cellFor = { 16: 4.5, 8: 6, 4: 8.5, 2: 12, 1.58: 14, 1: 17 }, levelsFor = { 16: 0, 8: 0, 4: 16, 2: 4, 1.58: 3, 1: 2 };
    let cur = { p: 27, b: 1.58, r: V.lab(27, 1.58) };
    const labPlates = (p, w, h, ink) => {
      const rad = w * .44 * Math.sqrt(cur.r.gb / cur.r.full), cx = w / 2, cy = h / 2;
      if (ink === 'red') { const g = p.createRadialGradient(cx - rad * .35, cy - rad * .4, rad * .05, cx, cy, rad); g.addColorStop(0, '#fff'); g.addColorStop(.5, '#777'); g.addColorStop(1, '#000'); p.fillStyle = g; p.beginPath(); p.arc(cx, cy, rad, 0, 7); p.fill(); }
      else { const g = p.createLinearGradient(0, cy - rad, 0, cy + rad); g.addColorStop(0, '#fff'); g.addColorStop(1, '#333'); p.fillStyle = g; p.beginPath(); p.arc(cx, cy, rad, 0, 7); p.fill(); }
    };
    const drawLab = halftone($('#labArt'), labPlates, { cell: () => cellFor[cur.b], levels: () => levelsFor[cur.b],
      after: (ctx, W, H, dpr, get) => { ctx.setLineDash([6 * dpr, 6 * dpr]); ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = get('--ink'); ctx.beginPath(); ctx.arc(W / 2, H / 2, W * .44, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = `700 ${11 * dpr}px "Space Mono", monospace`; ctx.fillStyle = get('--ink'); ctx.textAlign = 'center'; ctx.fillText(`16-bit · ${cur.r.full} GB`, W / 2, H * .035 + 10 * dpr); } });
    let pending = 0;
    function calc() {
      const p = +range.value, b = +$('input:checked', chips).value; cur = { p, b, r: V.lab(p, b) };
      $('#pval').textContent = p + 'B'; $('#gb').textContent = cur.r.gb.toFixed(1); $('#note').textContent = cur.r.note;
      $('#cap').textContent = levelsFor[b] ? `Screened at ${levelsFor[b]} tone levels per ink: what ${b === 1.58 ? 'ternary' : b + '-bit'} weights can say.` : 'Continuous tone: plenty of levels to spare.';
      cancelAnimationFrame(pending); pending = requestAnimationFrame(drawLab);
    }
    range.addEventListener('input', calc); chips.addEventListener('change', calc); calc();

    $('#latest').innerHTML = posts().slice(0, 3).map((p, i) => coverCard(p, i, 'blog.html#' + esc(p.slug))).join('');
    mountCovers($('#latest'));
  }

  /* =================== BLOG =================== */
  if (page === 'blog') {
    const grid = $('#covers'), reader = $('#reader'), head = $('.page-head'), chips = $('#cats');
    let cat = 'All', listScroll = 0;
    chips.innerHTML = ['All', ...new Set(posts().map(p => p.cat))].map(c => `<button class="btn sm" type="button" aria-pressed="${c === 'All'}">${esc(c)}</button>`).join('');
    chips.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; cat = b.textContent; $$('button', chips).forEach(x => { x.setAttribute('aria-pressed', x === b); x.classList.toggle('solid', x === b); }); renderList(); });
    $('button', chips).classList.add('solid');
    function renderList() { grid.innerHTML = posts().filter(p => cat === 'All' || p.cat === cat).map((p, i) => coverCard(p, i, '#' + esc(p.slug))).join(''); mountCovers(grid); }
    function renderPost(p) {
      const all = posts(), n = all.findIndex(x => x.slug === p.slug), older = all[n + 1], newer = all[n - 1];
      const body = p.body.map(([t, s]) => t === 'h' ? `<h2>${esc(s)}</h2>` : t === 'q' ? `<blockquote>${esc(s)}</blockquote>` : `<p>${esc(s)}</p>`).join('');
      reader.innerHTML = `<p style="margin:0 0 22px"><a class="btn sm" href="#">← Back issues</a></p>
        <div class="spread"><div class="page-l"><canvas id="postArt" aria-hidden="true"></canvas><h1>${riso(p.title)}</h1>
        <p class="kicker">${esc(p.cat)} · ${esc(V.fmtDate(p.date, { day: 'numeric', month: 'long', year: 'numeric' }))} · ${p.read} min read</p></div>
        <div class="page-r"><div class="prose">${body}</div>
        <nav class="pager" aria-label="More posts">${older ? `<a class="btn sm" href="#${esc(older.slug)}">← ${esc(older.title)}</a>` : '<span></span>'}${newer ? `<a class="btn sm" href="#${esc(newer.slug)}">${esc(newer.title)} →</a>` : ''}</nav></div></div>`;
    }
    function route() {
      const slug = decodeURIComponent(location.hash.slice(1)), p = posts().find(x => x.slug === slug);
      if (p && reader.hidden) listScroll = scrollY;
      const go = () => {
        redraws.length = 0;
        if (p) { reader.hidden = false; grid.hidden = head.hidden = true; renderPost(p); halftone($('#postArt'), coverPlates(p.slug, p.cat)); document.title = p.title + ' · vije.sh'; scrollTo(0, 0); }
        else { reader.hidden = true; reader.innerHTML = ''; grid.hidden = head.hidden = false; renderList(); document.title = 'Back issues · vije.sh · 17 Riso Red'; scrollTo(0, listScroll); }
      };
      document.startViewTransition && !RM() ? document.startViewTransition(go) : go();
    }
    addEventListener('hashchange', route); route();
  }

  /* =================== FORUM =================== */
  if (page === 'forum') {
    const main = $('#forum'), P = window.PRESS;
    const tints = ['var(--t1)', 'var(--t2)', 'var(--t3)', 'var(--t4)'];
    let cat = 'All';
    const current = () => decodeURIComponent(location.hash.slice(1));
    function wall() {
      const ts = threads().filter(t => cat === 'All' || t.cat === cat);
      main.innerHTML = `<header class="page-head"><p class="kicker">Issue 08 · Forum · the notice wall</p><h1>${riso('Notice wall', 'flip')}</h1>
        <div class="wall-head"><p>Every thread is a flyer. Each reply tears off a tab. Sample threads; your posts stay in this browser. <button class="linkish" id="resetBtn" type="button">Clear mine</button></p>
        <button class="btn solid" id="newBtn" type="button">+ Put up a flyer</button></div>
        <div class="cat-chips" role="group" aria-label="Filter by category">${['All', ...V.categories].map(c => `<button type="button" aria-pressed="${c === cat}">${esc(c)}</button>`).join('')}</div></header>
        <div class="wall">${ts.map((t, i) => {
          const r = V.rng(V.hash(t.id)), replies = t.posts.length - 1, torn = Math.min(replies, 6);
          const tabs = Array.from({ length: 7 }, (_, k) => `<span style="--i:${k}"${k < torn ? ' class="torn"' : ''}>${k < torn ? '' : 'vije.sh/forum'}</span>`).join('');
          return `<a class="flyer" href="#${esc(t.id)}" style="--rot:${((r() - .5) * 5).toFixed(1)}deg;--fc:${tints[i % 4]}">
            <span class="stamp" aria-hidden="true">${esc(t.cat)}</span>${t.pinned ? '<span class="pin-note">Pinned</span> ' : ''}${t.locked ? '<span class="pin-note locked">Locked</span>' : ''}
            <h2>${esc(t.title)}</h2><p>${esc(t.posts[0][2])}</p><span class="by">${esc(t.posts[0][0])} · ${esc(t.posts[0][1])} · ${replies} repl${replies === 1 ? 'y' : 'ies'}</span>
            <span class="tabs" aria-hidden="true">${tabs}</span></a>`;
        }).join('') || '<p>No flyers in this category yet.</p>'}</div>`;
      $('#newBtn').addEventListener('click', () => P.get() ? openNew() : P.open('signin', { note: 'Putting up a flyer needs a press pass.' }));
      $('#resetBtn').addEventListener('click', () => { F.reset(); wall(); });
      $$('.cat-chips button', main).forEach(b => b.addEventListener('click', () => { cat = b.textContent; wall(); }));
      document.title = 'Forum · vije.sh · 17 Riso Red';
    }
    const letter = ([u, when, text], i, t, fresh) => {
      const role = P.roleOf(u), staff = P.isStaff(), hid = !!mod().hide[t.id + ':' + i];
      if (hid && !staff) return `<li class="letter withdrawn"><h3>Withdrawn <small>· hidden by a moderator</small></h3></li>`;
      return `<li class="letter${fresh ? ' fresh' : ''}${hid ? ' hidden' : ''}"><h3>${riso('From: ' + u)}${role === 'admin' || role === 'moderator' ? `<span class="role ${role}">${role}</span>` : ''} <small>· ${esc(when)}</small>${staff && i > 0 ? ` <button class="tiny" type="button" data-hide="${i}">${hid ? 'Unhide' : 'Hide'}</button>` : ''}</h3><p>${esc(text)}</p></li>`;
    };
    function thread(id, fresh) {
      const t = modView(F.get(id)), s = P.get(), n = t.posts.length;
      const writeIn = t.locked ? `<p class="write-in gate"><span class="kicker">✺ Locked</span> This thread is closed to new write-ins.</p>`
        : s ? `<form class="write-in" id="writeIn"><label class="kicker" for="replyText">Write in as @${esc(s.handle)}</label><textarea id="replyText" rows="4" maxlength="1000" required placeholder="Dear vije.sh,"></textarea>
          <div class="row"><span class="fine">Plain text only. Kept in this browser.</span><button class="btn solid" type="submit">Send to print</button></div></form>`
        : `<div class="write-in gate"><p class="kicker">Write-ins need a press pass</p><p>Reading is free. To reply, show your pass or get one; it takes a minute.</p><div class="row"><button class="btn solid" type="button" data-pass="join">Get a pass</button><button class="btn" type="button" data-pass="signin">Sign in</button></div></div>`;
      main.innerHTML = `<header class="letters-head"><a class="btn sm" href="#">← Notice wall</a><h1>${riso(t.title)}</h1><p class="kicker">${esc(t.cat)} · letters page · ${n} letter${n > 1 ? 's' : ''}${t.pinned ? ' · pinned' : ''}${t.locked ? ' · locked' : ''}</p>
        ${P.isStaff() ? `<div class="mod" role="group" aria-label="Moderation"><span class="kicker">Moderate</span><button class="btn sm" type="button" data-mod="pin" aria-pressed="${t.pinned}">${t.pinned ? 'Unpin' : 'Pin'}</button><button class="btn sm" type="button" data-mod="lock" aria-pressed="${t.locked}">${t.locked ? 'Unlock' : 'Lock'}</button></div>` : ''}</header>
        <ol class="letters" id="letters">${t.posts.map((p, i) => letter(p, i, t, fresh && i === n - 1)).join('')}</ol>${writeIn}`;
      document.title = t.title + ' · Forum · vije.sh';
    }
    main.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const id = current(), t = id && F.get(id);
      if (b.dataset.pass) P.open(b.dataset.pass);
      else if (b.dataset.mod && t && P.isStaff()) { const v = modView(t); toggleMod(b.dataset.mod, t.id, b.dataset.mod === 'pin' ? v.pinned : v.locked); thread(t.id); }
      else if (b.dataset.hide && t && P.isStaff()) { const k = t.id + ':' + b.dataset.hide; toggleMod('hide', k, !!mod().hide[k]); thread(t.id); }
    });
    main.addEventListener('submit', e => {
      if (e.target.id !== 'writeIn') return;
      e.preventDefault(); const s = P.get(), id = current(), text = $('#replyText').value.trim().slice(0, 1000);
      if (!s || !text || modView(F.get(id)).locked) return;
      F.reply(id, text, s.handle); thread(id, true);
      $('#letters .letter:last-child').scrollIntoView({ behavior: RM() ? 'auto' : 'smooth', block: 'center' });
    });
    P.on(() => { if (dlg.open && !P.get()) dlg.close(); const t = F.get(current()); t ? thread(t.id) : wall(); });
    function route() {
      const t = F.get(current());
      const go = () => { t ? thread(t.id) : wall(); scrollTo(0, 0); };
      document.startViewTransition && !RM() ? document.startViewTransition(go) : go();
    }
    const dlg = $('#newDlg'), nf = $('#newForm');
    $('#ncat').innerHTML = V.categories.filter(c => c !== 'Announcements').map(c => `<option>${esc(c)}</option>`).join('');
    function openNew() { dlg.showModal(); $('#ntitle').focus(); }
    $('#cancelNew').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    nf.addEventListener('submit', e => {
      e.preventDefault();
      const s = P.get(), title = nf.elements.ntitle.value.trim().slice(0, 120), body = nf.elements.nbody.value.trim().slice(0, 2000); if (!s || !title || !body) return;
      const id = F.create(title, nf.elements.ncat.value, body, s.handle); nf.reset(); dlg.close(); cat = 'All'; location.hash = id;
    });
    addEventListener('hashchange', route); route();
  }

  /* =================== WORK =================== */
  if (page === 'work') {
    $$('canvas[data-poster]').forEach(cv => halftone(cv, coverPlates(cv.dataset.poster, cv.dataset.poster)));
    $('#printCv').addEventListener('click', () => window.print());
  }

  /* =================== DESK (admin) =================== */
  if (page === 'desk') {
    const P = window.PRESS, main = $('#desk');
    const load = () => store.get(DESK, []), save = l => store.set(DESK, l);
    const CATS = ['Notes', 'Engineering', 'Local AI', 'Games'];
    let editing = '', proofPlates = coverPlates('draft', 'Notes'), drawProof = null, timer = 0;
    const today = () => new Date().toISOString().slice(0, 10);
    const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';
    const uniq = (base, id) => { const taken = new Set(V.posts.map(p => p.slug).concat(load().filter(p => p.id !== id).map(p => p.slug))); let s = base, i = 2; while (taken.has(s)) s = `${base}-${i++}`; return s; };
    /* Tiny markup: blank line = paragraph, "## " = heading, "> " = pull quote. */
    const parse = src => src.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean).map(b => b.startsWith('## ') ? ['h', b.slice(3).trim()] : b.startsWith('>') ? ['q', b.replace(/^>\s?/gm, '').trim()] : ['p', b.replace(/\s*\n\s*/g, ' ')]);
    const prose = blocks => blocks.map(([t, s]) => t === 'h' ? `<h2>${esc(s)}</h2>` : t === 'q' ? `<blockquote>${esc(s)}</blockquote>` : `<p>${esc(s)}</p>`).join('');
    const readTime = src => Math.max(1, Math.round(src.split(/\s+/).filter(Boolean).length / 200));
    const stamp = st => `<span class="status ${st === 'live' ? 'live' : ''}">${st === 'live' ? 'In print' : 'Draft'}</span>`;

    function gate() {
      main.innerHTML = `<header class="page-head"><p class="kicker">Issue Nº 08 · Staff only</p><h1>${riso('The desk')}</h1>
        <p>This is where posts are set and the notice wall is kept tidy. Show an admin press pass to come in.</p>
        <div class="ctas"><button class="btn solid" type="button" data-pass="signin">Sign in</button></div>
        <p class="fine">Prototype: this check runs in the browser only. On the real site the server enforces it.</p></header>`;
      document.title = 'Staff only · vije.sh';
    }
    function render() {
      const s = P.get(); if (!s || s.role !== 'admin') return gate();
      const list = load(), live = list.filter(p => p.status === 'live').length, people = P.people(), ts = threads();
      const cur = list.find(p => p.id === editing) || { title: '', cat: 'Notes', excerpt: '', src: '' };
      main.innerHTML = `<header class="page-head"><p class="kicker">Issue Nº 08 · Editor's desk · @${esc(s.handle)}</p><h1>${riso('The desk')}</h1>
        <p>${list.length - live} on the spike · ${live} in print · ${ts.length} flyers · ${people.length} pass holders. Everything here is saved in this browser only.</p></header>
        <section class="desk-sec" aria-labelledby="setH"><div class="sec-head"><span class="num" aria-hidden="true">01</span><h2 id="setH">${riso(editing ? 'Reset the story' : 'Set a story')}</h2></div>
          <div class="desk-grid">
            <form class="composer" id="composer">
              <label class="field"><span class="kicker">Headline</span><input name="title" maxlength="120" required value="${esc(cur.title)}"></label>
              <div class="pair"><label class="field"><span class="kicker">Section</span><select name="cat">${CATS.map(c => `<option${c === cur.cat ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
              <label class="field"><span class="kicker">Standfirst</span><input name="excerpt" maxlength="160" value="${esc(cur.excerpt)}" placeholder="One line under the headline"></label></div>
              <label class="field"><span class="kicker">Copy</span><textarea name="src" rows="12" maxlength="20000" required placeholder="Write here.&#10;&#10;## A heading&#10;&#10;&gt; A pull quote">${esc(cur.src)}</textarea></label>
              <p class="fine hint">Blank line = new paragraph · <b>## </b>heading · <b>&gt; </b>pull quote. No HTML: everything is printed as plain text.</p>
              <p class="msg" id="deskMsg" role="status"></p>
              <div class="row"><button class="btn sm" type="button" data-act="new">${editing ? 'Cancel edit' : 'Clear'}</button>
                <span class="row"><button class="btn" type="submit" value="draft">Spike it (draft)</button><button class="btn solid" type="submit" value="live">Send to press</button></span></div>
            </form>
            <div class="proof"><p class="kicker">Proof · updates as you type</p>
              <div class="spread"><div class="page-l"><canvas id="proofArt" aria-hidden="true"></canvas><h1 id="proofH"></h1><p class="kicker" id="proofK"></p></div>
              <div class="page-r"><div class="prose" id="proofB"></div></div></div></div>
          </div></section>
        <section class="desk-sec" aria-labelledby="spikeH"><div class="sec-head"><span class="num" aria-hidden="true">02</span><h2 id="spikeH">${riso('The spike')}</h2><p>Your drafts and published posts. Sample posts from the shared content are not listed.</p></div>
          ${list.length ? `<div class="scroll"><table class="ledger"><thead><tr><th>Headline</th><th>Section</th><th>Status</th><th>Date</th><th><span class="sr">Actions</span></th></tr></thead><tbody>
          ${list.map(p => `<tr><td>${p.status === 'live' ? `<a href="blog.html#${esc(p.slug)}">${esc(p.title)}</a>` : esc(p.title)}</td><td>${esc(p.cat)}</td><td>${stamp(p.status)}</td><td>${esc(V.fmtDate(p.date))}</td>
            <td><span class="acts"><button class="btn sm" type="button" data-act="edit" data-id="${esc(p.id)}">Edit</button><button class="btn sm" type="button" data-act="flip" data-id="${esc(p.id)}">${p.status === 'live' ? 'Pull' : 'Publish'}</button><button class="btn sm" type="button" data-act="spike" data-id="${esc(p.id)}">Bin</button></span></td></tr>`).join('')}
          </tbody></table></div>` : '<p class="empty">Nothing on the spike yet. Set a story above.</p>'}</section>
        <section class="desk-sec" aria-labelledby="wallH"><div class="sec-head"><span class="num" aria-hidden="true">03</span><h2 id="wallH">${riso('Notice wall')}</h2><p>Pin and lock flyers. Hide single letters from inside a thread.</p></div>
          <div class="scroll"><table class="ledger"><thead><tr><th>Flyer</th><th>Section</th><th>Letters</th><th><span class="sr">Moderation</span></th></tr></thead><tbody>
          ${ts.map(t => `<tr><td><a href="forum.html#${esc(t.id)}">${esc(t.title)}</a></td><td>${esc(t.cat)}</td><td>${t.posts.length}</td>
            <td><span class="acts"><button class="btn sm" type="button" data-act="pin" data-id="${esc(t.id)}" aria-pressed="${t.pinned}">${t.pinned ? 'Unpin' : 'Pin'}</button><button class="btn sm" type="button" data-act="lock" data-id="${esc(t.id)}" aria-pressed="${t.locked}">${t.locked ? 'Unlock' : 'Lock'}</button></span></td></tr>`).join('')}
          </tbody></table></div></section>
        <section class="desk-sec" aria-labelledby="passH2"><div class="sec-head"><span class="num" aria-hidden="true">04</span><h2 id="passH2">${riso('Pass holders')}</h2><p>Roles are given here, never chosen at sign-up. The admin pass can't be handed on.</p></div>
          <div class="scroll"><table class="ledger"><thead><tr><th>Handle</th><th>Since</th><th>Role</th></tr></thead><tbody>
          ${people.map(p => `<tr><td>@${esc(p.handle)}${p.sample ? ' <small class="fine">sample</small>' : ''}</td><td>${esc(V.fmtDate(p.since))}</td>
            <td>${p.role === 'admin' ? '<span class="role">admin</span>' : `<select data-role="${esc(p.handle)}" aria-label="Role for ${esc(p.handle)}">${['member', 'moderator'].map(r => `<option${r === p.role ? ' selected' : ''}>${r}</option>`).join('')}</select>`}</td></tr>`).join('')}
          </tbody></table></div></section>`;
      document.title = "Editor's desk · vije.sh";
      const cv = $('#proofArt');
      drawProof = halftone(cv, (p, w, h, ink) => proofPlates(p, w, h, ink));
      proof(true);
    }
    function proof(plates) {
      const f = $('#composer'); if (!f) return;
      const e = f.elements, title = e.title.value.trim() || 'Untitled', src = e.src.value;
      $('#proofH').innerHTML = riso(title);
      $('#proofK').textContent = `${e.cat.value} · ${V.fmtDate(today())} · ${readTime(src)} min read`;
      $('#proofB').innerHTML = prose(parse(src)) || '<span class="fine">Your copy appears here.</span>';
      const go = () => { proofPlates = coverPlates(slugify(title), e.cat.value); drawProof(); };
      clearTimeout(timer); if (plates) go(); else timer = setTimeout(go, 350);
    }
    const msg = t => { const m = $('#deskMsg'); if (m) m.innerHTML = t; };

    main.addEventListener('input', e => { if (e.target.closest('#composer')) proof(e.target.name !== 'src'); });
    main.addEventListener('submit', e => {
      e.preventDefault();
      const s = P.get(); if (!s || s.role !== 'admin') return gate();
      const f = e.target.elements, status = e.submitter && e.submitter.value === 'live' ? 'live' : 'draft';
      const title = f.title.value.trim(), src = f.src.value.trim(); if (!title || !src) return msg('A headline and some copy, please.');
      const list = load(), old = list.find(p => p.id === editing), body = parse(src);
      const firstP = (body.find(b => b[0] === 'p') || ['', ''])[1];
      const post = { id: old ? old.id : 'd' + Date.now().toString(36), slug: uniq(slugify(title), old && old.id), title, cat: f.cat.value,
        excerpt: f.excerpt.value.trim() || (firstP.length > 140 ? firstP.slice(0, 137) + '…' : firstP), src, body, read: readTime(src),
        date: old && old.status === 'live' ? old.date : today(), status };
      save(old ? list.map(p => p.id === old.id ? post : p) : [post, ...list]);
      editing = ''; render();
      msg(status === 'live' ? `Sent to press. <a href="blog.html#${esc(post.slug)}">Read it on the blog →</a>` : 'Spiked as a draft.');
      if (status === 'live' && !RM()) reprint();
    });
    main.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.pass) return P.open(b.dataset.pass);
      const act = b.dataset.act, id = b.dataset.id, list = load(); if (!act) return;
      if (act === 'new') editing = '';
      else if (act === 'edit') editing = id;
      else if (act === 'flip') save(list.map(p => p.id === id ? { ...p, status: p.status === 'live' ? 'draft' : 'live', date: p.status === 'live' ? p.date : today() } : p));
      else if (act === 'spike') { if (!confirm('Bin this post? This cannot be undone.')) return; save(list.filter(p => p.id !== id)); if (editing === id) editing = ''; }
      else if (act === 'pin' || act === 'lock') { const t = threads().find(x => x.id === id); toggleMod(act, id, act === 'pin' ? t.pinned : t.locked); }
      render();
      if (act === 'edit') { $('#composer').scrollIntoView({ behavior: RM() ? 'auto' : 'smooth' }); $('#composer [name=title]').focus({ preventScroll: true }); }
    });
    main.addEventListener('change', e => { if (e.target.dataset.role) P.setRole(e.target.dataset.role, e.target.value); });
    P.on(render);
    render();
  }
})();
