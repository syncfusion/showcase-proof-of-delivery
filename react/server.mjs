// Dependency-free static host for Linux App Service: serves dist/ with SPA fallback and a /healthz probe.
// The build's asset URLs carry publicBasePath, but Vite writes files flat into dist/, so the prefix is stripped first.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { dirname, extname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const distDir = join(root, 'dist');
const indexFile = join(distDir, 'index.html');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const mountPath = '/proof-of-delivery/react';
const port = Number(process.env.PORT) || 8080;
const startedAt = Date.now();

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
};

// Compressed delivery (factory/standards/app-source-baseline.md, "Loading states"): scripts/precompress.mjs
// writes .br and .gz copies after the build; send the smallest one the request accepts. Brotli first.
const ENCODINGS = [['br', '.br'], ['gzip', '.gz']];
export function pickEncoding(acceptEncoding, filePath) {
  const accepted = String(acceptEncoding || '').toLowerCase().split(',')
    .map((part) => part.trim().split(';'))
    .filter(([, q]) => !q || parseFloat(q.split('=')[1]) > 0)
    .map(([name]) => name.trim());
  for (const [name, ext] of ENCODINGS) {
    if ((accepted.includes(name) || accepted.includes('*')) && existsSync(filePath + ext)) return { name, path: filePath + ext };
  }
  return null;
}

export function stripMountPath(pathname) {
  if (pathname === mountPath || pathname.startsWith(`${mountPath}/`)) return pathname.slice(mountPath.length) || '/';
  return pathname; // the unprefixed root also works, so the same build serves from the App Service root
}

function send(res, status, headers, body) { res.writeHead(status, headers); res.end(body); }
function sendFile(req, res, file, cache) {
  const headers = { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' };
  const encoding = pickEncoding(req.headers['accept-encoding'], file);
  if (existsSync(file + '.br') || existsSync(file + '.gz')) headers.Vary = 'Accept-Encoding';
  if (encoding) headers['Content-Encoding'] = encoding.name;
  const sendPath = encoding ? encoding.path : file;
  headers['Content-Length'] = statSync(sendPath).size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(sendPath).pipe(res);
}

export const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { Allow: 'GET, HEAD' }, 'Method not allowed');

  // Host health sits at the App Service's own root, never behind the mount path.
  if (url.pathname === '/healthz') {
    const built = existsSync(indexFile);
    const body = JSON.stringify({
      status: built ? 'ok' : 'missing-build', service: pkg.name, version: pkg.version,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), node: process.version, timestamp: new Date().toISOString(),
    });
    return send(res, built ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body);
  }

  // Everything outside the mount path redirects into it so the SPA always boots under the base path.
  if (url.pathname !== mountPath && !url.pathname.startsWith(`${mountPath}/`)) {
    const location = `${mountPath}${url.pathname}${url.search}`;
    return send(res, 308, { Location: location, 'Content-Type': 'text/plain; charset=utf-8' }, `Redirecting to ${location}`);
  }

  let pathname;
  try { pathname = stripMountPath(decodeURIComponent(url.pathname)); } catch { return send(res, 400, {}, 'Bad request'); }
  const relative = posix.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(distDir, relative);
  if (!file.startsWith(distDir)) return send(res, 403, {}, 'Forbidden');

  if (relative !== '/' && existsSync(file) && statSync(file).isFile()) {
    const hashed = relative.startsWith('/assets/');
    return sendFile(req, res, file, hashed ? 'public, max-age=31536000, immutable' : relative.endsWith('.html') ? 'no-cache' : 'public, max-age=3600');
  }
  // A missing file with an extension is a real 404, not a page; everything else is an SPA route.
  if (extname(relative)) return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
  if (!existsSync(indexFile)) return send(res, 503, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Build missing: run npm run build');
  return sendFile(req, res, indexFile, 'no-cache');
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(port, () => console.log(`${pkg.name} ${pkg.version} serving ${distDir} at http://localhost:${port}${mountPath}/`));
}
