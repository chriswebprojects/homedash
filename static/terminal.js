'use strict';
/* HomeDash web terminal. Uses xterm.js when available (static/vendor/ or CDN) and falls back to a small built-in emulator. */
let TS = null; // active terminal session

function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); }); }
function loadCss(href) { return new Promise((res, rej) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = res; l.onerror = () => rej(new Error('css')); document.head.appendChild(l); }); }
async function loadXterm() {
  if (window.Terminal && window.FitAddon) return true;
  const cdn = 'https://cdn.jsdelivr.net/npm/';
  const sets = [['/vendor/xterm.js', '/vendor/xterm.css', '/vendor/addon-fit.js'],
    [cdn + '@xterm/xterm@5.5.0/lib/xterm.js', cdn + '@xterm/xterm@5.5.0/css/xterm.css', cdn + '@xterm/addon-fit@0.10.0/lib/addon-fit.js']];
  for (const [js, css, fit] of sets) {
    try { await Promise.all([loadScript(js), loadCss(css)]); await loadScript(fit); if (window.Terminal && window.FitAddon) return true; } catch { /* try next */ }
  }
  return false;
}
const b64bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const bytesB64 = s => { let b = ''; new TextEncoder().encode(s).forEach(x => { b += String.fromCharCode(x); }); return btoa(b); };

function closeTerm() {
  if (!TS) return;
  try { TS.es.close(); } catch { /* ignore */ }
  try { TS.ro.disconnect(); } catch { /* ignore */ }
  try { TS.term.dispose && TS.term.dispose(); } catch { /* ignore */ }
  TS = null;
}

async function viewTerminal() {
  $('#view').innerHTML = `<div class="row sb" style="margin-bottom:10px"><div class="muted small">${esc(t('term_note'))}</div><button class="btn sm" data-act="term-new">↻ ${esc(t('term_restart'))}</button></div><div class="termwrap" id="termwrap"></div>`;
  if (!sessionStorage.getItem('hd_term')) sessionStorage.setItem('hd_term', rand());
  await startTerm(sessionStorage.getItem('hd_term'), false);
}
ACTIONS['term-new'] = async () => {
  const old = sessionStorage.getItem('hd_term');
  closeTerm(); try { await api('/api/term/close', { method: 'POST', body: { id: old } }); } catch { /* gone */ }
  sessionStorage.setItem('hd_term', rand()); await startTerm(sessionStorage.getItem('hd_term'), true);
};

