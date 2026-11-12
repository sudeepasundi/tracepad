import { describe, expect, it } from 'vitest';
import { PRESET_RULES, compileRules, filterRule, findMarks, findStatements, presetOn, statementSegments, statementsOn, type UserRule } from '../../src/engine/highlights';

/** What one ready-made rule (alone) marks in a text. */
function marked(id: string, text: string): string[] {
  const only = Object.fromEntries(PRESET_RULES.map((p) => [p.id, p.id === id]));
  return findMarks(text, compileRules([], only)).map((m) => text.slice(m.from, m.to));
}

describe('ready-made highlight rules', () => {
  it('every rule compiles, never matches the empty string, and its example is marked', () => {
    for (const p of PRESET_RULES) {
      const re = new RegExp(p.pattern, p.flags);
      expect(re.test(''), p.id).toBe(false);
      if (p.kind === 'statement') expect(findStatements(p.example), p.id).toEqual([{ from: 0, to: p.example.length }]);
      else expect(marked(p.id, p.example).length, p.id).toBeGreaterThan(0);
    }
  });

  it('the useful four are on by default, the noisier ones off', () => {
    const on = PRESET_RULES.filter((p) => presetOn(p, {})).map((p) => p.id);
    expect(on).toEqual(['exceptions', 'http', 'slow', 'trouble', 'sql']);
    expect(presetOn(PRESET_RULES[0], { exceptions: false })).toBe(false);
    expect(presetOn(PRESET_RULES[4], { trace: true })).toBe(true);
  });

  it('exceptions: class names, with or without a package; not the ERROR level', () => {
    expect(marked('exceptions', 'java.lang.NullPointerException: Cannot invoke "x"')).toEqual(['java.lang.NullPointerException']);
    expect(marked('exceptions', 'Caused by: java.net.ConnectException: Connection refused')).toEqual(['java.net.ConnectException']);
    expect(marked('exceptions', 'OutOfMemoryError and StackOverflowError')).toEqual(['OutOfMemoryError', 'StackOverflowError']);
    expect(marked('exceptions', '2026-03-14 10:15:30 ERROR [main] c.a.Job - error while saving, exception count 3')).toEqual([]);
  });

  it('HTTP: 4xx and 5xx in key=value, access logs and Spring names; not 2xx or other numbers', () => {
    expect(marked('http', 'GET /api/orders status=503 in 12ms')).toEqual(['status=503']);
    expect(marked('http', '"statusCode": 404,')).toEqual(['statusCode": 404']);
    expect(marked('http', '10.0.0.1 - - [14/Mar/2026] "GET /x HTTP/1.1" 502 120')).toEqual(['502']);
    expect(marked('http', 'Request failed: 500 INTERNAL_SERVER_ERROR from POST')).toEqual(['500 INTERNAL_SERVER_ERROR']);
    expect(marked('http', 'status=200 status=302 order 404117 took 500ms "HTTP/1.1" 200')).toEqual([]);
  });

  it('slow: 500 ms and up, and whole seconds; not short times or other words', () => {
    expect(marked('slow', 'took 1840ms')).toEqual(['1840ms']);
    expect(marked('slow', 'in 612 ms and 2.5 s and 3 seconds')).toEqual(['612 ms', '2.5 s', '3 seconds']);
    expect(marked('slow', 'took 84ms, 499ms, 0.4 s, 30s-window, 12 sessions')).toEqual([]);
  });

  it('trouble: timeouts, refusals, retries', () => {
    expect(marked('trouble', 'Read timed out; Connection refused; retrying in 5s; deadlock detected')).toEqual(['timed out', 'Connection refused', 'retrying', 'deadlock']);
    expect(marked('trouble', 'timeoutMs=30 is configured')).toEqual([]);
  });

  it('trace IDs, IP addresses and SQL', () => {
    expect(marked('trace', '[orders,4bf92f3577b34da6a3ce929d0e0e4736,00f067aa0ba902b7]')).toEqual(['4bf92f3577b34da6a3ce929d0e0e4736', '00f067aa0ba902b7']);
    expect(marked('ip', 'from 10.0.4.17:8080 and 192.168.1.1, not 999.1.1.1 or 1.2.3')).toEqual(['10.0.4.17:8080', '192.168.1.1']);
  });
});

