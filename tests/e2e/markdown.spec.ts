// Tables that survive pasting, and the Markdown preview (0.6). Both builds.
import { expect, test, type Page } from '@playwright/test';
import { box, contrastOf, docText, editor, openApp, openViaChooser, overlaps, useBasicFilePickers } from './helpers';

const HTML_TABLE = `<meta charset="utf-8"><p>Here are the slow endpoints:</p>
<table><thead><tr><th>Endpoint</th><th>Calls</th><th>p95 (ms)</th></tr></thead>
<tbody><tr><td>/api/orders</td><td align="right">1200</td><td align="right">340</td></tr>
<tr><td>/api/billing/run</td><td align="right">87</td><td align="right">1210</td></tr></tbody></table>`;
const HTML_PLAIN = 'Here are the slow endpoints:\n\nEndpoint\tCalls\tp95 (ms)\n/api/orders\t1200\t340\n/api/billing/run\t87\t1210';

const sections = Array.from({ length: 40 }, (_, i) => `## Section ${i + 1}\n\nParagraph ${i + 1} explains what happened in step ${i + 1} of the incident, in enough words to fill a line or two.\n`).join('\n');
const NOTES = `# Incident notes

Some **bold** text, a [link](https://example.com/page) and \`inline code\`.

| Service | Calls | p95 (ms) | Owner team |
| --- | ---: | ---: | --- |
| orders | 1200 | 340 | Core platform |
| billing | 87 | 1210 | Payments |
| search | 45000 | 95 | Discovery |

- [x] restart the worker
- [ ] write the report

<script>window.hacked = 1</script>

<img src="x" onerror="window.hacked = 1">

[bad link](javascript:window.hacked=1)

![remote picture](https://example.com/a.png)

| Key | Value |
| --- | --- |
| region | eu-west-1 |
| pods | 12 |

${sections}`;

async function setClipboard(page: Page, text: string, html?: string): Promise<void> {
  await page.evaluate(
    async ([t, h]) => {
      const items: Record<string, Blob> = { 'text/plain': new Blob([t!], { type: 'text/plain' }) };
      if (h) items['text/html'] = new Blob([h], { type: 'text/html' });
      await navigator.clipboard.write([new ClipboardItem(items)]);
    },
    [text, html ?? null] as const,
  );
}

async function paste(page: Page, text: string, html?: string): Promise<void> {
  // An empty tab shows the welcome card over the editor: focus instead of clicking.
  await editor(page).focus();
  await setClipboard(page, text, html);
  await page.keyboard.press('Control+V');
}

const openMd = (page: Page, name = 'notes.md', text = NOTES) => openViaChooser(page, [{ name, mimeType: 'text/plain', buffer: Buffer.from(text) }]);
const preview = (page: Page) => page.locator('.tp-preview');
const cells = (page: Page, table: number, col: number) =>
  page
    .locator('.tp-md table')
    .nth(table)
    .locator('tbody tr')
    .evaluateAll((rows, c) => rows.map((r) => r.children[c].textContent ?? ''), col);

async function openPreview(page: Page): Promise<void> {
  await openMd(page);
  await expect(page.getByRole('tab', { name: /notes\.md/ })).toBeVisible();
  await editor(page).click();
  await page.keyboard.press('Alt+P');
  await expect(preview(page)).toBeVisible();
  await expect(page.locator('.tp-md h1')).toHaveText('Incident notes');
}

test.beforeEach(async ({ page }) => {
  await useBasicFilePickers(page);
  await openApp(page);
});

