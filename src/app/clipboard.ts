// One way to put things on the clipboard, for every Copy button.
//
// The asynchronous Clipboard API is refused in many of the places Tracepad
// runs: inside a cross-origin frame, on managed browsers where the clipboard
// permission is switched off by policy, and when the document is not focused.
// The older copy command needs no permission (only a click or key press), so
// it is tried first; the asynchronous API is the second attempt.

export interface ClipboardContent {
  text: string;
  /** Rich version (tables, formatting) for Excel, Outlook, Teams and Word. */
  html?: string;
}

function copyByCommand(content: ClipboardContent): boolean {
  let filled = false;
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return;
    e.clipboardData.setData('text/plain', content.text);
    if (content.html) e.clipboardData.setData('text/html', content.html);
    e.preventDefault();
    e.stopImmediatePropagation();
    filled = true;
  };
  // Some browsers only fire the copy event when something is selected.
  const holder = document.createElement('span');
  holder.textContent = ' ';
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;user-select:text;white-space:pre';
  const selection = window.getSelection();
  const saved = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
  const focused = document.activeElement as HTMLElement | null;
  let ok = false;
  document.addEventListener('copy', onCopy, true);
  try {
    document.body.appendChild(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    selection?.removeAllRanges();
    selection?.addRange(range);
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    document.removeEventListener('copy', onCopy, true);
    selection?.removeAllRanges();
    if (saved) selection?.addRange(saved);
    holder.remove();
    if (focused && document.activeElement !== focused) focused.focus?.({ preventScroll: true });
  }
  return ok && filled;
}

async function copyByApi(content: ClipboardContent): Promise<boolean> {
  try {
    if (content.html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([content.html], { type: 'text/html' }), 'text/plain': new Blob([content.text], { type: 'text/plain' }) })]);
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content.text);
      return true;
    }
  } catch {
    /* refused: report false */
  }
  return false;
}

/** Copies text (and optionally a rich HTML version). Resolves to false when the browser refuses both ways. */
export async function copyToClipboard(content: ClipboardContent): Promise<boolean> {
  return copyByCommand(content) || (await copyByApi(content));
}
