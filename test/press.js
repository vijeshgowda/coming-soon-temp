/* Press passes: a mock sign-in for this prototype. Nothing leaves the browser and passwords are never stored. */
(function () {
  const V = window.VIJE, { esc, store } = V;
  const $ = (s, r = document) => r.querySelector(s);
  const K = { session: 'vije-riso-red-session', members: 'vije-riso-red-members', roles: 'vije-riso-red-roles' };
  const ADMIN_EMAIL = 'vije@vije.sh';
  const PROVIDERS = ['Google', 'GitHub', 'Microsoft', 'Discord', 'GitLab'];
  const CAN = { admin: 'Write posts · moderate · manage passes', moderator: 'Pin, lock and hide on the notice wall', member: 'Put up flyers and write in' };
  const subs = [];

  const people = () => {
    const over = store.get(K.roles, {});
    const base = Object.keys(V.roles).filter(h => h !== 'you').map(h => ({ handle: h, since: '2026-09-01', sample: true }));
    return base.concat(store.get(K.members, [])).map(p => ({ ...p, role: p.handle === 'vije' ? 'admin' : over[p.handle] || V.roles[p.handle] || 'member' }));
  };
  const find = h => people().find(p => p.handle === h);
  const roleOf = h => h === 'you' ? 'guest' : (find(h) || { role: 'member' }).role;

  let session = store.get(K.session, null);
  if (session && !find(session.handle)) session = null;
  const get = () => session && { handle: session.handle, role: roleOf(session.handle) };
  const isStaff = () => { const s = get(); return !!s && (s.role === 'admin' || s.role === 'moderator'); };
  const emit = () => { renderNav(); subs.forEach(f => f(get())); };
  const signIn = handle => { session = { handle }; store.set(K.session, session); emit(); };
  const signOut = () => { session = null; store.set(K.session, null); emit(); };
  const setRole = (h, role) => { if (h === 'vije' || !['member', 'moderator'].includes(role)) return; const o = store.get(K.roles, {}); o[h] = role; store.set(K.roles, o); emit(); };
  const clean = s => s.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);

  /* ---------- Nav: pass button and the admin-only Desk link ---------- */
  function renderNav() {
    const nav = $('.nav'), links = $('.links'); if (!nav || !links) return;
    let b = $('#passBtn');
    if (!b) { b = document.createElement('button'); b.type = 'button'; b.id = 'passBtn'; b.className = 'btn sm pass-btn'; b.addEventListener('click', () => open(get() ? 'pass' : 'signin')); nav.append(b); }
    const s = get();
    b.innerHTML = s ? `<span class="dot" aria-hidden="true"></span>@${esc(s.handle)}` : 'Sign in';
    b.setAttribute('aria-label', s ? `Your press pass: ${s.handle}, ${s.role}` : 'Sign in');
    const d = $('.desk-link', links);
    if (s && s.role === 'admin') { if (!d) links.insertAdjacentHTML('beforeend', `<li class="desk-link"><a href="desk.html"${document.body.dataset.page === 'desk' ? ' aria-current="page"' : ''}>Desk</a></li>`); }
    else if (d) d.remove();
  }

  /* ---------- Dialog ---------- */
  document.body.insertAdjacentHTML('beforeend', '<dialog class="dlg pass" id="passDlg" aria-labelledby="passH"><div id="passBody"></div></dialog>');
  const dlg = $('#passDlg'), body = $('#passBody');
  let provider = '', note = '';

  const seg = v => `<div class="seg" role="group" aria-label="Press pass"><button type="button" data-v="signin" aria-pressed="${v === 'signin'}">Sign in</button><button type="button" data-v="join" aria-pressed="${v === 'join'}">Get a pass</button></div>`;
  const oauth = () => `<div class="oauth">${PROVIDERS.map(p => `<button class="btn sm" type="button" data-prov="${p}">${p}</button>`).join('')}</div><p class="or">or with email</p>`;
  const notice = () => note ? `<p class="kicker note">${esc(note)}</p>` : '';
  const demo = `<p class="demo">Prototype: nothing leaves this browser and passwords are never kept. Quick look as <button class="linkish" type="button" data-demo="vije">vije (admin)</button>, <button class="linkish" type="button" data-demo="tomas">tomas (moderator)</button> or <button class="linkish" type="button" data-demo="nora">nora (member)</button>.</p>`;

  const views = {
    signin: () => `<h2 id="passH">Show your pass</h2>${seg('signin')}${notice()}${oauth()}
      <form id="signinForm">
        <label class="field"><span class="kicker">Email</span><input name="email" type="email" autocomplete="email" required></label>
        <label class="field"><span class="kicker">Password</span><input name="password" type="password" autocomplete="current-password" minlength="8" required></label>
        <p class="msg" id="passMsg" role="alert"></p>
        <div class="row"><button class="btn" type="button" data-close>Cancel</button><button class="btn solid" type="submit">Sign in</button></div>
      </form>${demo}`,
    join: (email = '') => `<h2 id="passH">Get a press pass</h2>${seg('join')}${notice()}
      ${provider ? `<p class="kicker note">✓ Signed in with ${esc(provider)}. Pick a handle to finish.</p>` : oauth()}
      <form id="joinForm">
        <label class="field"><span class="kicker">Handle</span><input name="handle" required pattern="[a-z0-9_]{3,20}" maxlength="20" autocomplete="username" aria-describedby="handleHint" autocapitalize="off" spellcheck="false"><small class="fine" id="handleHint">3 to 20 characters: a–z, 0–9 and _. Printed on everything you post.</small></label>
        ${provider ? '' : `<label class="field"><span class="kicker">Email</span><input name="email" type="email" autocomplete="email" required value="${esc(email)}"></label>
        <label class="field"><span class="kicker">Password</span><input name="password" type="password" autocomplete="new-password" minlength="8" required><small class="fine">At least 8 characters.</small></label>`}
        <label class="check"><input type="checkbox" name="rules" required><span>I'll follow the community guidelines: be kind, be specific and say what you tried.</span></label>
        <label class="human"><input type="checkbox" name="human" required><span>I'm a human</span><small>Turnstile goes here</small></label>
        <p class="msg" id="passMsg" role="alert"></p>
        <div class="row"><button class="btn" type="button" data-close>Cancel</button><button class="btn solid" type="submit">Print my pass</button></div>
      </form>`,
    pass: () => {
      const s = get(), p = find(s.handle), no = String(V.hash(s.handle) % 9000 + 1000);
      return `<h2 id="passH">Your press pass</h2>
      <div class="card"><canvas aria-hidden="true"></canvas><div><p class="kicker">vije.sh · Issue Nº 08</p><h3>@${esc(s.handle)}</h3>
        <dl><dt>Role</dt><dd>${esc(s.role)}</dd><dt>Pass Nº</dt><dd>${no}</dd><dt>Since</dt><dd>${esc(V.fmtDate(p.since))}</dd><dt>Can</dt><dd>${esc(CAN[s.role])}</dd></dl></div>
        <span class="seal" aria-hidden="true">${esc(s.role)}<br>✺</span></div>
      <div class="row"><button class="btn" type="button" data-out>Sign out</button><span class="row">${s.role === 'admin' ? '<a class="btn" href="desk.html">Open the desk</a>' : ''}<button class="btn solid" type="button" data-close>Done</button></span></div>`;
    }
  };

  /* Seeded two-plate portrait: the accent plate is a sun, the key plate a head and shoulders. */
  const portrait = handle => {
    const r = V.rng(V.hash(handle)), k = [r(), r(), r(), r()];
    return (p, w, h, ink) => {
      if (ink === 'red') {
        const cx = w * (.25 + k[0] * .5), cy = h * (.22 + k[1] * .2), rad = w * (.38 + k[2] * .15);
        const g = p.createRadialGradient(cx, cy, rad * .1, cx, cy, rad); g.addColorStop(0, '#222'); g.addColorStop(1, '#bbb');
        p.fillStyle = g; p.beginPath(); p.arc(cx, cy, rad, 0, 7); p.fill();
      } else {
        const g = p.createLinearGradient(0, h * .2, 0, h); g.addColorStop(0, '#666'); g.addColorStop(1, '#111');
        p.fillStyle = g;
        p.beginPath(); p.ellipse(w * .5, h * .42, w * .2, h * .15, 0, 0, 7); p.fill();
        p.beginPath(); p.ellipse(w * .5, h * 1.02, w * .44, h * .34, 0, 0, 7); p.fill();
        if (k[3] > .5) { p.fillStyle = '#111'; p.fillRect(w * .28, h * .26, w * .44, h * .06); p.fillRect(w * .34, h * .2, w * .32, h * .08); }
      }
    };
  };

  function show(view, arg) {
    body.innerHTML = views[view](arg);
    if (view === 'pass' && window.RISO) window.RISO.halftone($('canvas', body), portrait(get().handle), { cell: () => 4.5 });
    const f = $('input', body) || $('[data-close]', body); if (f) f.focus();
  }
  function open(view = 'signin', opts = {}) {
    provider = ''; note = opts.note || '';
    show(view === 'pass' && !get() ? 'signin' : view);
    if (!dlg.open) dlg.showModal();
  }
  const fail = t => { const m = $('#passMsg', body); if (m) m.textContent = t; };

  dlg.addEventListener('click', e => {
    if (e.target === dlg) return dlg.close();
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.v) { provider = ''; show(t.dataset.v); }
    else if (t.dataset.prov) { provider = t.dataset.prov; show('join'); }
    else if (t.dataset.demo) { signIn(t.dataset.demo); show('pass'); }
    else if ('close' in t.dataset) dlg.close();
    else if ('out' in t.dataset) { signOut(); dlg.close(); }
  });
  dlg.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target.elements;
    if (e.target.id === 'signinForm') {
      const email = f.email.value.trim().toLowerCase();
      const handle = email === ADMIN_EMAIL ? 'vije' : clean(email.split('@')[0]);
      const m = store.get(K.members, []).find(x => x.email === email);
      const h = m ? m.handle : find(handle) && find(handle).sample ? handle : '';
      if (!h) { show('join', email); fail('No pass for that email yet. Get one here.'); return; }
      signIn(h); show('pass');
    } else {
      const handle = f.handle.value.trim();
      if (find(handle)) return fail('That handle is taken. Try another.');
      const list = store.get(K.members, []);
      list.push({ handle, email: provider ? '' : f.email.value.trim().toLowerCase(), via: provider || 'email', since: new Date().toISOString().slice(0, 10) });
      store.set(K.members, list);
      signIn(handle); show('pass');
    }
  });

  window.PRESS = { get, roleOf, people, setRole, open, isStaff, signOut, on: f => subs.push(f) };
  renderNav();
})();
