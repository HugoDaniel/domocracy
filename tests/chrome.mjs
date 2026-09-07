// A static server and a Chrome DevTools Protocol client, with no dependencies.
//
// The browser suites need a real Chrome: moveBefore, shadow roots, custom
// element reactions and table sections are the things they are there to check,
// and none of them can be faked. This is the smallest thing that opens a page
// over HTTP and reads a value out of it.
//
//   startServer(root)     serves a directory on a free port
//   launchChrome(opts)    a Chrome process with a DevTools socket
//   openPage(client, url) a tab with eval and a list of page errors
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
};

// Everything under `root`, and nothing above it.
export function startServer(root) {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    const file = join(root, path);
    if (!file.startsWith(root + '/')) { res.writeHead(403); res.end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise(ready => server.listen(0, '127.0.0.1', () => ready({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(done => { server.closeAllConnections(); server.close(done); }),
  })));
}

const CHROME_PATHS = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
};

export function chromePath() {
  const path = process.env.CHROME ?? CHROME_PATHS[process.platform];
  if (!path || !existsSync(path)) throw new Error(`Chrome not found at ${path}. Set CHROME=/path/to/chrome.`);
  return path;
}

export async function launchChrome({ headless = true, width = 1280, height = 800 } = {}) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'domocracy-tests-'));
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-extensions',
    '--disable-popup-blocking',
    '--password-store=basic',
    '--use-mock-keychain',
    '--enable-automation',
  ];
  if (headless) args.push('--headless=new');
  args.push('about:blank');

  const proc = spawn(chromePath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise(resolve => proc.once('exit', resolve));
  // Chrome prints the socket to stderr once it is listening.
  const wsUrl = await new Promise((resolve, reject) => {
    let buffer = '', done = false;
    const timer = setTimeout(() => reject(new Error('timed out waiting for the Chrome DevTools endpoint')), 20000);
    proc.stderr.on('data', chunk => {
      if (done) return;
      buffer += chunk;
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { done = true; clearTimeout(timer); resolve(match[1]); }
    });
    exited.then(code => {
      if (done) return;
      clearTimeout(timer);
      reject(new Error(`Chrome exited with code ${code} before DevTools was ready:\n${buffer}`));
    });
  });

  const client = await connect(wsUrl);
  return {
    client,
    async close() {
      try { await Promise.race([client.send('Browser.close'), sleep(3000)]); } catch { /* the socket may already be gone */ }
      client.close();
      const killer = setTimeout(() => proc.kill('SIGKILL'), 3000);
      await exited;
      clearTimeout(killer);
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

// Commands get an id and resolve on the matching reply; events fan out to
// listeners keyed by session and method.
export function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map(), listeners = new Map();
    let nextId = 0;
    const key = (sessionId, method) => `${sessionId ?? ''}|${method}`;
    ws.addEventListener('open', () => resolve(client));
    ws.addEventListener('error', event => reject(new Error(`CDP WebSocket error: ${event.message ?? 'unknown'}`)));
    ws.addEventListener('close', () => {
      for (const p of pending.values()) p.reject(new Error(`${p.method}: CDP connection closed`));
      pending.clear();
    });
    ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (msg.id !== undefined) {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
        else p.resolve(msg.result);
        return;
      }
      const set = listeners.get(key(msg.sessionId, msg.method));
      if (set) for (const fn of [...set]) fn(msg.params);
    });

    const client = {
      send(method, params = {}, sessionId) {
        const id = ++nextId;
        const msg = { id, method, params };
        if (sessionId) msg.sessionId = sessionId;
        return new Promise((ok, fail) => { pending.set(id, { resolve: ok, reject: fail, method }); ws.send(JSON.stringify(msg)); });
      },
      on(method, fn, sessionId) {
        const k = key(sessionId, method);
        if (!listeners.has(k)) listeners.set(k, new Set());
        listeners.get(k).add(fn);
        return () => listeners.get(k)?.delete(fn);
      },
      once(method, sessionId) {
        return new Promise(ok => { const off = client.on(method, params => { off(); ok(params); }, sessionId); });
      },
      close() { try { ws.close(); } catch { /* already closed */ } },
    };
  });
}

// A fresh tab with a flat session, navigated and loaded. `errors` collects
// everything the page threw, which is how a suite that fails to import says so.
export async function openPage(client, url, { width = 1280, height = 800 } = {}) {
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  const page = {
    errors: [],
    send: (method, params) => client.send(method, params, sessionId),
    on: (method, fn) => client.on(method, fn, sessionId),
    once: method => client.once(method, sessionId),
    async eval(expression) {
      const { result, exceptionDetails } = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw new Error(`page.eval failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}\n  in: ${expression}`);
      return result.value;
    },
    close: () => client.send('Target.closeTarget', { targetId }),
  };
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  page.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    page.errors.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const loaded = page.once('Page.loadEventFired');
  await page.send('Page.navigate', { url });
  await loaded;
  return page;
}
