// Opening and saving real bytes: encodings, line endings, binary refusal, drag and drop.
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { docText, editor, openApp, openViaChooser, useBasicFilePickers } from './helpers';

const TEXT = 'ts=10:15 level=INFO msg="café für Zoë"\r\nsecond line\r\n';

function utf16(text: string, le: boolean): Buffer {
  const body = Buffer.from(text, 'utf16le');
  if (!le) body.swap16();
  return Buffer.concat([Buffer.from(le ? [0xff, 0xfe] : [0xfe, 0xff]), body]);
}

const FILES = {
  'utf8-lf.log': { buffer: Buffer.from(TEXT.replace(/\r\n/g, '\n'), 'utf8'), encoding: 'UTF-8', eol: 'LF' },
  'utf8-crlf.log': { buffer: Buffer.from(TEXT, 'utf8'), encoding: 'UTF-8', eol: 'CRLF' },
  'utf8-bom.txt': { buffer: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(TEXT, 'utf8')]), encoding: 'UTF-8 BOM', eol: 'CRLF' },
  'utf16-le.txt': { buffer: utf16(TEXT, true), encoding: 'UTF-16 LE', eol: 'CRLF' },
  'utf16-be.txt': { buffer: utf16(TEXT, false), encoding: 'UTF-16 BE', eol: 'CRLF' },
  'latin1.txt': { buffer: Buffer.from(TEXT, 'latin1'), encoding: 'Latin-1', eol: 'CRLF' },
} as const;

test.beforeEach(async ({ page }) => {
  await useBasicFilePickers(page);
  await openApp(page);
});

for (const [name, spec] of Object.entries(FILES)) {
  test(`${name}: detected as ${spec.encoding} / ${spec.eol} and saved back byte-for-byte`, async ({ page }) => {
    await openViaChooser(page, [{ name, mimeType: 'text/plain', buffer: spec.buffer }]);
    await expect(page.getByRole('tab', { name })).toBeVisible();
    await expect(page.getByTestId('status-encoding')).toHaveText(spec.encoding);
    await expect(page.getByTestId('status-eol')).toHaveText(spec.eol);
    expect(await docText(page)).toBe(TEXT.replace(/\r\n/g, '\n'));

    const download = page.waitForEvent('download');
    await page.keyboard.press('Control+S');
    const file = await download;
    expect(file.suggestedFilename()).toBe(name);
    const saved = await readFile(await file.path());
    expect(saved.equals(spec.buffer)).toBe(true);
  });
}

test('several files open at once, each in its own tab', async ({ page }) => {
  await openViaChooser(page, [
    { name: 'a.md', mimeType: 'text/markdown', buffer: Buffer.from('# Title\n') },
    { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}\n') },
    { name: 'c.log', mimeType: 'text/plain', buffer: Buffer.from('2026-01-01 INFO x\n') },
  ]);
  await expect(page.getByRole('tab')).toHaveCount(3);
  await page.getByRole('tab', { name: 'a.md' }).click();
  await expect(page.getByTestId('status-lang')).toHaveText('Markdown');
  await page.getByRole('tab', { name: 'b.json' }).click();
  await expect(page.getByTestId('status-lang')).toHaveText('JSON');
  // The pristine untitled tab was replaced, not left behind.
  await expect(page.getByRole('tab', { name: /untitled/ })).toHaveCount(0);
});

test('binary files are refused politely', async ({ page }) => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1]);
  await openViaChooser(page, [{ name: 'logo.png', mimeType: 'image/png', buffer: png }]);
  await expect(page.locator('.tp-toast')).toContainText('logo.png looks like a binary file');
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.getByRole('tab', { name: /untitled/ })).toBeVisible();
});

test('cancelling the picker changes nothing', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open a file', exact: true }).click();
  await (await chooser).setFiles([]);
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.locator('.tp-toast')).toHaveCount(0);
});

test('dropping files onto the window opens them', async ({ page }) => {
  await editor(page).focus();
  const data = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['dropped line 1\r\ndropped line 2\r\n'], 'dropped.log', { type: 'text/plain' }));
    return dt;
  });
  await page.dispatchEvent('.tp-main', 'dragenter', { dataTransfer: data });
  await expect(page.locator('.tp-drop')).toBeVisible();
  await page.dispatchEvent('.tp-main', 'drop', { dataTransfer: data });
  await expect(page.locator('.tp-drop')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'dropped.log' })).toBeVisible();
  await expect(page.getByTestId('status-eol')).toHaveText('CRLF');
  expect(await docText(page)).toBe('dropped line 1\ndropped line 2\n');
});

test('line endings can be switched before saving', async ({ page }) => {
  await openViaChooser(page, [{ name: 'unix.txt', mimeType: 'text/plain', buffer: Buffer.from('a\nb\n') }]);
  await page.getByTestId('status-eol').click();
  await expect(page.getByTestId('status-eol')).toHaveText('CRLF');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+S');
  const saved = await readFile(await (await download).path());
  expect(saved.toString('utf8')).toBe('a\r\nb\r\n');
});
