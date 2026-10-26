// DS41 console backend: starts/stops llama-server (current_best config), proxies the OpenAI + Anthropic API,
// streams logs and live stats to the browser. No dependencies.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI = path.resolve(HERE, '..');
const PUBLIC = path.join(UI, 'public');
const SHARD1 = 'DeepSeek-V4.1-Flash-1017-GSQ-RCO-IQ2_XXS-00001-of-00004.gguf';

// Two layouts share this console:
//  - project: <work>/ui inside the engine project; launch from <work>/bench/config/current_best.json
//  - app:     <repo>/console inside deepseek-v4-flash-mac; launch through <repo>/scripts/engine.sh (RAM presets)
const LAYOUT = (() => {
  const work = path.resolve(UI, '..');
  const projCfg = process.env.DS41_CONFIG || path.join(work, 'bench', 'config', 'current_best.json');
  if (fs.existsSync(projCfg)) {
    return {
      kind: 'project', root: work, config: projCfg, lock: path.join(work, '.model.lock'),
      model: process.env.DS41_MODEL || path.join(work, '..', 'Models', SHARD1),
    };
  }
  const repo = work;
  const engine = path.join(repo, 'scripts', 'engine.sh');
  const runtime = process.env.DS41_RUNTIME_DIR || path.join(repo, 'runtime');
  const modelDir = process.env.DS41_MODEL_DIR || path.join(repo, 'models');
  return {
    kind: 'app', root: repo, engine, lock: path.join(repo, '.model.lock'),
    bin: process.env.DS41_BIN_DIR || path.join(runtime, 'build', 'bin'),
    model: process.env.DS41_MODEL || path.join(modelDir, SHARD1),
  };
})();
const LOCK = LAYOUT.lock;
const MODEL = LAYOUT.model;
const HOST = process.env.HOST || '127.0.0.1';
const UI_PORT = Number(process.env.PORT || 3141);
const MODEL_PORT = Number(process.env.MODEL_PORT || 8080);
const MODEL_ALIAS = 'deepseek-v4.1-flash';

// ---------------------------------------------------------------------------------------------------------------- state

const state = {
  status: 'offline', // offline | starting | ready | stopping | error
  pid: null,
  startedAt: null,
  readyAt: null,
  exitedAt: null,
  error: null,
  opts: null,
  cmd: null,
  loadLine: '',
};

const stats = {
  requests: 0,
  promptTok: 0,
  genTok: 0,
  last: null,        // { prompt_n, prompt_ms, prompt_tps, gen_n, gen_ms, gen_tps, at }
  prefill: null,     // { n, progress, secs, tps, at } while a long prompt runs
  steps: [],         // { t, n, hit, mib, fill } one per decode step (tokstat)
  hist: [],          // { t, tps, hit } once per second
  ssdMiB: 0,
};

const sys = { rss: null, swapUsed: null, swapTotal: null, memFree: null, gpu: null, at: null };

let child = null;
let launching = false; // between a start request and the spawn
let killTimer = null;
const logs = [];
const clients = new Set();

function resetStats() {
  Object.assign(stats, { requests: 0, promptTok: 0, genTok: 0, last: null, prefill: null, steps: [], hist: [], ssdMiB: 0 });
}

// ---------------------------------------------------------------------------------------------------------------- config

// the app layout uses the same flags as its scripts/serve.sh
const APP_SERVER_ARGS = '-ub 4096 -b 4096 --checkpoint-min-step 4096 --spec-type ngram-mod --spec-ngram-mod-n-match 8 --spec-ngram-mod-n-min 2 --spec-ngram-mod-n-max 8';

