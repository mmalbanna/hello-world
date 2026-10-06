// Serves the exported scene to headless Chromium (WebGL2 on SwiftShader),
// streams each rendered layer (RGBA, bottom-up rows) to stdout in job order.
// usage: node render.mjs <gl-root> <jobs.json relative to root>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs'));
}

const root = path.resolve(process.argv[2]);
const jobs = process.argv[3];
let finish;
const finished = new Promise((r) => (finish = r));
const types = { '.html': 'text/html', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  if (req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (url.pathname === '/out') process.stdout.write(body, () => res.end('ok'));
      else if (url.pathname === '/log') { process.stderr.write(`[render] ${body}\n`); res.end('ok'); }
      else if (url.pathname === '/done') { res.end('ok'); finish(); }
      else { res.statusCode = 404; res.end(); }
    });
    return;
  }
  const p = path.join(root, decodeURIComponent(url.pathname));
  if (!p.startsWith(root + path.sep)) { res.statusCode = 403; res.end(); return; }
  fs.stat(p, (err, st) => {
    if (err || !st.isFile()) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Length', st.size);
    res.setHeader('Content-Type', types[path.extname(p)] || 'application/octet-stream');
    fs.createReadStream(p).pipe(res);
  });
});

server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address();
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-proxy-server'],
  });
  const page = await browser.newPage();
  page.on('console', (m) => process.stderr.write(`[page] ${m.text()}\n`));
  page.on('pageerror', (e) => { process.stderr.write(`[pageerror] ${e.message}\n`); process.exit(2); });
  await page.goto(`http://127.0.0.1:${port}/renderer.html?jobs=${encodeURIComponent(jobs)}`);
  await finished;
  await browser.close();
  server.close();
});
