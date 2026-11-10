# Tracepad

A text editor that runs in the browser and is built for backend debugging: reading application logs, cleaning up pasted tables, and working with files too big for ordinary web editors. Think "Notepad++, in a browser tab", with nothing to install.

**Live app:** https://sudeepasundi.github.io/tracepad/

Tracepad is being built in milestones. This page lists what works today and what is planned; the [changelog](CHANGELOG.md) has the detail for each release.

## What works today (0.3)

- **Tabs and files**: New, Open (several files at once), Save, Save As, drag and drop. Where the browser supports the File System Access API (Chrome, Edge), an opened file stays linked and Save writes back to it. Elsewhere, files open through the standard file picker and Save downloads a copy.
- **Logs**: automatic format detection (Spring Boot, Logback/Log4j, JSON lines, access logs, syslog, java.util.logging, epoch, Kubernetes prefixes), level colours, dimmed library stack frames, folding, a timeline you can click and drag, combined filters (level, text/regex, several patterns, logger/thread, trace ID, time range), F8 between errors, repeated-error grouping and your own highlight rules.
- **Session restore**: tabs, their order and unsaved text come back after a reload or restart; linked files are re-read from disk (after a browser restart they ask for access once).
- **Tab management**: rename (double-click, F2 or right-click; renames the file on disk in Chrome and Edge), drag to reorder, a right-click menu, and an Open files list (`Ctrl+Shift+E`) with filter, sort and keyboard navigation.
- **Encodings**: UTF-8, UTF-8 with BOM, UTF-16 LE/BE and Latin-1 are detected and written back unchanged. Line endings (LF/CRLF) are kept and can be switched from the status bar. Binary files are refused.
- **Editing**: multi-cursor (`Ctrl+Alt+↑/↓`, `Ctrl+click`, `Ctrl+D`), column selection (`Alt`+drag), find and replace with regular expressions, go to line, word wrap, a minimap, font and size settings.
- **Command palette** (`Ctrl+Shift+P` or `F1`): every action with its shortcut. Shortcuts avoid the ones browsers reserve (`Ctrl+W`, `Ctrl+T`, `Ctrl+N`, `Ctrl+Tab`).
- **Look**: six themes (three dark, three light), six accent colours, comfortable or compact density. Every combination is tested for WCAG contrast.
- **Offline**: installable as a PWA; after the first visit it works with no connection.
- **Single-file build**: one self-contained `tracepad.html` that also works inside a sandboxed cross-origin iframe.
- **A sample Spring Boot log** with stack traces, Kafka, Feign and trace IDs to try things on.

## Planned

| Version | Adds |
|---|---|
| 0.4 | Read-only viewer for very large logs (hundreds of MB), follow file, reload on change |
| 0.5 | Extract to table, automatic tables from log patterns, results panel |
| 0.6 | Pasted tables to Markdown, Markdown preview |
| 0.7 | Split view with snap layouts |
| 0.8 | Compare (diff) view, Copilot hand-off with secret masking |

Files over 64 MB are not opened yet; that needs the large-file viewer in 0.4.

## Privacy

- Tracepad has no server. It is a set of static files.
- Your files are read by your browser and never uploaded.
- There is no telemetry and no analytics.
- After the app has loaded it makes no network requests. The hosted build ships a Content-Security-Policy that blocks requests to any other origin, and the tests check that none are made.
- The single-file build loads nothing external at all: no CDN, no fonts.
- Settings and your session (open tabs and unsaved text) are stored in your browser, on your device, and nowhere else.

## Run and build

Requirements: Node 22+, and Rust with the WebAssembly target (`rustup target add wasm32-unknown-unknown`). Rust is needed because the log parser is compiled to WebAssembly; a TypeScript fallback covers browsers and frames where WebAssembly is blocked.

```bash
npm install
npm run dev            # development server
npm run build          # PWA build            -> dist/
npm run build:single   # one-file build       -> dist-single/tracepad.html
npm run build:all      # both
```

`dist/` uses relative paths, so it can be served from any sub-path (for example `https://<user>.github.io/tracepad/`).

## Test

```bash
npm test               # unit tests (Vitest): themes/contrast, encodings, log formats, filters, Rust vs TypeScript parity
npm run test:rust      # Rust unit tests
npm run build:all      # the end-to-end tests run against the built output
npx playwright install chromium firefox webkit
npm run e2e            # Chromium: PWA build, single-file build (incl. cross-origin iframe), phone
npm run e2e:browsers   # Firefox and WebKit smoke tests
npm run shots          # screenshots at 1920x1080, 1366x768 and 390x844 into shots/
```

## Browser support

| | Chrome / Edge | Firefox / Safari |
|---|---|---|
| Editing, find, palette, themes | yes | yes |
| Linked files (save in place) | yes | no: open via picker, save via download |
| Install and offline use | yes | offline yes; install varies |
| Inside a cross-origin iframe | yes, with picker/download fallbacks | yes, with picker/download fallbacks |

## Licence

[MIT](LICENSE)