describe('findMarks', () => {
  const user = (pattern: string, color: number, regex = false): UserRule => ({ id: color + 1, pattern, regex, color, on: true });

  it('user rules come first and win overlaps; marks never overlap', () => {
    const rules = compileRules([user('Connection', 1)], {});
    const text = 'Caused by: java.net.ConnectException: Connection refused after 1200ms';
    const marks = findMarks(text, rules).map((m) => [text.slice(m.from, m.to), m.color]);
    expect(marks).toEqual([
      ['java.net.ConnectException', 3],
      ['Connection', 1],
      ['1200ms', 0],
    ]);
    const all = findMarks(text, rules);
    for (let i = 1; i < all.length; i++) expect(all[i].from).toBeGreaterThanOrEqual(all[i - 1].to);
  });

  it('plain user text is literal and ignores case; regex rules are regexes; bad ones are skipped', () => {
    const rules = compileRules([user('a.b', 2), user('x+', 4, true), user('(', 5, true), user('', 0)], Object.fromEntries(PRESET_RULES.map((p) => [p.id, false])));
    expect(rules).toHaveLength(2);
    // 'a.b' is literal: it does not match 'axb'; 'x+' matches the x in it and the xxx.
    expect(findMarks('A.B axb xxx', rules).map((m) => m.from)).toEqual([0, 5, 8]);
  });

  it('switched-off rules do nothing', () => {
    const off = compileRules([{ ...user('INFO', 0), on: false }], Object.fromEntries(PRESET_RULES.map((p) => [p.id, false])));
    expect(off).toEqual([]);
    expect(findMarks('INFO', off)).toEqual([]);
  });
});

describe('filterRule', () => {
  const spec = (p: Partial<{ text: string; regex: boolean; caseSensitive: boolean; patterns: string[] }>) => ({ text: '', regex: false, caseSensitive: false, patterns: [], ...p });
  const hits = (text: string, s: ReturnType<typeof spec>) => {
    const r = filterRule(s);
    return r ? findMarks(text, [r]).map((m) => text.slice(m.from, m.to)) : null;
  };

  it('nothing to mark without text or patterns', () => {
    expect(filterRule(spec({}))).toBeNull();
    expect(filterRule(spec({ patterns: ['  '] }))).toBeNull();
    expect(filterRule(spec({ text: '(', regex: true }))).toBeNull();
  });

  it('plain text is literal and follows the case setting; regex text is a regex', () => {
    expect(hits('HikariPool hikari a.b', spec({ text: 'hikari' }))).toEqual(['Hikari', 'hikari']);
    expect(hits('HikariPool hikari', spec({ text: 'hikari', caseSensitive: true }))).toEqual(['hikari']);
    expect(hits('a.b axb', spec({ text: 'a.b' }))).toEqual(['a.b']);
    expect(hits('status=503 status=200', spec({ text: 'status=5\\d\\d', regex: true }))).toEqual(['status=503']);
  });

  it('patterns join the text: plain ones ignore case, /regex/ ones keep their flags', () => {
    expect(hits('Slow query took 900ms; order 7 failed', spec({ text: 'order', patterns: ['SLOW QUERY', '/\\d+ms/'] }))).toEqual(['Slow query', '900ms', 'order']);
  });
});

