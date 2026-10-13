// Writes a Brotli (.br) and a gzip (.gz) copy of each text asset in dist/ over 1 KB, after `vite build`,
// so server.mjs can send the smallest one the browser accepts (factory/standards/app-source-baseline.md,
// "Loading states"). Node's built-in zlib only; no runtime dependency. Measured on real-estate-portfolio (2026-10-07): the theme
// bundle 4.8 MB raw, the PDF Viewer page chunk 7.5 MB, both sent uncompressed before.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const COMPRESSIBLE = /\.(js|mjs|css|html|svg|json|wasm|txt|xml|map)$/i;
const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

let raw = 0, br = 0, gz = 0, files = 0;
for (const path of walk(dist).filter(path => COMPRESSIBLE.test(path))) {
  const data = readFileSync(path);
  if (data.length < 1024) continue;
  const brotli = brotliCompressSync(data, { params: {
    [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
  const gzip = gzipSync(data, { level: 9 });
  // A copy that is not smaller is not worth serving.
  if (brotli.length < data.length) writeFileSync(path + '.br', brotli);
  if (gzip.length < data.length) writeFileSync(path + '.gz', gzip);
  raw += data.length; br += Math.min(brotli.length, data.length); gz += Math.min(gzip.length, data.length); files++;
}
const mb = n => (n / 1024 / 1024).toFixed(2) + ' MB';
console.log(`precompress: ${files} files in ${relative(process.cwd(), dist) || 'dist'}: ${mb(raw)} raw, ${mb(gz)} gzip, ${mb(br)} brotli`);
