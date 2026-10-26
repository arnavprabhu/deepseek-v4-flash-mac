// DS41 console front end. No framework, no build.
const $ = (id) => document.getElementById(id);

let snap = null;
let busy = null; // AbortController of the running chat request
const chat = loadChat();

// ---------------------------------------------------------------------------------------------------------------- model panel

function segValue(id) {
  return Number(document.querySelector(`#${id} button.on`).dataset.v);
}
for (const id of ['ctx', 'effort']) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    for (const x of $(id).querySelectorAll('button')) x.classList.toggle('on', x === b);
    savePrefs();
  });
}
for (const id of ['spec', 'gpures']) $(id).addEventListener('change', savePrefs);

function savePrefs() {
  localStorage.setItem('ds41.prefs', JSON.stringify({ ctx: segValue('ctx'), effort: segValue('effort'), spec: $('spec').checked, gpures: $('gpures').checked }));
}
(function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('ds41.prefs') || '{}');
    for (const [id, v] of [['ctx', p.ctx], ['effort', p.effort]]) {
      if (v === undefined) continue;
      for (const x of $(id).querySelectorAll('button')) x.classList.toggle('on', Number(x.dataset.v) === v);
    }
    if (p.spec !== undefined) $('spec').checked = p.spec;
    if (p.gpures !== undefined) $('gpures').checked = p.gpures;
  } catch {}
})();

$('power').addEventListener('click', async () => {
  const s = snap?.state.status;
  const running = s === 'starting' || s === 'ready';
  $('power').disabled = true;
  const r = await fetch(running ? '/api/stop' : '/api/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ctx: segValue('ctx'), effort: segValue('effort'), spec: $('spec').checked, gpures: $('gpures').checked }),
  }).then((x) => x.json()).catch((e) => ({ error: e.message }));
  if (r.error) note(r.error, true);
  $('power').disabled = false;
});

function note(text, err = false) {
  $('model-note').textContent = text;
  $('model-note').classList.toggle('err', err);
}

// ---------------------------------------------------------------------------------------------------------------- live state

const es = new EventSource('/api/events');
es.addEventListener('state', (e) => { snap = JSON.parse(e.data); render(); });
es.addEventListener('logs', (e) => { $('log').textContent = ''; for (const l of JSON.parse(e.data)) addLog(l); });
es.addEventListener('log', (e) => addLog(JSON.parse(e.data)));
es.onerror = () => { $('status-text').textContent = 'CONSOLE OFFLINE'; $('status').dataset.s = 'error'; };