function loadConfig() {
  if (LAYOUT.kind === 'app') {
    return { name: 'configs/presets (common.env + RAM tier)', bin: LAYOUT.bin, args: '', env: {}, serverArgs: APP_SERVER_ARGS };
  }
  const c = JSON.parse(fs.readFileSync(LAYOUT.config, 'utf8'));
  const bin = path.isAbsolute(c.bin) ? c.bin : path.join(LAYOUT.root, c.bin);
  return { name: c.name || path.basename(LAYOUT.config), bin, args: c.args || '', env: c.env || {}, serverArgs: c.server_args || '' };
}

function splitArgs(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function buildCommand(opts) {
  const cfg = loadConfig();
  const server = path.join(cfg.bin, 'llama-server');
  let serverArgs = splitArgs(cfg.serverArgs);
  if (!opts.spec) {
    const keep = [];
    for (let i = 0; i < serverArgs.length; i++) {
      if (serverArgs[i].startsWith('--spec-')) { i++; continue; } // flag + value
      keep.push(serverArgs[i]);
    }
    serverArgs = keep;
  }
  const common = [
    ...serverArgs,
    '-c', String(opts.ctx),
    '-np', '1',
    '--jinja',
    ...(opts.effort === 0 ? ['-rea', 'off'] : ['-rea', 'on', '--reasoning-effort', String(opts.effort)]),
    '--temp', '1.0', '--top-p', '1.0', '--top-k', '0', '--min-p', '0',
    '--metrics', '--no-warmup',
    '-a', MODEL_ALIAS,
    '--host', '127.0.0.1', '--port', String(MODEL_PORT),
  ];
  const env = { ...process.env, ...cfg.env, LLAMA_DSV41_MOE_TOKSTATS: '1' };
  if (LAYOUT.kind === 'app') {
    // engine.sh loads the presets (which set the engine env) and adds -m + the base flags
    if (opts.gpures) env.DS41_GPURES = '1';
    return { cfg, server, exe: 'bash', args: [LAYOUT.engine, ...common], env };
  }
  if (opts.gpures) {
    env.LLAMA_DSV41_MOE_GPURES = '1';
    env.LLAMA_DSV41_MOE_PREDICT = '0';
  }
  return { cfg, server, exe: server, args: ['-m', MODEL, ...splitArgs(cfg.args), ...common], env };
}

// ---------------------------------------------------------------------------------------------------------------- lock

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function takeLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(LOCK);
      fs.writeFileSync(path.join(LOCK, 'owner'), `${process.pid} ds41-console ${new Date().toISOString()}\n`);
      return null;
    } catch (e) {
      if (e.code !== 'EEXIST') return String(e);
      let owner = '';
      try { owner = fs.readFileSync(path.join(LOCK, 'owner'), 'utf8').trim(); } catch {}
      const pid = Number(owner.split(/\s+/)[0]);
      if (pid && pid !== process.pid && !pidAlive(pid)) {
        fs.rmSync(LOCK, { recursive: true, force: true }); // stale
        continue;
      }
      if (pid === process.pid) return null;
      return owner || 'unknown owner';
    }
  }
  return 'could not take the model lock';
}

function releaseLock() {
  try {
    const owner = fs.readFileSync(path.join(LOCK, 'owner'), 'utf8');
    if (Number(owner.split(/\s+/)[0]) === process.pid) fs.rmSync(LOCK, { recursive: true, force: true });
  } catch {}
}

// ---------------------------------------------------------------------------------------------------------------- model process

function setStatus(s, extra = {}) {
  Object.assign(state, { status: s }, extra);
  broadcast('state', snapshot());
}

async function startModel(raw) {
  if (child || launching) return { error: `model is ${child ? state.status : 'starting'}` };
  launching = true;
  try { return await launch(raw); } finally { launching = false; }
}

