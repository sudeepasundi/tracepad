// HTML (from the clipboard) to clean Markdown: headings, lists, emphasis,
// links, code and, above all, tables as aligned pipe tables. The HTML is parsed
// with DOMParser into an inert document: nothing in it runs or loads.
import { toMarkdownTable, type Align } from './tabletext';

const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION', 'DETAILS', 'SUMMARY', 'ADDRESS', 'FORM', 'FIELDSET', 'DL', 'DT', 'DD', 'CENTER']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'CANVAS', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'AUDIO', 'VIDEO']);

const collapse = (s: string) => s.replace(/[ \t\r\n ]+/g, ' ');

function fence(code: string): string {
  let n = 3;
  for (const m of code.matchAll(/`{3,}/g)) n = Math.max(n, m[0].length + 1);
  return '`'.repeat(n);
}

function inlineCode(text: string): string {
  const t = text.replace(/\n/g, ' ');
  const ticks = t.includes('`') ? '``' : '`';
  return `${ticks}${ticks.length > 1 ? ' ' : ''}${t}${ticks.length > 1 ? ' ' : ''}${ticks}`;
}

function safeUrl(href: string | null): string | null {
  if (!href) return null;
  const h = href.trim();
  if (/^(javascript|vbscript|data):/i.test(h) || h.startsWith('#')) return null;
  return h.replace(/\s/g, '%20').replace(/\)/g, '%29');
}

function styleOf(el: Element, prop: string): string {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(el.getAttribute('style') ?? '');
  return m ? m[1].trim().toLowerCase() : '';
}

/** Inline content of a node, as Markdown on one logical line (line breaks become spaces unless `breaks`). */
function inline(node: Node, breaks = false): string {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      out += collapse(child.nodeValue ?? '');
      return;
    }
    if (child.nodeType !== 1) return;
    const el = child as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag)) return;
    if (tag === 'BR') {
      out += breaks ? '\n' : ' ';
      return;
    }
    if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') {
      const t = el.textContent ?? '';
      if (t.trim()) out += inlineCode(t.trim());
      return;
    }
    if (tag === 'IMG') {
      const alt = el.getAttribute('alt') ?? '';
      const src = safeUrl(el.getAttribute('src'));
      if (src) out += `![${alt}](${src})`;
      else if (alt) out += alt;
      return;
    }
    const inner = inline(el, breaks);
    const text = inner.trim();
    if (!text) {
      out += inner ? ' ' : '';
      return;
    }
    const lead = /^\s/.test(inner) ? ' ' : '';
    const tail = /\s$/.test(inner) ? ' ' : '';
    const weight = styleOf(el, 'font-weight');
    const bold = tag === 'B' || tag === 'STRONG' || weight === 'bold' || Number(weight) >= 600;
    const italic = tag === 'I' || tag === 'EM' || styleOf(el, 'font-style') === 'italic';
    const strike = tag === 'S' || tag === 'DEL' || tag === 'STRIKE';
    if (tag === 'A') {
      const href = safeUrl(el.getAttribute('href'));
      out += href && href !== text ? `${lead}[${text}](${href})${tail}` : lead + text + tail;
      return;
    }
    let t = text;
    if (strike) t = `~~${t}~~`;
    if (italic) t = `*${t}*`;
    if (bold) t = `**${t}**`;
    out += lead + t + tail;
  });
  return out;
}

function tableOf(table: Element): string {
  const rows: string[][] = [];
  const aligns: Align[] = [];
  let header = -1;
  table.querySelectorAll('tr').forEach((tr) => {
    // Rows of a nested table belong to that table.
    if (tr.closest('table') !== table) return;
    const cells: string[] = [];
    let allTh = true;
    Array.from(tr.children).forEach((cell) => {
      const tag = cell.tagName.toUpperCase();
      if (tag !== 'TD' && tag !== 'TH') return;
      if (tag !== 'TH') allTh = false;
      const text = inline(cell).replace(/\s+/g, ' ').trim();
      const a = (cell.getAttribute('align') ?? styleOf(cell, 'text-align')).toLowerCase();
      const col = cells.length;
      if ((a === 'right' || a === 'center' || a === 'left') && aligns[col] === undefined && tag === 'TD') aligns[col] = a as Align;
      cells.push(text);
      const span = Math.min(50, Number(cell.getAttribute('colspan')) || 1);
      for (let i = 1; i < span; i++) cells.push('');
    });
    if (!cells.length) return;
    if (header < 0 && (allTh || tr.parentElement?.tagName.toUpperCase() === 'THEAD')) header = rows.length;
    rows.push(cells);
  });
  // Spacer rows and columns (common in spreadsheet HTML) go.
  const kept = rows.filter((r) => r.some((c) => c !== ''));
  if (!kept.length) return '';
  const cols = Math.max(...kept.map((r) => r.length));
  const used = Array.from({ length: cols }, (_, c) => kept.some((r) => (r[c] ?? '') !== ''));
  const data = kept.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? '').filter((_, c) => used[c]));
  if (data[0].length === 1 && data.length === 1) return data[0][0];
  // No header row marked: the first row serves.
  if (header > 0) data.unshift(...data.splice(header, 1));
  // `aligns` has holes for columns that gave no alignment: make it dense before dropping unused columns.
  const dense: Align[] = Array.from({ length: cols }, (_, c) => (aligns[c] === 'left' ? '' : (aligns[c] ?? '')));
  return toMarkdownTable(
    data,
    dense.filter((_, c) => used[c]),
  );
}

