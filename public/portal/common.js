/* Shared helpers for the client portal and the studio. */
(function () {
  'use strict';
  const FA = {};

  // ---------- day / night (shared with the website) ----------
  FA.mode = function (set) {
    const root = document.documentElement;
    if (set) { try { localStorage.setItem('fa-mode', set); } catch (e) {} }
    let m = 'night'; try { m = localStorage.getItem('fa-mode') || 'night'; } catch (e) {}
    if (m === 'day') root.dataset.mode = 'day'; else delete root.dataset.mode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = m === 'day' ? '#efede8' : '#0a0b0d';
    return m;
  };
  FA.mode();

  // ---------- API ----------
  FA.api = async function (method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'fa' } };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let r;
    try { r = await fetch(url, opts); } catch (e) { const err = new Error(FA.t ? FA.t('err.network') : 'No connection. Check your internet and try again.'); err.code = 'network'; throw err; }
    let data = {};
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error(data.error || 'Something went wrong.'); err.status = r.status; err.code = data.code; throw err; }
    return data;
  };

  // Upload with progress (used for documents and photos).
  FA.upload = function (url, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', url);
      x.withCredentials = true;
      x.setRequestHeader('X-Requested-With', 'fa');
      x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
      x.onload = () => {
        let d = {}; try { d = JSON.parse(x.responseText); } catch (e) {}
        if (x.status >= 200 && x.status < 300) resolve(d); else reject(new Error(d.error || 'Upload failed.'));
      };
      x.onerror = () => reject(new Error('Upload failed. Check your connection.'));
      x.send(formData);
    });
  };

  // ---------- small helpers ----------
  FA.esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  FA.$ = (sel, el) => (el || document).querySelector(sel);
  FA.$$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  FA.locale = (lang) => ({ en: 'en-GB', fr: 'fr-FR', ar: 'ar-LB-u-nu-latn' }[lang] || 'en-GB');

  function toDate(v) {
    if (!v) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); }
    const d = new Date(v); return isNaN(d) ? null : d;
  }
  FA.date = (v, lang, opts) => { const d = toDate(v); return d ? d.toLocaleDateString(FA.locale(lang), opts || { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };
  FA.dateShort = (v, lang) => FA.date(v, lang, { day: 'numeric', month: 'short' });
  FA.time = (v, lang) => { const d = toDate(v); return d ? d.toLocaleTimeString(FA.locale(lang), { hour: '2-digit', minute: '2-digit' }) : ''; };
  FA.dayKey = (v) => { const d = toDate(v); return d ? d.toDateString() : ''; };
  FA.money = (n, currency, lang) => {
    if (n === null || n === undefined || n === '') return '—';
    // Amounts always use the same, familiar format ($126,000) in every language.
    try { return Number(n).toLocaleString('en-US', { style: 'currency', currency: currency || 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }); }
    catch (e) { return `${Number(n).toLocaleString()} ${currency || ''}`; }
  };
  FA.size = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  FA.ext = (name) => { const m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toUpperCase() : 'FILE'; };
  FA.isImage = (mime) => /^image\/(jpeg|png|webp)/.test(mime || '');

  let toastTimer;
  FA.toast = (msg) => {
    let t = FA.$('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  };

  FA.copy = async (text, btn, done) => {
    try { await navigator.clipboard.writeText(text); if (btn) { const o = btn.textContent; btn.textContent = done || 'Copied'; setTimeout(() => { btn.textContent = o; }, 1600); } return true; }
    catch (e) { return false; }
  };

  FA.icon = {
    doc: '<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/></svg>',
    clip: '<svg viewBox="0 0 24 24"><path d="M20 11.5l-8.3 8.3a5 5 0 0 1-7-7L13 4.5a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2.5-6.5z"/></svg>',
    left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    photo: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>',
    out: '<svg viewBox="0 0 24 24"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/></svg>',
  };

  // ---------- photo viewer ----------
  FA.lightbox = function (items, index, labels) {
    let i = index || 0;
    const bg = document.createElement('div');
    bg.className = 'lightbox'; bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true');
    bg.innerHTML = `<div class="lb-top"><span class="cap"></span><div style="display:flex;gap:8px"><a class="btn ghost sm dl" download>${labels && labels.download || 'Download'}</a><button class="close" type="button" aria-label="${labels && labels.close || 'Close'}">${FA.icon.close}</button></div></div>
      <div class="lb-img"><button class="nav prev" type="button" aria-label="Previous">${FA.icon.left}</button><img alt=""><button class="nav next" type="button" aria-label="Next">${FA.icon.right}</button></div>`;
    const img = FA.$('img', bg), cap = FA.$('.cap', bg), dl = FA.$('.dl', bg);
    function show() {
      const it = items[i]; img.src = it.url; img.alt = it.caption || ''; cap.textContent = [it.caption, it.date].filter(Boolean).join(' · ');
      dl.href = it.url + '?download=1';
      FA.$$('.nav', bg).forEach((n) => { n.hidden = items.length < 2; });
    }
    const rtl = () => document.documentElement.dir === 'rtl';
    function go(d) { i = (i + d + items.length) % items.length; show(); }
    function close() { bg.remove(); document.removeEventListener('keydown', key); }
    function key(e) { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') go(rtl() ? -1 : 1); if (e.key === 'ArrowLeft') go(rtl() ? 1 : -1); }
    FA.$('.prev', bg).onclick = () => go(-1); FA.$('.next', bg).onclick = () => go(1); FA.$('.close', bg).onclick = close;
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.classList.contains('lb-img')) close(); });
    let sx = null; bg.addEventListener('pointerdown', (e) => { sx = e.clientX; });
    bg.addEventListener('pointerup', (e) => { if (sx === null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 50) go((dx < 0) !== rtl() ? 1 : -1); });
    document.addEventListener('keydown', key);
    document.body.appendChild(bg); show(); FA.$('.close', bg).focus();
  };

  // ---------- modal ----------
  FA.modal = function (html, { onOpen } = {}) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => { bg.remove(); document.removeEventListener('keydown', key); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', key);
    document.body.appendChild(bg);
    const first = bg.querySelector('input,textarea,select,button');
    if (first) first.focus();
    if (onOpen) onOpen(bg, close);
    return close;
  };

  // ---------- installable app + push notifications ----------
  FA.isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  FA.isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  FA.swReady = null;
  if ('serviceWorker' in navigator) {
    FA.swReady = navigator.serviceWorker.register('/portal/sw.js', { scope: '/portal/' }).catch(() => null);
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.go) location.href = e.data.go; });
  }
  FA.pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  FA.pushState = async function () {
    if (!FA.pushSupported()) return FA.isIOS && !FA.isStandalone ? 'ios-install' : 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'on' : 'off';
  };
  const b64ToBytes = (b64) => { const p = '='.repeat((4 - (b64.length % 4)) % 4); const s = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
  FA.pushEnable = async function () {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('permission');
    const { publicKey } = await FA.api('GET', '/api/push/key');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    await FA.api('POST', '/api/push/subscribe', sub.toJSON());
    return true;
  };
  FA.pushDisable = async function () {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await FA.api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  };
  FA.installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); FA.installPrompt = e; document.dispatchEvent(new Event('fa-installable')); });

  // Resize photos in the browser before upload (faster on mobile data, smaller storage).
  FA.shrinkImage = function (file, maxSide = 2400, quality = 0.85) {
    return new Promise((resolve) => {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { resolve(file); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        if (scale === 1 && file.size < 1.5 * 1024 * 1024) { URL.revokeObjectURL(url); resolve(file); return; }
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((blob) => {
          URL.revokeObjectURL(url);
          resolve(blob ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file);
        }, 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  };

  window.FA = FA;
})();