function render() {
  const { state, stats, sys, api } = snap;
  const s = state.status;
  $('status').dataset.s = s;
  const label = { offline: 'OFFLINE', starting: 'LOADING', ready: 'READY', stopping: 'STOPPING', error: 'ERROR' }[s];
  $('status-text').textContent = s === 'ready' && stats.live.generating ? 'GENERATING' : (s === 'ready' && stats.prefill ? 'READING PROMPT' : label);
  $('status-time').textContent = state.startedAt && (s === 'ready' || s === 'starting') ? dur((state.now - state.startedAt) / 1000) : '';

  const running = s === 'starting' || s === 'ready';
  $('power').textContent = s === 'stopping' ? 'STOPPING…' : running ? 'STOP MODEL' : 'START MODEL';
  $('power').classList.toggle('stop', running);
  $('power').disabled = s === 'stopping';
  for (const b of document.querySelectorAll('#ctx button, #effort button')) b.disabled = running || s === 'stopping';
  $('spec').disabled = $('gpures').disabled = running;
  if (running && state.opts) { // show what is actually running
    for (const b of document.querySelectorAll('#ctx button')) b.classList.toggle('on', Number(b.dataset.v) === state.opts.ctx);
    for (const b of document.querySelectorAll('#effort button')) b.classList.toggle('on', Number(b.dataset.v) === state.opts.effort);
    $('spec').checked = state.opts.spec;
    $('gpures').checked = state.opts.gpures;
  }
  $('empty').querySelector('.dim').textContent = s === 'ready'
    ? 'READY. TYPE BELOW. ENTER SENDS, SHIFT+ENTER IS A NEW LINE.'
    : 'START THE MODEL ON THE LEFT, THEN TYPE BELOW. ENTER SENDS, SHIFT+ENTER IS A NEW LINE.';

  if (s === 'starting') note(`${(state.loadLine || 'loading').toUpperCase()} … ${dur((state.now - state.startedAt) / 1000)}\nFIRST LOAD READS ~80 GB OF WEIGHTS; LATER STARTS ARE FASTER.`);
  else if (s === 'ready') note(`${state.cmd}\nUP ${dur((state.now - state.readyAt) / 1000)} · LOADED IN ${dur((state.readyAt - state.startedAt) / 1000)}`);
  else if (s === 'error') note(state.error || 'error', true);
  else if (!$('model-note').classList.contains('err')) note('');

  // KPIs
  const live = stats.live;
  const last = stats.last || {};
  if (live.tps != null) { $('k-decode').textContent = live.tps.toFixed(1); $('k-decode-u').textContent = 'TOK/S · LIVE'; }
  else { $('k-decode').textContent = last.gen_tps ? last.gen_tps.toFixed(1) : '—'; $('k-decode-u').textContent = 'TOK/S · LAST'; }
  if (stats.prefill) { $('k-prefill').textContent = Math.round(stats.prefill.tps); $('k-prefill-u').textContent = 'TOK/S · LIVE'; }
  else { $('k-prefill').textContent = last.prompt_tps ? Math.round(last.prompt_tps) : '—'; $('k-prefill-u').textContent = 'TOK/S · LAST'; }
  $('k-hit').textContent = live.hit != null ? (live.hit * 100).toFixed(0) : '—';
  $('k-ssd').textContent = live.mibPerTok != null && isFinite(live.mibPerTok) ? Math.round(live.mibPerTok) : '—';

  const pb = $('prefill-bar');
  pb.hidden = !stats.prefill;
  if (stats.prefill) {
    $('prefill-fill').style.width = `${(stats.prefill.progress * 100).toFixed(1)}%`;
    const p = stats.prefill;
    const eta = p.progress > 0.01 ? p.secs * (1 - p.progress) / p.progress : null;
    $('prefill-text').textContent = `READING PROMPT ${(p.progress * 100).toFixed(0)}% · ${p.n.toLocaleString()} TOK · ${eta != null ? dur(eta) + ' LEFT' : ''}`;
  }

  $('r-last').textContent = last.prompt_n != null
    ? `${fmtInt(last.prompt_n)} IN ${secs(last.prompt_ms)} · ${fmtInt(last.gen_n ?? 0)} OUT ${secs(last.gen_ms ?? 0)}` : '—';
  $('r-rss').textContent = sys.rss ? gb(sys.rss) : '—';
  $('r-free').textContent = sys.memFree != null ? `${sys.memFree}%` : '—';
  $('r-swap').textContent = sys.swapUsed != null ? `${gb(sys.swapUsed)} / ${gb(sys.swapTotal)}` : '—';
  $('r-gpu').textContent = sys.gpu != null ? `${sys.gpu}%` : '—';
  $('r-req').textContent = fmtInt(stats.requests);
  $('r-tok').textContent = `${fmtInt(stats.promptTok)} / ${fmtInt(stats.genTok)}`;
  $('r-ssdt').textContent = `${stats.ssdGiB.toFixed(1)} GB`;

  // API
  $('a-openai').textContent = `${api.ui}/v1`;
  $('a-anthropic').textContent = api.ui;
  $('a-model').textContent = api.model;
  $('a-curl').textContent = curlText(api);

  drawChart(stats.hist);
  $('send').disabled = !busy && s !== 'ready';
}

function curlText(api) {
  return `# OpenAI
curl ${api.ui}/v1/chat/completions \\
  -H 'content-type: application/json' \\
  -d '{"model":"${api.model}","messages":[{"role":"user","content":"hi"}],"stream":true}'

# Anthropic
curl ${api.ui}/v1/messages \\
  -H 'content-type: application/json' -H 'x-api-key: local' \\
  -H 'anthropic-version: 2023-06-01' \\
  -d '{"model":"${api.model}","max_tokens":1024,"messages":[{"role":"user","content":"hi"}]}'

# Python
from openai import OpenAI
OpenAI(base_url="${api.ui}/v1", api_key="local")

from anthropic import Anthropic
Anthropic(base_url="${api.ui}", api_key="local")

# Claude Code / Anthropic-compatible agents
ANTHROPIC_BASE_URL=${api.ui} ANTHROPIC_API_KEY=local`;
}

