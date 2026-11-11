// Tables that survive pasting. HTML on the clipboard (an AI chat, a web page,
// Excel) becomes Markdown with aligned pipe tables; tab-, comma- and
// space-separated text becomes a table too. Ordinary prose and code are left
// exactly as they are.
import { undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { getView } from '../editor/editor';
import { htmlToMarkdown, inspectHtml } from '../engine/htmlmd';
import { textToMarkdownTable } from '../engine/tabletext';
import { toast } from './feedback';
import { onPaste } from './paste';
import { settings } from './settings';
import { activeTab } from './state';

/** Languages where pasted tables and rich text are converted. Code, logs and CSV files are not touched. */
const TEXTUAL = new Set(['Markdown', 'Plain text']);

/** What to insert instead of the plain text, or null to let the paste through unchanged. */
export function convertPaste(lang: string, html: string, text: string): string | null {
  if (!TEXTUAL.has(lang)) return null;
  if (html) {
    const info = inspectHtml(html);
    if (!info.looksLikeCode && (info.hasTable || (lang === 'Markdown' && info.hasStructure))) {
      const out = htmlToMarkdown(html);
      if (out.trim() && out.trim() !== text.trim()) return out;
    }
  }
  return textToMarkdownTable(text);
}

function insert(view: EditorView, from: number, to: number, markdown: string, original: string): void {
  const doc = view.state.doc;
  const line = doc.lineAt(from);
  // A table needs to start on its own line, and be followed by one.
  const block = /^(\||#|- |\d+\. |```|>)/.test(markdown);
  const before = block && from > line.from ? (doc.sliceString(line.from, from).trim() ? '\n\n' : '\n') : '';
  const after = block && to < doc.length && doc.sliceString(to, to + 1) !== '\n' ? '\n' : '';
  const text = before + markdown + after;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length - after.length }, userEvent: 'input.paste', scrollIntoView: true });
  toast(markdown.includes('\n| ') || markdown.startsWith('| ') ? 'Pasted as a Markdown table.' : 'Pasted as Markdown.', {
    ms: 6000,
    action: {
      label: 'Paste plain text instead',
      run: () => {
        undo(view);
        const sel = view.state.selection.main;
        // Windows clipboards carry CR LF; the document counts a line break as one character.
        const plain = original.replace(/\r\n?/g, '\n');
        view.dispatch({ changes: { from: sel.from, to: sel.to, insert: plain }, selection: { anchor: sel.from + plain.length }, userEvent: 'input.paste' });
        view.focus();
      },
    },
  });
}

export function installPasteTables(): void {
  onPaste((e) => {
    if (!settings.value.pasteTables || !e.clipboardData) return false;
    const target = e.target as Element | null;
    if (!target?.closest?.('.cm-content')) return false;
    const tab = activeTab.value;
    if (!tab || tab.big || tab.locked) return false;
    const text = e.clipboardData.getData('text/plain');
    const markdown = convertPaste(tab.lang, e.clipboardData.getData('text/html'), text);
    if (markdown === null) return false;
    const view = getView();
    const sel = view.state.selection.main;
    insert(view, sel.from, sel.to, markdown, text);
    return true;
  });
}

/**
 * Some phone keyboards insert clipboard text as ordinary input, with no paste
 * event. A burst of text arriving in one go that parses as a table is treated
 * the same way as a paste.
 */
export const pasteBurst = EditorView.inputHandler.of((view, from, to, text) => {
  if (!settings.value.pasteTables || text.length < 16 || !/[\t\n]|\S {2,}\S/.test(text)) return false;
  const tab = activeTab.value;
  if (!tab || !TEXTUAL.has(tab.lang)) return false;
  const markdown = textToMarkdownTable(text);
  if (markdown === null) return false;
  insert(view, from, to, markdown, text);
  return true;
});
