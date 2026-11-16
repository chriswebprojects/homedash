'use strict';
/* HomeDash admin panel: general, appearance, integrations (Home Assistant, terminal, docker), users, API tokens, backup */
const ADMIN_TABS = ['general', 'appearance', 'integrations', 'users', 'tokens', 'backup'];

function viewAdmin(tab) {
  if (!ADMIN_TABS.includes(tab)) tab = 'general';
  $('#view').innerHTML = `<div class="admin"><div class="side">${ADMIN_TABS.map(x => `<a href="#/admin/${x}" class="${x === tab ? 'on' : ''}">${esc(t(x))}</a>`).join('')}</div><div class="card panel" id="panel"></div></div>`;
  ({ general: pGeneral, appearance: pAppearance, integrations: pIntegrations, users: pUsers, tokens: pTokens, backup: pBackup })[tab]($('#panel'));
}

/* ----- generic form helpers: inputs use name="a.b.c" to address S.cfg */
const field = (label, name, val, type = 'text', extra = '') => `<label class="f"><span>${esc(label)}</span><input type="${type}" name="${name}" value="${esc(val)}" ${extra}></label>`;
const check = (label, name, on) => `<label class="chk"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}> ${esc(label)}</label>`;
function selectF(label, name, val, opts) { return `<label class="f"><span>${esc(label)}</span><select name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`; }
function setPath(o, path, v) { const p = path.split('.'); let c = o; while (p.length > 1) c = c[p.shift()]; c[p[0]] = v; }
function collect(form, extra) {
  const cfg = JSON.parse(JSON.stringify(S.cfg));
  $$('[name]', form).forEach(el => {
    let v = el.type === 'checkbox' ? el.checked : (el.type === 'number' || el.type === 'range') ? Number(el.value) : el.value;
    if (el.dataset.t === 'list') v = v.split(',').map(x => x.trim()).filter(Boolean);
    if (el.dataset.t === 'entities') v = v.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [id, ...n] = l.split('|'); return { id: id.trim(), name: n.join('|').trim() }; });
    setPath(cfg, el.name, v);
  });
  return extra ? extra(cfg) : cfg;
}
async function saveForm(form, extra) {
  await api('/api/config', { method: 'PUT', body: collect(form, extra) });
  await loadCfg(); LANG = S.me.language || localStorage.getItem('hd_lang') || S.cfg.language; applyLook(S.cfg); toast(t('saved'), 'ok');
}
const saveBtn = () => `<div class="row" style="margin-top:8px"><button class="btn primary" type="submit">${esc(t('save_all'))}</button></div>`;
function wireForm(form, extra, live) {
  form.onsubmit = async e => { e.preventDefault(); try { await saveForm(form, extra); route(); } catch (err) { toast(errMsg(err), 'err'); } };
  if (live) form.addEventListener('input', () => applyLook(collect(form, extra)));
}

/* ----- General */
function pGeneral(p) {
  const c = S.cfg;
  p.innerHTML = `<h2>${esc(t('general'))}</h2><form id="f">
    <div class="grid2">${field(t('title'), 'title', c.title, 'text', 'maxlength="60"')}${field(t('subtitle'), 'subtitle', c.subtitle, 'text', 'maxlength="120"')}</div>
    <div class="grid2">${selectF(t('language'), 'language', c.language, Object.entries(LANG_NAMES))}
    <label class="f"><span>${esc(t('timezone'))}</span><input type="text" name="timezone" list="tzs" value="${esc(c.timezone)}" placeholder="Europe/Berlin"><datalist id="tzs">${(Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []).map(z => `<option value="${z}">`).join('')}</datalist></label></div>
    ${check(t('time24'), 'time24', c.time24)}
    <label class="f"><span>${esc(t('clock_zones'))}</span><input type="text" name="clock_zones" data-t="list" value="${esc((c.clock_zones || []).join(', '))}" placeholder="America/New_York, Asia/Tokyo"></label>
    ${saveBtn()}</form>`;
  wireForm($('#f', p));
}