function drawChart(hist) {
  const c = $('chart');
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const n = 180;
  const pts = hist.slice(-n);
  const max = Math.max(20, ...pts.map((p) => p.tps || 0)) * 1.1;
  // grid
  g.strokeStyle = '#000'; g.globalAlpha = 0.15; g.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const y = Math.round((h * i) / 4) + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.globalAlpha = 1;
  g.font = '10px ui-monospace, Menlo, monospace'; g.fillStyle = '#000';
  g.fillText(`${Math.round(max)} TOK/S`, 4, 11);
  const x = (i) => (w * (i + n - pts.length)) / (n - 1);
  // decode tok/s: solid steps
  g.lineWidth = 2; g.strokeStyle = '#000'; g.setLineDash([]);
  stepLine(g, pts, x, (p) => (p.tps == null ? null : h - (p.tps / max) * h));
  // cache hit: dashed steps, 0..100%
  g.lineWidth = 1; g.setLineDash([4, 3]);
  stepLine(g, pts, x, (p) => (p.hit == null ? null : h - p.hit * h * 0.95));
  g.setLineDash([]);
}

function stepLine(g, pts, x, y) {
  let open = false;
  g.beginPath();
  pts.forEach((p, i) => {
    const yy = y(p);
    if (yy == null) { open = false; return; }
    if (!open) { g.moveTo(x(i), yy); open = true; } else { g.lineTo(x(i), g._lastY); g.lineTo(x(i), yy); }
    g._lastY = yy;
  });
  g.stroke();
}

// ---------------------------------------------------------------------------------------------------------------- log

function addLog(l) {
  const el = $('log');
  const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
  el.textContent += `${new Date(l.t).toLocaleTimeString([], { hour12: false })}  ${l.line}\n`;
  if (el.textContent.length > 200000) el.textContent = el.textContent.slice(-150000);
  if (stick) el.scrollTop = el.scrollHeight;
  $('log-last').textContent = l.line;
}
$('log-toggle').addEventListener('click', () => {
  $('log-panel').classList.toggle('open');
  $('log').scrollTop = $('log').scrollHeight;
});

// ---------------------------------------------------------------------------------------------------------------- chat

function loadChat() {
  try { return JSON.parse(localStorage.getItem('ds41.chat') || '[]'); } catch { return []; }
}
function saveChat() {
  localStorage.setItem('ds41.chat', JSON.stringify(chat.map(({ el, ...m }) => m)));
}
$('system').value = localStorage.getItem('ds41.system') || '';
$('system').addEventListener('input', () => localStorage.setItem('ds41.system', $('system').value));
$('maxtok').value = localStorage.getItem('ds41.maxtok') || '4096';
$('maxtok').addEventListener('input', () => localStorage.setItem('ds41.maxtok', $('maxtok').value));

function renderAll() {
  $('msgs').querySelectorAll('.msg').forEach((m) => m.remove());
  $('empty').hidden = chat.length > 0;
  for (const m of chat) mount(m);
}

function mount(m) {
  const el = document.createElement('div');
  el.className = `msg ${m.role}`;
  el.innerHTML = `<div class="who"><span>${m.role === 'user' ? 'YOU' : 'DS41'}</span><span class="meta"></span></div>`
    + (m.role === 'assistant' ? '<details class="think" hidden><summary>THINKING</summary><div class="tbody"></div></details>' : '')
    + '<div class="body"></div>';
  $('msgs').appendChild(el);
  m.el = el;
  paint(m);
  $('empty').hidden = true;
}

function paint(m, streaming = false) {
  const el = m.el;
  const body = el.querySelector('.body');
  body.innerHTML = m.role === 'user' ? `<p>${esc(m.content).replace(/\n/g, '<br>')}</p>` : md(m.content || '');
  body.classList.toggle('cursor', streaming && !m.content && !m.reasoning ? true : streaming && !!m.content);
  const th = el.querySelector('.think');
  if (th) {
    th.hidden = !m.reasoning;
    th.querySelector('.tbody').textContent = m.reasoning || '';
    th.querySelector('summary').textContent = streaming && !m.content ? 'THINKING …' : `THOUGHT · ${m.reasoning ? m.reasoning.length.toLocaleString() + ' CHARS' : ''}`;
    if (streaming && !m.content) th.open = true;
  }
  el.querySelector('.meta').textContent = m.meta || '';
}

$('clear').addEventListener('click', () => {
  if (busy) busy.abort();
  chat.length = 0;
  saveChat();
  renderAll();
});

$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); }
});

