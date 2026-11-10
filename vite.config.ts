import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** Everything the app may load. No third-party origin appears here on purpose. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "form-action 'none'",
  "base-uri 'self'",
].join('; ');

function listPublic(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listPublic(full, `${prefix}${name}/`) : [`${prefix}${name}`];
  });
}

/** Emits sw.js with a versioned cache name and the exact list of files to precache. */
function serviceWorker(): Plugin {
  return {
    name: 'tracepad-sw',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'sw.js');
      const files = [...new Set(['./', 'index.html', ...built, ...listPublic('public')])];
      const hash = createHash('sha256').update(files.join('|')).digest('hex').slice(0, 8);
      const source = readFileSync('src/sw.template.js', 'utf8')
        .replace('__CACHE__', `tracepad-${pkg.version}-${hash}`)
        .replace('__FILES__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

/** PWA build: add the CSP. Single-file build: drop links to files that will not exist. */
function htmlFor(single: boolean): Plugin {
  return {
    name: 'tracepad-html',
    apply: 'build',
    transformIndexHtml(html) {
      if (!single) {
        return html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
      }
      const icon = readFileSync('public/favicon.svg', 'utf8').replace(/\s+/g, ' ').trim();
      const href = `data:image/svg+xml,${encodeURIComponent(icon)}`;
      return html.replace(/\s*<link[^>]*data-pwa[^>]*>/g, '').replace('</title>', `</title>\n    <link rel="icon" href="${href}" />`);
    },
  };
}

function renameSingle(): Plugin {
  return {
    name: 'tracepad-rename-single',
    apply: 'build',
    closeBundle() {
      if (existsSync('dist-single/index.html')) renameSync('dist-single/index.html', 'dist-single/tracepad.html');
    },
  };
}

export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    publicDir: single ? false : 'public',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __SINGLE__: JSON.stringify(single),
    },
    plugins: [preact(), htmlFor(single), ...(single ? [viteSingleFile({ removeViteModuleLoader: true }), renameSingle()] : [serviceWorker()])],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
      chunkSizeWarningLimit: 4000,
    },
    worker: { format: 'es' as const },
    server: { port: 5173, strictPort: false },
    test: {
      include: ['tests/unit/**/*.test.ts'],
      environment: 'node',
    },
  };
});