test.describe('pasting', () => {
  test('a table copied from a web page becomes an aligned Markdown table', async ({ page }) => {
    await paste(page, HTML_PLAIN, HTML_TABLE);
    await expect.poll(() => docText(page)).toContain('| Endpoint');
    const lines = (await docText(page)).split('\n');
    expect(lines[0]).toBe('Here are the slow endpoints:');
    const table = lines.filter((l) => l.startsWith('|'));
    expect(table).toHaveLength(4);
    expect(table[0]).toMatch(/^\| Endpoint +\| +Calls \| +p95 \(ms\) \|$/);
    expect(table[1]).toMatch(/^\| -+ \| -+: \| -+: \|$/);
    expect(table[3]).toMatch(/^\| \/api\/billing\/run \| +87 \| +1210 \|$/);
    // Aligned: every row is the same length.
    expect(new Set(table.map((l) => l.length)).size).toBe(1);
    await expect(page.locator('.tp-toast')).toContainText('Pasted as');
  });

  test('"Paste plain text instead" puts back exactly what was on the clipboard', async ({ page }) => {
    await paste(page, HTML_PLAIN, HTML_TABLE);
    await expect.poll(() => docText(page)).toContain('| Endpoint');
    await page.getByRole('button', { name: 'Paste plain text instead' }).click();
    await expect.poll(async () => (await docText(page)).replace(/\r/g, '')).toBe(HTML_PLAIN);
  });

  test('tab-separated text with "(ms)" and multi-word headers becomes a table', async ({ page }) => {
    await paste(page, 'Service name\tDuration (ms)\tStatus\norder service\t340\tOK\nbilling run\t1210\tFAILED\n');
    await expect.poll(() => docText(page)).toContain('| Service name');
    const text = await docText(page);
    expect(text).toContain('Duration (ms) |');
    expect(text).toMatch(/\| order service \| +340 \| OK +\|/);
  });

  test('comma-separated and space-aligned text become tables', async ({ page }) => {
    await paste(page, 'id,name,total\n1,"Smith, Ann",10.50\n2,Bob,7\n');
    await expect.poll(() => docText(page)).toContain('| Smith, Ann |');
    await page.keyboard.press('Control+A');
    await paste(page, 'NAME            READY   STATUS    RESTARTS\norders-7d9f     1/1     Running   0\nbilling-5c2a    0/1     Error     14\n');
    await expect.poll(() => docText(page)).toContain('| billing-5c2a |');
    expect(await docText(page)).toMatch(/\| NAME +\| READY \| STATUS +\| +RESTARTS \|/);
  });

  test('ordinary prose, and prose with commas, is pasted untouched', async ({ page }) => {
    const prose = 'First, we restarted the pod. Then, after a while, it failed again.\nSecond, the queue filled up, slowly, over an hour.\nNothing else changed.';
    await paste(page, prose, `<p>${prose.replace(/\n/g, '</p><p>')}</p>`);
    await expect.poll(async () => (await docText(page)).replace(/\r/g, '')).toBe(prose);
    await expect(page.locator('.tp-toast')).toHaveCount(0);
  });

  test('code and CSV files are never converted', async ({ page }) => {
    await openViaChooser(page, [{ name: 'Main.java', mimeType: 'text/plain', buffer: Buffer.from('') }]);
    await expect(page.getByRole('tab', { name: /Main\.java/ })).toBeVisible();
    await paste(page, HTML_PLAIN, HTML_TABLE);
    await expect.poll(async () => (await docText(page)).replace(/\r/g, '')).toBe(HTML_PLAIN);
    await openViaChooser(page, [{ name: 'data.csv', mimeType: 'text/plain', buffer: Buffer.from('') }]);
    await expect(page.getByRole('tab', { name: /data\.csv/ })).toBeVisible();
    await paste(page, 'a,b,c\n1,2,3\n4,5,6\n');
    await expect.poll(async () => (await docText(page)).replace(/\r/g, '')).toBe('a,b,c\n1,2,3\n4,5,6\n');
  });

  test('the Appearance switch turns conversion off', async ({ page }) => {
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('switch', { name: 'Convert pasted tables' }).click();
    await expect(page.getByRole('switch', { name: 'Convert pasted tables' })).toHaveAttribute('aria-checked', 'false');
    await paste(page, HTML_PLAIN, HTML_TABLE);
    await expect.poll(async () => (await docText(page)).replace(/\r/g, '')).toBe(HTML_PLAIN);
  });

  test('rich text pasted into a Markdown tab keeps headings, lists and links', async ({ page }) => {
    await openMd(page, 'empty.md', '');
    await expect(page.getByRole('tab', { name: /empty\.md/ })).toBeVisible();
    await paste(page, 'Plan\nfirst\nsecond\nsee docs', '<h2>Plan</h2><ul><li>first</li><li><b>second</b></li></ul><p>see <a href="https://example.com/docs">docs</a></p>');
    await expect.poll(() => docText(page)).toContain('## Plan');
    const text = await docText(page);
    expect(text).toContain('- first\n- **second**');
    expect(text).toContain('[docs](https://example.com/docs)');
  });
});

