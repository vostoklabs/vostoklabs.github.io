// Draws the "How to print shine-through" pictures and writes them to public/guides/.
// Needs the keycap's dev server (pnpm --filter keycap-generator dev, port 5193 by default):
//   ALLOW_CHROME=1 node apps/keycap-generator/scripts/guide/render.mjs [http://localhost:5193]
// One headless Chrome, killed by its process tree when done.
if (!process.env.ALLOW_CHROME) { console.error('BLOCKED: set ALLOW_CHROME=1 (one headless Chrome at a time).'); process.exit(3); }
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://localhost:5193';
const OUT = fileURLToPath(new URL('../../public/guides/', import.meta.url));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9471;
const profile = `${tmpdir()}/keycap-guide-render`;
mkdirSync(profile, { recursive: true });
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=700,500', 'about:blank'], { stdio: 'ignore' });
try {
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    await sleep(200);
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') console.error('page error:', m.params.exceptionDetails?.exception?.description);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') console.error('page log:', m.params.entry.text, m.params.entry.url ?? '');
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.error('console:', m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.navigate', { url: `${BASE}/scripts/guide/shine.html` });
  let shots = null;
  for (let i = 0; i < 120 && !shots; i++) {
    await sleep(500);
    const r = await send('Runtime.evaluate', { expression: 'window.__done ? JSON.stringify(window.__shots) : null', returnByValue: true });
    if (r?.result?.value) shots = JSON.parse(r.result.value);
  }
  if (!shots) throw new Error('the page never finished drawing');
  for (const [name, url] of Object.entries(shots)) {
    writeFileSync(`${OUT}shine-${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`wrote public/guides/shine-${name}.png`);
  }
  ws.close();
} finally {
  try { execSync(`taskkill /F /T /PID ${chrome.pid}`, { stdio: 'ignore' }); } catch { /* gone */ }
}