async function launch(raw) {
  const opts = {
    ctx: [8192, 16384, 32768, 65536, 131072].includes(Number(raw.ctx)) ? Number(raw.ctx) : 131072,
    spec: raw.spec !== false,
    gpures: !!raw.gpures,
    effort: [0, 25, 50, 75, 100].includes(Number(raw.effort)) ? Number(raw.effort) : 50,
  };
  let cmd;
  try { cmd = buildCommand(opts); } catch (e) { return { error: `config: ${e.message}` }; }
  const app = LAYOUT.kind === 'app';
  if (!fs.existsSync(cmd.server)) return { error: app ? 'engine not built yet: run scripts/setup.sh' : `llama-server not built: ${cmd.server}` };
  if (!fs.existsSync(MODEL)) return { error: app ? 'model not downloaded yet: run scripts/download-model.sh' : `model not found: ${MODEL}` };
  if (await portInUse(MODEL_PORT)) {
    return { error: `port ${MODEL_PORT} is already in use (another llama-server or console?). Stop it, or start the console with MODEL_PORT=<port>.` };
  }
  const busy = takeLock();
  if (busy) return { error: `another model job holds the lock (${busy})` };

  resetStats();
  logs.length = 0;
  pushLog(`$ ${cmd.exe} ${cmd.args.join(' ')}`);
  child = spawn(cmd.exe, cmd.args, { env: cmd.env, cwd: LAYOUT.root, stdio: ['ignore', 'pipe', 'pipe'] });
  setStatus('starting', {
    pid: child.pid, startedAt: Date.now(), readyAt: null, exitedAt: null, error: null, opts,
    cmd: `llama-server … -c ${opts.ctx}${opts.gpures ? ' · gpu-resident' : ''}`, config: cmd.cfg.name, loadLine: 'loading weights',
  });
  for (const stream of [child.stdout, child.stderr]) lineReader(stream, onModelLine);
  child.on('exit', (code, signal) => {
    clearTimeout(killTimer);
    const wasStopping = state.status === 'stopping';
    child = null;
    releaseLock();
    pushLog(`[console] llama-server exited (${signal || code})`);
    setStatus(wasStopping || code === 0 ? 'offline' : 'error', {
      pid: null, exitedAt: Date.now(),
      error: wasStopping || code === 0 ? null : `llama-server exited with ${signal || code}; see log`,
    });
  });
  child.on('error', (e) => {
    pushLog(`[console] spawn error: ${e.message}`);
  });
  pollHealth();
  return { ok: true };
}

function stopModel() {
  if (!child) return { error: 'model is not running' };
  setStatus('stopping');
  child.kill('SIGINT');
  killTimer = setTimeout(() => child && child.kill('SIGKILL'), 20000);
  return { ok: true };
}

async function pollHealth() {
  while (child && state.status === 'starting') {
    await sleep(1000);
    try {
      const r = await fetch(`http://127.0.0.1:${MODEL_PORT}/health`);
      if (r.ok && state.status === 'starting') {
        setStatus('ready', { readyAt: Date.now(), loadLine: '' });
        pushLog('[console] model ready');
      }
    } catch {}
  }
}

const RE_TOK = /tokstat seq \d+ step \d+: n_tok = (\d+), hits = (\d+), misses = (\d+), hit rate = ([\d.]+)%, MiB = ([\d.]+), fill ms = ([\d.]+)/;
const RE_PP = /prompt processing, n_tokens =\s*(\d+), progress = ([\d.]+), t =\s*([\d.]+) s \/ ([\d.]+) tokens per second/;
const RE_PEVAL = /prompt eval time =\s*([\d.]+) ms \/\s*(\d+) tokens \(\s*[\d.]+ ms per token,\s*([\d.]+) tokens per second\)/;
const RE_EVAL = /^(?:.*?)\s+eval time =\s*([\d.]+) ms \/\s*(\d+) tokens \(\s*[\d.]+ ms per token,\s*([\d.]+) tokens per second\)/;