/* ----- Appearance (live preview while editing) */
function pAppearance(p) {
  const c = S.cfg; let ws = JSON.parse(JSON.stringify(c.widgets));
  const themes = ['auto', 'dark', 'light', 'midnight', 'nord', 'dracula', 'forest'].map(x => [x, x === 'auto' ? t('auto') : x[0].toUpperCase() + x.slice(1)]);
  p.innerHTML = `<h2>${esc(t('appearance'))}</h2><form id="f">
    <div class="grid2">${selectF(t('theme'), 'theme', c.theme, themes)}
    <label class="f"><span>${esc(t('accent'))}</span><input type="color" name="accent" value="${esc(c.accent)}"></label></div>
    <div class="grid2"><label class="f"><span>${esc(t('radius'))}: <b id="rv">${c.radius}</b>px</span><input type="range" name="radius" min="0" max="32" value="${c.radius}"></label>
    <label class="f"><span>${esc(t('columns'))}: <b id="cv">${c.columns}</b></span><input type="range" name="columns" min="1" max="8" value="${c.columns}"></label></div>
    ${selectF(t('card_style'), 'card_style', c.card_style, [['glass', t('glass')], ['solid', t('solid')], ['flat', t('flat')]])}
    ${field(t('background'), 'background', c.background, 'text', 'placeholder="https://…/wallpaper.jpg"')}
    <label class="f"><span>${esc(t('widgets_order'))}</span><div class="wl" id="wl"></div></label>
    <label class="f"><span>${esc(t('custom_css'))}</span><textarea name="custom_css" rows="5" spellcheck="false" placeholder=":root { --accent: #ff6b6b; }">${esc(c.custom_css)}</textarea></label>
    ${saveBtn()}</form>`;
  const form = $('#f', p), drawWL = () => {
    $('#wl', p).innerHTML = ws.map((w, i) => `<div class="it"><input type="checkbox" data-i="${i}" ${w.on ? 'checked' : ''} style="accent-color:var(--accent)"><span class="grow">${esc(t('w_' + w.id))}</span><button type="button" class="btn sm icon" data-m="${i}:-1" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="btn sm icon" data-m="${i}:1" ${i === ws.length - 1 ? 'disabled' : ''}>↓</button></div>`).join('');
  };
  drawWL();
  $('#wl', p).onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; const [i, d] = b.dataset.m.split(':').map(Number); [ws[i], ws[i + d]] = [ws[i + d], ws[i]]; drawWL(); };
  $('#wl', p).onchange = e => { ws[+e.target.dataset.i].on = e.target.checked; };
  form.addEventListener('input', () => { $('#rv', p).textContent = form.radius.value; $('#cv', p).textContent = form.columns.value; });
  wireForm(form, cfg => { cfg.widgets = ws; return cfg; }, true);
}

