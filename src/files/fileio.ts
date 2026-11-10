// Opening and saving local files. Nothing here talks to the network: files are
// read with the File API and written through a file handle or a download.
import { docText, markSaved, setTabLanguage } from '../editor/editor';
import { languageName } from '../editor/languages';
import { scanBytes } from '../engine/client';
import { ask, toast } from '../app/feedback';
import { activeId, crossOriginFramed, dropActive, patchTab, tabs } from '../app/state';
import { activateTab, addTab } from '../app/tabs';
import { decodeBytes, detectEncoding, encodeText } from './encoding';

/** Above this size a file needs the read-only large-file viewer (arrives in 0.4). */
export const MAX_EDITABLE_BYTES = 64 * 1024 * 1024;

let pickerBlocked = false;

function errName(e: unknown): string {
  return e instanceof DOMException || e instanceof Error ? e.name : '';
}

export async function openFiles(): Promise<void> {
  // Decided synchronously: inside a cross-origin iframe the File System Access
  // picker is blocked, and <input type=file> must be clicked within this same
  // user gesture.
  if (window.showOpenFilePicker && !crossOriginFramed && !pickerBlocked) {
    try {
      const handles = await window.showOpenFilePicker({ multiple: true, id: 'tracepad-open' });
      for (const h of handles) await openHandle(h);
      return;
    } catch (e) {
      if (errName(e) === 'AbortError') return;
      pickerBlocked = true;
      toast('The linked-file picker is not available here. Click Open again to use the basic picker.', { kind: 'info' });
      return;
    }
  }
  pickWithInput();
}

function pickWithInput(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.className = 'tp-file-input';
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  const cleanup = () => input.remove();
  input.addEventListener('change', async () => {
    const files = [...(input.files ?? [])];
    cleanup();
    for (const f of files) await openFile(f);
  });
  // Only the cancel event means "cancelled". Window focus is not a signal:
  // cloud-synced files can arrive seconds after the dialog closes.
  input.addEventListener('cancel', cleanup);
  document.body.appendChild(input);
  input.click();
}

export async function openHandle(handle: FileSystemFileHandle): Promise<void> {
  for (const t of tabs.value) {
    if (t.handle && (await t.handle.isSameEntry(handle).catch(() => false))) {
      activateTab(t.id);
      return;
    }
  }
  let file: File;
  try {
    file = await handle.getFile();
  } catch (e) {
    toast(`Could not read ${handle.name}: ${errName(e) || 'unknown error'}.`, { kind: 'error' });
    return;
  }
  await openFile(file, handle);
}

export async function openFile(file: File, handle?: FileSystemFileHandle): Promise<void> {
  if (file.size > MAX_EDITABLE_BYTES) {
    await ask({
      title: `${file.name} is too large for this version`,
      message: `It is ${(file.size / 1048576).toFixed(0)} MB. Files over 64 MB need the read-only large-file viewer, which arrives in version 0.4. Nothing was opened.`,
      buttons: [{ id: 'ok', label: 'OK', primary: true }],
    });
    return;
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    toast(
      errName(e) === 'NotReadableError'
        ? `${file.name} changed or moved since it was picked. Pick the file again.`
        : `Could not read ${file.name}.`,
      { kind: 'error', action: { label: 'Pick file again', run: () => void openFiles() } },
    );
    return;
  }
  const detected = detectEncoding(bytes);
  const utf16 = detected.encoding.startsWith('UTF-16');
  const stats = utf16 || detected.binary ? null : await scanBytes(bytes);
  if (detected.binary || (stats && stats.nul > 0)) {
    toast(`${file.name} looks like a binary file, so it was not opened.`, { kind: 'error' });
    return;
  }
  const text = decodeBytes(bytes, detected.encoding);
  let eol: 'LF' | 'CRLF';
  if (stats) eol = stats.crlf > stats.lf ? 'CRLF' : 'LF';
  else {
    const head = text.slice(0, 1 << 20);
    const crlf = head.split('\r\n').length - 1;
    eol = crlf > 0 && crlf >= head.split('\n').length - 1 - crlf ? 'CRLF' : 'LF';
  }
  addTab({ name: file.name, text, handle, encoding: detected.encoding, eol });
}