function onModelLine(line) {
  let m;
  if ((m = RE_TOK.exec(line))) {
    const n = Number(m[1]);
    const hits = Number(m[2]), misses = Number(m[3]);
    if (n <= 16) { // decode / verify steps only
      stats.steps.push({ t: Date.now(), n, hit: hits + misses ? hits / (hits + misses) : 1, mib: Number(m[5]), fill: Number(m[6]) });
      if (stats.steps.length > 512) stats.steps.splice(0, stats.steps.length - 512);
    }
    stats.ssdMiB += Number(m[5]);
    return; // too chatty for the log panel
  }
  if ((m = RE_PP.exec(line))) {
    stats.prefill = { n: Number(m[1]), progress: Number(m[2]), secs: Number(m[3]), tps: Number(m[4]), at: Date.now() };
  } else if ((m = RE_PEVAL.exec(line))) {
    stats.last = { prompt_ms: Number(m[1]), prompt_n: Number(m[2]), prompt_tps: Number(m[3]), at: Date.now() };
    stats.prefill = null;
  } else if ((m = RE_EVAL.exec(line)) && !line.includes('prompt eval')) {
    stats.last = { ...(stats.last || {}), gen_ms: Number(m[1]), gen_n: Number(m[2]), gen_tps: Number(m[3]), at: Date.now() };
    stats.requests++;
    stats.promptTok += stats.last.prompt_n || 0;
    stats.genTok += stats.last.gen_n || 0;
  } else if (state.status === 'starting') {
    if (/load_tensors|loading model/.test(line)) state.loadLine = 'loading weights';
    else if (/llama_moe_cache: arena/.test(line)) state.loadLine = 'allocating expert arena';
    else if (/seed|profile/.test(line) && /moe/.test(line)) state.loadLine = 'seeding expert arena';
    else if (/listening on/.test(line)) state.loadLine = 'listening';
    else if (/^==> preset:/.test(line)) state.loadLine = 'loading weights';
  }
  if (/^(llama_model_loader|print_info|load_tensors:\s+-|llama_model_load)/.test(line) && !/error/i.test(line)) return; // loader noise
  pushLog(line);
}

function pushLog(line) {
  const entry = { t: Date.now(), line };
  logs.push(entry);
  if (logs.length > 600) logs.splice(0, logs.length - 600);
  broadcast('log', entry);
}

function lineReader(stream, fn) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '').replace(/\x1b\[[0-9;]*m/g, ''); // no ANSI colors
      buf = buf.slice(i + 1);
      if (line.trim()) fn(line);
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------- live numbers

function liveNumbers() {
  const now = Date.now();
  const win = stats.steps.filter((s) => now - s.t < 4000);
  let tps = null;
  if (win.length >= 3) {
    const span = (win[win.length - 1].t - win[0].t) / 1000;
    const toks = win.slice(1).reduce((a, s) => a + s.n, 0);
    tps = span > 0 ? toks / span : null;
  }
  const recent = stats.steps.slice(-32);
  const hit = recent.length ? recent.reduce((a, s) => a + s.hit, 0) / recent.length : null;
  const mib = recent.length ? recent.reduce((a, s) => a + s.mib, 0) / recent.reduce((a, s) => a + s.n, 0) : null;
  const generating = win.length > 0 && now - win[win.length - 1].t < 1500;
  return { tps: generating ? tps : null, hit, mibPerTok: mib, generating };
}

function snapshot() {
  return {
    state: { ...state, now: Date.now() },
    stats: {
      requests: stats.requests, promptTok: stats.promptTok, genTok: stats.genTok, last: stats.last,
      prefill: stats.prefill && Date.now() - stats.prefill.at < 15000 ? stats.prefill : null,
      ssdGiB: stats.ssdMiB / 1024, live: liveNumbers(), hist: stats.hist.slice(-180),
    },
    sys,
    api: {
      ui: `http://${HOST}:${UI_PORT}`, direct: `http://127.0.0.1:${MODEL_PORT}`, model: MODEL_ALIAS,
    },
  };
}

function sampleSystem() {
  const tasks = [];
  if (state.pid) {
    tasks.push(run('ps', ['-o', 'rss=', '-p', String(state.pid)]).then((o) => { sys.rss = Number(o.trim()) * 1024 || null; }));
  } else {
    sys.rss = null;
  }
  tasks.push(run('sysctl', ['-n', 'vm.swapusage']).then((o) => {
    const u = /used = ([\d.]+)M/.exec(o), t = /total = ([\d.]+)M/.exec(o);
    sys.swapUsed = u ? Number(u[1]) * 1048576 : null;
    sys.swapTotal = t ? Number(t[1]) * 1048576 : null;
  }));
  tasks.push(run('sysctl', ['-n', 'kern.memorystatus_level']).then((o) => { sys.memFree = Number(o.trim()) || null; }));
  tasks.push(run('ioreg', ['-r', '-d', '1', '-c', 'IOAccelerator']).then((o) => {
    const m = /"Device Utilization %"=(\d+)/.exec(o);
    sys.gpu = m ? Number(m[1]) : null;
  }));
  return Promise.allSettled(tasks).then(() => { sys.at = Date.now(); });
}

function run(cmd, args) {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 3000, maxBuffer: 8 << 20 }, (e, out) => resolve(e ? '' : out)));
}

