import { describe, expect, it } from 'vitest';
import { inferTable, parseMarkdownTable, textToMarkdownTable, toMarkdownTable } from '../../src/engine/tabletext';

const rows = (text: string) => inferTable(text)?.rows ?? null;

describe('Markdown table writer', () => {
  it('aligns the pipes and right-aligns number columns', () => {
    expect(toMarkdownTable([['Service', 'Requests', 'Avg (ms)'], ['orders', '1,204', '84'], ['inventory', '312', '1203.5']])).toBe(
      ['| Service   | Requests | Avg (ms) |', '| --------- | -------: | -------: |', '| orders    |    1,204 |       84 |', '| inventory |      312 |   1203.5 |'].join('\n'),
    );
  });

  it('escapes pipes, flattens line breaks, pads short rows and narrow columns', () => {
    expect(toMarkdownTable([['a', 'b'], ['x|y', 'two\nlines'], ['only']])).toBe(['| a    | b         |', '| ---- | --------- |', '| x\\|y | two lines |', '| only |           |'].join('\n'));
  });

  it('honours explicit alignment, and counts wide characters as two columns', () => {
    const md = toMarkdownTable([['名前', 'n'], ['日本語', '1']], ['center', 'left']);
    const lines = md.split('\n');
    expect(lines[1]).toBe('| :----: | :-- |');
    expect(lines[0]).toBe('|  名前  | n   |');
  });

  it('round-trips through the parser', () => {
    const src = [['Name', 'Qty'], ['a|b', '3'], ['c', '']];
    const md = toMarkdownTable(src, ['', 'right']);
    const back = parseMarkdownTable(md.split('\n'))!;
    expect(back.rows).toEqual(src);
    expect(back.aligns).toEqual(['', 'right']);
    expect(parseMarkdownTable(['just text', 'more text'])).toBeNull();
  });
});

describe('tables in pasted text', () => {
  it('tab-separated (Excel, most AI chats)', () => {
    const t = inferTable('Endpoint\tRequests\tAvg Response (ms)\tErrors\n/api/orders\t1204\t84\t3\n/api/orders/{id}\t9310\t41\t0\n');
    expect(t!.kind).toBe('tsv');
    expect(t!.rows).toEqual([['Endpoint', 'Requests', 'Avg Response (ms)', 'Errors'], ['/api/orders', '1204', '84', '3'], ['/api/orders/{id}', '9310', '41', '0']]);
    // Trailing empty cells dropped by the spreadsheet are filled in.
    expect(rows('a\tb\tc\n1\t2\n3\t4\t5')).toEqual([['a', 'b', 'c'], ['1', '2', ''], ['3', '4', '5']]);
  });

  it('comma- and semicolon-separated, with quotes', () => {
    expect(rows('id,name,total\n1,"Rao, Meera",1299.50\n2,"He said ""ok""",15')).toEqual([['id', 'name', 'total'], ['1', 'Rao, Meera', '1299.50'], ['2', 'He said "ok"', '15']]);
    expect(rows('id;name;qty\n1;bolt;40\n2;nut;55')).toEqual([['id', 'name', 'qty'], ['1', 'bolt', '40'], ['2', 'nut', '55']]);
  });

  it('space-aligned columns, with multi-word headers and units', () => {
    const text = ['Requests  Avg Response (ms)  Errors', '1204      84                 3', '9310      41                 0'].join('\n');
    const t = inferTable(text);
    expect(t!.kind).toBe('aligned');
    expect(t!.rows).toEqual([['Requests', 'Avg Response (ms)', 'Errors'], ['1204', '84', '3'], ['9310', '41', '0']]);
    expect(textToMarkdownTable(text)).toBe(['| Requests | Avg Response (ms) | Errors |', '| -------: | ----------------: | -----: |', '|     1204 |                84 |      3 |', '|     9310 |                41 |      0 |'].join('\n'));
    // A ruler line under the header is dropped.
    expect(rows('Service     P95 (ms)   Error rate\n----------  --------   ----------\norders      412        0.4%\ninventory   1203       2.1%')).toEqual([['Service', 'P95 (ms)', 'Error rate'], ['orders', '412', '0.4%'], ['inventory', '1203', '2.1%']]);
  });

  it('single-spaced columns only when the data is clearly numeric', () => {
    expect(rows('pid cpu mem\n4242 12.5 3.1\n911 0.4 1.2\n77 99.0 40.2')).toEqual([['pid', 'cpu', 'mem'], ['4242', '12.5', '3.1'], ['911', '0.4', '1.2'], ['77', '99.0', '40.2']]);
    expect(rows('we went home\nthen we slept\nall night long')).toBeNull();
  });

  it('database client output: MySQL boxes and psql rules', () => {
    expect(rows('+----+--------+-------+\n| id | status | total |\n+----+--------+-------+\n|  1 | PAID   | 12.50 |\n|  2 | NEW    |  3.00 |\n+----+--------+-------+')).toEqual([['id', 'status', 'total'], ['1', 'PAID', '12.50'], ['2', 'NEW', '3.00']]);
    expect(rows(' id | status \n----+--------\n  1 | PAID\n  2 | NEW')).toEqual([['id', 'status'], ['1', 'PAID'], ['2', 'NEW']]);
  });

  it('a Markdown table is left as it is', () => {
    expect(inferTable('| a | b |\n| --- | --- |\n| 1 | 2 |')).toBeNull();
  });
});

describe('prose is never mistaken for a table', () => {
  const prose = [
    'Hello, world. This is, well, a sentence.\nAnd here, too, is another one.',
    'We deployed at 10:15, rolled back at 10:40, and redeployed at 11:05.\nThe second attempt held, so far, without errors.',
    'Dear team,\nplease review the attached log, the config, and the dashboard.\nThanks, Ravi',
    'First line of a note\nSecond line of a note',
    'Step 1: open the file\nStep 2: press Ctrl+F\nStep 3: type the text',
    'ERROR  something  broke badly here\nand this line is just ordinary text',
    'A single line with, commas, in it',
    'key: value\nother: thing',
    'public static void main(String[] args) {\n    System.out.println("a, b, c");\n}',
    'SELECT id, name, total\nFROM orders\nWHERE status = 1',
    'one, two\nthree, four',
    'Notes;  more notes\nplain text  here',
    '2026-03-14 10:15:02 INFO  started\n2026-03-14 10:15:03 WARN  slow query took 2140ms',
  ];
  for (const text of prose) {
    it(JSON.stringify(text.slice(0, 48)), () => {
      expect(textToMarkdownTable(text)).toBeNull();
    });
  }

  it('text with a blank line in it is not one table', () => {
    expect(inferTable('a\tb\n1\t2\n\nsome words after')).toBeNull();
  });
});