test.describe('preview', () => {
  test('Alt+P shows and hides it; the button in the top bar does the same', async ({ page }) => {
    await openPreview(page);
    await expect(page.locator('.tp-preview-name')).toHaveText('notes.md');
    await page.keyboard.press('Alt+P');
    await expect(preview(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Toggle preview' }).click();
    await expect(preview(page)).toBeVisible();
    await page.getByRole('button', { name: 'Close preview' }).click();
    await expect(preview(page)).toHaveCount(0);
  });

  test('it is safe: no scripts, no handlers, no script links, no remote images', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await openPreview(page);
    await expect(page.locator('.tp-md table')).toHaveCount(2);
    const facts = await page.evaluate(() => {
      const md = document.querySelector('.tp-md')!;
      return {
        hacked: (window as unknown as { hacked?: number }).hacked,
        scripts: md.querySelectorAll('script').length,
        handlers: Array.from(md.querySelectorAll('*')).filter((el) => Array.from(el.attributes).some((a) => a.name.startsWith('on'))).length,
        images: md.querySelectorAll('img').length,
        hrefs: Array.from(md.querySelectorAll('a')).map((a) => a.getAttribute('href')),
        rels: Array.from(md.querySelectorAll('a')).map((a) => a.getAttribute('rel')),
        text: md.textContent ?? '',
      };
    });
    expect(facts.hacked).toBeUndefined();
    expect(facts.scripts).toBe(0);
    expect(facts.handlers).toBe(0);
    expect(facts.images).toBe(0);
    expect(facts.hrefs).toEqual(['https://example.com/page']);
    expect(facts.rels).toEqual(['noopener noreferrer']);
    // Raw HTML is shown as text, and the remote image as a note.
    expect(facts.text).toContain('<script>window.hacked = 1</script>');
    expect(facts.text).toContain('[image: remote picture]');
    expect(requests.filter((u) => u.includes('example.com'))).toEqual([]);
  });

  test('it follows typing', async ({ page }) => {
    await openPreview(page);
    await editor(page).click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('End');
    await page.keyboard.type(' for Tuesday');
    await expect(page.locator('.tp-md h1')).toHaveText('Incident notes for Tuesday');
  });

  test('clicking a header sorts: up, down, then document order; numbers sort as numbers', async ({ page }) => {
    await openPreview(page);
    const th = page.locator('.tp-md table').first().locator('th', { hasText: 'Calls' });
    expect(await cells(page, 0, 1)).toEqual(['1200', '87', '45000']);
    await th.click();
    await expect(th).toHaveAttribute('aria-sort', 'ascending');
    expect(await cells(page, 0, 1)).toEqual(['87', '1200', '45000']);
    await th.click();
    expect(await cells(page, 0, 1)).toEqual(['45000', '1200', '87']);
    await th.click();
    await expect(th).toHaveAttribute('aria-sort', 'none');
    expect(await cells(page, 0, 1)).toEqual(['1200', '87', '45000']);
    await page.locator('.tp-md table').first().locator('th', { hasText: 'Service' }).click();
    expect(await cells(page, 0, 0)).toEqual(['billing', 'orders', 'search']);
  });

  test('"Copy table" and "Copy as rich text" put a real table on the clipboard', async ({ page }) => {
    await openPreview(page);
    await page.locator('.tp-md-tablebox').first().getByRole('button', { name: 'Copy table' }).click();
    await expect(page.locator('.tp-toast')).toContainText('Copied the table');
    const read = () =>
      page.evaluate(async () => {
        const item = (await navigator.clipboard.read())[0];
        return { html: await (await item.getType('text/html')).text(), text: (await (await item.getType('text/plain')).text()).replace(/\r/g, '') };
      });
    let clip = await read();
    expect(clip.text).toBe('Service\tCalls\tp95 (ms)\tOwner team\norders\t1200\t340\tCore platform\nbilling\t87\t1210\tPayments\nsearch\t45000\t95\tDiscovery');
    expect(clip.html).toContain('<table');
    expect(clip.html).toContain('border:1px solid');
    expect(clip.html).not.toContain('Copy table');
    await page.getByRole('button', { name: 'Copy as rich text' }).click();
    await expect(page.locator('.tp-toast').last()).toContainText('Copied as rich text');
    clip = await read();
    expect(clip.html).toContain('<h1>Incident notes</h1>');
    expect(clip.html).toContain('<table');
    expect(clip.html).not.toContain('Edit as table');
    expect(clip.html).not.toContain('data-line');
    expect(clip.text).toContain('# Incident notes');
  });

  test('"Edit as table" rewrites that table, aligned, and can be undone in one step', async ({ page }) => {
    await openPreview(page);
    await page.locator('.tp-md-tablebox').nth(1).getByRole('button', { name: 'Edit as table' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit table' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Header 1' })).toBeFocused();
    await expect(dialog.getByRole('textbox', { name: 'Row 1, column 2' })).toHaveValue('eu-west-1');
    await dialog.getByRole('textbox', { name: 'Row 1, column 2' }).fill('ap-southeast-2 (Sydney)');
    await dialog.getByRole('button', { name: 'Add row' }).click();
    await dialog.getByRole('textbox', { name: 'Row 3, column 1' }).fill('nodes');
    await dialog.getByRole('textbox', { name: 'Row 3, column 2' }).fill('4');
    await dialog.getByRole('button', { name: 'Save table' }).click();
    await expect(dialog).toHaveCount(0);
    const text = await docText(page);
    expect(text).toContain('| Key    | Value                   |\n| ------ | ----------------------- |\n| region | ap-southeast-2 (Sydney) |\n| pods   | 12                      |\n| nodes  | 4                       |');
    // The other table and the text around are untouched.
    expect(text).toContain('| orders | 1200 | 340 | Core platform |');
    expect(text).toContain('## Section 1\n');
    await expect(page.locator('.tp-md table').nth(1).locator('tbody tr')).toHaveCount(3);
    await editor(page).click();
    await page.keyboard.press('Control+Z');
    await expect.poll(() => docText(page)).toBe(NOTES);
  });

  test('Escape closes the table editor without changing anything', async ({ page }) => {
    await openPreview(page);
    await page.locator('.tp-md-tablebox').first().getByRole('button', { name: 'Edit as table' }).click();
    await page.getByRole('textbox', { name: 'Row 1, column 1' }).fill('changed');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Edit table' })).toHaveCount(0);
    await expect(preview(page)).toBeVisible();
    expect(await docText(page)).toBe(NOTES);
  });

  test('scrolling either side moves the other to the same place', async ({ page }) => {
    await openPreview(page);
    const sync = () =>
      page.evaluate(() => {
        const sc = document.querySelector('.tp-preview-scroll')!;
        const top = sc.getBoundingClientRect().top;
        const heads = Array.from(sc.querySelectorAll('h1, h2'));
        const shown = heads.filter((h) => h.getBoundingClientRect().top <= top + 60).pop();
        const ed = document.querySelector('.cm-scroller')!;
        const edTop = ed.getBoundingClientRect().top;
        const line = Array.from(ed.querySelectorAll('.cm-line')).find((l) => l.getBoundingClientRect().bottom > edTop + 2);
        return { preview: shown?.textContent ?? '', previewTop: sc.scrollTop, previewMax: sc.scrollHeight - sc.clientHeight, editorLine: line?.textContent ?? '', editorTop: ed.scrollTop, editorMax: ed.scrollHeight - ed.clientHeight };
      });
    // Editor to the end: preview at its end.
    await page.locator('.cm-scroller').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect.poll(async () => (await sync()).previewMax - (await sync()).previewTop).toBeLessThan(3);
    // Preview to a heading: the editor shows the same heading at its top.
    await page.waitForTimeout(200);
    await page.locator('.tp-preview-scroll').evaluate((sc) => {
      const h = Array.from(sc.querySelectorAll('h2')).find((x) => x.textContent === 'Section 20')!;
      sc.scrollTop += h.getBoundingClientRect().top - sc.getBoundingClientRect().top;
    });
    await expect.poll(async () => (await sync()).editorLine).toMatch(/^(## Section 20|)$/);
    const s = await sync();
    expect(s.editorTop).toBeGreaterThan(100);
    expect(s.editorTop).toBeLessThan(s.editorMax - 100);
    // Editor to a heading: the preview has that heading at its top.
    await page.waitForTimeout(200);
    await page.evaluate(() => (window as unknown as { __tracepad: { scrollEditor(n: number): void } }).__tracepad.scrollEditor(0));
    await expect.poll(async () => (await sync()).previewTop).toBe(0);
  });

  test('dragging its edge resizes between 20% and 85%, double-click resets, and the width is remembered', async ({ page }) => {
    await openPreview(page);
    const area = await box(page.locator('.tp-editor-area'));
    const share = async () => (await box(preview(page))).width / area.width;
    expect(await share()).toBeCloseTo(0.5, 1);
    const handle = page.getByRole('separator', { name: 'Resize preview' });
    const drag = async (toX: number) => {
      const h = await box(handle);
      await page.mouse.move(h.x + h.width / 2, h.y + 200);
      await page.mouse.down();
      await page.mouse.move(toX, h.y + 220, { steps: 6 });
      await page.mouse.up();
    };
    await drag(area.x + area.width * 0.3);
    expect(await share()).toBeCloseTo(0.7, 1);
    await drag(area.x + area.width - 20);
    expect(await share()).toBeCloseTo(0.2, 2);
    await drag(area.x + 5);
    expect(await share()).toBeCloseTo(0.85, 2);
    // The editor keeps the rest and neither side is covered.
    const pane = await box(page.locator('.tp-editor-pane'));
    expect(pane.width).toBeGreaterThan(area.width * 0.14);
    expect(overlaps(pane, await box(preview(page)))).toBe(false);
    await drag(area.x + area.width * 0.4);
    expect(await share()).toBeCloseTo(0.6, 1);
    await page.reload();
    await expect(page.locator('html[data-ready="true"]')).toBeAttached();
    await editor(page).click();
    await page.keyboard.press('Alt+P');
    await expect(preview(page)).toBeVisible();
    expect(await share()).toBeCloseTo(0.6, 1);
    await handle.dblclick();
    expect(await share()).toBeCloseTo(0.5, 2);
  });
});

test.describe('preview appearance', () => {
  test('side by side: full height, scrollbar at its right edge, text column centred, nothing clipped', async ({ page }) => {
    await openPreview(page);
    const area = await box(page.locator('.tp-editor-area'));
    const p = await box(preview(page));
    const sc = await box(page.locator('.tp-preview-scroll'));
    const head = await box(page.locator('.tp-preview-head'));
    expect(p.y).toBeCloseTo(area.y, 0);
    expect(p.height).toBeCloseTo(area.height, 0);
    expect(p.x + p.width).toBeCloseTo(area.x + area.width, 0);
    // The scroller spans the preview: its scrollbar is at the outer edge and there is no dead band.
    expect(sc.width).toBeGreaterThan(p.width - 2);
    expect(sc.y).toBeCloseTo(head.y + head.height, 0);
    expect(sc.y + sc.height).toBeCloseTo(p.y + p.height, 0);
    const m = await page.locator('.tp-preview-scroll').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight }));
    expect(m.sw).toBeLessThanOrEqual(m.cw);
    expect(m.sh).toBeGreaterThan(m.ch);
    const doc = await box(page.locator('.tp-md'));
    expect(Math.abs(doc.x - sc.x - (sc.x + m.cw - (doc.x + doc.width)))).toBeLessThan(2);
    // Header buttons sit inside the header, in order, without touching.
    const buttons = await Promise.all((await page.locator('.tp-preview-actions button').all()).map(box));
    for (const [i, b] of buttons.entries()) {
      expect(b.x + b.width).toBeLessThanOrEqual(head.x + head.width);
      expect(b.y).toBeGreaterThanOrEqual(head.y);
      expect(b.y + b.height).toBeLessThanOrEqual(head.y + head.height + 0.5);
      if (i) expect(overlaps(buttons[i - 1], b)).toBe(false);
    }
    expect(overlaps(await box(page.locator('.tp-preview-title')), buttons[0])).toBe(false);
  });

  test('each table has its buttons at its own top-right corner', async ({ page }) => {
    await openPreview(page);
    for (const tb of await page.locator('.tp-md-tablebox').all()) {
      const table = await box(tb.locator('.tp-md-tablescroll'));
      const tools = await Promise.all((await tb.locator('.tp-md-tool').all()).map(box));
      expect(tools).toHaveLength(2);
      const last = tools[1];
      expect(Math.abs(last.x + last.width - (table.x + table.width))).toBeLessThan(2);
      expect(last.y + last.height).toBeLessThanOrEqual(table.y);
      expect(table.y - (last.y + last.height)).toBeLessThan(10);
      expect(overlaps(tools[0], tools[1])).toBe(false);
      expect(tools[0].x).toBeGreaterThanOrEqual(table.x - 1);
    }
    // The two tables have different widths, so their buttons are in different places.
    const rights = await page.locator('.tp-md-tablebox').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
    expect(Math.abs(rights[0] - rights[1])).toBeGreaterThan(20);
  });

  for (const theme of ['midnight', 'paper']) {
    test(`text is readable in ${theme}`, async ({ page }) => {
      await page.evaluate((t) => {
        const s = JSON.parse(localStorage.getItem('tracepad.settings') ?? '{}');
        localStorage.setItem('tracepad.settings', JSON.stringify({ ...s, theme: t }));
      }, theme);
      await page.reload();
      await expect(page.locator('html[data-ready="true"]')).toBeAttached();
      await openPreview(page);
      for (const sel of ['.tp-md h1', '.tp-md p', '.tp-md th', '.tp-md td', '.tp-md a', '.tp-md code', '.tp-md-tool', '.tp-preview-kind', '.tp-preview-name', '.tp-md-img', '.tp-md blockquote, .tp-md li']) {
        expect(await contrastOf(page.locator(sel).first()), sel).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  test('full screen at 1920: wide centred column, large text, wide tables, scrollbar at the screen edge', async ({ page }) => {
    await openPreview(page);
    const before = await page.locator('.tp-md p').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    await page.keyboard.press('Alt+Shift+P');
    await expect(preview(page)).toHaveClass(/is-fullscreen/);
    const vw = page.viewportSize()!;
    const p = await box(preview(page));
    expect(p).toEqual({ x: 0, y: 0, width: vw.width, height: vw.height });
    await expect(page.locator('.tp-preview-name')).toHaveText('notes.md');
    const sc = await box(page.locator('.tp-preview-scroll'));
    expect(sc.x).toBe(0);
    expect(sc.width).toBe(vw.width);
    expect(sc.y + sc.height).toBe(vw.height);
    const doc = await box(page.locator('.tp-md'));
    expect(doc.width).toBeGreaterThanOrEqual(1400);
    expect(doc.width).toBeLessThanOrEqual(1440);
    const clientW = await page.locator('.tp-preview-scroll').evaluate((el) => el.clientWidth);
    expect(Math.abs(doc.x - (clientW - (doc.x + doc.width)))).toBeLessThan(2);
    // The column uses three quarters of the screen: no huge empty band.
    expect(doc.width / vw.width).toBeGreaterThan(0.7);
    const after = await page.locator('.tp-md p').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(after).toBeGreaterThanOrEqual(16);
    expect(after).toBeGreaterThan(before);
    for (const t of await page.locator('.tp-md table').all()) expect((await box(t)).width).toBeGreaterThanOrEqual(980);
    // Buttons still at their own table's corner.
    const tb = page.locator('.tp-md-tablebox').nth(1);
    const table = await box(tb.locator('.tp-md-tablescroll'));
    const tool = await box(tb.locator('.tp-md-tool').last());
    expect(Math.abs(tool.x + tool.width - (table.x + table.width))).toBeLessThan(2);
    // Escape leaves full screen and keeps the preview; double-clicking the header toggles it.
    await page.keyboard.press('Escape');
    await expect(preview(page)).not.toHaveClass(/is-fullscreen/);
    await expect(preview(page)).toBeVisible();
    await page.locator('.tp-preview-kind').dblclick();
    await expect(preview(page)).toHaveClass(/is-fullscreen/);
    await page.getByRole('button', { name: 'Leave full screen' }).click();
    await expect(preview(page)).not.toHaveClass(/is-fullscreen/);
    await page.getByRole('button', { name: 'Preview full screen' }).click();
    await expect(preview(page)).toHaveClass(/is-fullscreen/);
    // A dialog opened from full screen is on top, and Escape closes it first.
    await page.locator('.tp-md-tablebox').first().getByRole('button', { name: 'Edit as table' }).click();
    await expect(page.getByRole('dialog', { name: 'Edit table' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Edit table' })).toHaveCount(0);
    await expect(preview(page)).toHaveClass(/is-fullscreen/);
    await page.keyboard.press('Escape');
    await expect(preview(page)).not.toHaveClass(/is-fullscreen/);
  });

  test('at 1366x768 the header fits and the table scrolls inside its own box', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openPreview(page);
    const head = await box(page.locator('.tp-preview-head'));
    for (const b of await page.locator('.tp-preview-actions button').all()) expect((await box(b)).x + (await box(b)).width).toBeLessThanOrEqual(head.x + head.width);
    const m = await page.locator('.tp-preview-scroll').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(m.sw).toBeLessThanOrEqual(m.cw);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