// ------------------------------------------------------------------ saving

function bytesFor(id: number): Uint8Array | null {
  const tab = tabs.value.find((t) => t.id === id);
  if (!tab) return null;
  const { bytes, lossy } = encodeText(docText(id, tab.eol), tab.encoding);
  if (lossy > 0) toast(`${lossy} character${lossy === 1 ? '' : 's'} cannot be stored as Latin-1 and were written as "?".`, { kind: 'error' });
  return bytes;
}

async function writeHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  if (handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    const p = await handle.requestPermission?.({ mode: 'readwrite' });
    if (p !== 'granted') throw new DOMException('Permission to write was not granted', 'NotAllowedError');
  }
  const w = await handle.createWritable();
  await w.write(bytes as unknown as BufferSource);
  await w.close();
}

export async function saveTab(id: number | null = activeId.value): Promise<boolean> {
  const tab = tabs.value.find((t) => t.id === id);
  if (!tab || id == null) return false;
  if (!tab.handle) return saveTabAs(id);
  const bytes = bytesFor(id);
  if (!bytes) return false;
  try {
    await writeHandle(tab.handle, bytes);
    markSaved(id);
    toast(`Saved ${tab.name}`, { kind: 'ok', ms: 1600 });
    return true;
  } catch (e) {
    toast(`Could not save to ${tab.name} (${errName(e) || 'error'}). Use Save As to choose another place.`, { kind: 'error' });
    return false;
  }
}

export async function saveTabAs(id: number | null = activeId.value): Promise<boolean> {
  const tab = tabs.value.find((t) => t.id === id);
  if (!tab || id == null) return false;
  if (window.showSaveFilePicker && !crossOriginFramed) {
    let handle: FileSystemFileHandle | null = null;
    try {
      handle = await window.showSaveFilePicker({ suggestedName: tab.name, id: 'tracepad-save' });
    } catch (e) {
      if (errName(e) === 'AbortError') return false;
    }
    if (handle) {
      const bytes = bytesFor(id);
      if (!bytes) return false;
      try {
        await writeHandle(handle, bytes);
      } catch (e) {
        toast(`Could not save ${handle.name} (${errName(e) || 'error'}).`, { kind: 'error' });
        return false;
      }
      const lang = languageName(handle.name);
      patchTab(id, { handle, name: handle.name, untitled: false, lang });
      setTabLanguage(id, lang);
      markSaved(id);
      toast(`Saved ${handle.name}`, { kind: 'ok', ms: 1600 });
      return true;
    }
  }
  const bytes = bytesFor(id);
  if (!bytes) return false;
  download(bytes, tab.name);
  markSaved(id);
  toast(`Downloaded ${tab.name}. This browser cannot save in place, so check your Downloads folder.`, { kind: 'ok', ms: 5000 });
  return true;
}

function download(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// --------------------------------------------------------------- drag & drop

export function installDrop(): void {
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    dropActive.value = true;
    e.preventDefault();
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) dropActive.value = false;
  });
  window.addEventListener(
    'drop',
    (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      dropActive.value = false;
      // Handles must be requested synchronously, before the event is released.
      const jobs: Promise<void>[] = [];
      for (const item of [...(e.dataTransfer?.items ?? [])]) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        const pending = item.getAsFileSystemHandle?.();
        jobs.push(
          (async () => {
            const h = pending ? await pending.catch(() => null) : null;
            if (h && h.kind === 'file') await openHandle(h as FileSystemFileHandle);
            else if (h && h.kind === 'directory') toast('Folders cannot be opened. Drop files instead.', { kind: 'info' });
            else if (file) await openFile(file);
          })(),
        );
      }
      void Promise.all(jobs);
    },
    true,
  );
}
