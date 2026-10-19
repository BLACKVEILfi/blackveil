// BLACKVEIL web server: static pages + JSON API + a loop that indexes BlackveilBank events.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
const PORT = Number(process.env.PORT || 9150);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_MODE = process.env.PUBLIC === '1'; // hides _fonts and other internal pages on the live server

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.sol': 'text/plain; charset=utf-8',
};
const GZ = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.md', '.sol']);
// clean URLs → page files
const PAGES = { '/': 'index.html', '/app': 'app.html', '/verify': 'verify.html', '/agents': 'agents.html', '/pay': 'pay.html' };

const { default: api } = await import('./server/api.mjs');
const B = await import('./server/bank.mjs');

const cache = new Map();
async function serveFile(res, file, req) {
  const s = await stat(file);
  if (s.isDirectory()) throw Object.assign(new Error('dir'), { code: 'EISDIR' });
  const ext = extname(file).toLowerCase();
  let c = cache.get(file);
  if (!c || c.mtime !== s.mtimeMs) {
    const body = await readFile(file);
    c = { mtime: s.mtimeMs, body, gz: GZ.has(ext) && body.length > 1024 ? gzipSync(body) : null };
    cache.set(file, c);
  }
  const headers = { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': /\/(fonts|img|vendor)\//.test(file) ? 'public, max-age=604800' : 'no-cache', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'", 'permissions-policy': 'camera=(), microphone=(), geolocation=()' };
  if (c.gz && /gzip/.test(req.headers['accept-encoding'] || '')) { headers['content-encoding'] = 'gzip'; headers.vary = 'accept-encoding'; res.writeHead(200, headers).end(c.gz); }
  else res.writeHead(200, headers).end(c.body);
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); decodeURIComponent(url.pathname); } catch { res.writeHead(400).end('Bad request'); return; }
  if (url.pathname.startsWith('/api/')) {
    try { await api(req, res, url); }
    catch (e) { console.error(e); if (!res.headersSent) res.writeHead(500, { 'content-type': TYPES['.json'] }); res.end('{"error":"internal"}'); }
    return;
  }
  if (PUBLIC_MODE && /^\/_/.test(url.pathname)) { res.writeHead(404).end('Not found'); return; }
  if (url.pathname === '/config.js' && process.env.LOCAL_RPC && process.env.BANK) {
    // local fork run: point the pages at the fork's bank and RPC without touching public/config.js
    const body = await readFile(join(ROOT, 'config.js'), 'utf8');
    const extra = `\nObject.assign(window.BLACKVEIL_CONFIG, ${JSON.stringify({ bank: process.env.BANK, deployBlock: Number(process.env.DEPLOY_BLOCK || 0), rpc: process.env.LOCAL_RPC, local: true })});\n`;
    res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-cache' }).end(body + extra);
    return;
  }
  const clean = url.pathname.replace(/\/+$/, '') || '/';
  let path = PAGES[clean] || normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try { await serveFile(res, file, req); }
  catch {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    try { res.end(await readFile(join(ROOT, '404.html'))); } catch { res.end('Not found'); }
  }
});

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), '[srv]', ...a);
(async () => {
  for (;;) {
    const t = Date.now();
    try { await B.sync(); } catch (e) { log('sync error', e.message); }
    await new Promise(r => setTimeout(r, Math.max(1500, Number(process.env.SYNC_MS || 4000) - (Date.now() - t))));
  }
})();

server.listen(PORT, HOST, () => console.log(`BLACKVEIL → http://${HOST}:${PORT}`));