function listOf(list: Element, depth: number): string {
  const ordered = list.tagName.toUpperCase() === 'OL';
  let n = Number(list.getAttribute('start')) || 1;
  const lines: string[] = [];
  Array.from(list.children).forEach((li) => {
    if (li.tagName.toUpperCase() !== 'LI') return;
    const marker = ordered ? `${n++}. ` : '- ';
    const indent = '  '.repeat(depth);
    const pad = ' '.repeat(marker.length);
    // Text of the item itself, then nested lists and blocks, indented under it.
    const own = document_.createElement('div');
    const nested: Element[] = [];
    li.childNodes.forEach((c) => {
      const tag = c.nodeType === 1 ? (c as Element).tagName.toUpperCase() : '';
      if (tag === 'UL' || tag === 'OL') nested.push(c as Element);
      else own.appendChild(c.cloneNode(true));
    });
    const body = blocks(own).trim() || '';
    const check = li.querySelector(':scope > input[type="checkbox"]');
    const box = check ? (check.hasAttribute('checked') ? '[x] ' : '[ ] ') : '';
    const first = body.split('\n');
    lines.push(indent + marker + box + (first[0] ?? ''));
    for (const l of first.slice(1)) lines.push(l ? indent + pad + l : '');
    for (const sub of nested) lines.push(listOf(sub, depth + 1));
  });
  return lines.join('\n');
}

let document_: Document;

/** Block-level content of a node as Markdown, blocks separated by blank lines. */
function blocks(node: Node): string {
  const out: string[] = [];
  let run = '';
  const flush = () => {
    // Adjacent inline elements each bring their own edge space.
    const t = run
      .replace(/ {2,}/g, ' ')
      .replace(/ *\n */g, '\n')
      .trim();
    if (t) out.push(t);
    run = '';
  };
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      run += collapse(child.nodeValue ?? '');
      return;
    }
    if (child.nodeType !== 1) return;
    const el = child as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag)) return;
    if (/^H[1-6]$/.test(tag)) {
      flush();
      const t = inline(el).trim();
      if (t) out.push(`${'#'.repeat(Number(tag[1]))} ${t}`);
    } else if (tag === 'TABLE') {
      flush();
      const t = tableOf(el);
      if (t) out.push(t);
    } else if (tag === 'UL' || tag === 'OL') {
      flush();
      const t = listOf(el, 0);
      if (t.trim()) out.push(t);
    } else if (tag === 'PRE') {
      flush();
      const code = (el.textContent ?? '').replace(/\n$/, '');
      const lang = /(?:language|lang)-([\w+#-]+)/.exec(`${el.className} ${el.querySelector('code')?.className ?? ''}`)?.[1] ?? '';
      const f = fence(code);
      out.push(`${f}${lang}\n${code}\n${f}`);
    } else if (tag === 'BLOCKQUOTE') {
      flush();
      const t = blocks(el).trim();
      if (t) out.push(t.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'));
    } else if (tag === 'HR') {
      flush();
      out.push('---');
    } else if (tag === 'BR') {
      run += '\n';
    } else if (BLOCK.has(tag) || tag === 'TBODY' || tag === 'TR' || tag === 'TD' || tag === 'LI') {
      flush();
      const t = blocks(el).trim();
      if (t) out.push(t);
    } else {
      // Inline element (possibly wrapping blocks, as some editors produce).
      if (el.querySelector('table, ul, ol, pre, h1, h2, h3, h4, h5, h6, p, div, blockquote')) {
        flush();
        const t = blocks(el).trim();
        if (t) out.push(t);
      } else {
        const holder = document_.createElement('span');
        holder.appendChild(el.cloneNode(true));
        run += inline(holder, true);
      }
    }
  });
  flush();
  return out.join('\n\n');
}

export interface HtmlInfo {
  hasTable: boolean;
  /** Headings, lists, links, emphasis or code blocks: something Markdown can express. */
  hasStructure: boolean;
  /** Looks like text copied from a code editor (coloured monospace spans): better pasted as plain text. */
  looksLikeCode: boolean;
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

export function inspectHtml(html: string): HtmlInfo {
  const doc = parse(html);
  const body = doc.body;
  const hasTable = !!body.querySelector('table tr td, table tr th');
  const hasStructure = !!body.querySelector('h1, h2, h3, h4, h5, h6, ul, ol, a[href], b, strong, em, i, pre, code, blockquote');
  const mono = /mono|consolas|courier|menlo|fira code|cascadia|source code/i;
  const first = body.querySelector('div, pre, span');
  const looksLikeCode = !hasTable && !!first && (mono.test(first.getAttribute('style') ?? '') || (first.tagName === 'PRE' && body.children.length === 1) || /white-space:\s*pre/i.test(first.getAttribute('style') ?? ''));
  return { hasTable, hasStructure, looksLikeCode };
}

/** Converts clipboard HTML to Markdown. */
export function htmlToMarkdown(html: string): string {
  const doc = parse(html);
  document_ = doc;
  return blocks(doc.body)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
