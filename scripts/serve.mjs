// Tiny static server for tests and local previews (no dependencies).
//   node scripts/serve.mjs --dir dist --port 4173 --prefix /tracepad/
//   node scripts/serve.mjs --port 4175 --frame http://127.0.0.1:4174/tracepad.html
// --frame serves one page that embeds the given URL in a sandboxed, cross-origin
// iframe, the way an artifact host would.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const dir = resolve(arg('dir', 'dist'));
const port = Number(arg('port', '4173'));
const prefix = arg('prefix', '/');
const frame = arg('frame');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.log': 'text/plain; charset=utf-8',
};

const framePage = (src) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Frame host</title>
<style>html,body{height:100%;margin:0;background:#666}iframe{display:block;border:0;width:100%;height:100%}</style></head>
<body><iframe id="embedded" title="Tracepad" sandbox="allow-scripts allow-downloads allow-popups allow-modals" src="${src}"></iframe></body></html>`;

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (frame) {
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
      res.end(framePage(frame));
      return;
    }
    if (!url.pathname.startsWith(prefix)) {
      res.writeHead(url.pathname === '/' ? 302 : 404, url.pathname === '/' ? { location: prefix } : {});
      res.end();
      return;
    }
    let rel = normalize(decodeURIComponent(url.pathname.slice(prefix.length))).replace(/^(\.\.[\\/])+/, '');
    let file = join(dir, rel);
    if (!file.startsWith(dir)) throw new Error('outside root');
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${frame ? `frame of ${frame}` : dir} at http://127.0.0.1:${port}${frame ? '/' : prefix}`));
