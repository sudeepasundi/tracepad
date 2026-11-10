// Opening files that are too large for the editor: they go to the read-only,
// disk-backed viewer instead (see src/app/big.ts).
import { ask, toast } from '../app/feedback';
import { startBig } from '../app/big';
import { settings } from '../app/settings';
import { tabs } from '../app/state';
import { addTab } from '../app/tabs';
import { detectEncoding } from './encoding';

const MB = 1024 * 1024;
/** Above this, only the end can be shown: the index itself would not fit in memory. */
export const TAIL_ONLY_BYTES = 3072 * MB;

export function largeLimitBytes(): number {
  return settings.value.largeFileMB * MB;
}

export async function openBigFile(file: File, handle?: FileSystemFileHandle, opts: { activate?: boolean; uid?: string; lastUsed?: number } = {}): Promise<number | null> {
  let sample: Uint8Array;
  try {
    sample = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  } catch {
    toast(`Could not read ${file.name}. If it changed since it was picked, pick it again.`, { kind: 'error' });
    return null;
  }
  const detected = detectEncoding(sample);
  if (detected.binary) {
    toast(`${file.name} looks like a binary file, so it was not opened.`, { kind: 'error' });
    return null;
  }
  if (detected.encoding.startsWith('UTF-16')) {
    await ask({
      title: `${file.name} cannot be opened yet`,
      message: `It is ${(file.size / MB).toFixed(0)} MB of UTF-16 text. Large files are supported in UTF-8 and Latin-1 only. Nothing was opened.`,
      buttons: [{ id: 'ok', label: 'OK', primary: true }],
    });
    return null;
  }

  let start = detected.encoding === 'UTF-8 BOM' ? 3 : 0;
  let tailOnly = false;
  const tailBytes = settings.value.tailMB * MB;
  const tailLabel = settings.value.tailMB >= 1 ? `${settings.value.tailMB} MB` : `${Math.round(settings.value.tailMB * 1024)} KB`;
  if (file.size > settings.value.tailAskMB * MB) {
    const forced = file.size > TAIL_ONLY_BYTES;
    const size = file.size >= 1024 * MB ? `${(file.size / (1024 * MB)).toFixed(1)} GB` : `${(file.size / MB).toFixed(1)} MB`;
    const r = await ask({
      title: `${file.name} is ${size}`,
      message: forced
        ? `A file this large cannot be indexed in full in a browser tab. Tracepad can show its last ${tailLabel}, which is where the recent entries are.`
        : `Indexing all of it needs a lot of memory and may be slow. The last ${tailLabel} (the most recent entries) opens in a few seconds.`,
      buttons: [{ id: 'cancel', label: 'Cancel' }, ...(forced ? [] : [{ id: 'all', label: 'Open all of it' }]), { id: 'tail', label: `Open the last ${tailLabel}`, primary: true }],
    });
    if (!r || r.button === 'cancel') return null;
    if (r.button === 'tail') {
      // Start at the first whole line inside that last part.
      const at = Math.max(0, file.size - tailBytes);
      const peek = new Uint8Array(await file.slice(at, at + MB).arrayBuffer());
      const nl = peek.indexOf(10);
      start = at + (nl < 0 ? 0 : nl + 1);
      tailOnly = true;
    }
  }

  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 10) {
      if (i > 0 && sample[i - 1] === 13) crlf++;
      else lf++;
    }
  }
  const id = addTab({ name: file.name, text: '', handle, encoding: detected.encoding, eol: crlf > lf ? 'CRLF' : 'LF', big: true, tailOnly, activate: opts.activate, uid: opts.uid, lastUsed: opts.lastUsed });
  const tab = tabs.value.find((t) => t.id === id)!;
  void startBig(id, tab.uid, file, start, detected.encoding === 'Latin-1' ? 'iso-8859-1' : 'utf-8', tailOnly);
  return id;
}
