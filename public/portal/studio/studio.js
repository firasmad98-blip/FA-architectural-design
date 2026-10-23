/* FA Studio — Firas's side of the portal: clients, projects, uploads, approvals, payments, messages, website requests. */
(function () {
  'use strict';
  const { $, $$, esc, api } = FA;
  const root = $('#root');
  const L = 'en';
  const d = (v) => FA.date(v, L);
  const ds = (v) => FA.dateShort(v, L);
  const money = (n, c) => FA.money(n, c, L);
  const state = { user: null, projects: [], clients: [], bundle: null, pollTimer: null };
  const CATS = ['Drawings', 'Contracts', 'Permits', 'Reports', 'Invoices', 'Other'];
  const TABS = [['overview', 'Overview'], ['documents', 'Documents'], ['photos', 'Photos'], ['approvals', 'Approvals'], ['payments', 'Payments'], ['messages', 'Messages'], ['settings', 'Project details']];

  // ---------- start ----------
  async function boot() {
    try { state.user = (await api('GET', '/api/auth/me')).user; } catch (e) { state.user = null; }
    if (!state.user) { location.replace('/portal/' + (location.hash ? '' : '')); return; }
    if (state.user.role !== 'admin') { location.replace('/portal/'); return; }
    document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr';
    window.addEventListener('hashchange', route);
    route();
  }

  async function route() {
    clearInterval(state.pollTimer);
    const h = location.hash.replace(/^#\/?/, '').split('/');
    try {
      if (h[0] === 'projects' && h[1] === 'new') return newProject();
      if (h[0] === 'projects' && h[1]) return projectPage(Number(h[1]), h[2] || 'overview');
      if (h[0] === 'projects') return projectsPage();
      if (h[0] === 'clients') return clientsPage();
      if (h[0] === 'requests') return requestsPage();
      if (h[0] === 'account') return accountPage();
      return dashboard();
    } catch (e) {
      if (e.status === 401) { location.replace('/portal/'); return; }
      shell('', `<div class="empty"><b>${esc(e.message)}</b><button class="btn ghost" onclick="location.reload()">Reload</button></div>`);
    }
  }

  // ---------- shell ----------
  let counts = { requests: 0, approvals: 0 };
  function shell(active, content, sub) {
    const nav = [['', 'Dashboard'], ['projects', 'Projects'], ['clients', 'Clients'], ['requests', 'Website requests', counts.requests], ['account', 'My account']];
    const links = nav.map(([k, label, n]) => `<a href="#/${k}" ${active === k ? 'aria-current="page"' : ''}><span>${label}</span>${n ? `<span class="badge">${n}</span>` : ''}</a>`).join('');
    root.innerHTML = `
      <header class="topbar">
        <a class="brand" href="#/"><img src="/images/logo.webp" alt=""><span>FA Architectural Design<small>STUDIO</small></span></a>
        <div class="top-tools"><a class="btn ghost sm" href="/" target="_blank" rel="noopener">Website</a><a class="icon-btn" href="#/account" aria-label="Notifications and account">${FA.icon.bell}</a></div>
      </header>
      <div class="shell">
        <aside class="rail"><nav aria-label="Studio">${links}</nav>${sub || ''}
          <div class="rail-foot"><span class="label">Signed in as</span><b>${esc(state.user.name)}</b><button class="linkish" id="signout" type="button" style="margin-top:8px;align-self:flex-start">Sign out</button></div></aside>
        <main class="main"><nav class="tabs-m" aria-label="Studio">${links}</nav>${content}</main>
      </div>`;
    $('#signout').onclick = signOut;
  }
  async function signOut() { try { await FA.pushDisable(); } catch (e) {} await api('POST', '/api/auth/logout').catch(() => {}); location.replace('/portal/'); }
  async function refreshCounts() { try { const s = await api('GET', '/api/studio/summary'); counts = { requests: s.new_requests, approvals: s.pending_approvals }; return s; } catch (e) { return null; } }
  const statusPill = (s) => s === 'active' ? '<span class="pill ok">Active</span>' : s === 'completed' ? '<span class="pill">Completed</span>' : '<span class="pill due">Archived</span>';

  function confirmBox(title, text, okLabel, onOk, danger) {
    FA.modal(`<h2>${esc(title)}</h2><p class="small muted">${esc(text)}</p><div class="acts"><button class="btn ${danger ? 'danger' : ''}" id="cf-ok" type="button">${esc(okLabel)}</button><button class="btn ghost" data-close type="button">Cancel</button></div>`,
      { onOpen: (bg, close) => { $('#cf-ok', bg).onclick = async () => { $('#cf-ok', bg).disabled = true; try { await onOk(); close(); } catch (e) { FA.toast(e.message); $('#cf-ok', bg).disabled = false; } }; } });
  }

  // ---------- dashboard ----------
  async function dashboard() {
    document.title = 'Dashboard · FA Studio';
    const [s, pr, nt] = await Promise.all([refreshCounts(), api('GET', '/api/projects'), api('GET', '/api/notifications')]);
    state.projects = pr.projects;
    const kpi = (n, label, href) => `<a class="card" href="${href}"><p class="label">${label}</p><p class="n">${n}</p></a>`;
    const notes = nt.notifications.slice(0, 12).map((n) => `<li><span class="dot ${n.read_at ? '' : 'warn'}"></span><div class="t"><b>${esc(n.title)}</b><span>${esc(n.body)}</span></div><a class="linkish" href="${esc(n.url.replace('/portal/studio/', ''))}">${esc(ds(n.created_at))}</a></li>`).join('');
    const active = state.projects.filter((p) => p.status === 'active');
    shell('', `
      <div class="phead"><div><p class="label">Studio</p><h1>Good to see you, ${esc(state.user.name.split(' ')[0])}</h1></div><a class="btn" href="#/projects/new">New project</a></div>
      <div class="kpis">
        ${kpi(s ? s.active_projects : 0, 'Active projects', '#/projects')}${kpi(s ? s.clients : 0, 'Clients', '#/clients')}
        ${kpi(s ? s.pending_approvals : 0, 'Waiting for clients', '#/projects')}${kpi(s ? s.new_requests : 0, 'New website requests', '#/requests')}
        ${kpi(s ? s.payments_due : 0, 'Payments due', '#/projects')}
      </div>
      <div class="grid2">
        <div class="card"><div class="sec-title"><h2 style="margin:0">Active projects</h2><a class="linkish" href="#/projects">All projects</a></div>
          ${active.length ? `<ul class="list">${active.map((p) => `<li><span class="dot ${p.pending_approvals ? 'warn' : 'ok'}"></span><div class="t"><b>${esc(p.name)}</b><span>${esc([p.client_name || 'No client yet', p.stage_name, p.progress + '%'].filter(Boolean).join(' · '))}</span></div><a class="linkish" href="#/projects/${p.id}">Open</a></li>`).join('')}</ul>`
          : `<div class="empty"><b>No projects yet</b><span>Create your first project and invite its client.</span><a class="btn" href="#/projects/new">New project</a></div>`}
        </div>
        <div class="card"><div class="sec-title"><h2 style="margin:0">Activity</h2>${nt.unread ? '<button class="linkish" id="mark-read" type="button">Mark all as read</button>' : ''}</div>
          ${notes ? `<ul class="list">${notes}</ul>` : '<p class="small muted">Client decisions, messages and website requests will appear here.</p>'}</div>
      </div>`);
    if ($('#mark-read')) $('#mark-read').onclick = async () => { await api('POST', '/api/notifications/read'); dashboard(); };
  }

  // ---------- projects ----------
  async function projectsPage() {
    document.title = 'Projects · FA Studio';
    await refreshCounts();
    state.projects = (await api('GET', '/api/projects')).projects;
    const rows = state.projects.map((p) => `<tr><td><a class="linkish" href="#/projects/${p.id}" style="font-size:14.5px">${esc(p.name)}</a><div class="small muted">${esc(p.code || '')}</div></td>
      <td>${esc(p.client_name || '—')}</td><td>${esc(p.stage_name || '')}</td><td class="num">${p.progress}%</td>
      <td>${p.pending_approvals ? `<span class="pill warn">${p.pending_approvals} waiting</span>` : ''}${p.unread_messages ? ` <span class="pill">${p.unread_messages} new msg</span>` : ''}</td><td>${statusPill(p.status)}</td></tr>`).join('');
    shell('projects', `<div class="phead"><h1>Projects</h1><a class="btn" href="#/projects/new">New project</a></div>
      ${state.projects.length ? `<div class="tablewrap"><table><thead><tr><th>Project</th><th>Client</th><th>Stage</th><th>Progress</th><th>Waiting</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<div class="empty"><b>No projects yet</b><a class="btn" href="#/projects/new">Create the first project</a></div>`}`);
  }

  async function loadClients() { state.clients = (await api('GET', '/api/studio/clients')).clients; return state.clients; }
  const clientOptions = (sel) => `<option value="">— No client yet —</option>${state.clients.filter((c) => c.active || c.id === sel).map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)} · ${esc(c.email)}</option>`).join('')}`;

  async function newProject() {
    document.title = 'New project · FA Studio';
    await loadClients();
    shell('projects', `<div class="phead"><div><p class="label"><a class="linkish" href="#/projects">Projects</a></p><h1>New project</h1></div></div>
      <form class="card" id="np" style="max-width:760px"><div class="form-grid">
        <div class="field full"><label for="np-name">Project name</label><input id="np-name" required placeholder="e.g. Villa Haddad"></div>
        <div class="field"><label for="np-loc">Location</label><input id="np-loc" placeholder="e.g. Baakline, Chouf"></div>
        <div class="field"><label for="np-type">Type</label><input id="np-type" list="types" placeholder="e.g. Villa"><datalist id="types"><option>Villa</option><option>Residential building</option><option>Apartment interior</option><option>Office</option><option>Commercial</option><option>Resort</option><option>Industrial</option><option>Landscaping</option><option>Renovation</option></datalist></div>
        <div class="field full"><label for="np-client">Client</label><select id="np-client">${clientOptions(null)}</select><span class="hint">Not in the list? <a class="linkish" href="#/clients">Add the client first</a>, then come back.</span></div>
        <div class="field"><label for="np-value">Contract value</label><input id="np-value" inputmode="decimal" placeholder="e.g. 420000"></div>
        <div class="field"><label for="np-cur">Currency</label><select id="np-cur"><option>USD</option><option>EUR</option><option>LBP</option></select></div>
        <div class="field full"><label for="np-hand">Expected handover</label><input id="np-hand" placeholder="e.g. Jun 2027"></div>
        <p class="err full" id="np-err" hidden></p>
        <div class="full acts"><button class="btn" type="submit">Create project</button><a class="btn ghost" href="#/projects">Cancel</a></div>
      </div></form>`);
    $('#np').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('POST', '/api/studio/projects', { name: $('#np-name').value, location: $('#np-loc').value, type: $('#np-type').value, clientId: $('#np-client').value || null, contractValue: $('#np-value').value, currency: $('#np-cur').value, handover: $('#np-hand').value });
        FA.toast('Project created'); location.hash = `#/projects/${r.id}/overview`;
      } catch (ex) { $('#np-err').textContent = ex.message; $('#np-err').hidden = false; }
    });
  }

  // ---------- one project ----------
  async function projectPage(id, tab) {
    const b = await api('GET', `/api/projects/${id}`);
    state.bundle = b;
    const P = b.project;
    document.title = `${P.name} · FA Studio`;
    const pending = b.approvals.filter((a) => a.status === 'pending').length;
    const tabs = TABS.map(([k, label]) => `<a href="#/projects/${id}/${k}" ${tab === k ? 'aria-current="page"' : ''}><span>${label}</span>${k === 'approvals' && pending ? `<span class="badge">${pending}</span>` : ''}${k === 'messages' && b.unreadMessages ? `<span class="badge">${b.unreadMessages}</span>` : ''}</a>`).join('');
    const stage = b.stages.find((s) => s.position === P.currentStage);
    shell('projects', `
      <div class="phead"><div><p class="label"><a class="linkish" href="#/projects">Projects</a> · ${esc(P.code || '')}</p><h1>${esc(P.name)}</h1></div>
        <div class="meta"><span>Client <b>${esc(b.client ? b.client.name : 'not assigned')}</b></span>${stage ? `<span>Stage <b>${esc(stage.name)}</b></span>` : ''}<span>Progress <b>${P.progress}%</b></span>${statusPill(P.status)}</div></div>
      <nav class="filters" aria-label="Project sections" style="margin-bottom:22px">${TABS.map(([k, label]) => `<a href="#/projects/${id}/${k}" class="btn ${tab === k ? '' : 'ghost'} sm">${label}${k === 'approvals' && pending ? ` (${pending})` : ''}${k === 'messages' && b.unreadMessages ? ` (${b.unreadMessages})` : ''}</a>`).join('')}</nav>
      <div id="tab"></div>`);
    const fn = { overview: tOverview, documents: tDocuments, photos: tPhotos, approvals: tApprovals, payments: tPayments, messages: tMessages, settings: tSettings }[tab] || tOverview;
    await fn($('#tab'), b);
  }
  const reload = () => route();

  // ----- overview: stage, progress, work lines, stage names -----
  function tOverview(el, b) {
    const P = b.project;
    const noClient = !b.client ? `<div class="banner"><span class="small">This project has no client yet, so nobody can see it in the portal.</span><a class="btn sm" href="#/projects/${P.id}/settings">Assign a client</a></div>` : '';
    el.innerHTML = `${noClient}
      <div class="grid2">
        <form class="card" id="prog"><h2>Stage and progress</h2>
          <div class="stack" style="gap:16px">
            <div class="field"><label for="pg-stage">Current stage</label><select id="pg-stage">${b.stages.map((s) => `<option value="${s.position}" ${s.position === P.currentStage ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
            <div class="field"><label for="pg-val">Overall progress</label><div class="range"><input type="range" id="pg-val" min="0" max="100" step="1" value="${P.progress}"><b class="num" id="pg-out" style="color:var(--white);min-width:48px">${P.progress}%</b></div></div>
            <div class="field"><label for="pg-note">Short note for the client</label><input id="pg-note" value="${esc(P.progressNote || '')}" placeholder="e.g. Structure complete, façade under way"></div>
            <label class="check"><input type="checkbox" id="pg-notify" checked> Notify the client about the new progress</label>
            <div><button class="btn" type="submit">Save</button></div>
          </div></form>
        <form class="card" id="work"><h2>Progress breakdown</h2><p class="small muted" style="margin:-6px 0 14px">Lines the client sees under progress, for example “Structure · 100%”.</p>
          <div class="editor" id="work-rows"></div>
          <div class="acts" style="margin-top:14px"><button class="btn ghost sm" type="button" id="work-add">Add line</button><button class="btn sm" type="submit">Save lines</button></div></form>
      </div>
      <form class="card" id="stages" style="margin-top:20px"><h2>Stage names and dates</h2><p class="small muted" style="margin:-6px 0 14px">Default names are translated for French and Arabic clients automatically. Dates are free text, for example “Jan 2026”.</p>
        <div class="editor" id="stage-rows"></div>
        <div class="acts" style="margin-top:14px"><button class="btn ghost sm" type="button" id="stage-add">Add stage</button><button class="btn sm" type="submit">Save stages</button></div></form>`;
    $('#pg-val').oninput = () => { $('#pg-out').textContent = $('#pg-val').value + '%'; };
    $('#prog').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('PATCH', `/api/studio/projects/${P.id}`, { currentStage: Number($('#pg-stage').value), progress: Number($('#pg-val').value), progressNote: $('#pg-note').value, notify: $('#pg-notify').checked }); FA.toast('Saved'); reload(); }
      catch (ex) { FA.toast(ex.message); }
    });
    const xBtn = `<button class="icon-btn" type="button" data-x aria-label="Remove">${FA.icon.close}</button>`;
    const workRow = (w = {}) => `<div class="editor-row"><input class="input" data-k="title" placeholder="e.g. Façade stone cladding" value="${esc(w.title || '')}" aria-label="Line"><input class="input note" data-k="note" placeholder="Note (optional)" value="${esc(w.note || '')}" aria-label="Note"><input class="input" data-k="percent" type="number" min="0" max="100" value="${w.percent || 0}" aria-label="Percent">${xBtn}</div>`;
    const stageRow = (s = {}) => `<div class="editor-row two"><input class="input" data-k="name" value="${esc(s.name || '')}" placeholder="Stage name" aria-label="Stage"><input class="input" data-k="date" value="${esc(s.date_label || '')}" placeholder="Date, e.g. Mar 2026" aria-label="Date">${xBtn}</div>`;
    $('#work-rows').innerHTML = b.work.map(workRow).join('') || workRow();
    $('#stage-rows').innerHTML = b.stages.map(stageRow).join('');
    const bindX = (host) => $$('[data-x]', host).forEach((x) => { x.onclick = () => x.parentElement.remove(); });
    bindX($('#work-rows')); bindX($('#stage-rows'));
    $('#work-add').onclick = () => { $('#work-rows').insertAdjacentHTML('beforeend', workRow()); bindX($('#work-rows')); };
    $('#stage-add').onclick = () => { $('#stage-rows').insertAdjacentHTML('beforeend', stageRow()); bindX($('#stage-rows')); };
    const collect = (host) => $$('.editor-row', host).map((r) => Object.fromEntries($$('[data-k]', r).map((i) => [i.dataset.k, i.value])));
    $('#work').addEventListener('submit', async (e) => { e.preventDefault(); try { await api('PUT', `/api/studio/projects/${P.id}/work`, { items: collect($('#work-rows')) }); FA.toast('Lines saved'); reload(); } catch (ex) { FA.toast(ex.message); } });
    $('#stages').addEventListener('submit', async (e) => { e.preventDefault(); try { await api('PUT', `/api/studio/projects/${P.id}/stages`, { stages: collect($('#stage-rows')) }); FA.toast('Stages saved'); reload(); } catch (ex) { FA.toast(ex.message); } });
  }

  // ----- documents -----
  function tDocuments(el, b) {
    const P = b.project;
    el.innerHTML = `<form class="card" id="up" style="margin-bottom:20px"><h2>Upload documents</h2><div class="form-grid">
        <div class="field full"><label for="up-files">Files</label><input type="file" id="up-files" multiple required><span class="hint">PDF, DWG, images, Word, Excel or ZIP. Up to 30 MB each, 5 at a time.</span></div>
        <div class="field"><label for="up-title">Title</label><input id="up-title" placeholder="Uses the file name if empty"><span class="hint">Only used when uploading one file.</span></div>
        <div class="field"><label for="up-cat">Category</label><select id="up-cat">${CATS.map((c) => `<option>${c}</option>`).join('')}</select></div>
        <div class="field"><label for="up-ver">Version</label><input id="up-ver" placeholder="e.g. Rev C"></div>
        <label class="check" style="align-self:end"><input type="checkbox" id="up-notify" checked> Notify the client</label>
        <div class="full"><button class="btn" type="submit">Upload</button><div class="progress-up" hidden><i></i></div></div>
      </div></form>
      ${b.documents.length ? `<div class="tablewrap"><table><thead><tr><th>Document</th><th>Category</th><th>Version</th><th>Size</th><th>Added</th><th></th></tr></thead><tbody>
        ${b.documents.map((x) => `<tr><td><span class="ftype">${esc(FA.ext(x.original_name))}</span><a class="linkish" href="${x.url}" target="_blank" rel="noopener">${esc(x.title)}</a></td><td>${esc(x.category)}</td><td class="num">${esc(x.version || '—')}</td><td class="num">${FA.size(x.size)}</td><td class="num">${esc(d(x.created_at))}</td>
          <td><div class="row-acts"><button class="btn danger sm" type="button" data-del="${x.id}" data-name="${esc(x.title)}">Delete</button></div></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty"><b>No documents yet</b><span>Upload plans, contracts, permits and reports for the client.</span></div>'}`;
    $('#up').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fl = $('#up-files').files; if (!fl.length) return;
      const fd = new FormData();
      Array.from(fl).slice(0, 5).forEach((f) => fd.append('files', f));
      fd.append('title', $('#up-title').value); fd.append('category', $('#up-cat').value); fd.append('version', $('#up-ver').value); fd.append('notify', String($('#up-notify').checked));
      const bar = $('.progress-up', el); bar.hidden = false; const btn = $('#up button[type=submit]'); btn.disabled = true;
      try { await FA.upload(`/api/studio/projects/${P.id}/documents`, fd, (p) => { $('i', bar).style.width = p + '%'; }); FA.toast('Uploaded'); reload(); }
      catch (ex) { FA.toast(ex.message); btn.disabled = false; bar.hidden = true; }
    });
    $$('[data-del]', el).forEach((x) => { x.onclick = () => confirmBox('Delete document?', `“${x.dataset.name}” will be removed for the client too.`, 'Delete', async () => { await api('DELETE', `/api/studio/documents/${x.dataset.del}`); reload(); }, true); });
  }

  // ----- photos -----
  function tPhotos(el, b) {
    const P = b.project;
    el.innerHTML = `<form class="card" id="up" style="margin-bottom:20px"><h2>Add site photos</h2><div class="form-grid">
        <div class="field full"><label for="ph-files">Photos</label><input type="file" id="ph-files" accept="image/jpeg,image/png,image/webp,image/heic" multiple required><span class="hint">Photos are resized automatically before upload, so this works well on mobile data.</span></div>
        <div class="field"><label for="ph-cap">Caption</label><input id="ph-cap" placeholder="e.g. Façade progress, week 18"></div>
        <div class="field"><label for="ph-date">Date taken</label><input id="ph-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <label class="check full"><input type="checkbox" id="ph-notify" checked> Notify the client</label>
        <div class="full"><button class="btn" type="submit">Upload photos</button><div class="progress-up" hidden><i></i></div></div>
      </div></form>
      ${b.photos.length ? `<div class="photos">${b.photos.map((x, i) => `<figure class="photo"><button class="open" type="button" data-i="${i}"><img src="${x.url}" alt="" loading="lazy"></button>
        <figcaption>${esc(x.caption || '')}<span>${esc(ds(x.taken_on || x.created_at))}</span></figcaption>
        <div class="tools">${P.coverPhotoId === x.id ? '<span class="tag-cover">Cover photo</span>' : `<button class="btn ghost sm" type="button" data-cover="${x.id}">Use as cover</button>`}<button class="btn danger sm" type="button" data-del="${x.id}">Delete</button></div></figure>`).join('')}</div>`
        : '<div class="empty"><b>No photos yet</b><span>Add renders or site visit photos. The first photo becomes the project cover.</span></div>'}`;
    $('#up').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fl = Array.from($('#ph-files').files).slice(0, 30); if (!fl.length) return;
      const btn = $('#up button[type=submit]'); btn.disabled = true; btn.textContent = 'Preparing…';
      const fd = new FormData();
      for (const f of fl) fd.append('photos', await FA.shrinkImage(f));
      fd.append('caption', $('#ph-cap').value); fd.append('takenOn', $('#ph-date').value); fd.append('notify', String($('#ph-notify').checked));
      const bar = $('.progress-up', el); bar.hidden = false; btn.textContent = 'Uploading…';
      try { const r = await FA.upload(`/api/studio/projects/${P.id}/photos`, fd, (p) => { $('i', bar).style.width = p + '%'; }); FA.toast(`${r.count} photo(s) added`); reload(); }
      catch (ex) { FA.toast(ex.message); btn.disabled = false; btn.textContent = 'Upload photos'; bar.hidden = true; }
    });
    const items = b.photos.map((x) => ({ url: x.url, caption: x.caption, date: d(x.taken_on || x.created_at) }));
    $$('[data-i]', el).forEach((x) => { x.onclick = () => FA.lightbox(items, Number(x.dataset.i)); });
    $$('[data-cover]', el).forEach((x) => { x.onclick = async () => { await api('PATCH', `/api/studio/projects/${P.id}`, { coverPhotoId: Number(x.dataset.cover) }); FA.toast('Cover updated'); reload(); }; });
    $$('[data-del]', el).forEach((x) => { x.onclick = () => confirmBox('Delete photo?', 'The client will no longer see it.', 'Delete', async () => { await api('DELETE', `/api/studio/photos/${x.dataset.del}`); reload(); }, true); });
  }

  // ----- approvals -----
  function tApprovals(el, b) {
    const P = b.project;
    const pill = (s) => s === 'pending' ? '<span class="pill warn">Waiting for client</span>' : s === 'approved' ? '<span class="pill ok">Approved</span>' : '<span class="pill due">Changes requested</span>';
    el.innerHTML = `<form class="card" id="ap" style="margin-bottom:20px"><h2>Ask the client to approve something</h2><div class="form-grid">
        <div class="field full"><label for="ap-title">What needs approval</label><input id="ap-title" required placeholder="e.g. Kitchen worktop marble"></div>
        <div class="field full"><label for="ap-desc">Explanation</label><textarea id="ap-desc" rows="3" placeholder="What the client should know before deciding"></textarea></div>
        <div class="field"><label for="ap-opts">Options to choose from (optional)</label><textarea id="ap-opts" rows="4" placeholder="One option per line&#10;Calacatta white&#10;Taupe travertine"></textarea><span class="hint">Leave empty for a simple approve / request changes.</span></div>
        <div class="stack" style="gap:16px">
          <div class="field"><label for="ap-due">Answer needed by</label><input id="ap-due" type="date"></div>
          <div class="field"><label for="ap-file">Image or drawing (optional)</label><input id="ap-file" type="file" accept="image/*,.pdf"></div>
        </div>
        <div class="full"><button class="btn" type="submit">Send to client</button><span class="small muted" style="margin-inline-start:12px">The client is notified straight away.</span></div>
      </div></form>
      ${b.approvals.length ? b.approvals.map((a) => `<article class="appr">${a.imageUrl ? `<a class="thumb" href="${a.imageUrl}" target="_blank" rel="noopener"><img src="${a.imageUrl}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',innerHTML:FA.icon.doc}))"></a>` : `<div class="thumb"><span class="ph">${FA.icon.doc}</span></div>`}
        <div class="body"><div class="head"><h3>${esc(a.title)}</h3>${pill(a.status)}</div>
          ${a.description ? `<p class="small muted" style="white-space:pre-wrap">${esc(a.description)}</p>` : ''}
          ${a.options.length ? `<p class="small">Options: ${a.options.map((o) => `<span class="pill" style="margin:2px">${esc(o)}</span>`).join(' ')}</p>` : ''}
          ${a.status === 'pending' ? `<p class="small muted">Sent ${esc(d(a.created_at))}${a.due_date ? ` · answer needed by ${esc(d(a.due_date))}` : ''}</p>` : `<p class="small">${a.status === 'approved' ? 'Approved' : 'Changes requested'} by ${esc(a.decided_by_name || 'client')} on ${esc(d(a.decided_at))} at ${esc(FA.time(a.decided_at, L))}</p>
            ${a.chosen_option ? `<p class="small">Chosen: <b style="color:var(--white);font-weight:400">${esc(a.chosen_option)}</b></p>` : ''}${a.client_comment ? `<p class="small" style="white-space:pre-wrap">Client’s comment: ${esc(a.client_comment)}</p>` : ''}`}
          <div class="acts">${a.status !== 'pending' ? `<button class="btn ghost sm" type="button" data-reopen="${a.id}">Ask again</button>` : ''}<button class="btn danger sm" type="button" data-del="${a.id}">Delete</button></div>
        </div></article>`).join('') : '<div class="empty"><b>No approvals yet</b><span>Ask the client to choose materials or approve designs. Every decision is recorded with date and time.</span></div>'}`;
    $('#ap').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData();
      fd.append('title', $('#ap-title').value); fd.append('description', $('#ap-desc').value); fd.append('options', $('#ap-opts').value); fd.append('dueDate', $('#ap-due').value);
      const f = $('#ap-file').files[0]; if (f) fd.append('file', FA.isImage(f.type) ? await FA.shrinkImage(f) : f);
      const btn = $('#ap button[type=submit]'); btn.disabled = true;
      try { await FA.upload(`/api/studio/projects/${P.id}/approvals`, fd); FA.toast('Sent to the client'); reload(); } catch (ex) { FA.toast(ex.message); btn.disabled = false; }
    });
    $$('[data-reopen]', el).forEach((x) => { x.onclick = () => confirmBox('Ask the client again?', 'Their previous answer is cleared and they are notified again.', 'Ask again', async () => { await api('POST', `/api/studio/approvals/${x.dataset.reopen}/reopen`); reload(); }); });
    $$('[data-del]', el).forEach((x) => { x.onclick = () => confirmBox('Delete this approval?', 'It will be removed for the client, including their answer.', 'Delete', async () => { await api('DELETE', `/api/studio/approvals/${x.dataset.del}`); reload(); }, true); });
  }

  // ----- payments -----
  function tPayments(el, b) {
    const P = b.project;
    const paid = b.payments.filter((x) => x.status === 'paid').reduce((s, x) => s + x.amount, 0);
    const scheduled = b.payments.reduce((s, x) => s + x.amount, 0);
    el.innerHTML = `<div class="grid3" style="margin-bottom:20px">
        <div class="card"><p class="label">Contract value</p><p class="n">${esc(money(P.contractValue, P.currency))}</p><p class="small muted"><a class="linkish" href="#/projects/${P.id}/settings">Edit</a></p></div>
        <div class="card"><p class="label">Scheduled</p><p class="n">${esc(money(scheduled, P.currency))}</p>${P.contractValue && Math.round(scheduled) !== Math.round(P.contractValue) ? '<p class="small" style="color:var(--warn)">Different from the contract value</p>' : ''}</div>
        <div class="card"><p class="label">Received</p><p class="n">${esc(money(paid, P.currency))}</p></div>
      </div>
      <form class="card" id="pay" style="margin-bottom:20px"><h2>Add a payment</h2><div class="form-grid">
        <div class="field"><label for="py-label">Name</label><input id="py-label" required placeholder="e.g. Instalment ${b.payments.length + 1} of 6"></div>
        <div class="field"><label for="py-ms">Milestone</label><input id="py-ms" placeholder="e.g. Structure complete"></div>
        <div class="field"><label for="py-amt">Amount (${esc(P.currency)})</label><input id="py-amt" inputmode="decimal" required></div>
        <div class="field"><label for="py-due">Due date</label><input id="py-due" type="date"></div>
        <div class="field"><label for="py-st">Status</label><select id="py-st"><option value="upcoming">Upcoming</option><option value="due">Due now (notifies the client)</option><option value="paid">Paid</option></select></div>
        <div style="align-self:end"><button class="btn" type="submit">Add payment</button></div>
      </div></form>
      ${b.payments.length ? `<div class="tablewrap"><table><thead><tr><th>Payment</th><th>Milestone</th><th>Amount</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
        ${b.payments.map((x) => `<tr><td><b>${esc(x.label)}</b></td><td>${esc(x.milestone || '')}</td><td class="num">${esc(money(x.amount, P.currency))}</td><td class="num">${esc(x.due_date ? d(x.due_date) : '—')}</td>
          <td><select class="input" data-status="${x.id}" aria-label="Status"><option value="upcoming" ${x.status === 'upcoming' ? 'selected' : ''}>Upcoming</option><option value="due" ${x.status === 'due' ? 'selected' : ''}>Due</option><option value="paid" ${x.status === 'paid' ? 'selected' : ''}>Paid${x.paid_on ? ' · ' + esc(ds(x.paid_on)) : ''}</option></select></td>
          <td><div class="row-acts"><button class="btn danger sm" type="button" data-del="${x.id}">Delete</button></div></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty"><b>No payment schedule yet</b><span>Add each instalment so the client always knows what is paid and what is next.</span></div>'}`;
    $('#pay').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('POST', `/api/studio/projects/${P.id}/payments`, { label: $('#py-label').value, milestone: $('#py-ms').value, amount: $('#py-amt').value, dueDate: $('#py-due').value, status: $('#py-st').value }); FA.toast('Payment added'); reload(); }
      catch (ex) { FA.toast(ex.message); }
    });
    $$('[data-status]', el).forEach((s) => { s.onchange = async () => { try { await api('PATCH', `/api/studio/payments/${s.dataset.status}`, { status: s.value }); FA.toast(s.value === 'due' ? 'Marked as due · client notified' : 'Updated'); reload(); } catch (ex) { FA.toast(ex.message); } }; });
    $$('[data-del]', el).forEach((x) => { x.onclick = () => confirmBox('Delete payment?', 'It will be removed from the client’s schedule.', 'Delete', async () => { await api('DELETE', `/api/studio/payments/${x.dataset.del}`); reload(); }, true); });
  }

  // ----- messages -----
  function tMessages(el, b) {
    const P = b.project;
    el.innerHTML = `${!b.client ? '<div class="banner"><span class="small">Assign a client to this project so they can read and answer messages.</span></div>' : ''}
      <div class="chat"><div class="thread" id="thread"><div class="loading">Loading…</div></div><div class="attach-name" id="att-name" hidden></div>
      <form class="compose" id="compose"><label class="icon-btn" for="att" title="Attach a file">${FA.icon.clip}<span class="sr">Attach a file</span></label><input type="file" id="att" hidden>
      <textarea id="msg-in" rows="1" placeholder="Write to ${esc(b.client ? b.client.name : 'the client')}…" aria-label="Message"></textarea><button class="btn" type="submit" aria-label="Send">${FA.icon.send}</button></form></div>`;
    const thread = $('#thread'), input = $('#msg-in'), att = $('#att'), attName = $('#att-name');
    let last = -1;
    async function load() {
      const { messages } = await api('GET', `/api/projects/${P.id}/messages`);
      if (messages.length === last) return; last = messages.length;
      if (!messages.length) { thread.innerHTML = '<div class="empty" style="margin:auto"><b>No messages yet</b><span>Start the conversation with your client.</span></div>'; return; }
      let lastDay = '';
      thread.innerHTML = messages.map((m) => {
        const day = FA.dayKey(m.created_at); let sep = '';
        if (day !== lastDay) { lastDay = day; sep = `<span class="daysep">${esc(day === new Date().toDateString() ? 'Today' : ds(m.created_at))}</span>`; }
        const file = m.fileUrl ? (FA.isImage(m.file_mime) ? `<a class="att" href="${m.fileUrl}" target="_blank" rel="noopener" style="border:0;padding:0"><img src="${m.fileUrl}" alt="" loading="lazy"></a>` : `<a class="att" href="${m.fileUrl}" target="_blank" rel="noopener">${esc(FA.ext(m.file_name))} · ${esc(m.file_name)}</a>`) : '';
        const me = m.sender_role === 'admin';
        return `${sep}<div class="msg ${me ? 'me' : ''}"><div class="bub">${esc(m.body)}${m.body && file ? '<br>' : ''}${file}</div><span class="meta">${esc(m.mine ? 'You' : m.sender_name || '')} · ${esc(FA.time(m.created_at, L))}</span></div>`;
      }).join('');
      thread.scrollTop = thread.scrollHeight;
    }
    load().catch((e) => { thread.innerHTML = `<div class="empty"><b>${esc(e.message)}</b></div>`; });
    state.pollTimer = setInterval(() => { if (document.visibilityState === 'visible') load().catch(() => {}); }, 15000);
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(140, input.scrollHeight) + 'px'; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 700) { e.preventDefault(); $('#compose').requestSubmit(); } });
    att.onchange = () => { if (att.files[0]) { attName.hidden = false; attName.innerHTML = `${esc(att.files[0].name)} · <button class="linkish" type="button" id="att-x">Remove</button>`; $('#att-x').onclick = () => { att.value = ''; attName.hidden = true; }; } };
    $('#compose').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim(); const f = att.files[0]; if (!text && !f) return;
      const btn = $('#compose button[type=submit]'); btn.disabled = true;
      try {
        if (f) { const fd = new FormData(); fd.append('body', text); fd.append('file', FA.isImage(f.type) ? await FA.shrinkImage(f) : f); await FA.upload(`/api/projects/${P.id}/messages`, fd); }
        else await api('POST', `/api/projects/${P.id}/messages`, { body: text });
        input.value = ''; input.style.height = ''; att.value = ''; attName.hidden = true; last = -1; await load();
      } catch (ex) { FA.toast(ex.message); }
      btn.disabled = false; input.focus();
    });
  }

  // ----- project details -----
  async function tSettings(el, b) {
    const P = b.project;
    await loadClients();
    el.innerHTML = `<form class="card" id="ps" style="max-width:820px"><h2>Project details</h2><div class="form-grid">
        <div class="field full"><label for="ps-name">Project name</label><input id="ps-name" value="${esc(P.name)}" required></div>
        <div class="field"><label for="ps-code">Reference</label><input id="ps-code" value="${esc(P.code || '')}"></div>
        <div class="field"><label for="ps-type">Type</label><input id="ps-type" value="${esc(P.type || '')}"></div>
        <div class="field"><label for="ps-loc">Location</label><input id="ps-loc" value="${esc(P.location || '')}"></div>
        <div class="field"><label for="ps-hand">Expected handover</label><input id="ps-hand" value="${esc(P.handover || '')}"></div>
        <div class="field full"><label for="ps-client">Client</label><select id="ps-client">${clientOptions(P.clientId)}</select><span class="hint">Only this client can see the project in their portal.</span></div>
        <div class="field"><label for="ps-value">Contract value</label><input id="ps-value" inputmode="decimal" value="${P.contractValue === null ? '' : P.contractValue}"></div>
        <div class="field"><label for="ps-cur">Currency</label><select id="ps-cur">${['USD', 'EUR', 'LBP'].map((c) => `<option ${c === P.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label for="ps-status">Status</label><select id="ps-status"><option value="active" ${P.status === 'active' ? 'selected' : ''}>Active</option><option value="completed" ${P.status === 'completed' ? 'selected' : ''}>Completed (client can still see it)</option><option value="archived" ${P.status === 'archived' ? 'selected' : ''}>Archived (hidden from client)</option></select></div>
        <div class="full"><button class="btn" type="submit">Save details</button></div>
      </div></form>
      <div class="card" style="max-width:820px;margin-top:20px;border-color:var(--due-line)"><h2>Delete project</h2><p class="small muted">Deletes the project with all its documents, photos, approvals, payments and messages. This cannot be undone.</p><div class="acts" style="margin-top:14px"><button class="btn danger" id="ps-del" type="button">Delete project</button></div></div>`;
    $('#ps').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PATCH', `/api/studio/projects/${P.id}`, { name: $('#ps-name').value, code: $('#ps-code').value, type: $('#ps-type').value, location: $('#ps-loc').value, handover: $('#ps-hand').value, clientId: $('#ps-client').value || null, contractValue: $('#ps-value').value, currency: $('#ps-cur').value, status: $('#ps-status').value });
        FA.toast('Details saved'); reload();
      } catch (ex) { FA.toast(ex.message); }
    });
    $('#ps-del').onclick = () => FA.modal(`<h2>Delete “${esc(P.name)}”?</h2><p class="small muted">Type the project name to confirm. Everything inside it is deleted for good.</p><div class="field"><label for="del-name">Project name</label><input id="del-name" autocomplete="off"></div><div class="acts"><button class="btn danger" id="del-ok" type="button" disabled>Delete for good</button><button class="btn ghost" data-close type="button">Cancel</button></div>`,
      { onOpen: (bg, close) => { const i = $('#del-name', bg), ok = $('#del-ok', bg); i.oninput = () => { ok.disabled = i.value.trim() !== P.name.trim(); }; ok.onclick = async () => { await api('DELETE', `/api/studio/projects/${P.id}`); close(); FA.toast('Project deleted'); location.hash = '#/projects'; }; } });
  }

  // ---------- clients ----------
  // Messages the studio sends to clients, in the client's language.
  const SIGN = { en: 'Firas Moufid Abou Dargham\nFA Architectural Design', fr: 'Firas Moufid Abou Dargham\nFA Architectural Design', ar: 'فراس مفيد أبو ضرغم\nFA Architectural Design' };
  const MSG = {
    invite: {
      en: (n, e, link, portal) => `Hello ${n},\n\nYour private client portal for your project with FA Architectural Design is ready. You can follow progress, see documents and photos, approve decisions and message the studio.\n\nTap this link to open your portal and choose your password (valid for 7 days):\n${link}\n\nAfter that, sign in any time at ${portal} with your email (${e}), or with Face ID / fingerprint.\n\n${SIGN.en}`,
      fr: (n, e, link, portal) => `Bonjour ${n},\n\nVotre espace client pour votre projet avec FA Architectural Design est prêt. Vous pouvez y suivre l’avancement, consulter les documents et photos, valider les choix et écrire au bureau.\n\nTouchez ce lien pour ouvrir votre espace et choisir votre mot de passe (valable 7 jours) :\n${link}\n\nEnsuite, connectez-vous à tout moment sur ${portal} avec votre e-mail (${e}), ou avec Face ID / empreinte.\n\n${SIGN.fr}`,
      ar: (n, e, link, portal) => `مرحباً ${n}،\n\nبوابتك الخاصة لمتابعة مشروعك مع FA Architectural Design أصبحت جاهزة. يمكنك من خلالها متابعة سير العمل، والاطلاع على المستندات والصور، والموافقة على القرارات، ومراسلة المكتب.\n\nاضغط على هذا الرابط لفتح بوابتك واختيار كلمة المرور (صالح لمدة ٧ أيام):\n${link}\n\nبعد ذلك يمكنك الدخول في أي وقت عبر ${portal} ببريدك الإلكتروني (${e})، أو عبر Face ID / البصمة.\n\n${SIGN.ar}`,
    },
    reset: {
      en: (n, e, link) => `Hello ${n},\n\nHere is your new link to open your FA client portal and choose a new password (valid for 48 hours):\n${link}\n\n${SIGN.en}`,
      fr: (n, e, link) => `Bonjour ${n},\n\nVoici votre nouveau lien pour ouvrir votre espace client FA et choisir un nouveau mot de passe (valable 48 heures) :\n${link}\n\n${SIGN.fr}`,
      ar: (n, e, link) => `مرحباً ${n}،\n\nهذا رابطك الجديد لفتح بوابة العملاء الخاصة بـ FA واختيار كلمة مرور جديدة (صالح لمدة ٤٨ ساعة):\n${link}\n\n${SIGN.ar}`,
    },
    password: {
      en: (n, e, pw, portal) => `Hello ${n},\n\nI have set a temporary password for your FA client portal:\n\nOpen: ${portal}\nEmail: ${e}\nTemporary password: ${pw}\n\nYou will be asked to choose your own password when you sign in.\n\n${SIGN.en}`,
      fr: (n, e, pw, portal) => `Bonjour ${n},\n\nJ’ai défini un mot de passe temporaire pour votre espace client FA :\n\nAdresse : ${portal}\nE-mail : ${e}\nMot de passe temporaire : ${pw}\n\nVous choisirez votre propre mot de passe à la connexion.\n\n${SIGN.fr}`,
      ar: (n, e, pw, portal) => `مرحباً ${n}،\n\nحدّدت لك كلمة مرور مؤقتة لبوابة العملاء الخاصة بـ FA:\n\nالرابط: ${portal}\nالبريد الإلكتروني: ${e}\nكلمة المرور المؤقتة: ${pw}\n\nسيُطلب منك اختيار كلمة مرور خاصة بك عند الدخول.\n\n${SIGN.ar}`,
    },
  };
  const portalUrl = () => location.origin + '/portal/';
  function showMessage(client, title, note, text) {
    FA.modal(`<h2>${esc(title)}</h2><p class="small muted">${esc(note)}</p>
      <div class="copybox" dir="${client.lang === 'ar' ? 'rtl' : 'ltr'}">${esc(text)}</div>
      <div class="acts"><button class="btn" id="msg-copy" type="button">Copy message</button><a class="btn ghost" id="msg-wa" target="_blank" rel="noopener">Open WhatsApp</a><button class="btn ghost" data-close type="button">Done</button></div>`,
      { onOpen: (bg) => {
        $('#msg-copy', bg).onclick = (e) => FA.copy(text, e.target, 'Copied');
        const phone = String(client.phone || '').replace(/[^\d]/g, '');
        $('#msg-wa', bg).href = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
        if (!phone) $('#msg-wa', bg).title = 'No phone number saved for this client: WhatsApp will ask you to choose the contact.';
      } });
  }
  function showLink(client, r) {
    const first = client.name.split(' ')[0], lang = MSG.invite[client.lang] ? client.lang : 'en';
    const text = r.purpose === 'invite' ? MSG.invite[lang](first, client.email, r.link, portalUrl()) : MSG.reset[lang](first, client.email, r.link);
    showMessage(client, r.purpose === 'invite' ? `Send the invitation to ${client.name}` : `Send the new link to ${client.name}`,
      `The client taps the link and chooses ${r.purpose === 'invite' ? 'their' : 'a new'} password. It works once and stays valid until ${d(r.expiresAt)}, ${FA.time(r.expiresAt, L)}. Any older link stops working.`, text);
  }
  function helpSignIn(c) {
    const status = [
      c.last_login_at ? `Last signed in ${d(c.last_login_at)}.` : 'Has not signed in yet.',
      c.link_expires ? `An unused link is valid until ${d(c.link_expires)}.` : '',
      c.devices ? `Face ID / fingerprint is on for ${c.devices} device${c.devices === 1 ? '' : 's'}.` : '',
    ].filter(Boolean).join(' ');
    FA.modal(`<h2>Help ${esc(c.name)} sign in</h2><p class="small muted">${esc(status)}</p>
      <div class="card" style="padding:16px"><p style="color:var(--white)">1 · Send a new link <span class="pill ok" style="margin-inline-start:6px">Recommended</span></p>
        <p class="small muted" style="margin:6px 0 12px">The client taps it on their phone and chooses a new password. Their other devices are signed out.</p>
        <button class="btn sm" type="button" id="h-link">Create link</button></div>
      <div class="card" style="padding:16px"><p style="color:var(--white)">2 · Set a password yourself</p>
        <p class="small muted" style="margin:6px 0 12px">Useful during a phone call. The client is asked to change it when they sign in.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><input class="input" id="h-pw" style="flex:1;min-width:160px" autocomplete="off" placeholder="At least 8 characters" dir="ltr"><button class="btn ghost sm" type="button" id="h-gen">Suggest one</button><button class="btn sm" type="button" id="h-set">Set password</button></div>
        <p class="err" id="h-err" hidden style="margin-top:8px"></p></div>
      ${c.devices ? `<div class="card" style="padding:16px"><p style="color:var(--white)">3 · Lost phone?</p><p class="small muted" style="margin:6px 0 12px">Remove Face ID / fingerprint sign-in from all of ${esc(c.name.split(' ')[0])}’s devices.</p><button class="btn danger sm" type="button" id="h-dev">Remove ${c.devices} device${c.devices === 1 ? '' : 's'}</button></div>` : ''}
      <div class="acts"><button class="btn ghost" data-close type="button">Close</button></div>`,
      { onOpen: (bg, close) => {
        $('#h-link', bg).onclick = async () => { try { const r = await api('POST', `/api/studio/clients/${c.id}/access-link`); close(); clientsPage(); setTimeout(() => showLink(c, r), 60); } catch (e) { FA.toast(e.message); } };
        $('#h-gen', bg).onclick = () => { const a = 'abcdefghjkmnpqrstuvwxyz', D = '23456789'; const r = (x) => x[crypto.getRandomValues(new Uint32Array(1))[0] % x.length]; $('#h-pw', bg).value = 'Fa-' + Array.from({ length: 4 }, () => r(a)).join('') + Array.from({ length: 4 }, () => r(D)).join(''); };
        $('#h-set', bg).onclick = async () => {
          const pw = $('#h-pw', bg).value.trim();
          try {
            await api('POST', `/api/studio/clients/${c.id}/set-password`, { password: pw });
            close(); clientsPage();
            const lang = MSG.password[c.lang] ? c.lang : 'en';
            setTimeout(() => showMessage(c, `Send the password to ${c.name}`, 'Their other devices were signed out. They will choose their own password when they sign in.', MSG.password[lang](c.name.split(' ')[0], c.email, pw, portalUrl())), 60);
          } catch (e) { $('#h-err', bg).textContent = e.message; $('#h-err', bg).hidden = false; }
        };
        if ($('#h-dev', bg)) $('#h-dev', bg).onclick = async () => { await api('DELETE', `/api/studio/clients/${c.id}/passkeys`); close(); FA.toast('Face ID / fingerprint removed'); clientsPage(); };
      } });
  }
  async function clientsPage() {
    document.title = 'Clients · FA Studio';
    await Promise.all([loadClients(), refreshCounts()]);
    const langName = { en: 'English', fr: 'Français', ar: 'العربية' };
    shell('clients', `<div class="phead"><h1>Clients</h1><button class="btn" id="add" type="button">Add client</button></div>
      ${state.clients.length ? `<div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Language</th><th>Projects</th><th>Sign-in</th><th></th></tr></thead><tbody>
        ${state.clients.map((c) => `<tr style="${c.active ? '' : 'opacity:.55'}"><td><b>${esc(c.name)}</b>${c.active ? '' : ' <span class="pill due">Disabled</span>'}</td><td>${esc(c.email)}</td><td dir="ltr">${esc(c.phone || '—')}</td><td>${langName[c.lang]}</td><td class="num">${c.projects}</td><td class="small">${c.last_login_at ? esc(d(c.last_login_at)) : (c.link_expires ? '<span class="pill warn">Invited</span>' : '<span class="muted">Never</span>')}${c.devices ? ' <span class="pill ok">Face ID</span>' : ''}</td>
          <td><div class="row-acts"><button class="btn ghost sm" type="button" data-edit="${c.id}">Edit</button><button class="btn ghost sm" type="button" data-help="${c.id}">Help with sign-in</button></div></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty"><b>No clients yet</b><span>Add a client, then create their project. They receive a one-tap link by WhatsApp or email to open their portal.</span></div>'}`);
    const form = (c = {}) => `<form id="cf" style="display:flex;flex-direction:column;gap:14px"><h2>${c.id ? 'Edit client' : 'Add client'}</h2>
      <div class="field"><label for="cf-name">Full name</label><input id="cf-name" value="${esc(c.name || '')}" required></div>
      <div class="field"><label for="cf-email">Email (used to sign in)</label><input id="cf-email" type="email" value="${esc(c.email || '')}" required dir="ltr"></div>
      <div class="field"><label for="cf-phone">Phone / WhatsApp</label><input id="cf-phone" value="${esc(c.phone || '')}" placeholder="+961 3 123 456" dir="ltr"></div>
      <div class="field"><label for="cf-lang">Portal language</label><select id="cf-lang">${['en', 'fr', 'ar'].map((l) => `<option value="${l}" ${c.lang === l ? 'selected' : ''}>${langName[l]}</option>`).join('')}</select></div>
      ${c.id ? `<label class="check"><input type="checkbox" id="cf-active" ${c.active ? 'checked' : ''}> Can sign in</label>` : ''}
      <p class="err" id="cf-err" hidden></p>
      <div class="acts"><button class="btn" type="submit">${c.id ? 'Save' : 'Add client'}</button><button class="btn ghost" data-close type="button">Cancel</button></div></form>`;
    $('#add').onclick = () => FA.modal(form(), { onOpen: (bg, close) => {
      $('#cf', bg).addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const lang = $('#cf-lang', bg).value, phone = $('#cf-phone', bg).value;
          const r = await api('POST', '/api/studio/clients', { name: $('#cf-name', bg).value, email: $('#cf-email', bg).value, phone, lang });
          close(); await clientsPage(); showLink({ ...r.client, lang, phone }, r);
        } catch (ex) { $('#cf-err', bg).textContent = ex.message; $('#cf-err', bg).hidden = false; }
      });
    } });
    $$('[data-edit]').forEach((x) => { x.onclick = () => { const c = state.clients.find((y) => y.id === Number(x.dataset.edit)); FA.modal(form(c), { onOpen: (bg, close) => {
      $('#cf', bg).addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api('PATCH', `/api/studio/clients/${c.id}`, { name: $('#cf-name', bg).value, email: $('#cf-email', bg).value, phone: $('#cf-phone', bg).value, lang: $('#cf-lang', bg).value, active: $('#cf-active', bg).checked }); close(); FA.toast('Saved'); clientsPage(); }
        catch (ex) { $('#cf-err', bg).textContent = ex.message; $('#cf-err', bg).hidden = false; }
      });
    } }); }; });
    $$('[data-help]').forEach((x) => { x.onclick = () => helpSignIn(state.clients.find((y) => y.id === Number(x.dataset.help))); });
  }

  // ---------- website requests ----------
  async function requestsPage() {
    document.title = 'Website requests · FA Studio';
    const { requests } = await api('GET', '/api/studio/requests');
    await refreshCounts();
    const st = (r) => `<select class="input" data-st="${r.id}" aria-label="Status">${[['new', 'New'], ['contacted', 'Contacted'], ['closed', 'Closed']].map(([v, l]) => `<option value="${v}" ${r.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    shell('requests', `<div class="phead"><div><p class="label">From the website form</p><h1>Website requests</h1></div></div>
      ${requests.length ? `<div class="tablewrap"><table><thead><tr><th>Received</th><th>Name and contact</th><th>Project</th><th>Message</th><th>Status</th><th></th></tr></thead><tbody>
        ${requests.map((r) => `<tr style="${r.status === 'closed' ? 'opacity:.55' : ''}"><td class="num">${esc(d(r.created_at))}<div class="small muted">${esc(FA.time(r.created_at, L))}</div></td>
          <td><b>${esc(r.name)}</b><div class="small" dir="ltr">${esc(r.contact || '')}</div><div class="small muted">${esc((r.language || '').toUpperCase())}</div></td>
          <td class="small">${esc([r.project_type, r.location].filter(Boolean).join(' · '))}<div class="muted">${esc([r.budget, r.timeline].filter(Boolean).join(' · '))}</div></td>
          <td><div class="req-msg">${esc(r.message || '')}</div></td><td>${st(r)}</td>
          <td><div class="row-acts">${waLink(r)}<button class="btn danger sm" type="button" data-del="${r.id}">Delete</button></div></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty"><b>No requests yet</b><span>When someone sends the “Request a consultation” form on your website, it appears here and you get a notification.</span></div>'}`);
    $$('[data-st]').forEach((s) => { s.onchange = async () => { await api('PATCH', `/api/studio/requests/${s.dataset.st}`, { status: s.value }); requestsPage(); }; });
    $$('[data-del]').forEach((x) => { x.onclick = () => confirmBox('Delete request?', 'This removes it from the list.', 'Delete', async () => { await api('DELETE', `/api/studio/requests/${x.dataset.del}`); requestsPage(); }, true); });
  }
  function waLink(r) {
    const digits = String(r.contact || '').replace(/[^\d+]/g, '');
    if (/@/.test(r.contact || '')) return `<a class="btn ghost sm" href="mailto:${esc(r.contact)}">Email</a>`;
    if (digits.replace(/\D/g, '').length >= 7) return `<a class="btn ghost sm" href="https://wa.me/${digits.replace(/\D/g, '')}" target="_blank" rel="noopener">WhatsApp</a>`;
    return '';
  }

  // ---------- account ----------
  async function accountPage() {
    document.title = 'My account · FA Studio';
    const nt = await api('GET', '/api/notifications');
    shell('account', `<div class="phead"><h1>My account</h1></div>
      <div class="grid2"><div class="stack">
        <form class="card" id="pw"><h2>Change password</h2><div class="stack" style="gap:14px">
          <div class="field"><label for="pw-cur">Current password</label><input id="pw-cur" type="password" autocomplete="current-password"></div>
          <div class="field"><label for="pw-new">New password</label><input id="pw-new" type="password" autocomplete="new-password"><span class="hint">At least 8 characters. Other devices are signed out.</span></div>
          <p class="err" id="pw-err" hidden></p><div><button class="btn" type="submit">Save password</button></div></div></form>
        <div class="card"><h2>Notifications on this device</h2><p class="small" id="n-state">…</p><div class="acts" style="margin-top:14px" id="n-acts"></div>
          <p class="small muted" style="margin-top:14px">Turn this on on your phone to be alerted when a client approves, requests changes, writes to you, or when someone sends the website form. On iPhone, first add the portal to your Home Screen from Safari.</p></div>
      </div><div class="stack">
        <div class="card"><h2>Face ID / fingerprint</h2><div id="pk-list"><p class="small muted">…</p></div><div class="acts" style="margin-top:14px"><button class="btn" id="pk-add" type="button" hidden>Turn on for this device</button></div></div>
        <div class="card"><h2>Appearance</h2><div class="filters" style="margin:0"><button type="button" data-mode="night" aria-pressed="${FA.mode() !== 'day'}">Night</button><button type="button" data-mode="day" aria-pressed="${FA.mode() === 'day'}">Day</button></div></div>
        <div class="card"><h2>Recent notifications</h2>${nt.notifications.length ? `<ul class="list">${nt.notifications.slice(0, 10).map((n) => `<li><span class="dot ${n.read_at ? '' : 'warn'}"></span><div class="t"><b>${esc(n.title)}</b><span>${esc(n.body)}</span></div><span class="r">${esc(ds(n.created_at))}</span></li>`).join('')}</ul>` : '<p class="small muted">Nothing yet.</p>'}</div>
        <button class="btn ghost" id="so" type="button">${FA.icon.out}Sign out</button>
      </div></div>`);
    $('#so').onclick = signOut;
    $$('[data-mode]').forEach((b) => { b.onclick = () => { FA.mode(b.dataset.mode); accountPage(); }; });
    $('#pw').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/auth/password', { current: $('#pw-cur').value, password: $('#pw-new').value }); FA.toast('Password changed'); $('#pw').reset(); $('#pw-err').hidden = true; }
      catch (ex) { $('#pw-err').textContent = ex.message; $('#pw-err').hidden = false; }
    });
    async function paint() {
      const st = await FA.pushState().catch(() => 'unsupported');
      if (!$('#n-state')) return;
      const text = { on: 'On.', off: 'Off.', blocked: 'Blocked in this browser’s settings. Allow notifications for this site, then reload.', unsupported: 'This browser does not support notifications.', 'ios-install': 'On iPhone: open the portal in Safari, tap Share → Add to Home Screen, then open it from the icon and turn notifications on there.' };
      $('#n-state').textContent = text[st];
      $('#n-acts').innerHTML = st === 'on' ? '<button class="btn" id="n-test" type="button">Send a test</button><button class="btn ghost" id="n-off" type="button">Turn off</button>' : st === 'off' ? '<button class="btn" id="n-on" type="button">Turn on</button>' : '';
      if ($('#n-on')) $('#n-on').onclick = async () => { try { await FA.pushEnable(); } catch (e) { FA.toast('Notifications were not allowed.'); } paint(); };
      if ($('#n-off')) $('#n-off').onclick = async () => { await FA.pushDisable(); paint(); };
      if ($('#n-test')) $('#n-test').onclick = async () => { await api('POST', '/api/push/test'); FA.toast('Test sent'); };
    }
    paint();
    async function paintPk() {
      const can = await FA.passkeyAvailable();
      let list = []; try { list = (await api('GET', '/api/passkeys')).passkeys; } catch (e) {}
      if (!$('#pk-list')) return; // the page changed meanwhile
      $('#pk-list').innerHTML = list.length ? `<ul class="list">${list.map((k) => `<li><span class="dot ok"></span><div class="t"><b>${esc(k.label || '')}</b><span>${esc(k.last_used_at ? 'Last used ' + d(k.last_used_at) : 'Added ' + d(k.created_at))}</span></div><button class="linkish" type="button" data-pk-del="${k.id}">Remove</button></li>`).join('')}</ul>`
        : `<p class="small muted">${can ? 'Sign in to the studio with Face ID or your fingerprint instead of your password.' : 'This browser or device can’t use Face ID / fingerprint sign-in.'}</p>`;
      $('#pk-add').hidden = !can;
      $$('[data-pk-del]').forEach((b) => { b.onclick = async () => { await api('DELETE', '/api/passkeys/' + b.dataset.pkDel); paintPk(); }; });
    }
    $('#pk-add').onclick = async () => { try { await FA.passkeyRegister(); FA.toast('Face ID / fingerprint is on for this device'); paintPk(); } catch (e) { if (!FA.passkeyCancelled(e)) FA.toast(e.message || 'It did not work on this device.'); } };
    paintPk();
    await api('POST', '/api/notifications/read').catch(() => {});
  }

  boot();
})();