setInterval(async () => {
  const live = liveNumbers();
  stats.hist.push({ t: Date.now(), tps: live.tps, hit: live.generating ? live.hit : null });
  if (stats.hist.length > 600) stats.hist.splice(0, stats.hist.length - 600);
  if (clients.size === 0) return;
  await sampleSystem();
  broadcast('state', snapshot());
}, 1000);

// ---------------------------------------------------------------------------------------------------------------- http

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 1 << 20) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

function proxy(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (state.status !== 'ready') {
    const msg = state.status === 'starting' ? 'model is still loading' : 'model is not running; start it in the console';
    if (req.url.startsWith('/v1/messages')) {
      res.writeHead(503, { 'content-type': 'application/json', ...CORS });
      return res.end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: msg } }));
    }
    res.writeHead(503, { 'content-type': 'application/json', ...CORS });
    return res.end(JSON.stringify({ error: { message: msg, type: 'unavailable', code: 503 } }));
  }
  if (req.method === 'POST' && REWRITE_PATHS.has(new URL(req.url, 'http://x').pathname)) {
    // buffer the JSON body so the reasoning effort can be normalized for the model's chat template
    const chunks = [];
    let size = 0;
    req.on('data', (d) => { chunks.push(d); size += d.length; });
    req.on('end', () => {
      let body = Buffer.concat(chunks, size);
      try {
        const j = JSON.parse(body.toString('utf8'));
        if (normalizeEffort(j)) body = Buffer.from(JSON.stringify(j));
      } catch {} // not JSON: forward unchanged, the server reports the error
      forward(req, res, body);
    });
    return;
  }
  forward(req, res, null);
}

// The DS41 chat template accepts reasoning_effort = integer 1..100 or low/high/max (low 50, high 75, max 100) and
// raises on anything else, which llama-server returns as a 500. OpenAI clients send minimal/medium/xhigh too.
const REWRITE_PATHS = new Set(['/v1/chat/completions', '/v1/responses', '/v1/completions', '/v1/messages']);
const EFFORT_MAP = { minimal: '25', medium: '60', xhigh: '90', min: '25', med: '60', mid: '60', default: null, auto: null };

function effortValue(v) {
  if (v === null || v === undefined) return { drop: true };
  if (typeof v === 'number' && Number.isFinite(v)) return { value: String(Math.min(100, Math.max(1, Math.round(v)))) };
  if (typeof v !== 'string') return { drop: true };
  const w = v.trim().toLowerCase();
  if (w === 'none' || w === 'off') return { value: '1' }; // the server's "none" leaves raw <think> text in the reply
  if (w === 'low' || w === 'high' || w === 'max') return { value: w };
  if (/^\d+(\.\d+)?$/.test(w)) return { value: String(Math.min(100, Math.max(1, Math.round(Number(w))))) };
  if (w in EFFORT_MAP) return EFFORT_MAP[w] === null ? { drop: true } : { value: EFFORT_MAP[w] };
  return { drop: true }; // unknown word: use the server default
}

