// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, inspectHtml } from '../../src/engine/htmlmd';

describe('tables', () => {
  it('an AI-chat table becomes an aligned pipe table, units and all', () => {
    const html = `<div class="markdown"><p>Here is the summary:</p>
      <table><thead><tr><th>Endpoint</th><th>Requests</th><th>Avg Response (ms)</th><th>Errors</th></tr></thead>
      <tbody><tr><td><code>/api/orders</code></td><td>1,204</td><td>84</td><td>3</td></tr>
      <tr><td><code>/api/orders/{id}</code></td><td>9,310</td><td>41</td><td>0</td></tr></tbody></table>
      <p>Let me know if you want <strong>p95</strong> too.</p></div>`;
    expect(htmlToMarkdown(html)).toBe(
      [
        'Here is the summary:',
        '',
        '| Endpoint           | Requests | Avg Response (ms) | Errors |',
        '| ------------------ | -------: | ----------------: | -----: |',
        '| `/api/orders`      |    1,204 |                84 |      3 |',
        '| `/api/orders/{id}` |    9,310 |                41 |      0 |',
        '',
        'Let me know if you want **p95** too.',
      ].join('\n'),
    );
  });

  it('Excel HTML: styles, spacer cells and no header markup', () => {
    const html = `<html><head><style>td{mso-number-format:General}</style></head><body><table border=0 cellpadding=0><col width=64>
      <tr height=20><td height=20 style='height:15pt'>Service</td><td align=right>Calls</td><td></td></tr>
      <tr><td>orders</td><td align=right>12</td><td></td></tr><tr><td>stock</td><td align=right>7</td><td></td></tr></table></body></html>`;
    expect(htmlToMarkdown(html)).toBe(['| Service | Calls |', '| ------- | ----: |', '| orders  |    12 |', '| stock   |     7 |'].join('\n'));
  });

  it('pipes in cells are escaped, line breaks flattened, colspan filled, nested tables kept apart', () => {
    const html = '<table><tr><th>a</th><th>b</th><th>c</th></tr><tr><td colspan="2">x | y<br>z</td><td><table><tr><td>inner</td></tr></table></td></tr></table>';
    const md = htmlToMarkdown(html);
    expect(md.split('\n')[2]).toContain('x \\| y z');
    expect(md.split('\n')).toHaveLength(3);
    expect(md).not.toMatch(/\| inner \|\n\|/);
  });

  it('keeps explicit alignment and emphasis inside cells', () => {
    const md = htmlToMarkdown('<table><tr><th>k</th><th>v</th></tr><tr><td style="text-align:center"><b>bold</b></td><td><a href="https://example.com/x">link</a></td></tr></table>');
    expect(md.split('\n')[1]).toMatch(/^\| :-+: \| -+ \|$/);
    expect(md).toContain('**bold**');
    expect(md).toContain('[link](https://example.com/x)');
  });
});

describe('everything else', () => {
  it('headings, paragraphs, emphasis, links and inline code', () => {
    const html = '<h2>Root cause</h2><p>The <em>pool</em> was <strong>exhausted</strong> after <code>5003ms</code>; see <a href="https://example.com/runbook">the runbook</a>.</p><h3>Next</h3><p>Retry<br>later</p>';
    expect(htmlToMarkdown(html)).toBe(['## Root cause', '', 'The *pool* was **exhausted** after `5003ms`; see [the runbook](https://example.com/runbook).', '', '### Next', '', 'Retry\nlater'].join('\n'));
  });

  it('lists: nested, ordered, with task boxes', () => {
    const html = '<ul><li>one</li><li>two<ul><li>two a</li><li>two b</li></ul></li></ul><ol start="3"><li>third</li><li>fourth</li></ol><ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>';
    expect(htmlToMarkdown(html)).toBe(['- one', '- two', '  - two a', '  - two b', '', '3. third', '4. fourth', '', '- [x] done', '- [ ] todo'].join('\n'));
  });

  it('code blocks keep their text exactly, with the language', () => {
    const html = '<pre><code class="language-java">if (a &lt; b) {\n    return "x | y";\n}\n</code></pre>';
    expect(htmlToMarkdown(html)).toBe('```java\nif (a < b) {\n    return "x | y";\n}\n```');
    expect(htmlToMarkdown('<pre>has ``` inside</pre>')).toBe('````\nhas ``` inside\n````');
  });

  it('block quotes and rules', () => {
    expect(htmlToMarkdown('<blockquote><p>first</p><p>second</p></blockquote><hr><p>after</p>')).toBe('> first\n>\n> second\n\n---\n\nafter');
  });

  it('drops scripts, styles, buttons and unsafe links; nothing runs', () => {
    const md = htmlToMarkdown('<p>ok<script>window.__ran = true</script><style>p{color:red}</style><button>Copy</button></p><p><a href="javascript:alert(1)">click</a> <img src="x" onerror="window.__ran = true" alt="pic"></p>');
    expect(md).toBe('ok\n\nclick ![pic](x)');
    expect((globalThis as unknown as { __ran?: boolean }).__ran).toBeUndefined();
  });

  it('collapses the whitespace of source HTML and non-breaking spaces', () => {
    expect(htmlToMarkdown('<div>\n   <span>hello</span>\n   <span>&nbsp;world</span>\n</div>\n<div>next</div>')).toBe('hello world\n\nnext');
  });

  it('bold and italic given by style (Google Docs, Word)', () => {
    expect(htmlToMarkdown('<p><span style="font-weight:700">Strong</span> and <span style="font-style:italic">slanted</span> and <span style="font-weight:400">plain</span></p>')).toBe('**Strong** and *slanted* and plain');
  });
});

describe('inspectHtml', () => {
  it('spots tables, structure and code-editor HTML', () => {
    expect(inspectHtml('<table><tr><td>a</td></tr></table>')).toMatchObject({ hasTable: true });
    expect(inspectHtml('<p>plain words</p>')).toEqual({ hasTable: false, hasStructure: false, looksLikeCode: false });
    expect(inspectHtml('<h1>t</h1><ul><li>x</li></ul>')).toMatchObject({ hasTable: false, hasStructure: true });
    const vscode = '<meta charset="utf-8"><div style="color: #d4d4d4;background-color: #1e1e1e;font-family: Consolas, \'Courier New\', monospace;font-size: 14px;white-space: pre;"><div><span style="color: #569cd6;">public</span> <span>class</span> A {}</div></div>';
    expect(inspectHtml(vscode).looksLikeCode).toBe(true);
    expect(inspectHtml('<pre>raw text</pre>').looksLikeCode).toBe(true);
  });
});