/* ----- Integrations */
function pIntegrations(p) {
  const c = S.cfg, ha = c.ha;
  p.innerHTML = `<h2>${esc(t('integrations'))}</h2><form id="f">
    <h3 style="margin-bottom:12px">🏠 Home Assistant</h3>
    <div class="grid2">${field(t('ha_url'), 'ha.url', ha.url, 'text', 'placeholder="http://homeassistant.local:8123"')}${field(t('ha_token'), 'ha.token', ha.token, 'password', 'autocomplete="off"')}</div>
    ${check(t('verify_tls'), 'ha.verify_tls', ha.verify_tls)}
    <label class="f"><span>${esc(t('entities'))} · ${esc(t('entities_hint'))}</span><textarea name="ha.entities" data-t="entities" rows="6" spellcheck="false" placeholder="light.living_room|Living room&#10;sensor.outdoor_temperature">${esc(ha.entities.map(e => e.id + (e.name ? '|' + e.name : '')).join('\n'))}</textarea></label>
    <div class="row" style="margin-bottom:22px"><button type="button" class="btn" id="ha-test">${esc(t('test'))}</button><button type="button" class="btn" id="ha-pick">${esc(t('load_entities'))}</button></div>
    <h3 style="margin-bottom:12px">⌨ ${esc(t('terminal'))} / 🐳 Docker</h3>
    ${check(t('terminal_enabled'), 'terminal.enabled', c.terminal.enabled)}
    ${check(t('docker_autolinks'), 'docker.autolinks', c.docker.autolinks)}
    ${saveBtn()}</form>`;
  const form = $('#f', p); wireForm(form);
  $('#ha-test', p).onclick = async () => {
    try { const r = await api('/api/ha/test', { method: 'POST', body: { url: form['ha.url'].value, token: form['ha.token'].value, verify_tls: form['ha.verify_tls'].checked } }); toast(t('test_ok') + ': ' + r.message, 'ok'); }
    catch (e) { toast(errMsg(e), 'err'); }
  };
  $('#ha-pick', p).onclick = async () => {
    let list; try { list = (await api('/api/ha/entities')).entities; } catch (e) { return toast(errMsg(e) + ' (' + t('save_all') + '?)', 'err'); }
    const ov = modal(t('load_entities'), `<input type="text" id="hq" placeholder="${esc(t('search'))}" style="margin-bottom:10px"><div id="hl" style="max-height:50vh;overflow:auto"></div>`, {});
    const draw = () => { const q = $('#hq', ov).value.toLowerCase(); $('#hl', ov).innerHTML = list.filter(x => (x.id + x.name).toLowerCase().includes(q)).slice(0, 150).map(x => `<div class="row sb" style="padding:6px 0;border-bottom:1px solid var(--card-b)"><span><span class="mono small">${esc(x.id)}</span><br><span class="muted small">${esc(x.name)}</span></span><button type="button" class="btn sm" data-id="${esc(x.id)}" data-n="${esc(x.name)}">+</button></div>`).join(''); };
    draw(); $('#hq', ov).oninput = draw;
    $('#hl', ov).onclick = e => { const b = e.target.closest('[data-id]'); if (!b) return; const ta = form['ha.entities']; ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + b.dataset.id + '|' + b.dataset.n; b.disabled = true; b.textContent = '✓'; };
  };
}

