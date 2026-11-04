/*
  A headless Chrome of the script's own, driven over the DevTools protocol: its own profile in a
  temp folder and its own process tree, so it never touches a browser someone has open.

    const chrome = await launchChrome();
    try {
      await chrome.open('http://localhost:5173/');
      const title = await chrome.evaluate('document.title');
    } finally {
      await chrome.close();
    }

  WebGL runs in software (SwiftShader), which costs a desktop's worth of CPU while a page draws:
  run one at a time, and always close it. `close()` ends the whole process tree by its id, never
  every chrome on the machine.

  The browser is CHROME, else the usual install path for the platform.
*/

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = {
  win32: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};

function chromePath() {
  const found = [process.env.CHROME, ...(CANDIDATES[process.platform] ?? [])].find((p) => p && existsSync(p));
  if (!found) throw new Error('No Chrome found: set CHROME to its executable.');
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start Chrome and connect to its page. `width`/`height` size the window. */
export async function launchChrome({ width = 1024, height = 700 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'vl-chrome-'));
  const proc = spawn(chromePath(), [
    '--headless=new',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore', detached: process.platform !== 'win32' });

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try { ws?.close(); } catch { /* already gone */ }
    if (proc.pid) {
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' });
        else process.kill(-proc.pid, 'SIGKILL');
      } catch { /* already gone */ }
    }
    // The profile is locked for a moment after the process goes.
    for (let i = 0; i < 10; i++) {
      try { rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(300); }
    }
  }

  let ws;
  try {
    // Chrome writes the port it chose into the profile.
    let port = 0;
    for (let i = 0; i < 100 && !port; i++) {
      try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { await sleep(150); }
    }
    if (!port) throw new Error('Chrome did not open its debugging port.');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = pages.find((p) => p.type === 'page');
    if (!page) throw new Error('Chrome has no page to drive.');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  } catch (err) {
    await close();
    throw err;
  }

  let id = 0;
  const waiting = new Map();
  const listeners = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
    }
  };

  /** One protocol call. */
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      waiting.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  /** Call `fn` with each `method` event's params. */
  const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]);

  /** Go to a page and wait for it to load. A move within the page (only the `#` changes) loads
   *  nothing, so it is not waited for. */
  async function open(url) {
    await send('Page.enable');
    const loaded = new Promise((resolve) => on('Page.loadEventFired', resolve));
    const res = await send('Page.navigate', { url });
    if (res.errorText) throw new Error(`${url}: ${res.errorText}`);
    if (res.loaderId) await loaded;
  }

  /** The value of an expression in the page, awaited if it is a promise. A thrown error is
   *  thrown here too, with the page's own message. */
  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
    return res.result.value;
  }

  return { send, on, open, evaluate, close };
}