describe('findStatements (whole SQL statements)', () => {
  const found = (block: string) => findStatements(block).map((m) => block.slice(m.from, m.to));

  it('Hibernate one-liners, in lower case, from the keyword to the end', () => {
    expect(found('org.hibernate.SQL : update orders set status=?,updated_at=? where id=?')).toEqual(['update orders set status=?,updated_at=? where id=?']);
    expect(found('org.hibernate.SQL : select o1_0.id,o1_0.customer_id,o1_0.status from orders o1_0 where o1_0.id=?')).toEqual(['select o1_0.id,o1_0.customer_id,o1_0.status from orders o1_0 where o1_0.id=?']);
    expect(found('org.hibernate.SQL : insert into orders (customer_id,status,total) values (?,?,?)')).toEqual(['insert into orders (customer_id,status,total) values (?,?,?)']);
    expect(found('delete from order_items where order_id=?')).toEqual(['delete from order_items where order_id=?']);
    expect(found('SELECT COUNT(*) AS n FROM orders WHERE status = ?')).toEqual(['SELECT COUNT(*) AS n FROM orders WHERE status = ?']);
  });

  it('a statement in the middle of a message, and one per semicolon', () => {
    expect(found('Slow query took 4628ms rows=458 sql=select * from orders where created_at > ?')).toEqual(['select * from orders where created_at > ?']);
    expect(found('ran: update a set x=1; update b set y=2; done')).toEqual(['update a set x=1;', 'update b set y=2;']);
    expect(found('could not execute statement [insert into orders (id) values (?)]; SQL [n/a]')).toEqual(['insert into orders (id) values (?)']);
  });

  it('pretty-printed SQL (format_sql) across lines, but not into a stack trace or the next entry', () => {
    const entry = [
      '2026-03-14 10:00:01.000 DEBUG [main] org.hibernate.SQL : ',
      '    select',
      '        o1_0.id,',
      '        o1_0.status ',
      '    from',
      '        orders o1_0 ',
      '    where',
      '        o1_0.id=?',
    ].join('\n');
    expect(found(entry)).toEqual([entry.slice(entry.indexOf('select'))]);
    const withTrace = 'SQL Error: update orders set status=? where id=?\n\tat com.acme.Repo.save(Repo.java:12)\nCaused by: x';
    expect(found(withTrace)).toEqual(['update orders set status=? where id=?']);
    const next = 'insert into t (a) values (?)\n2026-03-14 10:00:02.000 INFO next entry';
    expect(found(next)).toEqual(['insert into t (a) values (?)']);
  });

  it('ordinary sentences are not SQL', () => {
    for (const prose of [
      'Please select a value from the list',
      'select the best option from them',
      'We will update the record set soon',
      'delete it from here',
      'insert the card',
      'Merge requests into main',
    ])
      expect(found(prose), prose).toEqual([]);
  });

  it('is a switchable ready-made rule, on by default, and not part of the line rules', () => {
    expect(statementsOn({})).toBe(true);
    expect(statementsOn({ sql: false })).toBe(false);
    const only = Object.fromEntries(PRESET_RULES.map((p) => [p.id, p.id === 'sql']));
    expect(compileRules([], only)).toEqual([]);
  });
});

describe('statementSegments', () => {
  it('cuts a statement into per-line pieces without indentation, found from any of its lines', () => {
    const lines = ['2026-03-14 10:00:09.000 DEBUG [main] org.hibernate.SQL - ', '    update', '        orders ', '    set', '        status=?', '2026-03-14 10:00:10.000 INFO next'];
    const isEntry = (i: number) => /^\d{4}-/.test(lines[i]);
    const segs = statementSegments([3], lines.length, (i) => lines[i], isEntry);
    expect([...segs.keys()]).toEqual([1, 2, 3, 4]);
    expect([1, 2, 3, 4].map((i) => segs.get(i)!.map((x) => lines[i].slice(x.from, x.to)).join(''))).toEqual(['update', 'orders', 'set', 'status=?']);
    // Text that is not loaded ends the entry early, and nothing breaks.
    expect(statementSegments([3], lines.length, (i) => (i < 3 ? lines[i] : undefined), isEntry).size).toBe(0);
  });
});
