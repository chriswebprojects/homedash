'use strict';
/* HomeDash frontend core: state, api, theming, login, dashboard widgets. Admin panel -> admin.js, terminal -> terminal.js */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let LANG = 'en';
const t = k => (I18N[LANG] && I18N[LANG][k]) || I18N.en[k] || k;
const errMsg = e => { const k = 'e_' + (e && e.message); return (I18N[LANG] && I18N[LANG][k]) || I18N.en[k] || (e && e.message) || t('error'); };

const S = { pub: null, me: null, cfg: null, sys: null, dock: null, comp: null, ha: null, hist: { cpu: [], rx: [], tx: [] }, srvOff: 0,
  edit: false, filter: 'all', q: '', timers: [], route: 'home', _j: {} };

async function api(path, o = {}) {
  const init = { method: o.method || 'GET', headers: { 'X-Requested-With': 'homedash' }, credentials: 'same-origin' };
  if (o.body !== undefined) { init.body = JSON.stringify(o.body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(path, init);
  let data = null; try { data = await r.json(); } catch { /* not json */ }
  if (!r.ok) {
    if (r.status === 401 && S.me && !path.startsWith('/api/login')) { S.me = null; stopTimers(); renderLogin(); }
    const e = new Error((data && data.error) || r.statusText); e.status = r.status; throw e;
  }
  return data;
}
function toast(msg, type = '') {
  const el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), type === 'err' ? 6000 : 3000);
}

/* ---------- formatting */
const fmtB = n => { if (!isFinite(n)) return '–'; const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return n.toFixed(i < 2 ? 0 : 1) + ' ' + u[i]; };
const fmtUp = s => { s = Math.floor(s); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + (h || d ? h + 'h ' : '') + m + 'm'; };
const lvl = p => p >= 90 ? 'bad' : p >= 75 ? 'warn' : '';
const secHead = (title, extra = '') => `<div class="sec-h"><h2>${esc(title)}</h2><div class="line"></div>${extra}</div>`;
const bar = (p) => `<div class="bar ${lvl(p)}"><i style="width:${Math.max(0, Math.min(100, p)).toFixed(1)}%"></i></div>`;
const rand = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, '0')).join(''); };

