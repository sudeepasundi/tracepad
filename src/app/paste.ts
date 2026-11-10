// Paste capture. This module is imported before anything that creates an editor,
// so our capture-phase listener is registered first and the editor cannot swallow
// the event before we have looked at it. Handlers are added by later features
// (table conversion); with none registered the event passes through untouched.

export type PasteHandler = (e: ClipboardEvent) => boolean;

const handlers: PasteHandler[] = [];

export function onPaste(handler: PasteHandler): () => void {
  handlers.push(handler);
  return () => {
    const i = handlers.indexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

document.addEventListener(
  'paste',
  (e) => {
    for (const h of handlers) {
      let handled = false;
      try {
        handled = h(e);
      } catch (err) {
        console.error(err);
      }
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
    }
  },
  true,
);
