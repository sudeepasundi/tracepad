// Builds engine-rs to WebAssembly and copies it to src/engine/engine.wasm.
// Needs: rustup target add wasm32-unknown-unknown
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src/engine/engine.wasm');
try {
  execFileSync(
    'cargo',
    ['build', '--manifest-path', join(root, 'engine-rs/Cargo.toml'), '--target', 'wasm32-unknown-unknown', '--release', '--quiet'],
    { stdio: 'inherit' },
  );
} catch (e) {
  if (existsSync(out)) {
    console.warn('[wasm] cargo build failed; keeping the existing engine.wasm');
    process.exit(0);
  }
  console.error('[wasm] cargo build failed. Install Rust and run: rustup target add wasm32-unknown-unknown');
  process.exit(1);
}
copyFileSync(join(root, 'engine-rs/target/wasm32-unknown-unknown/release/tracepad_engine.wasm'), out);
console.log(`[wasm] engine.wasm ${(statSync(out).size / 1024).toFixed(1)} KB`);
