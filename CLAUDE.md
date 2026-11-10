# Tracepad: notes for future sessions

Browser-only text editor for backend debugging (logs, tables, big files). Static hosting on GitHub Pages under `/tracepad/`, plus a single-file build that must work inside a sandboxed cross-origin iframe. No backend, no telemetry, no network calls after load.

The approved plan and milestone list live in `README.md` ("Planned") and `CHANGELOG.md`. Milestones 1 and 2 (0.1.0, 0.2.0) are shipped; next is 0.3 (logs: format detection, colours, timeline, filters).

## Stack

- **CodeMirror 6** editor, **Preact + @preact/signals** for the chrome, **TypeScript strict**, plain CSS.
- **Vite** with two modes: `vite build` (PWA, `dist/`) and `vite build --mode single` (`dist-single/tracepad.html`, via vite-plugin-singlefile).
- **Rust -> WebAssembly** engine in `engine-rs/` (plain `extern "C"` ABI, no wasm-bindgen, no imports). Every Rust function has a TypeScript twin and a parity test.
- **Vitest** for unit tests, **Playwright** for end-to-end, appearance and screenshot runs.

## File map

```
index.html              entry; links marked data-pwa are stripped from the single-file build
vite.config.ts          both builds, CSP injection, service-worker generation
engine-rs/src/lib.rs    Rust engine (scan today; indexing/parsing/filtering/templates later)
scripts/build-wasm.mjs  cargo build -> src/engine/engine.wasm (git-ignored)
scripts/gen-log.mjs     deterministic Spring Boot log generator (sample + big test files)
scripts/serve.mjs       static server for tests; --frame embeds a URL in a sandboxed iframe
scripts/build-icons.mjs renders PNG icons from scripts/icon.svg and public/favicon.svg
src/boot.ts             first import is app/paste.ts (paste capture before any editor exists)
src/main.tsx            wiring, service-worker registration, window.__tracepad test hook
src/app/                state (signals), settings, themes, commands + layers, tabs, feedback, storage,
                        session (restore) + idb
src/editor/             CodeMirror setup, languages, minimap
src/files/              encodings, open/save/drag-drop
src/engine/             client (worker + fallbacks), wasm wrapper, TypeScript twins
src/workers/            engine worker
src/ui/                 Preact components
src/styles/app.css      all styles
src/sw.template.js      service worker source; __CACHE__ and __FILES__ are filled at build
tests/unit              Vitest
tests/e2e               Playwright: app, files, tabs, appearance (both builds); pwa; single; iframe; phone; smoke
                        linked.ts = real file handles for tests (origin private file system)
tests/visual            screenshot run for human review
```

## Conventions

- Every CSS class starts with `tp-`. Colours come only from the `--tp-*` variables built in `src/app/themes.ts`; never hard-code a colour in a component.
- Every user action is a command in `src/app/actions.ts`. Buttons call `runCommand`; the palette and Help read the same registry. Do not bind `Ctrl+W/T/N/Tab` (browser-reserved).
- Anything that can be dismissed with Escape registers a **layer** (`registerLayer` in `src/app/commands.ts`) with an `isOpen` read from live state. Do not track open/closed through effect cleanups: effects run after paint and a fast second key press sees stale state.
- State that must be right before the next key press (focus, initial dialog value) uses `useLayoutEffect` or a freshly keyed component, not `useEffect`.
- All persistent storage goes through `src/app/storage.ts` (falls back to memory when storage is blocked).
- `src/engine/*.ts` and `src/files/encoding.ts` are pure (no DOM) so they run in workers and unit tests.
- Adding a Rust export: bump nothing unless a signature changes (then bump `tp_abi` and `ENGINE_ABI`), add the TypeScript twin, add cases to `tests/unit/engine-parity.test.ts`.
- User-facing text: plain sentences, no exclamation marks, say what happened and what to do next.
- Commits: author `Sudeep <sudeepasundi@users.noreply.github.com>` (repo-local git config), **no co-author trailer**. No personal details or employer names anywhere in the repo; sample data uses `com.acme`.

## Build, test, release

```bash
npm run dev
npm test && npm run test:rust
npm run build:all && npm run e2e && npm run e2e:browsers
npm run shots        # then LOOK at shots/*.png
```

Release checklist (every change ships as a version):

