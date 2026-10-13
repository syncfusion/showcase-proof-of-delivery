import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { name: string; version: string };

// Public base path per factory/standards/publishing-base-path.md
export const publicBasePath = '/proof-of-delivery/react';

export default defineConfig({
  base: `${publicBasePath}/`,
  plugins: [react(), tailwindcss()],
  define: {
    __APP_NAME__: JSON.stringify(pkg.name),
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  // The PDF Viewer's own library is one large chunk, loaded only on the signing route (app-plan.md).
  build: { chunkSizeWarningLimit: 8000 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