/* ---------- theming */
function applyLook(src) {
  const root = document.documentElement;
  let theme = (S.me && S.me.theme) || src.theme || 'auto';
  if (theme === 'auto') theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  root.dataset.theme = theme;
  root.style.setProperty('--accent', src.accent || '#6366f1');
  root.style.setProperty('--radius', (src.radius ?? 14) + 'px');
  root.style.setProperty('--cols', src.columns || 4);
  document.body.classList.remove('cs-glass', 'cs-solid', 'cs-flat'); document.body.classList.add('cs-' + (src.card_style || 'glass'));
  const bg = $('#bg');
  if (src.background && /^(https?:\/\/|\/)[^"'()\s]+$/.test(src.background)) { bg.style.backgroundImage = `url("${src.background}")`; bg.classList.add('img'); }
  else { bg.style.backgroundImage = ''; bg.classList.remove('img'); }
  let st = $('#custom-css'); if (!st) { st = document.createElement('style'); st.id = 'custom-css'; document.head.appendChild(st); }
  st.textContent = src.custom_css || '';
  document.title = src.title || 'HomeDash';
}
function pickLang(def) {
  const saved = localStorage.getItem('hd_lang'); if (saved && I18N[saved]) return saved;
  if (def && I18N[def] && def !== 'en') return def;
  const nav = (navigator.language || 'en').slice(0, 2); return I18N[nav] ? nav : (def && I18N[def] ? def : 'en');
}
const langOptions = cur => Object.keys(LANG_NAMES).map(k => `<option value="${k}" ${k === cur ? 'selected' : ''}>${LANG_NAMES[k]}</option>`).join('');

/* ---------- boot / auth */
async function boot() {
  S.pub = await api('/api/public');
  LANG = pickLang(S.pub.language); applyLook(S.pub);
  if (S.pub.needs_setup) return renderAuth(true);
  try { S.me = await api('/api/me'); } catch { S.me = null; }
  if (!S.me) return renderAuth(false);
  await loadCfg();
  LANG = S.me.language || localStorage.getItem('hd_lang') || S.cfg.language;
  applyLook(S.cfg); route();
}
async function loadCfg() { S.cfg = await api('/api/config'); }

function renderAuth(setup) {
  stopTimers();
  $('#app').innerHTML = `<div class="auth"><form class="card" id="af"><div class="logo">⌂</div>
    <h1>${esc(setup ? t('setup_title') : S.pub.title)}</h1><div class="muted small" style="margin-bottom:18px">${esc(setup ? t('setup_desc') : '')}</div>
    <label class="f"><span>${t('username')}</span><input type="text" name="username" autocomplete="username" autofocus required></label>
    <label class="f"><span>${t('password')}${setup ? ' · ' + esc(t('password_hint')) : ''}</span><input type="password" name="password" autocomplete="${setup ? 'new-password' : 'current-password'}" minlength="${setup ? 8 : 1}" required></label>
    <div class="err" id="ae"></div>
    <button class="btn primary" style="width:100%;justify-content:center">${esc(setup ? t('create_admin') : t('sign_in'))}</button>
    <div class="row" style="margin-top:16px;justify-content:center"><select id="l0" style="width:auto">${langOptions(LANG)}</select></div></form></div>`;
  $('#l0').onchange = e => { localStorage.setItem('hd_lang', e.target.value); LANG = e.target.value; renderAuth(setup); };
  $('#af').onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    try {
      if (setup) await api('/api/setup', { method: 'POST', body: { ...f, language: LANG } });
      await api('/api/login', { method: 'POST', body: f });
      await boot();
    } catch (err) { $('#ae').textContent = errMsg(err); }
  };
}

/* ---------- shell / routing */
function stopTimers() { S.timers.forEach(clearInterval); S.timers = []; }
function route() {
  const [r, sub] = location.hash.replace(/^#\/?/, '').split('/');
  const admin = S.me.role === 'admin';
  S.route = r === 'admin' && admin ? 'admin' : r === 'terminal' && admin ? 'terminal' : 'home';
  stopTimers(); if (typeof closeTerm === 'function') closeTerm();
  renderShell();
  if (S.route === 'terminal') viewTerminal();
  else if (S.route === 'admin') viewAdmin(sub || 'general');
  else viewHome();
}
window.addEventListener('hashchange', () => S.me && route());

function renderShell() {
  const admin = S.me.role === 'admin', home = S.route === 'home';
  const tab = (h, label, on) => `<a href="${h}" class="${on ? 'on' : ''}">${esc(label)}</a>`;
  $('#app').innerHTML = `<header class="top">
    <a class="brand" href="#/"><div class="logo">⌂</div><div>${esc(S.cfg.title)}${S.cfg.subtitle ? `<div class="small muted" style="font-weight:400;line-height:1.1">${esc(S.cfg.subtitle)}</div>` : ''}</div></a>
    <nav class="tabs">${tab('#/', t('dashboard'), home)}${admin && S.cfg.terminal.enabled ? tab('#/terminal', t('terminal'), S.route === 'terminal') : ''}${admin ? tab('#/admin', t('admin'), S.route === 'admin') : ''}</nav>
    <div class="spacer"></div>
    ${home ? `<input class="search" id="q" type="text" placeholder="${esc(t('search'))}" value="${esc(S.q)}">` : ''}
    ${home && admin ? `<button class="btn ${S.edit ? 'primary' : ''}" data-act="edit-toggle">${S.edit ? '✓ ' + esc(t('done')) : '✎ ' + esc(t('edit'))}</button>` : ''}
    <select id="langsel" title="${esc(t('language'))}">${langOptions(LANG)}</select>
    <button class="btn" data-act="profile">👤<span class="uname"> ${esc(S.me.username)}</span></button>
    <button class="btn" data-act="logout" title="${esc(t('logout'))}">⎋</button></header><main id="view"></main>`;
  $('#langsel').onchange = async e => { localStorage.setItem('hd_lang', e.target.value); await api('/api/me', { method: 'PUT', body: { language: e.target.value } }); S.me.language = e.target.value; LANG = e.target.value; route(); };
  const q = $('#q'); if (q) q.oninput = () => { S.q = q.value.trim().toLowerCase(); applySearch(); };
}

/* ---------- icons */
function icon(ic, url, name) {
  ic = (ic || '').trim();
  const letter = esc((name || '?').trim().charAt(0).toUpperCase());
  const img = src => `<img class="ic" loading="lazy" src="${esc(src)}" alt="" data-l="${letter}">`;
  let inner = '';
  if (/^https?:\/\//i.test(ic)) inner = img('/api/icon?src=' + encodeURIComponent(ic));
  else if (ic.startsWith('/')) inner = img(ic);
  else if (/^di:/i.test(ic)) inner = img('/api/icon?di=' + encodeURIComponent(ic.slice(3).trim().toLowerCase()));
  else if (ic && !/^[\w.:-]+$/.test(ic)) inner = esc(ic);
  else if (/^https?:\/\//i.test(url || '')) inner = img('/api/icon?fav=' + encodeURIComponent(url));
  return `<div class="ico">${inner || letter}</div>`;
}
document.addEventListener('error', e => {
  const el = e.target; if (el && el.tagName === 'IMG' && el.classList.contains('ic') && el.parentNode) el.parentNode.textContent = el.dataset.l || '?';
}, true);

/* ---------- home view */
function viewHome() {
  const view = $('#view'); view.classList.toggle('editing', S.edit);
  view.innerHTML = S.cfg.widgets.filter(w => w.on).map(w => `<section id="w-${w.id}"></section>`).join('');
  renderClock(); renderSystem(); renderLinks(); renderDocker(); renderCompose(); renderHA(); startPolling();
}
function every(fn, ms) { fn(); S.timers.push(setInterval(() => { if (!document.hidden) fn(); }, ms)); }
function startPolling() {
  const has = id => !!$('#w-' + id);
  if (has('clock')) S.timers.push(setInterval(renderClockTime, 1000));
  if (has('system') || has('clock')) every(loadSys, 3000);
  if (has('docker')) every(loadDocker, 8000);
  if (has('compose')) every(loadCompose, 10000);
  if (has('ha')) every(loadHA, 10000);
}
const quiet = fn => async () => { try { await fn(); } catch { /* keep last data */ } };
const loadSys = quiet(async () => {
  const s = S.sys = await api('/api/system'); S.srvOff = s.time.epoch * 1000 - Date.now();
  const push = (a, v) => { a.push(v); if (a.length > 60) a.shift(); };
  push(S.hist.cpu, s.cpu.usage); push(S.hist.rx, s.net.rx); push(S.hist.tx, s.net.tx);
  renderSystem(); renderClockTime();
});
const changed = (k, d) => { const j = JSON.stringify(d); if (S._j[k] === j) return false; S._j[k] = j; return true; };
const loadDocker = quiet(async () => { const d = await api('/api/docker/containers'); if (changed('docker', d)) { S.dock = d; renderDocker(); } });
const loadCompose = quiet(async () => { const d = await api('/api/compose/projects'); if (changed('comp', d)) { S.comp = d; renderCompose(); } });
const loadHA = quiet(async () => { const d = await api('/api/ha/states'); if (changed('ha', d)) { S.ha = d; renderHA(); } });

function applySearch() {
  $$('[data-s]').forEach(e => e.classList.toggle('hidden', !!S.q && !e.dataset.s.includes(S.q)));
  $$('.cat').forEach(c => c.classList.toggle('hidden', !!S.q && !S.edit && !$$('[data-s]', c).some(x => !x.classList.contains('hidden'))));
}

/* ---------- clock */
function fmtDT(d, tz, o) { try { return new Intl.DateTimeFormat(LANG, { ...o, ...(tz ? { timeZone: tz } : {}) }).format(d); } catch { return new Intl.DateTimeFormat(LANG, o).format(d); } }
function renderClock() {
  const el = $('#w-clock'); if (!el) return;
  const zones = (S.cfg.clock_zones || []).map((z, i) => `<div class="card clock-z"><div class="time" id="ckz${i}"></div><div class="z">${esc(z.split('/').pop().replace(/_/g, ' '))}</div></div>`).join('');
  el.innerHTML = secHead(t('w_clock')) + `<div class="clocks"><div class="card clock-main"><div class="time" id="ck-t"></div><div class="date" id="ck-d"></div></div>${zones}<div class="clock-srv" id="ck-s"></div></div>`;
  renderClockTime();
}
function renderClockTime() {
  if (!$('#ck-t')) return;
  const now = new Date(), tz = S.cfg.timezone, h12 = !S.cfg.time24;
  const tm = { hour: '2-digit', minute: '2-digit', hour12: h12 };
  $('#ck-t').textContent = fmtDT(now, tz, { ...tm, second: '2-digit' });
  $('#ck-d').textContent = fmtDT(now, tz, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  (S.cfg.clock_zones || []).forEach((z, i) => { const e = $('#ckz' + i); if (e) e.textContent = fmtDT(now, z, tm); });
  const s = $('#ck-s');
  if (s && S.sys) {
    const srv = new Date(Date.now() + S.srvOff);
    s.innerHTML = `<div>${esc(t('server_time'))}: <b>${esc(fmtDT(srv, S.sys.time.tz, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: h12 }))}</b> <span class="small">(${esc(S.sys.time.tz)})</span></div><div>${esc(t('uptime'))}: <b>${fmtUp(S.sys.uptime + (Date.now() - (srv - S.srvOff)) / 1000)}</b></div>`;
  }
}

/* ---------- system */
const ring = p => `<div class="ring ${lvl(p)}"><svg width="96" height="96" viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="40"/><circle class="fg" cx="50" cy="50" r="40" stroke-dasharray="251.3" stroke-dashoffset="${(251.3 * (1 - Math.min(100, p) / 100)).toFixed(1)}"/></svg><div class="v">${Math.round(p)}%</div></div>`;
function spark(a, max) {
  if (a.length < 2) return '<svg class="spark"></svg>';
  const m = max || Math.max(1, ...a);
  const line = a.map((v, i) => `${(i / (a.length - 1) * 120).toFixed(1)},${(34 - v / m * 32).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 120 36" preserveAspectRatio="none"><path d="M0,36 L${line.split(' ').join(' L')} L120,36Z"/><polyline points="${line}"/></svg>`;
}
function renderSystem() {
  const el = $('#w-system'); if (!el) return;
  const s = S.sys, head = secHead(t('w_system'));
  if (!s) { el.innerHTML = head + `<div class="card empty">${esc(t('loading'))}</div>`; return; }
  const m = s.memory, mp = m.total ? m.used / m.total * 100 : 0, sp = m.swap_total ? m.swap_used / m.swap_total * 100 : 0;
  const temps = [...s.temps.map(x => ({ n: (x.group && !x.label.startsWith(x.group) ? x.group + ' ' : '') + x.label, v: x.value, crit: x.crit })),
    ...s.gpus.map(g => ({ n: g.name, v: g.temp, crit: null }))].slice(0, 20);
  const tcls = x => x.v >= (x.crit ? x.crit - 5 : 85) ? 'bad' : x.v >= 70 ? 'warn' : '';
  const cards = [
    `<div class="card"><h3>${t('host')}<span class="small">v${esc(s.version)}</span></h3><dl class="kv"><dt>${t('host')}</dt><dd>${esc(s.hostname)}</dd><dt>${t('os')}</dt><dd>${esc(s.os)}</dd><dt>${t('kernel')}</dt><dd>${esc(s.kernel)} (${esc(s.arch)})</dd><dt>${t('uptime')}</dt><dd>${fmtUp(s.uptime)}</dd><dt>${t('cpu')}</dt><dd>${esc(s.cpu.model)}</dd>${s.gpus.map(g => `<dt>${t('gpu')}</dt><dd>${esc(g.name)} · ${Math.round(g.util)}% · ${fmtB(g.mem_used)}/${fmtB(g.mem_total)}</dd>`).join('')}</dl></div>`,
    `<div class="card"><h3>${t('cpu')}<span class="small">${s.cpu.cores} ${t('cores')}</span></h3><div class="cpu-wrap">${ring(s.cpu.usage)}<div class="grow"><div class="small muted">${t('load')}</div><div><b>${s.cpu.load.map(x => x.toFixed(2)).join(' · ')}</b></div>${spark(S.hist.cpu, 100)}</div></div><div class="cores">${s.cpu.per_core.map(v => `<i style="height:${Math.max(4, v)}%" title="${v}%"></i>`).join('')}</div></div>`,
    `<div class="card"><h3>${t('memory')}<span class="small">${mp.toFixed(0)}%</span></h3><div class="metric"><div class="top"><span>${fmtB(m.used)} ${t('used')}</span><span class="muted">${fmtB(m.total)}</span></div>${bar(mp)}</div>${m.swap_total ? `<div class="metric"><div class="top"><span>${t('swap')} ${fmtB(m.swap_used)}</span><span class="muted">${fmtB(m.swap_total)}</span></div>${bar(sp)}</div>` : ''}</div>`,
    `<div class="card"><h3>${t('disks')}</h3>${s.disks.map(d => { const p = d.total ? d.used / d.total * 100 : 0; return `<div class="metric"><div class="top"><span title="${esc(d.path)}">${esc(d.label)}</span><span class="muted">${fmtB(d.used)} / ${fmtB(d.total)} · ${p.toFixed(0)}%</span></div>${bar(p)}</div>`; }).join('') || `<div class="muted">–</div>`}</div>`,
    `<div class="card"><h3>${t('network')}</h3><div class="net"><div><div class="l">↓</div><b>${fmtB(s.net.rx)}/s</b>${spark(S.hist.rx)}</div><div><div class="l">↑</div><b>${fmtB(s.net.tx)}/s</b>${spark(S.hist.tx)}</div></div></div>`,
    `<div class="card"><h3>${t('temps')}</h3>${temps.length ? `<div class="chips">${temps.map(x => `<span class="chip ${tcls(x)}">${esc(x.n)} <b>${x.v.toFixed(0)}°C</b></span>`).join('')}</div>` : `<div class="muted">${t('no_temps')}</div>`}</div>`,
  ];
  el.innerHTML = head + `<div class="sys">${cards.join('')}</div>`;
}

/* ---------- links */
function tile(l, ci, li) {
  const attrs = `class="tile card" data-s="${esc((l.name + ' ' + l.desc + ' ' + l.url).toLowerCase())}"`;
  const inner = `${icon(l.icon, l.url, l.name)}<div class="t"><div class="n">${esc(l.name)}</div>${l.desc ? `<div class="d">${esc(l.desc)}</div>` : ''}</div>`;
  if (S.edit) return `<div ${attrs} draggable="true" data-act="edit-link" data-ci="${ci}" data-li="${li}">${inner}<span class="pen">✎</span></div>`;
  return `<a ${attrs} href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
}
function renderLinks() {
  const el = $('#w-links'); if (!el) return;
  let html = secHead(t('w_links'), S.edit ? `<button class="btn sm" data-act="add-cat">+ ${esc(t('add_category'))}</button>` : '');
  S.cfg.categories.forEach((c, ci) => {
    html += `<div class="cat"><div class="cat-h">${esc(c.name) || '&nbsp;'}${S.edit ? ` <button class="btn sm icon" data-act="rename-cat" data-ci="${ci}" title="${esc(t('rename'))}">✎</button><button class="btn sm icon danger" data-act="del-cat" data-ci="${ci}" title="${esc(t('delete'))}">🗑</button>` : ''}</div><div class="tiles" data-ci="${ci}">`;
    c.links.forEach((l, li) => { html += tile(l, ci, li); });
    if (S.edit) html += `<div class="tile card add" data-act="add-link" data-ci="${ci}">+ ${esc(t('add_link'))}</div>`;
    html += '</div></div>';
  });
  el.innerHTML = html; applySearch();
}
async function saveCfg() { await api('/api/config', { method: 'PUT', body: S.cfg }); await loadCfg(); }

function modal(title, body, o = {}) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<form class="modal ${o.wide ? 'wide' : ''}" autocomplete="off"><h2>${esc(title)}</h2>${body}<div class="foot">${o.extra || ''}<button type="button" class="btn" data-close>${esc(o.onSubmit ? t('cancel') : t('close'))}</button>${o.onSubmit ? `<button class="btn primary" type="submit">${esc(o.submit || t('save'))}</button>` : ''}</div></form>`;
  document.body.appendChild(ov);
  const onKey = e => { if (e.key === 'Escape') ov.close(); };
  ov.close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('mousedown', e => { if (e.target === ov) ov.close(); });
  $('[data-close]', ov).onclick = ov.close;
  const form = $('form', ov);
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (!o.onSubmit) return;
    const btn = $('button[type=submit]', form); btn.disabled = true;
    try { await o.onSubmit(Object.fromEntries(new FormData(form)), ov); ov.close(); } catch (err) { toast(errMsg(err), 'err'); btn.disabled = false; }
  });
  const first = $('input:not([type=hidden]), textarea', form); if (first && o.focus !== false) first.focus();
  return ov;
}

function linkDialog(ci, li) {
  const isNew = li == null;
  const l = isNew ? { name: '', url: 'https://', icon: '', desc: '' } : S.cfg.categories[ci].links[li];
  const cats = S.cfg.categories.map((c, i) => `<option value="${i}" ${i === ci ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const ov = modal(isNew ? t('add_link') : t('edit_link'), `
    <label class="f"><span>${t('name')}</span><input type="text" name="name" value="${esc(l.name)}" required></label>
    <label class="f"><span>${t('url')}</span><input type="url" name="url" value="${esc(l.url)}" required></label>
    <label class="f"><span>${t('icon')}</span><input type="text" name="icon" value="${esc(l.icon)}"><small class="muted">${esc(t('icon_hint'))}</small></label>
    <label class="f"><span>${t('description')}</span><input type="text" name="desc" value="${esc(l.desc)}"></label>
    <label class="f"><span>${t('category')}</span><select name="cat">${cats}</select></label>`, {
    extra: isNew ? '' : `<button type="button" class="btn danger" data-del>${esc(t('delete'))}</button>`,
    onSubmit: async f => {
      const nl = { name: f.name, url: f.url, icon: f.icon, desc: f.desc }, tc = +f.cat;
      if (!isNew) S.cfg.categories[ci].links.splice(li, 1);
      if (!isNew && tc === ci) S.cfg.categories[tc].links.splice(li, 0, nl); else S.cfg.categories[tc].links.push(nl);
      await saveCfg(); renderLinks();
    } });
  const d = $('[data-del]', ov);
  if (d) d.onclick = async () => { if (!confirm(t('confirm'))) return; S.cfg.categories[ci].links.splice(li, 1); await saveCfg(); renderLinks(); ov.close(); };
}

/* drag & drop re-ordering of links in edit mode */
let drag = null;
document.addEventListener('dragstart', e => { const el = e.target.closest && e.target.closest('.tile[draggable=true]'); if (!el) return; drag = { ci: +el.dataset.ci, li: +el.dataset.li }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'link'); });
document.addEventListener('dragover', e => { if (drag && e.target.closest && e.target.closest('.tiles')) e.preventDefault(); });
document.addEventListener('dragend', () => { drag = null; });
document.addEventListener('drop', async e => {
  if (!drag) return; const grid = e.target.closest && e.target.closest('.tiles'); if (!grid) return; e.preventDefault();
  const tl = e.target.closest('.tile[draggable=true]'), tci = +grid.dataset.ci, links = S.cfg.categories[tci].links;
  let tli = tl ? +tl.dataset.li : links.length; const [item] = S.cfg.categories[drag.ci].links.splice(drag.li, 1);
  if (tci === drag.ci && drag.li < tli) tli--; links.splice(tli, 0, item); drag = null;
  renderLinks(); try { await saveCfg(); } catch (err) { toast(errMsg(err), 'err'); }
});

/* ---------- docker */
const guessIcon = c => c.icon || 'di:' + c.image.split('@')[0].split(':')[0].split('/').pop().toLowerCase();
function appUrl(c) {
  if (c.url) return c.url;
  if (!S.cfg.docker.autolinks || c.state !== 'running') return '';
  const tcp = c.ports.filter(p => p.type === 'tcp'); if (!tcp.length) return '';
  const pref = [80, 8080, 3000, 8000, 8096, 443, 8443, 9000, 5000];
  const p = tcp.find(p => pref.includes(p.private)) || tcp[0];
  return `${[443, 8443, 9443].includes(p.private) ? 'https' : 'http'}://${location.hostname}:${p.public}`;
}
function dcard(c) {
  const url = appUrl(c), admin = S.me.role === 'admin', run = c.state === 'running';
  const dot = run ? 'ok' : ['paused', 'restarting'].includes(c.state) ? 'warn' : c.state === 'dead' ? 'bad' : '';
  const ports = c.ports.map(p => `<a class="port" target="_blank" rel="noopener" href="${esc(location.protocol + '//' + location.hostname + ':' + p.public)}">${p.public}</a>`).join('');
  const b = (a, label, cls = '') => `<button class="btn sm ${cls}" data-act="d-act" data-id="${esc(c.id)}" data-a="${a}">${esc(t(label))}</button>`;
  return `<div class="card dc" data-s="${esc((c.name + ' ' + c.image + ' ' + c.project).toLowerCase())}">
    <div class="head">${icon(guessIcon(c), url, c.name)}<div class="grow"><div class="nm">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}</div><div class="im" title="${esc(c.image)}">${esc(c.image)}</div></div></div>
    <div class="st"><span class="dot ${dot}"></span>${esc(c.status)}${c.project ? ` · <span title="compose project">${esc(c.project)}</span>` : ''}</div>
    ${ports ? `<div class="chips" style="gap:6px">${ports}</div>` : ''}
    <div class="acts">${url ? `<a class="btn sm primary" href="${esc(url)}" target="_blank" rel="noopener">${esc(t('open'))} ↗</a>` : ''}${admin ? (run ? b('restart', 'restart') + b('stop', 'stop', 'danger') : b('start', 'start')) : ''}${admin ? `<button class="btn sm" data-act="d-logs" data-id="${esc(c.id)}" data-n="${esc(c.name)}">${esc(t('logs'))}</button>` : ''}</div></div>`;
}
function renderDocker() {
  const el = $('#w-docker'); if (!el) return;
  const d = S.dock, head = secHead(t('w_docker'));
  if (!d) { el.innerHTML = head + `<div class="card empty">${esc(t('loading'))}</div>`; return; }
  if (!d.available) { el.innerHTML = head + `<div class="card empty">${esc(t('no_docker'))}<div class="small mono" style="margin-top:6px">${esc(d.error)}</div></div>`; return; }
  const list = d.containers, nRun = list.filter(c => c.state === 'running').length;
  const shown = list.filter(c => S.filter === 'all' || (S.filter === 'running') === (c.state === 'running'));
  const cnt = { all: list.length, running: nRun, stopped: list.length - nRun };
  el.innerHTML = head + `<div class="toolbar"><div class="seg">${['all', 'running', 'stopped'].map(f => `<button data-act="dfilter" data-f="${f}" class="${S.filter === f ? 'on' : ''}">${esc(t(f))} ${cnt[f]}</button>`).join('')}</div></div>
    <div class="dock">${shown.map(dcard).join('') || `<div class="card empty">${esc(t('no_containers'))}</div>`}</div>`;
  applySearch();
}

/* ---------- compose */
function renderCompose() {
  const el = $('#w-compose'); if (!el) return;
  const admin = S.me.role === 'admin', c = S.comp;
  const head = secHead(t('w_compose'), admin ? `<button class="btn sm" data-act="cfiles">📄 ${esc(t('files'))}</button>` : '');
  if (!c) { el.innerHTML = head + `<div class="card empty">${esc(t('loading'))}</div>`; return; }
  if (!c.available) { el.innerHTML = head + `<div class="card empty">${esc(t('no_docker'))}</div>`; return; }
  const btn = (p, a, label, cls = '') => `<button class="btn sm ${cls}" data-act="c-act" data-p="${esc(p.name)}" data-a="${a}">${esc(t(label))}</button>`;
  const cards = c.projects.map(p => {
    const pc = p.total ? p.running / p.total * 100 : 0;
    const acts = !admin ? '' : [
      p.total ? btn(p, 'restart', 'restart') + (p.running ? btn(p, 'stop', 'stop') : btn(p, 'start', 'start')) : '',
      p.can_cli ? btn(p, 'up', 'up') + btn(p, 'pull', 'pull') + (p.total ? btn(p, 'down', 'down', 'danger') : '') : '',
      p.file ? `<button class="btn sm" data-act="cedit" data-p="${esc(p.file)}">✎ ${esc(t('edit_file'))}</button>` : '',
    ].join('');
    return `<div class="card proj" data-s="${esc(p.name.toLowerCase())}"><div class="head"><div class="nm">${esc(p.name)}</div><span class="small muted">${p.running}/${p.total} · ${p.total} ${esc(t('services'))}</span></div>${bar(pc)}
      <div class="svc">${p.services.map(s => `<span><i class="dot ${s.state === 'running' ? 'ok' : ''}"></i>${esc(s.service || s.container)}</span>`).join('')}</div><div class="acts" style="display:flex;gap:6px;flex-wrap:wrap">${acts}</div></div>`;
  }).join('');
  el.innerHTML = head + `<div class="dock">${cards || `<div class="card empty">${esc(t('no_compose'))}</div>`}</div>`; applySearch();
}
async function composeEditor(path) {
  const r = path ? await api('/api/compose/file?path=' + encodeURIComponent(path)) : { content: 'services:\n  app:\n    image: nginx:alpine\n    ports:\n      - "8081:80"\n' };
  modal(t('edit_file'), `<label class="f"><span>${t('file_path')}</span><input type="text" name="path" value="${esc(path || 'my-stack/compose.yaml')}" ${path ? 'readonly' : ''} required></label><label class="f"><span>YAML</span><textarea name="content" rows="20" spellcheck="false" style="width:100%">${esc(r.content)}</textarea></label>`, {
    wide: true, onSubmit: async f => { await api('/api/compose/file', { method: 'PUT', body: f }); toast(t('saved'), 'ok'); loadCompose(); } });
}

/* ---------- home assistant */
const HA_ICON = { light: '💡', switch: '🔌', input_boolean: '🔘', fan: '🌀', scene: '🎬', script: '📜', automation: '⚙️', button: '🔲', input_button: '🔲', cover: '🪟', media_player: '🎵', sensor: '📟', binary_sensor: '🔔', climate: '🌡️', lock: '🔒', person: '🧑', weather: '⛅', sun: '☀️', device_tracker: '📍', input_number: '🔢' };
const HA_ACT = { light: 'toggle', switch: 'toggle', input_boolean: 'toggle', fan: 'toggle', automation: 'toggle', cover: 'toggle', scene: 'turn_on', script: 'turn_on', button: 'press', input_button: 'press', media_player: 'media_play_pause' };
function renderHA() {
  const el = $('#w-ha'); if (!el) return;
  const h = S.ha, head = secHead(t('w_ha')), admin = S.me.role === 'admin';
  if (!h) { el.innerHTML = head + `<div class="card empty">${esc(t('loading'))}</div>`; return; }
  if (!h.configured) { el.innerHTML = head + `<div class="card empty">${esc(t('ha_not_configured'))}${admin ? ` <a href="#/admin/integrations" style="color:var(--accent)">${esc(t('ha_setup'))}</a>` : ''}</div>`; return; }
  if (h.error) { el.innerHTML = head + `<div class="card empty">⚠ ${esc(h.error)}</div>`; return; }
  if (!h.entities.length) { el.innerHTML = head + `<div class="card empty">${esc(t('ha_empty'))}</div>`; return; }
  el.innerHTML = head + `<div class="ha">${h.entities.map(e => {
    const dom = e.id.split('.')[0], act = HA_ACT[dom], on = ['on', 'open', 'playing', 'home', 'unlocked', 'heat', 'cool'].includes(e.state);
    const st = e.state === 'unavailable' ? t('unavailable') : e.state + (e.unit ? ' ' + e.unit : '');
    return `<div class="card hat ${act ? 'act' : ''} ${on ? 'on' : ''}" ${act ? `data-act="ha" data-id="${esc(e.id)}"` : ''} data-s="${esc((e.name + ' ' + e.id).toLowerCase())}"><div class="e">${HA_ICON[dom] || '◻️'}</div><div class="s">${esc(st)}</div><div class="n" title="${esc(e.id)}">${esc(e.name)}</div></div>`;
  }).join('')}</div>`;
  applySearch();
}

/* ---------- profile */
function profileDialog() {
  const themeOpts = ['', 'auto', 'dark', 'light', 'midnight', 'nord', 'dracula', 'forest'].map(x => `<option value="${x}" ${S.me.theme === x ? 'selected' : ''}>${x ? (x === 'auto' ? t('auto') : x[0].toUpperCase() + x.slice(1)) : t('language_auto')}</option>`).join('');
  modal(t('profile') + ' – ' + S.me.username, `
    <div class="grid2"><label class="f"><span>${t('language')}</span><select name="language"><option value="">${t('language_auto')}</option>${langOptions(S.me.language)}</select></label>
    <label class="f"><span>${t('theme')}</span><select name="theme">${themeOpts}</select></label></div>
    <hr style="border:0;border-top:1px solid var(--card-b);margin:6px 0 14px">
    <label class="f"><span>${t('current_password')}</span><input type="password" name="current_password" autocomplete="current-password"></label>
    <label class="f"><span>${t('new_password')} · ${esc(t('password_hint'))}</span><input type="password" name="password" autocomplete="new-password"></label>`, {
    onSubmit: async f => {
      const body = { language: f.language, theme: f.theme }; if (f.password) { body.password = f.password; body.current_password = f.current_password; }
      await api('/api/me', { method: 'PUT', body });
      S.me = await api('/api/me'); LANG = S.me.language || S.cfg.language; localStorage.setItem('hd_lang', LANG); applyLook(S.cfg); route();
    } });
}

/* ---------- actions (event delegation) */
const ACTIONS = {
  'edit-toggle'() { S.edit = !S.edit; route(); },
  async 'add-cat'() { const n = prompt(t('category_name')); if (!n) return; S.cfg.categories.push({ name: n, links: [] }); await saveCfg(); renderLinks(); },
  async 'rename-cat'(el) { const c = S.cfg.categories[+el.dataset.ci], n = prompt(t('category_name'), c.name); if (n == null) return; c.name = n; await saveCfg(); renderLinks(); },
  async 'del-cat'(el) { if (!confirm(t('confirm'))) return; S.cfg.categories.splice(+el.dataset.ci, 1); await saveCfg(); renderLinks(); },
  'add-link'(el) { linkDialog(+el.dataset.ci, null); },
  'edit-link'(el) { linkDialog(+el.dataset.ci, +el.dataset.li); },
  dfilter(el) { S.filter = el.dataset.f; renderDocker(); },
  async 'd-act'(el) { el.disabled = true; try { await api('/api/docker/action', { method: 'POST', body: { id: el.dataset.id, action: el.dataset.a } }); } finally { await loadDocker(); await loadCompose(); } },
  async 'd-logs'(el) {
    const ov = modal(el.dataset.n + ' – ' + t('logs'), `<pre class="logs" id="lg">${esc(t('loading'))}</pre>`, { wide: true, focus: false });
    try { const r = await api('/api/docker/logs?tail=300&id=' + encodeURIComponent(el.dataset.id)); const p = $('#lg', ov); p.textContent = r.logs || '–'; p.scrollTop = p.scrollHeight; } catch (e) { $('#lg', ov).textContent = errMsg(e); }
  },
  async 'c-act'(el) {
    const a = el.dataset.a; if ((a === 'down' || a === 'stop') && !confirm(t('confirm'))) return;
    el.disabled = true; toast('…');
    try {
      const r = await api('/api/compose/action', { method: 'POST', body: { project: el.dataset.p, action: a } });
      if (r.output) modal(el.dataset.p + ' – ' + a, `<pre class="logs">${esc(r.output)}</pre>`, { wide: true, focus: false }); else toast('✓ ' + a, 'ok');
    } finally { await loadCompose(); await loadDocker(); }
  },
  async cfiles() {
    const r = await api('/api/compose/files');
    const ov = modal(t('files'), `<div class="muted small" style="margin-bottom:10px">${esc(t('compose_dir'))}: <span class="mono">${esc(r.dir)}</span></div>${r.files.map(f => `<div class="row sb" style="padding:6px 0;border-bottom:1px solid var(--card-b)"><span class="mono small">${esc(f)}</span><button type="button" class="btn sm" data-act="cedit" data-p="${esc(f)}">✎</button></div>`).join('') || `<div class="muted">${esc(t('no_compose'))}</div>`}<div style="margin-top:12px"><button type="button" class="btn sm" data-act="cnew">+ ${esc(t('new_file'))}</button></div>`, { focus: false });
    ov.addEventListener('click', e => { if (e.target.closest('[data-act=cedit],[data-act=cnew]')) ov.close(); });
  },
  cedit(el) { return composeEditor(el.dataset.p); },
  cnew() { return composeEditor(null); },
  async ha(el) {
    const id = el.dataset.id, dom = id.split('.')[0];
    await api('/api/ha/service', { method: 'POST', body: { domain: dom, service: HA_ACT[dom], entity_id: id } });
    setTimeout(loadHA, 600);
  },
  profile: profileDialog,
  async logout() { await api('/api/logout', { method: 'POST', body: {} }); S.me = null; stopTimers(); location.hash = ''; boot(); },
};
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = ACTIONS[el.dataset.act]; if (!fn) return;
  if (el.tagName !== 'A') e.preventDefault();
  try { await fn(el, e); } catch (err) { toast(errMsg(err), 'err'); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me && S.route === 'home') { loadSys(); loadDocker(); } });
document.addEventListener('DOMContentLoaded', () => boot().catch(err => { $('#app').innerHTML = `<div class="auth"><div class="card">⚠ ${esc(err.message)}</div></div>`; }));