/* ----- Users */
async function pUsers(p) {
  const { users } = await api('/api/users');
  p.innerHTML = `<h2>${esc(t('users'))}</h2><table class="t"><tr><th>${esc(t('username'))}</th><th>${esc(t('role'))}</th><th>${esc(t('created'))}</th><th></th></tr>
    ${users.map(u => `<tr><td>${esc(u.username)}${u.username === S.me.username ? ' <span class="muted small">(you)</span>' : ''}</td>
      <td><select data-role="${esc(u.username)}" style="width:auto"><option value="user" ${u.role === 'user' ? 'selected' : ''}>${esc(t('role_user'))}</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>${esc(t('role_admin'))}</option></select></td>
      <td class="muted small">${new Date(u.created * 1000).toLocaleDateString(LANG)}</td>
      <td style="text-align:right"><button class="btn sm" data-pw="${esc(u.username)}">${esc(t('reset_password'))}</button> <button class="btn sm danger" data-rm="${esc(u.username)}">${esc(t('delete'))}</button></td></tr>`).join('')}</table>
    <h3 style="margin:24px 0 12px">${esc(t('add_user'))}</h3>
    <form id="nu"><div class="grid2">${field(t('username'), 'username', '', 'text', 'required autocomplete="off"')}${field(t('password') + ' · ' + t('password_hint'), 'password', '', 'password', 'required minlength="8" autocomplete="new-password"')}
    ${selectF(t('role'), 'role', 'user', [['user', t('role_user')], ['admin', t('role_admin')]])}</div><button class="btn primary" type="submit">${esc(t('add_user'))}</button></form>`;
  const again = () => pUsers(p);
  p.onchange = async e => { const u = e.target.dataset.role; if (!u) return; try { await api('/api/users', { method: 'PUT', body: { username: u, role: e.target.value } }); toast(t('saved'), 'ok'); } catch (err) { toast(errMsg(err), 'err'); again(); } };
  p.onclick = async e => {
    const pw = e.target.closest('[data-pw]'), rm = e.target.closest('[data-rm]');
    try {
      if (pw) { const v = prompt(t('new_password') + ' (' + t('password_hint') + ')'); if (v) { await api('/api/users', { method: 'PUT', body: { username: pw.dataset.pw, password: v } }); toast(t('saved'), 'ok'); } }
      if (rm && confirm(t('confirm'))) { await api('/api/users?username=' + encodeURIComponent(rm.dataset.rm), { method: 'DELETE' }); again(); }
    } catch (err) { toast(errMsg(err), 'err'); }
  };
  $('#nu', p).onsubmit = async e => { e.preventDefault(); try { await api('/api/users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); again(); } catch (err) { toast(errMsg(err), 'err'); } };
}

/* ----- API tokens + Home Assistant sensor sample */
async function pTokens(p, fresh) {
  const { tokens } = await api('/api/tokens');
  const tok = fresh || 'YOUR_TOKEN';
  const yaml = `rest:\n  - resource: ${location.origin}/api/system\n    scan_interval: 30\n    headers:\n      Authorization: Bearer ${tok}\n    sensor:\n      - name: "Server CPU"\n        value_template: "{{ value_json.cpu.usage }}"\n        unit_of_measurement: "%"\n      - name: "Server RAM"\n        value_template: "{{ (value_json.memory.used / value_json.memory.total * 100) | round(1) }}"\n        unit_of_measurement: "%"\n      - name: "Server temperature"\n        value_template: "{{ value_json.temps[0].value if value_json.temps else none }}"\n        unit_of_measurement: "°C"\n        device_class: temperature`;
  p.innerHTML = `<h2>${esc(t('tokens'))}</h2>
    ${fresh ? `<div class="card" style="border-color:var(--ok);margin-bottom:16px"><div class="small muted">${esc(t('token_once'))}</div><input type="text" readonly value="${esc(fresh)}" class="mono" onfocus="this.select()" style="margin-top:8px"></div>` : ''}
    <table class="t"><tr><th>${esc(t('token_name'))}</th><th>${esc(t('created'))}</th><th></th></tr>${tokens.map(x => `<tr><td class="mono">${esc(x.name)}</td><td class="muted small">${new Date(x.created * 1000).toLocaleString(LANG)}</td><td style="text-align:right"><button class="btn sm danger" data-rm="${esc(x.name)}">${esc(t('delete'))}</button></td></tr>`).join('') || `<tr><td colspan="3" class="muted">${esc(t('none'))}</td></tr>`}</table>
    <form id="nt" class="row" style="margin:16px 0"><input type="text" name="name" placeholder="${esc(t('token_name'))}" required pattern="[A-Za-z0-9_.\\-]+" style="max-width:240px"><button class="btn primary">${esc(t('create_token'))}</button></form>
    <div class="muted small" style="margin-top:20px">${esc(t('ha_sample'))}</div><pre class="code">${esc(yaml)}</pre>`;
  $('#nt', p).onsubmit = async e => { e.preventDefault(); try { const r = await api('/api/tokens', { method: 'POST', body: { name: e.target.name.value } }); pTokens(p, r.token); } catch (err) { toast(errMsg(err), 'err'); } };
  p.onclick = async e => { const b = e.target.closest('[data-rm]'); if (b && confirm(t('confirm'))) { await api('/api/tokens?name=' + encodeURIComponent(b.dataset.rm), { method: 'DELETE' }); pTokens(p); } };
}

/* ----- Backup */
function pBackup(p) {
  p.innerHTML = `<h2>${esc(t('backup'))}</h2><div class="row"><button class="btn" id="ex">⬇ ${esc(t('export'))}</button><label class="btn" style="cursor:pointer">⬆ ${esc(t('import'))}<input type="file" id="im" accept="application/json" hidden></label></div>
    <p class="muted small" style="margin-top:16px">config.json · users.json · tokens.json → <span class="mono">/data</span></p>`;
  $('#ex', p).onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S.cfg, null, 2)], { type: 'application/json' })); a.download = 'homedash-settings.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  $('#im', p).onchange = async e => {
    try { const cfg = JSON.parse(await e.target.files[0].text()); await api('/api/config', { method: 'PUT', body: cfg }); await loadCfg(); applyLook(S.cfg); toast(t('imported'), 'ok'); route(); }
    catch (err) { toast(errMsg(err), 'err'); }
  };
}