async function startTerm(sid, fresh) {
  closeTerm();
  const wrap = $('#termwrap'); if (!wrap) return; wrap.innerHTML = '';
  let term, fit;
  if (await loadXterm()) {
    term = new Terminal({ cursorBlink: true, fontSize: 14, scrollback: 5000, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', theme: { background: '#0b0d12' } });
    const fa = new FitAddon.FitAddon(); term.loadAddon(fa); term.open(wrap); fit = () => fa.fit();
  } else { term = new BasicTerm(wrap); fit = () => term.fit(); }
  fit(); term.focus && term.focus();
  const session = { term, es: null, ro: null }; TS = session;
  try { await api('/api/term/open', { method: 'POST', body: { id: sid, fresh, cols: term.cols, rows: term.rows } }); }
  catch (e) { wrap.innerHTML = `<div class="empty">${esc(e.message === 'terminal_disabled' ? t('term_disabled') : errMsg(e))}</div>`; return; }
  if (TS !== session) return;
  const es = session.es = new EventSource('/api/term/stream?id=' + encodeURIComponent(sid));
  es.onmessage = e => term.write(b64bytes(e.data));
  es.addEventListener('exit', () => { es.close(); term.write('\r\n\x1b[33m[' + t('term_exited') + ']\x1b[0m\r\n'); });
  let chain = Promise.resolve();
  const post = (path, body) => { chain = chain.then(() => api(path, { method: 'POST', body: { id: sid, ...body } })).catch(() => { }); };
  let buf = '', timer = null;
  term.onData(d => { buf += d; if (!timer) timer = setTimeout(() => { const data = buf; buf = ''; timer = null; post('/api/term/input', { data: bytesB64(data) }); }, 6); });
  let rt = null, last = '';
  const resize = () => { clearTimeout(rt); rt = setTimeout(() => { fit(); const k = term.cols + 'x' + term.rows; if (k !== last) { last = k; post('/api/term/resize', { cols: term.cols, rows: term.rows }); } }, 120); };
  session.ro = new ResizeObserver(resize); session.ro.observe(wrap);
}

/* ---------- minimal built-in terminal emulator (fallback when xterm.js cannot be loaded) ---------- */
class BasicTerm {
  constructor(host) {
    this.host = host; this.el = document.createElement('div'); this.el.className = 'bterm'; this.el.tabIndex = 0; host.appendChild(this.el);
    const probe = document.createElement('span'); probe.textContent = 'M'.repeat(20); probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'; this.el.appendChild(probe);
    const r = probe.getBoundingClientRect(); this.cw = (r.width / 20) || 8; this.ch = r.height || 18; probe.remove();
    this.dec = new TextDecoder('utf-8'); this.sb = []; this.st = 0; this.p = ''; this.cols = 80; this.rows = 24;
    this.cx = 0; this.cy = 0; this.fg = null; this.bg = null; this.bold = false; this.inv = false; this.ak = '';
    this.grid = Array.from({ length: this.rows }, () => this.blank());
    this.el.addEventListener('keydown', e => this.key(e)); this.el.addEventListener('paste', e => { e.preventDefault(); this.cb && this.cb(e.clipboardData.getData('text')); });
    this.el.addEventListener('mousedown', () => setTimeout(() => this.el.focus(), 0));
  }
  focus() { this.el.focus(); }
  dispose() { this.el.remove(); }
  onData(cb) { this.cb = cb; }
  blank() { return Array.from({ length: this.cols }, () => ({ c: ' ', a: '' })); }
  fit() {
    const r = this.host.getBoundingClientRect();
    this.resize(Math.max(20, Math.floor((r.width - 20) / this.cw)), Math.max(5, Math.floor((r.height - 16) / this.ch)));
  }
  resize(cols, rows) {
    while (this.grid.length < rows) this.grid.push(this.blank());
    while (this.grid.length > rows) { this.sb.push(this.grid.shift()); this.cy = Math.max(0, this.cy - 1); }
    for (const row of this.grid) { while (row.length < cols) row.push({ c: ' ', a: '' }); row.length = cols; }
    this.cols = cols; this.rows = rows; this.cx = Math.min(this.cx, cols - 1); this.cy = Math.min(this.cy, rows - 1); this.sched();
  }
  write(data) {
    const s = typeof data === 'string' ? data : this.dec.decode(data, { stream: true });
    for (const ch of s) {
      switch (this.st) {
        case 0:
          if (ch === '\x1b') this.st = 1;
          else if (ch === '\n') this.lf();
          else if (ch === '\r') this.cx = 0;
          else if (ch === '\b') this.cx = Math.max(0, this.cx - 1);
          else if (ch === '\t') this.cx = Math.min(this.cols - 1, (this.cx + 8) & ~7);
          else if (ch >= ' ' && ch !== '\x7f') this.put(ch);
          break;
        case 1: this.st = ch === '[' ? (this.p = '', 2) : ch === ']' ? 3 : (ch === '(' || ch === ')') ? 4 : 0; break;
        case 2: if (ch >= '@' && ch <= '~') { this.csi(ch, this.p); this.st = 0; } else this.p += ch; break;
        case 3: this.st = ch === '\x07' ? 0 : ch === '\x1b' ? 5 : 3; break;
        default: this.st = 0;
      }
    }
    this.sched();
  }
  put(ch) {
    if (this.cx >= this.cols) { this.cx = 0; this.lf(); }
    this.grid[this.cy][this.cx] = { c: ch, a: this.ak }; this.cx++;
  }
  lf() {
    if (this.cy < this.rows - 1) this.cy++;
    else { this.sb.push(this.grid.shift()); this.grid.push(this.blank()); if (this.sb.length > 1000) this.sb.shift(); }
  }
  erase(row, from, to) { for (let i = from; i < to && i < this.cols; i++) row[i] = { c: ' ', a: '' }; }
  csi(cmd, p) {
    const n = p.replace(/[?>=]/g, '').split(';').map(x => parseInt(x, 10) || 0), a = n[0] || 1, g = this.grid, row = g[this.cy];
    switch (cmd) {
      case 'A': this.cy = Math.max(0, this.cy - a); break;
      case 'B': this.cy = Math.min(this.rows - 1, this.cy + a); break;
      case 'C': this.cx = Math.min(this.cols - 1, this.cx + a); break;
      case 'D': this.cx = Math.max(0, this.cx - a); break;
      case 'G': this.cx = Math.min(this.cols - 1, a - 1); break;
      case 'd': this.cy = Math.min(this.rows - 1, a - 1); break;
      case 'H': case 'f': this.cy = Math.min(this.rows - 1, (n[0] || 1) - 1); this.cx = Math.min(this.cols - 1, (n[1] || 1) - 1); break;
      case 'J': {
        const m = n[0] || 0;
        if (m === 0) { this.erase(row, this.cx, this.cols); for (let y = this.cy + 1; y < this.rows; y++) this.erase(g[y], 0, this.cols); }
        else if (m === 1) { for (let y = 0; y < this.cy; y++) this.erase(g[y], 0, this.cols); this.erase(row, 0, this.cx + 1); }
        else { for (let y = 0; y < this.rows; y++) this.erase(g[y], 0, this.cols); if (m === 3) this.sb = []; }
        break;
      }
      case 'K': { const m = n[0] || 0; if (m === 0) this.erase(row, this.cx, this.cols); else if (m === 1) this.erase(row, 0, this.cx + 1); else this.erase(row, 0, this.cols); break; }
      case 'P': row.splice(this.cx, a); while (row.length < this.cols) row.push({ c: ' ', a: '' }); break;
      case '@': row.splice(this.cx, 0, ...Array.from({ length: a }, () => ({ c: ' ', a: '' }))); row.length = this.cols; break;
      case 'X': this.erase(row, this.cx, this.cx + a); break;
      case 'L': for (let i = 0; i < a; i++) { g.splice(this.rows - 1, 1); g.splice(this.cy, 0, this.blank()); } break;
      case 'M': for (let i = 0; i < a; i++) { g.splice(this.cy, 1); g.push(this.blank()); } break;
      case 'm': this.sgr(p === '' ? [0] : n); break;
      default: break; // modes, scroll regions, etc. are ignored
    }
  }
  sgr(n) {
    const pal = i => { if (i < 16) return ['#1d1f27', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#d6dbe6', '#5c6370', '#ff7b86', '#b5e890', '#f5d58a', '#7cc4ff', '#dd8cf5', '#6ed4e0', '#ffffff'][i];
      if (i >= 232) { const v = 8 + (i - 232) * 10; return `rgb(${v},${v},${v})`; } i -= 16; const q = x => x ? 55 + x * 40 : 0; return `rgb(${q(Math.floor(i / 36))},${q(Math.floor(i / 6) % 6)},${q(i % 6)})`; };
    for (let i = 0; i < n.length; i++) {
      const v = n[i];
      if (v === 0) { this.fg = this.bg = null; this.bold = this.inv = false; }
      else if (v === 1) this.bold = true; else if (v === 22) this.bold = false; else if (v === 7) this.inv = true; else if (v === 27) this.inv = false;
      else if (v >= 30 && v <= 37) this.fg = pal(v - 30); else if (v === 39) this.fg = null;
      else if (v >= 40 && v <= 47) this.bg = pal(v - 40); else if (v === 49) this.bg = null;
      else if (v >= 90 && v <= 97) this.fg = pal(v - 90 + 8); else if (v >= 100 && v <= 107) this.bg = pal(v - 100 + 8);
      else if (v === 38 || v === 48) {
        let c = null;
        if (n[i + 1] === 5) { c = pal(n[i + 2] || 0); i += 2; } else if (n[i + 1] === 2) { c = `rgb(${n[i + 2] || 0},${n[i + 3] || 0},${n[i + 4] || 0})`; i += 4; }
        if (v === 38) this.fg = c; else this.bg = c;
      }
    }
    this.ak = (this.fg || this.bg || this.bold || this.inv) ? [this.fg || '', this.bg || '', this.bold ? 1 : 0, this.inv ? 1 : 0].join('|') : '';
  }
  sched() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }
  span(k, txt) {
    if (!k) return esc(txt);
    const [fg, bg, b, inv] = k.split('|'); let st = '';
    const f = inv === '1' ? (bg || '#0b0d12') : fg, bgc = inv === '1' ? (fg || '#d6dbe6') : bg;
    if (f) st += `color:${f};`; if (bgc) st += `background:${bgc};`; if (b === '1') st += 'font-weight:bold;';
    return `<span style="${st}">${esc(txt)}</span>`;
  }
  draw() {
    const rows = this.sb.slice(-400).concat(this.grid), off = rows.length - this.rows; let out = '';
    rows.forEach((row, y) => {
      let run = '', key = null, line = '';
      const flush = () => { if (run) line += this.span(key, run); run = ''; };
      for (let x = 0; x < row.length; x++) {
        const cell = row[x], isCur = y - off === this.cy && x === this.cx;
        if (isCur) { flush(); line += `<span class="cur">${esc(cell.c)}</span>`; key = null; continue; }
        if (cell.a !== key) { flush(); key = cell.a; }
        run += cell.c;
      }
      flush(); out += line.replace(/\s+$/, '') + '\n';
    });
    const atBottom = this.el.scrollTop + this.el.clientHeight >= this.el.scrollHeight - 30;
    this.el.innerHTML = out; if (atBottom) this.el.scrollTop = this.el.scrollHeight;
  }
  key(e) {
    if (e.metaKey) return; const k = e.key; let s = null;
    if (e.ctrlKey && (k === 'v' || k === 'V')) return; // let the browser paste
    if (e.ctrlKey && !e.altKey && k.length === 1) { const c = k.toLowerCase().charCodeAt(0); if (c >= 97 && c <= 122) s = String.fromCharCode(c - 96); else if (k === '[') s = '\x1b'; else if (k === '\\') s = '\x1c'; }
    else if (e.altKey && k.length === 1) s = '\x1b' + k;
    else if (k.length === 1) s = k;
    else s = { Enter: '\r', Backspace: '\x7f', Tab: '\t', Escape: '\x1b', ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D', Home: '\x1b[H', End: '\x1b[F', Delete: '\x1b[3~', PageUp: '\x1b[5~', PageDown: '\x1b[6~' }[k] ?? null;
    if (s !== null) { e.preventDefault(); this.cb && this.cb(s); }
  }
}