function normalizeEffort(j) {
  let changed = false;
  const fix = (obj, key) => {
    if (!obj || typeof obj !== 'object' || !(key in obj)) return;
    const r = effortValue(obj[key]);
    if (r.drop) { delete obj[key]; changed = true; return; }
    if (obj[key] !== r.value) { obj[key] = r.value; changed = true; }
  };
  fix(j, 'reasoning_effort');
  if (j.reasoning && typeof j.reasoning === 'object') fix(j.reasoning, 'effort');
  if (j.chat_template_kwargs && typeof j.chat_template_kwargs === 'object') fix(j.chat_template_kwargs, 'reasoning_effort');
  return changed;
}

function forward(req, res, body) {
  const headers = { ...req.headers, host: `127.0.0.1:${MODEL_PORT}` };
  if (body) {
    headers['content-length'] = String(body.length);
    delete headers['transfer-encoding'];
  }
  const up = http.request({ host: '127.0.0.1', port: MODEL_PORT, method: req.method, path: req.url, headers }, (ur) => {
    res.writeHead(ur.statusCode || 502, { ...ur.headers, ...CORS });
    ur.pipe(res);
  });
  up.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json', ...CORS });
    res.end(JSON.stringify({ error: { message: `upstream: ${e.message}`, type: 'upstream_error' } }));
  });
  // a closed client (stop button, ctrl-c in an agent) aborts the generation in llama-server
  res.on('close', () => { if (!res.writableFinished) up.destroy(); });
  if (body) up.end(body);
  else req.pipe(up);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
    res.write(`event: logs\ndata: ${JSON.stringify(logs.slice(-300))}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (p === '/api/state') {
    if (!sys.at || Date.now() - sys.at > 2000) await sampleSystem();
    return json(res, 200, snapshot());
  }
  if (p === '/api/config') {
    try {
      const c = loadConfig();
      return json(res, 200, { layout: LAYOUT.kind, name: c.name, bin: c.bin, model: MODEL, config: LAYOUT.config || null });
    } catch (e) { return json(res, 500, { error: e.message }); }
  }
  if (p === '/api/start' && req.method === 'POST') {
    const r = await startModel(await readBody(req));
    return json(res, r.error ? 409 : 200, r);
  }
  if (p === '/api/stop' && req.method === 'POST') {
    const r = stopModel();
    return json(res, r.error ? 409 : 200, r);
  }
  if (p.startsWith('/v1/') || p === '/health' || p === '/props' || p === '/metrics' || p === '/slots' || p === '/tokenize' || p === '/detokenize') {
    return proxy(req, res);
  }
  return serveStatic(req, res);
});

server.listen(UI_PORT, HOST, () => {
  console.log(`\n  DS41 CONSOLE  http://${HOST}:${UI_PORT}\n`);
  console.log(`  OpenAI     http://${HOST}:${UI_PORT}/v1/chat/completions`);
  console.log(`  Anthropic  http://${HOST}:${UI_PORT}/v1/messages`);
  console.log(`  (direct    http://127.0.0.1:${MODEL_PORT} once the model is up)\n`);
});

function shutdown() {
  if (child) {
    console.log('stopping llama-server ...');
    child.kill('SIGINT');
    setTimeout(() => { child && child.kill('SIGKILL'); releaseLock(); process.exit(0); }, 8000);
    child.on('exit', () => { releaseLock(); process.exit(0); });
  } else {
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
    sock.setTimeout(1000, () => { sock.destroy(); resolve(false); });
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
