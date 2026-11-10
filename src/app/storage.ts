// Key/value storage that never throws. Sandboxed iframes and private windows can
// deny localStorage; in that case values live in memory for this page only.

const memory = new Map<string, string>();
let persistent: boolean | null = null;

function probe(): boolean {
  if (persistent !== null) return persistent;
  try {
    const k = '__tp_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    persistent = true;
  } catch {
    persistent = false;
  }
  return persistent;
}

export function storageIsPersistent(): boolean {
  return probe();
}

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = probe() ? window.localStorage.getItem(key) : (memory.get(key) ?? null);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  const raw = JSON.stringify(value);
  try {
    if (probe()) window.localStorage.setItem(key, raw);
    else memory.set(key, raw);
  } catch {
    memory.set(key, raw);
  }
}
