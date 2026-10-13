// Flattens the Syncfusion Tailwind 3 theme (an @import list of per-control sheets) into one file under
// public/, served as-is. Bundling it through Vite breaks its inline SVG data URIs (nested url(#id)
// references get re-quoted), so the theme stays outside the Vite CSS pipeline.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const entry = require.resolve('@syncfusion/ej2-tailwind3-theme/styles/tailwind3.css');
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'styles', 'syncfusion', 'tailwind3.css');

const seen = new Set();
const remote = [];
function inline(file) {
  if (seen.has(file)) return '';
  seen.add(file);
  return readFileSync(file, 'utf8').replace(/@import\s+(?:url\()?["']([^"']+)["']\)?\s*;/g, (_, ref) => {
    if (/^https?:/.test(ref)) { remote.push(`@import url("${ref}");`); return ''; }
    return inline(resolve(dirname(file), ref));
  });
}
const body = inline(entry);
mkdirSync(dirname(target), { recursive: true });
// Remote @imports (web fonts) must precede every other rule.
writeFileSync(target, `${[...new Set(remote)].join('\n')}\n${body}`);
console.log(`Syncfusion theme: ${seen.size} sheets flattened into ${target} (${Math.round(Buffer.byteLength(body) / 1024)} KB)`);