1. Bump `version` in `package.json` (and `package-lock.json` via `npm install --package-lock-only`).
2. Add a section to `CHANGELOG.md` headed `## <version>`; the Release workflow copies it into the release notes.
3. Run the full test list above. Take screenshots at 1920x1080, 1366x768 and 390x844 in a dark and a light theme, open them, fix what looks wrong.
4. Commit, push to `main`. The "CI and deploy" workflow tests, builds and deploys Pages.
5. Run the "Release" workflow: `gh workflow run release.yml`. It creates tag `v<version>` and a GitHub Release with the PWA zip and the single HTML file.
6. Confirm both: `gh run list --limit 4`, open the site, `gh release view v<version>`.

## Gotchas

- **Quality bar**: passing tests are not enough. UI changes need screenshots that a person (or you) has looked at, plus appearance assertions (space used, scrollbars at edges, controls beside what they control, no overlap or clipping, contrast).
- **Paste**: editors can swallow paste events. `src/app/paste.ts` registers a capture-phase listener and must stay the first import in `boot.ts`.
- **Cross-origin iframe**: `showOpenFilePicker` is blocked there. `openFiles()` decides synchronously and clicks an `<input type=file>` inside the same user gesture. Files picked that way are one-time snapshots; reading them after they change throws `NotReadableError` (offer "Pick file again").
- **Picker cancel**: only the input's `cancel` event means cancelled. Never use window focus; cloud-synced files can arrive seconds later.
- **Sandboxed frames** have an opaque origin: `localStorage`/IndexedDB throw. Use the storage wrapper.
- **Service worker**: cache name is `tracepad-<version>-<hash>`. A new worker waits; the page shows "New version available" and only then sends `skip-waiting`. The first install fires `controllerchange` too, so reload only when the user asked.
- **Session**: IndexedDB holds the full session (handles, big text), throttled to twice a second. A write started in `pagehide` does not reliably finish, so a small synchronous localStorage journal is written on exit and the newer of the two wins on start (`src/app/session.ts`). Tabs have a stable `uid` to join the two. A newly linked handle is saved at once.
- **Testing linked files**: Playwright cannot drive native pickers. `tests/e2e/linked.ts` swaps `showOpenFilePicker` for one returning origin-private-file-system handles, which are real handles (writable, `move()`, storable in IndexedDB). Permission prompts are simulated by overriding `FileSystemFileHandle.prototype.queryPermission`.
- **Artifact viewers block downloads** from the frame; in a cross-origin frame Save offers "Copy all text" as well.
- **Tab context-menu items for split and compare** are added in 0.7 and 0.8, when those features exist.
- **Git Bash mangles `--prefix /tracepad/`**; prefix manual runs of `scripts/serve.mjs` with `MSYS_NO_PATHCONV=1`.
- **Shell heredocs mangle backslashes** in patch scripts; write the script to a file instead.
- **Settings** are saved on a debounce and flushed on `pagehide`, `beforeunload` and when the page becomes hidden.
- **Large files**: JS strings stop near 512 M characters. Files over 64 MB must go to the read-only, disk-backed viewer (0.4), never into a CodeMirror document. Keep engine interfaces as bytes in, typed arrays out, chunk by chunk.
- **Hidden lines**: when filters arrive (0.3), test hiding on 300k+ lines.
- **Timestamps**: allow a prefix of up to ~64 characters before the timestamp (Kubernetes and epoch logs) or the whole file collapses into one entry.
- **CRLF**: Windows checkouts and Windows logs have `\r\n`. `.gitattributes` forces LF in the repo; parsers must strip a trailing `\r`.
- **WebAssembly can be blocked** by a frame's CSP. `src/engine/client.ts` falls back to TypeScript in a worker, then TypeScript on the main thread. Help > About shows which engine is active.
- **Vite inline worker + wasm**: the worker is inlined (`?worker&inline`), so it cannot resolve asset URLs. The main thread loads the wasm bytes and posts them to the worker.
- **Local Firefox**: Playwright's Firefox may fail to launch on some Windows machines (`spawn UNKNOWN`); the Firefox smoke tests still run in CI.
- **GitHub Actions** runs sometimes sit queued; re-dispatching usually unsticks them. Tag pushes may be blocked, which is why the Release workflow creates the tag through the release API.
- **Full screen** (0.6+): request it on the document root so toasts, menus and dialogs stay visible; handle Esc through the layer registry.
- **Copilot** (0.8): Microsoft 365 Copilot cannot be iframed; use a popup.
