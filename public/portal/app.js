/* FA Client Portal — what clients see. */
(function () {
  'use strict';
  const { $, $$, esc, api } = FA;
  const { S, STAGES } = window.FA_I18N;
  const root = $('#root');

  const state = { user: null, lang: 'en', projects: null, bundle: null, bundleId: null, docFilter: 'all', pollTimer: null, bannerHidden: false };
  try { state.bannerHidden = localStorage.getItem('fa-notif-banner') === 'hidden'; } catch (e) {}

  // ---------- language ----------
  function t(key, vars) {
    let s = (S[state.lang] && S[state.lang][key]) || S.en[key] || key;
    if (vars) Object.keys(vars).forEach((k) => { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  FA.t = t;
  function setLang(lang, save) {
    state.lang = ['en', 'fr', 'ar'].includes(lang) ? lang : 'en';
    document.documentElement.lang = state.lang;
    document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
    try { localStorage.setItem('fa-lang', state.lang); } catch (e) {}
    if (save && state.user) api('POST', '/api/auth/language', { lang: state.lang }).catch(() => {});
  }
  let saved = 'en'; try { saved = localStorage.getItem('fa-lang') || (navigator.language || 'en').slice(0, 2); } catch (e) {}
  setLang(saved);
  const stageName = (n) => (STAGES[state.lang] && STAGES[state.lang][n]) || n;
  const d = (v) => FA.date(v, state.lang);
  const ds = (v) => FA.dateShort(v, state.lang);

  const langSwitch = () => `<div class="lang" role="group" aria-label="Language">
    ${['en', 'fr', 'ar'].map((l) => `<button type="button" data-lang="${l}" lang="${l}" aria-pressed="${state.lang === l}">${l === 'ar' ? 'ع' : l.toUpperCase()}</button>`).join('')}</div>`;
  function bindLang(el, rerender) {
    $$('[data-lang]', el).forEach((b) => b.addEventListener('click', () => { setLang(b.dataset.lang, true); rerender(); }));
  }

  // ---------- start ----------
  async function boot() {
    try {
      const me = await api('GET', '/api/auth/me');
      state.user = me.user;
      if (state.user && state.user.role === 'admin') { location.replace('/portal/studio/' + location.hash); return; }
      if (state.user) setLang(state.user.lang);
    } catch (e) { state.user = null; }
    window.addEventListener('hashchange', route);
    route();
  }

  async function route() {
    clearInterval(state.pollTimer);
    if (!state.user) return renderLogin();
    if (state.user.mustChangePassword) return renderPassword(true);
    const h = location.hash.replace(/^#\/?/, '').split('/');
    if (h[0] === 'account') return renderAccount();
    if (!state.projects) {
      try { state.projects = (await api('GET', '/api/projects')).projects; } catch (e) { return renderError(e); }
    }
    if (h[0] === 'p' && h[1]) return renderProject(Number(h[1]), h[2] || 'overview');
    if (state.projects.length === 1 && h[0] !== 'projects') { location.replace(`#/p/${state.projects[0].id}/overview`); return; }
    return renderPicker();
  }

  function renderError(e) {
    root.innerHTML = `<div class="main"><div class="empty"><b>${esc(e.message || t('err.generic'))}</b><button class="btn ghost" id="retry">↻</button></div></div>`;
    $('#retry').onclick = () => route();
  }

  // ---------- login ----------
  function renderLogin() {
    document.title = 'FA Client Portal';
    root.innerHTML = `<div class="auth">
      <div class="art"><img src="/images/golden-pavilion.webp" alt=""><div class="cap"><p class="label" style="color:#cfd3d9">FA Architectural Design</p><p>${esc(t('login.art'))}</p></div></div>
      <div class="side">
        <div class="top-tools">${langSwitch()}<button class="icon-btn" id="mode" type="button" aria-label="Day / night">${FA.mode() === 'day' ? FA.icon.moon : FA.icon.sun}</button></div>
        <form id="login" novalidate>
          <img class="mark" src="/images/logo.webp" alt="FA Architectural Design">
          <div><p class="label">${esc(t('login.eyebrow'))}</p><h1>${esc(t('login.title'))}</h1></div>
          <div class="field"><label for="email">${esc(t('login.email'))}</label><input id="email" type="email" autocomplete="username" required dir="ltr"></div>
          <div class="field"><label for="password">${esc(t('login.password'))}</label><input id="password" type="password" autocomplete="current-password" required dir="ltr"></div>
          <p class="err" id="login-err" role="alert" hidden></p>
          <button class="btn" type="submit">${esc(t('login.submit'))}</button>
          <p class="small muted">${esc(t('login.help'))}</p>
        </form>
      </div></div>`;
    bindLang(root, renderLogin);
    $('#mode').onclick = () => { FA.mode(FA.mode() === 'day' ? 'night' : 'day'); renderLogin(); };
    $('#login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#login-err'); err.hidden = true;
      const btn = $('#login button[type=submit]'); btn.disabled = true;
      try {
        const r = await api('POST', '/api/auth/login', { email: $('#email').value, password: $('#password').value });
        state.user = r.user;
        if (state.user.role === 'admin') { location.replace('/portal/studio/'); return; }
        setLang(state.user.lang === 'en' && state.lang !== 'en' ? state.lang : state.user.lang, state.user.lang !== state.lang);
        state.projects = null;
        route();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    });
  }

  // ---------- password ----------
  function renderPassword(forced) {
    const inner = `<form id="pw" novalidate style="display:flex;flex-direction:column;gap:16px;max-width:520px">
      ${forced ? `<img class="mark" src="/images/logo.webp" alt=""><div><h1 style="font-size:22px">${esc(t('pw.title'))}</h1><p class="muted small" style="margin-top:8px">${esc(t('pw.text'))}</p></div>` : ''}
      <div class="field"><label for="pw-cur">${esc(t(forced ? 'pw.temp' : 'pw.current'))}</label><input id="pw-cur" type="password" autocomplete="current-password" dir="ltr"></div>
      <div class="field"><label for="pw-new">${esc(t('pw.new'))}</label><input id="pw-new" type="password" autocomplete="new-password" dir="ltr"><span class="hint">${esc(t('pw.hint'))}</span></div>
      <div class="field"><label for="pw-new2">${esc(t('pw.confirm'))}</label><input id="pw-new2" type="password" autocomplete="new-password" dir="ltr"></div>
      <p class="err" id="pw-err" role="alert" hidden></p>
      <button class="btn" type="submit">${esc(t('pw.save'))}</button>
    </form>`;
    if (forced) {
      root.innerHTML = `<div class="auth"><div class="art"><img src="/images/golden-pavilion.webp" alt=""></div><div class="side"><div class="top-tools">${langSwitch()}</div><div style="margin:auto;width:100%;max-width:420px">${inner}</div></div></div>`;
      bindLang(root, () => renderPassword(true));
    } else {
      $('#pw-host').innerHTML = inner;
    }
    const f = $('#pw');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#pw-err'); err.hidden = true;
      if ($('#pw-new').value !== $('#pw-new2').value) { err.textContent = t('pw.mismatch'); err.hidden = false; return; }
      try {
        await api('POST', '/api/auth/password', { current: $('#pw-cur').value, password: $('#pw-new').value });
        state.user.mustChangePassword = false;
        FA.toast(t('pw.saved'));
        if (forced) route(); else f.reset();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
  }

  // ---------- shell ----------
  function shell(active, projectId, content) {
    const p = projectId && state.projects ? state.projects.find((x) => x.id === projectId) : null;
    const b = state.bundle && state.bundleId === projectId ? state.bundle : null;
    const pending = b ? b.approvals.filter((a) => a.status === 'pending').length : (p ? p.pending_approvals : 0);
    const unread = b ? b.unreadMessages : (p ? p.unread_messages : 0);
    const items = projectId ? [
      ['overview', t('nav.overview')], ['approvals', t('nav.approvals'), pending], ['documents', t('nav.documents')],
      ['messages', t('nav.messages'), unread], ['payments', t('nav.payments')], ['photos', t('nav.photos')],
    ] : [];
    const link = (v) => `#/p/${projectId}/${v}`;
    const navHtml = items.map(([v, label, n]) => `<a href="${link(v)}" ${active === v ? 'aria-current="page"' : ''}><span>${esc(label)}</span>${n ? `<span class="badge">${n}</span>` : ''}</a>`).join('');
    const extra = `${state.projects && state.projects.length > 1 ? `<a href="#/projects" ${active === 'projects' ? 'aria-current="page"' : ''}>${esc(t('nav.projects'))}</a>` : ''}<a href="#/account" ${active === 'account' ? 'aria-current="page"' : ''}>${esc(t('nav.account'))}</a>`;
    root.innerHTML = `
      <header class="topbar">
        <a class="brand" href="${projectId ? link('overview') : '#/'}"><img src="/images/logo.webp" alt=""><span>FA Architectural Design<small>${esc(t('brand.sub'))}</small></span></a>
        <div class="top-tools">${langSwitch()}<a class="icon-btn" href="#/account" aria-label="${esc(t('nav.account'))}">${FA.icon.bell}</a></div>
      </header>
      <div class="shell">
        <aside class="rail">
          ${p ? `<div><p class="label">${esc(p.code || '')}</p><p style="color:var(--white);margin-top:4px">${esc(p.name)}</p></div>` : ''}
          <nav aria-label="Portal">${navHtml}${extra}</nav>
          <div class="rail-foot"><span class="label">${esc(t('signedin'))}</span><b>${esc(state.user.name)}</b><button class="linkish" id="signout" type="button" style="margin-top:8px;align-self:flex-start">${esc(t('signout'))}</button></div>
        </aside>
        <main class="main" id="main">
          <nav class="tabs-m" aria-label="Portal">${navHtml}${extra}</nav>
          ${content}
        </main>
      </div>`;
    bindLang(root, () => route());
    $('#signout').onclick = signOut;
    const cur = $('.tabs-m [aria-current="page"]'); if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  async function signOut() {
    try { await FA.pushDisable(); } catch (e) {}
    await api('POST', '/api/auth/logout').catch(() => {});
    state.user = null; state.projects = null; state.bundle = null;
    location.hash = ''; renderLogin();
  }

  // ---------- project picker ----------
  function renderPicker() {
    document.title = t('pick.title') + ' · FA';
    const cards = state.projects.map((p) => `<a class="pcard" href="#/p/${p.id}/overview">
      <div class="img">${p.cover_file_id ? `<img src="/api/files/${p.cover_file_id}" alt="" loading="lazy">` : FA.icon.photo}</div>
      <div class="b"><p class="label">${esc(p.code || '')}</p><h3>${esc(p.name)}</h3><p class="small muted">${esc([p.location, stageName(p.stage_name || '')].filter(Boolean).join(' · '))}</p>
      ${p.pending_approvals ? `<p class="small" style="color:var(--warn)">${esc(t('ap.waiting'))}: ${p.pending_approvals}</p>` : ''}</div></a>`).join('');
    shell('projects', null, `<div class="phead"><h1>${esc(t('pick.title'))}</h1></div>${state.projects.length ? `<div class="pcards">${cards}</div>` : `<div class="empty"><b>${esc(t('pick.none'))}</b></div>`}`);
  }

  // ---------- project ----------
  async function renderProject(id, view) {
    const known = state.projects.find((p) => p.id === id);
    if (!known) { location.replace('#/projects'); return; }
    if (state.bundleId !== id || !state.bundle) {
      shell(view, id, `<div class="loading">${esc(t('loading'))}</div>`);
    }
    try { state.bundle = await api('GET', `/api/projects/${id}`); state.bundleId = id; }
    catch (e) { if (e.status === 401) { state.user = null; return renderLogin(); } return renderError(e); }
    const b = state.bundle;
    known.pending_approvals = b.approvals.filter((a) => a.status === 'pending').length;
    document.title = `${b.project.name} · FA`;
    const views = { overview: vOverview, approvals: vApprovals, documents: vDocuments, messages: vMessages, payments: vPayments, photos: vPhotos };
    const fn = views[view] || vOverview;
    const stage = b.stages.find((s) => s.position === b.project.currentStage);
    const head = `<div class="phead"><div><p class="label">${esc(b.project.code || '')}</p><h1>${esc(b.project.name)}</h1></div>
      <div class="meta">${b.project.location ? `<span>${esc(t('meta.location'))} <b>${esc(b.project.location)}</b></span>` : ''}${stage ? `<span>${esc(t('meta.stage'))} <b>${esc(stageName(stage.name))}</b></span>` : ''}${b.project.handover ? `<span>${esc(t('meta.handover'))} <b>${esc(b.project.handover)}</b></span>` : ''}</div></div>`;
    shell(view, id, head + '<div id="view"></div>');
    fn($('#view'), b);
  }

  // ----- overview -----
  async function vOverview(el, b) {
    const P = b.project;
    const stagesHtml = b.stages.map((s) => {
      const cls = s.position < P.currentStage ? 'done' : s.position === P.currentStage ? 'now' : '';
      return `<li class="${cls}"><i></i><b>${esc(stageName(s.name))}</b><span>${esc(s.date_label || '')}</span></li>`;
    }).join('');
    const work = b.work.map((w) => `<li><span class="dot ${w.percent >= 100 ? 'ok' : w.percent > 0 ? 'warn' : ''}"></span><div class="t"><b>${esc(w.title)}</b>${w.note ? `<span>${esc(w.note)}</span>` : ''}</div><span class="r">${w.percent}%</span></li>`).join('');
    const attn = [];
    b.approvals.filter((a) => a.status === 'pending').forEach((a) => attn.push(`<li><span class="dot warn"></span><div class="t"><b>${esc(a.title)}</b>${a.due_date ? `<span>${esc(t('ov.due', { d: ds(a.due_date) }))}</span>` : ''}</div><a class="linkish" href="#/p/${P.id}/approvals">${esc(t('ov.review'))}</a></li>`));
    b.payments.filter((x) => x.status === 'due').forEach((x) => attn.push(`<li><span class="dot due"></span><div class="t"><b>${esc(x.label)}</b><span>${esc(FA.money(x.amount, P.currency, state.lang))}${x.due_date ? ' · ' + esc(t('ov.due', { d: ds(x.due_date) })) : ''}</span></div><a class="linkish" href="#/p/${P.id}/payments">${esc(t('ov.view'))}</a></li>`));
    if (b.unreadMessages) attn.push(`<li><span class="dot warn"></span><div class="t"><b>${esc(t('ov.unread', { n: b.unreadMessages }))}</b><span>${esc(t('ov.fromStudio'))}</span></div><a class="linkish" href="#/p/${P.id}/messages">${esc(t('ov.open'))}</a></li>`);
    const updates = b.updates.map((u) => `<li><span class="dot ok"></span><div class="t"><b>${esc(u.title)}</b><span>${esc(u.body)}</span></div><span class="r">${esc(ds(u.created_at))}</span></li>`).join('');
    el.innerHTML = `
      <div id="notif-banner"></div>
      ${P.coverUrl ? `<div class="cover"><img src="${P.coverUrl}" alt=""></div>` : ''}
      <div class="stack">
        <div class="card"><h2>${esc(t('ov.stages'))}</h2><ol class="stages">${stagesHtml}</ol></div>
        <div class="grid2">
          <div class="card"><h2>${esc(t('ov.progress'))}</h2>
            <div class="bigstat"><span class="n num">${P.progress}%</span>${P.progressNote ? `<span class="muted small">${esc(P.progressNote)}</span>` : ''}</div>
            <div class="bar"><i style="width:${P.progress}%"></i></div>
            ${work ? `<ul class="list" style="margin-top:20px">${work}</ul>` : `<p class="muted small" style="margin-top:16px">${esc(t('ov.noProgress'))}</p>`}
          </div>
          <div class="stack">
            <div class="card"><h2>${esc(t('ov.attention'))}</h2>${attn.length ? `<ul class="list">${attn.join('')}</ul>` : `<p class="muted small">${esc(t('ov.allgood'))}</p>`}</div>
            <div class="card"><h2>${esc(t('ov.updates'))}</h2>${updates ? `<ul class="list">${updates}</ul>` : `<p class="muted small">${esc(t('ov.noupdates'))}</p>`}</div>
          </div>
        </div>
      </div>`;
    // Offer notifications once, if possible on this device.
    if (!state.bannerHidden && FA.pushSupported()) {
      const st = await FA.pushState().catch(() => 'unsupported');
      if (st === 'off') {
        const host = $('#notif-banner');
        host.innerHTML = `<div class="banner"><span class="small">${esc(t('banner.notif'))}</span><div class="acts"><button class="btn sm" id="nb-on" type="button">${esc(t('banner.enable'))}</button><button class="btn ghost sm" id="nb-later" type="button">${esc(t('banner.later'))}</button></div></div>`;
        $('#nb-on').onclick = async () => { try { await FA.pushEnable(); host.innerHTML = ''; FA.toast(t('acc.notifOn')); } catch (e) { FA.toast(t('acc.notifBlocked')); } };
        $('#nb-later').onclick = () => { host.innerHTML = ''; state.bannerHidden = true; try { localStorage.setItem('fa-notif-banner', 'hidden'); } catch (e) {} };
      }
    }
  }

  // ----- approvals -----
  function vApprovals(el, b) {
    if (!b.approvals.length) { el.innerHTML = `<div class="empty"><b>${esc(t('ap.empty'))}</b></div>`; return; }
    el.innerHTML = b.approvals.map((a) => {
      const pill = a.status === 'pending' ? `<span class="pill warn">${esc(t('ap.waiting'))}</span>` : a.status === 'approved' ? `<span class="pill ok">${esc(t('ap.approved'))}</span>` : `<span class="pill due">${esc(t('ap.changes'))}</span>`;
      const isImg = a.imageUrl;
      const thumb = isImg ? `<a class="thumb" href="${a.imageUrl}" target="_blank" rel="noopener"><img src="${a.imageUrl}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',innerHTML:FA.icon.doc}))"></a>` : `<div class="thumb"><span class="ph">${FA.icon.doc}</span></div>`;
      let body;
      if (a.status === 'pending') {
        body = `${a.options.length ? `<div class="opts" role="radiogroup">${a.options.map((o, i) => `<label><input type="radio" name="opt-${a.id}" id="opt-${a.id}-${i}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</div>` : ''}
          <div class="field" data-note hidden><label for="note-${a.id}">${esc(t('ap.what'))}</label><textarea id="note-${a.id}" rows="3"></textarea></div>
          <p class="err" data-err hidden></p>
          <div class="acts"><button class="btn" type="button" data-approve>${esc(t('ap.approve'))}</button><button class="btn ghost" type="button" data-changes>${esc(t('ap.request'))}</button><button class="linkish" type="button" data-cancel hidden>${esc(t('ap.cancel'))}</button></div>`;
      } else {
        body = `<p class="log">${esc(t('ap.decidedOn', { s: a.status === 'approved' ? t('ap.approved') : t('ap.changes'), d: d(a.decided_at) }))}</p>
          ${a.chosen_option ? `<p class="small">${esc(t('ap.yourChoice', { o: a.chosen_option }))}</p>` : ''}${a.client_comment ? `<p class="small muted">${esc(t('ap.yourComment', { c: a.client_comment }))}</p>` : ''}`;
      }
      return `<article class="appr" data-id="${a.id}">${thumb}<div class="body">
        <div class="head"><h3>${esc(a.title)}</h3>${pill}</div>
        ${a.description ? `<p class="small muted" style="white-space:pre-wrap">${esc(a.description)}</p>` : ''}
        ${a.status === 'pending' && a.due_date ? `<p class="small" style="color:var(--warn)">${esc(t('ap.due', { d: d(a.due_date) }))}</p>` : ''}
        ${body}</div></article>`;
    }).join('');
    $$('.appr', el).forEach((card) => {
      const id = card.dataset.id;
      const approve = $('[data-approve]', card); if (!approve) return;
      const changes = $('[data-changes]', card), cancel = $('[data-cancel]', card), note = $('[data-note]', card), err = $('[data-err]', card);
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      approve.onclick = async () => {
        err.hidden = true;
        const opt = $('input[type=radio]:checked', card);
        if ($('input[type=radio]', card) && !opt) return fail(t('ap.choose'));
        approve.disabled = true;
        try { await api('POST', `/api/approvals/${id}/decide`, { decision: 'approve', option: opt ? opt.value : null }); FA.toast(t('ap.sentOk')); route(); }
        catch (e) { approve.disabled = false; fail(e.message); }
      };
      changes.onclick = async () => {
        err.hidden = true;
        if (note.hidden) { note.hidden = false; cancel.hidden = false; approve.hidden = true; changes.textContent = t('ap.send'); $('textarea', note).focus(); return; }
        const c = $('textarea', note).value.trim(); if (!c) return fail(t('ap.what'));
        changes.disabled = true;
        try { await api('POST', `/api/approvals/${id}/decide`, { decision: 'changes', comment: c }); FA.toast(t('ap.sentOk')); route(); }
        catch (e) { changes.disabled = false; fail(e.message); }
      };
      cancel.onclick = () => { note.hidden = true; cancel.hidden = true; approve.hidden = false; changes.textContent = t('ap.request'); err.hidden = true; };
    });
  }

  // ----- documents -----
  function vDocuments(el, b) {
    if (!b.documents.length) { el.innerHTML = `<div class="empty"><b>${esc(t('doc.empty'))}</b></div>`; return; }
    const cats = ['all', ...['Drawings', 'Contracts', 'Permits', 'Reports', 'Invoices', 'Other'].filter((c) => b.documents.some((x) => x.category === c))];
    if (!cats.includes(state.docFilter)) state.docFilter = 'all';
    const rows = b.documents.filter((x) => state.docFilter === 'all' || x.category === state.docFilter).map((x) => `<tr>
      <td><span class="ftype">${esc(FA.ext(x.original_name))}</span><b>${esc(x.title)}</b></td>
      <td>${esc(t('doc.' + x.category))}</td><td class="num">${esc(x.version || '—')}</td><td class="num">${esc(d(x.created_at))}</td>
      <td style="white-space:nowrap"><a class="linkish" href="${x.url}" target="_blank" rel="noopener">${esc(t('doc.open'))}</a> &nbsp; <a class="linkish" href="${x.url}?download=1">${esc(t('doc.download'))}</a></td></tr>`).join('');
    el.innerHTML = `<div class="filters" role="group">${cats.map((c) => `<button type="button" data-f="${c}" aria-pressed="${state.docFilter === c}">${esc(t('doc.' + c))}</button>`).join('')}</div>
      <div class="tablewrap"><table><thead><tr><th>${esc(t('doc.name'))}</th><th>${esc(t('doc.category'))}</th><th>${esc(t('doc.version'))}</th><th>${esc(t('doc.date'))}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    $$('[data-f]', el).forEach((btn) => { btn.onclick = () => { state.docFilter = btn.dataset.f; vDocuments(el, b); }; });
  }

  // ----- messages -----
  function vMessages(el, b) {
    el.innerHTML = `<div class="chat"><div class="thread" id="thread" aria-live="polite"><div class="loading">${esc(t('loading'))}</div></div>
      <div class="attach-name" id="att-name" hidden></div>
      <form class="compose" id="compose"><label class="icon-btn" for="att" title="${esc(t('msg.attach'))}">${FA.icon.clip}<span class="sr">${esc(t('msg.attach'))}</span></label><input type="file" id="att" hidden>
      <textarea id="msg-in" rows="1" placeholder="${esc(t('msg.placeholder'))}" aria-label="${esc(t('msg.placeholder'))}"></textarea>
      <button class="btn" type="submit" aria-label="${esc(t('msg.send'))}">${FA.icon.send}</button></form></div>`;
    const thread = $('#thread'), input = $('#msg-in'), att = $('#att'), attName = $('#att-name');
    let lastCount = -1;
    async function load(scroll) {
      try {
        const { messages } = await api('GET', `/api/projects/${b.project.id}/messages`);
        if (messages.length === lastCount) return;
        lastCount = messages.length;
        b.unreadMessages = 0; const badge = $$('a[href$="/messages"] .badge'); badge.forEach((x) => x.remove());
        if (!messages.length) { thread.innerHTML = `<div class="empty" style="margin:auto"><b>${esc(t('msg.empty'))}</b></div>`; return; }
        let lastDay = '';
        thread.innerHTML = messages.map((m) => {
          const day = FA.dayKey(m.created_at); let sep = '';
          if (day !== lastDay) { lastDay = day; sep = `<span class="daysep">${esc(day === new Date().toDateString() ? t('msg.today') : ds(m.created_at))}</span>`; }
          const file = m.fileUrl ? (FA.isImage(m.file_mime) ? `<a class="att" href="${m.fileUrl}" target="_blank" rel="noopener" style="border:0;padding:0"><img src="${m.fileUrl}" alt="${esc(m.file_name)}" loading="lazy"></a>` : `<a class="att" href="${m.fileUrl}" target="_blank" rel="noopener">${esc(FA.ext(m.file_name))} · ${esc(m.file_name)}</a>`) : '';
          return `${sep}<div class="msg ${m.mine ? 'me' : ''}"><div class="bub">${esc(m.body)}${m.body && file ? '<br>' : ''}${file}</div><span class="meta">${esc(m.mine ? t('msg.you') : m.sender_name || 'FA')} · ${esc(FA.time(m.created_at, state.lang))}</span></div>`;
        }).join('');
        if (scroll !== false) thread.scrollTop = thread.scrollHeight;
      } catch (e) { if (lastCount < 0) thread.innerHTML = `<div class="empty"><b>${esc(e.message)}</b></div>`; }
    }
    load();
    state.pollTimer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15000);
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(140, input.scrollHeight) + 'px'; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !FA.isIOS && window.innerWidth > 700) { e.preventDefault(); $('#compose').requestSubmit(); } });
    att.onchange = () => {
      if (att.files[0]) { attName.hidden = false; attName.innerHTML = `${esc(att.files[0].name)} · <button class="linkish" type="button" id="att-x">${esc(t('msg.removeFile'))}</button>`; $('#att-x').onclick = () => { att.value = ''; attName.hidden = true; }; }
    };
    $('#compose').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim(); const file = att.files[0];
      if (!text && !file) return;
      const btn = $('#compose button[type=submit]'); btn.disabled = true;
      try {
        if (file) {
          const fd = new FormData(); fd.append('body', text);
          fd.append('file', FA.isImage(file.type) ? await FA.shrinkImage(file) : file);
          await FA.upload(`/api/projects/${b.project.id}/messages`, fd);
        } else await api('POST', `/api/projects/${b.project.id}/messages`, { body: text });
        input.value = ''; input.style.height = ''; att.value = ''; attName.hidden = true; lastCount = -1; await load();
      } catch (ex) { FA.toast(ex.message); }
      btn.disabled = false; input.focus();
    });
  }

  // ----- payments -----
  function vPayments(el, b) {
    const P = b.project;
    if (!b.payments.length && !P.contractValue) { el.innerHTML = `<div class="empty"><b>${esc(t('pay.empty'))}</b></div>`; return; }
    const paid = b.payments.filter((x) => x.status === 'paid').reduce((s, x) => s + x.amount, 0);
    const next = b.payments.find((x) => x.status === 'due') || b.payments.find((x) => x.status === 'upcoming');
    const total = P.contractValue || b.payments.reduce((s, x) => s + x.amount, 0);
    const pct = total ? Math.min(100, Math.round((paid / total) * 100)) : 0;
    const pill = (s) => s === 'paid' ? `<span class="pill ok">${esc(t('pay.paidStatus'))}</span>` : s === 'due' ? `<span class="pill due">${esc(t('pay.dueStatus'))}</span>` : `<span class="pill">${esc(t('pay.upcoming'))}</span>`;
    el.innerHTML = `<div class="grid3" style="margin-bottom:20px">
        <div class="card"><p class="label">${esc(t('pay.contract'))}</p><p class="n">${esc(FA.money(total, P.currency, state.lang))}</p></div>
        <div class="card"><p class="label">${esc(t('pay.paid'))}</p><p class="n">${esc(FA.money(paid, P.currency, state.lang))}</p><div class="bar" style="margin-top:12px"><i style="width:${pct}%"></i></div></div>
        <div class="card"><p class="label">${esc(t('pay.next'))}</p>${next ? `<p class="n">${esc(FA.money(next.amount, P.currency, state.lang))}</p><p class="small muted" style="margin-top:4px">${esc(next.label)}${next.due_date ? ' · ' + esc(t('pay.dueOn', { d: d(next.due_date) })) : ''}</p>` : `<p class="n">${esc(t('pay.none'))}</p>`}</div>
      </div>
      ${b.payments.length ? `<div class="tablewrap"><table><thead><tr><th>${esc(t('pay.label'))}</th><th>${esc(t('pay.milestone'))}</th><th>${esc(t('pay.amount'))}</th><th>${esc(t('pay.due'))}</th><th>${esc(t('pay.status'))}</th></tr></thead><tbody>
        ${b.payments.map((x) => `<tr><td><b>${esc(x.label)}</b></td><td>${esc(x.milestone || '')}</td><td class="num">${esc(FA.money(x.amount, P.currency, state.lang))}</td><td class="num">${esc(x.due_date ? d(x.due_date) : '—')}</td><td>${pill(x.status)}${x.status === 'paid' && x.paid_on ? `<div class="small muted" style="margin-top:4px">${esc(t('pay.paidOn', { d: ds(x.paid_on) }))}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : ''}`;
  }

  // ----- photos -----
  function vPhotos(el, b) {
    if (!b.photos.length) { el.innerHTML = `<div class="empty"><b>${esc(t('ph.empty'))}</b></div>`; return; }
    el.innerHTML = `<div class="photos">${b.photos.map((x, i) => `<figure class="photo"><button class="open" type="button" data-i="${i}" aria-label="${esc(x.caption || 'Photo')}"><img src="${x.url}" alt="${esc(x.caption || '')}" loading="lazy"></button>
      <figcaption>${esc(x.caption || '')}<span>${esc(ds(x.taken_on || x.created_at))}</span></figcaption></figure>`).join('')}</div>`;
    const items = b.photos.map((x) => ({ url: x.url, caption: x.caption, date: d(x.taken_on || x.created_at) }));
    $$('[data-i]', el).forEach((btn) => { btn.onclick = () => FA.lightbox(items, Number(btn.dataset.i), { download: t('ph.download'), close: t('ph.close') }); });
  }

  // ---------- account ----------
  async function renderAccount() {
    document.title = t('acc.title') + ' · FA';
    if (!state.projects) { try { state.projects = (await api('GET', '/api/projects')).projects; } catch (e) { state.projects = []; } }
    const pid = state.bundleId || (state.projects[0] && state.projects[0].id) || null;
    const u = state.user;
    shell('account', pid, `<div class="phead"><h1>${esc(t('acc.title'))}</h1></div>
      <div class="grid2"><div class="stack">
        <form class="card" id="profile"><h2>${esc(t('acc.profile'))}</h2><div class="form-grid">
          <div class="field"><label for="p-name">${esc(t('acc.name'))}</label><input id="p-name" value="${esc(u.name)}" required></div>
          <div class="field"><label for="p-phone">${esc(t('acc.phone'))}</label><input id="p-phone" value="${esc(u.phone || '')}" dir="ltr" inputmode="tel"></div>
          <div class="field full"><label>${esc(t('acc.email'))}</label><input value="${esc(u.email)}" disabled dir="ltr"></div>
          <div class="full"><button class="btn" type="submit">${esc(t('acc.save'))}</button></div></div></form>
        <div class="card"><h2>${esc(t('acc.security'))}</h2><div id="pw-host"></div></div>
      </div><div class="stack">
        <div class="card"><h2>${esc(t('acc.notif'))}</h2><p class="small" id="n-state">…</p><div class="acts" style="margin-top:14px" id="n-acts"></div></div>
        <div class="card"><h2>${esc(t('acc.install'))}</h2><p class="small muted" id="i-text"></p><div class="acts" style="margin-top:14px"><button class="btn ghost" id="i-btn" type="button" hidden>${esc(t('acc.installBtn'))}</button></div></div>
        <div class="card"><h2>${esc(t('acc.prefs'))}</h2>
          <div class="field"><span class="lbl">${esc(t('acc.language'))}</span>${langSwitch().replace('class="lang"', 'class="lang" style="align-self:flex-start"')}</div>
          <div class="field" style="margin-top:16px"><span class="lbl">${esc(t('acc.look'))}</span><div class="filters" style="margin:0"><button type="button" data-mode="night" aria-pressed="${FA.mode() !== 'day'}">${esc(t('acc.night'))}</button><button type="button" data-mode="day" aria-pressed="${FA.mode() === 'day'}">${esc(t('acc.day'))}</button></div></div>
        </div>
        <button class="btn ghost" id="signout2" type="button">${FA.icon.out}${esc(t('signout'))}</button>
      </div></div>`);
    renderPassword(false);
    $('#signout2').onclick = signOut;
    $$('[data-mode]').forEach((b) => { b.onclick = () => { FA.mode(b.dataset.mode); renderAccount(); }; });
    $('#profile').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('PATCH', '/api/auth/profile', { name: $('#p-name').value, phone: $('#p-phone').value }); u.name = $('#p-name').value.trim(); u.phone = $('#p-phone').value.trim(); FA.toast(t('acc.saved')); }
      catch (ex) { FA.toast(ex.message); }
    });
    // notifications
    async function paintNotif() {
      const st = await FA.pushState().catch(() => 'unsupported');
      const map = { on: 'acc.notifOn', off: 'acc.notifOff', blocked: 'acc.notifBlocked', unsupported: 'acc.notifUnsupported', 'ios-install': 'acc.notifIOS' };
      $('#n-state').textContent = t(map[st]);
      const acts = $('#n-acts');
      acts.innerHTML = st === 'on' ? `<button class="btn" id="n-test" type="button">${esc(t('acc.test'))}</button><button class="btn ghost" id="n-off" type="button">${esc(t('acc.disable'))}</button>`
        : st === 'off' ? `<button class="btn" id="n-on" type="button">${esc(t('acc.enable'))}</button>` : '';
      if ($('#n-on')) $('#n-on').onclick = async () => { try { await FA.pushEnable(); } catch (e) { FA.toast(t('acc.notifBlocked')); } paintNotif(); };
      if ($('#n-off')) $('#n-off').onclick = async () => { await FA.pushDisable(); paintNotif(); };
      if ($('#n-test')) $('#n-test').onclick = async () => { await api('POST', '/api/push/test'); FA.toast(t('acc.testSent')); };
    }
    paintNotif();
    // install
    const iText = $('#i-text'), iBtn = $('#i-btn');
    function paintInstall() {
      if (FA.isStandalone) { iText.textContent = t('acc.installed'); iBtn.hidden = true; return; }
      if (FA.installPrompt) { iText.textContent = t('acc.installText'); iBtn.hidden = false; return; }
      iText.textContent = `${t('acc.installText')} ${FA.isIOS ? t('acc.installIOS') : t('acc.installOther')}`;
    }
    paintInstall();
    document.addEventListener('fa-installable', paintInstall, { once: true });
    iBtn.onclick = async () => { if (!FA.installPrompt) return; FA.installPrompt.prompt(); await FA.installPrompt.userChoice; FA.installPrompt = null; paintInstall(); };
  }

  boot();
})();