$('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) { busy.abort(); return; }
  const text = $('input').value.trim();
  if (!text || snap?.state.status !== 'ready') return;
  $('input').value = '';
  const user = { role: 'user', content: text };
  chat.push(user); mount(user);
  const bot = { role: 'assistant', content: '', reasoning: '', meta: 'WAITING' };
  chat.push(bot); mount(bot);
  scrollDown(true);
  await complete(bot);
});

async function complete(bot) {
  busy = new AbortController();
  $('send').textContent = 'STOP';
  $('send').classList.add('stop');
  $('send').disabled = false;
  const messages = [];
  if ($('system').value.trim()) messages.push({ role: 'system', content: $('system').value.trim() });
  for (const m of chat) if (m !== bot && m.content) messages.push({ role: m.role, content: m.content });
  const t0 = performance.now();
  let tFirst = null, timings = null, finish = null;
  try {
    const r = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: snap.api.model, messages, stream: true, max_tokens: Number($('maxtok').value) || 4096 }),
      signal: busy.signal,
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error?.message || `HTTP ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        if (j.timings) timings = j.timings;
        const ch = j.choices?.[0];
        if (!ch) continue;
        if (ch.finish_reason) finish = ch.finish_reason;
        const d = ch.delta || {};
        if (d.reasoning_content || d.content) {
          if (tFirst == null) tFirst = performance.now();
          bot.reasoning += d.reasoning_content || '';
          bot.content += d.content || '';
          bot.meta = `TTFT ${secs(tFirst - t0)} · ${bot.content ? 'WRITING' : 'THINKING'}`;
          paint(bot, true);
          scrollDown();
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') bot.content += `\n\n**[ERROR] ${err.message}**`;
    else finish = 'stopped';
  }
  const parts = [];
  if (tFirst != null) parts.push(`TTFT ${secs(tFirst - t0)}`);
  if (timings) {
    parts.push(`${fmtInt(timings.prompt_n)} IN @ ${Math.round(timings.prompt_per_second)}/S`);
    parts.push(`${fmtInt(timings.predicted_n)} OUT @ ${timings.predicted_per_second.toFixed(1)}/S`);
  }
  if (finish && finish !== 'stop') parts.push(finish.toUpperCase());
  bot.meta = parts.join(' · ');
  paint(bot, false);
  const th = bot.el.querySelector('.think');
  if (th && bot.content) th.open = false;
  saveChat();
  busy = null;
  $('send').textContent = 'SEND';
  $('send').classList.remove('stop');
  $('send').disabled = snap?.state.status !== 'ready';
}

function scrollDown(force = false) {
  const el = $('msgs');
  if (force || el.scrollTop + el.clientHeight >= el.scrollHeight - 120) el.scrollTop = el.scrollHeight;
}

// ---------------------------------------------------------------------------------------------------------------- copy

document.addEventListener('click', (e) => {
  const b = e.target.closest('.copy');
  if (!b) return;
  navigator.clipboard.writeText($(b.dataset.copy).textContent);
  b.textContent = 'OK';
  setTimeout(() => { b.textContent = 'COPY'; }, 900);
});

// ---------------------------------------------------------------------------------------------------------------- tiny markdown

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
}

function md(src) {
  const out = [];
  const parts = src.split(/```/);
  parts.forEach((part, k) => {
    if (k % 2 === 1) {
      const nl = part.indexOf('\n');
      const code = nl >= 0 ? part.slice(nl + 1) : part;
      out.push(`<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`);
      return;
    }
    let list = null;
    let para = [];
    const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const line of part.split('\n')) {
      let m;
      if (!line.trim()) { flush(); close(); continue; }
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flush(); close(); out.push(`<h${m[1].length > 2 ? 4 : 3}>${inline(m[2])}</h${m[1].length > 2 ? 4 : 3}>`); continue; }
      if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) { flush(); if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { flush(); if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
      close();
      para.push(line);
    }
    flush(); close();
  });
  return out.join('');
}

// ---------------------------------------------------------------------------------------------------------------- format

function dur(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
function secs(ms) { return ms >= 10000 ? `${(ms / 1000).toFixed(0)}S` : `${(ms / 1000).toFixed(1)}S`; }
function gb(b) { return `${(b / 1073741824).toFixed(1)} GB`; }
function fmtInt(n) { return Number(n || 0).toLocaleString(); }

renderAll();
window.addEventListener('resize', () => snap && drawChart(snap.stats.hist));
