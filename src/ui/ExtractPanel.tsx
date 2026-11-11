// Sidebar panel "Tables": auto tables, extract presets, a custom pattern, and
// the two cross-file tools.
import { useState } from 'preact/hooks';
import { forceLog } from '../app/logs';
import { countDuplicates, findInTabs, panelOpen, results, runAutoTables, runExtract } from '../app/results';
import { activeTab } from '../app/state';
import { PRESET_TITLES, type ExtractSpec } from '../engine/tables';

const PRESETS: { id: Exclude<ExtractSpec['preset'], 'custom'>; hint: string }[] = [
  { id: 'times', hint: 'took 84ms, in 6.4 seconds, (52ms): as milliseconds' },
  { id: 'sql', hint: 'operation, table and statement' },
  { id: 'kafka', hint: 'topic, partition, offset, key' },
  { id: 'ips', hint: 'every IPv4 address, with port' },
  { id: 'timestamps', hint: 'time and level of every entry' },
];

export function ExtractPanel() {
  const tab = activeTab.value;
  const [regex, setRegex] = useState('');
  const open = results.value.length;
  let problem: string | null = null;
  if (regex) {
    try {
      if (new RegExp(regex).test('')) problem = 'This matches empty text, so it would match every line.';
    } catch (e) {
      problem = e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : 'Not a valid pattern';
    }
  }
  const run = () => {
    if (regex && !problem) void runExtract({ preset: 'custom', regex });
  };

  return (
    <div>
      {tab && !tab.isLog && (
        <section class="tp-section">
          <p class="tp-help-text">Tables are built from logs. {tab.name} is not being treated as one.</p>
          <button type="button" class="tp-btn tp-insight-force" onClick={() => forceLog(true)}>
            Treat this tab as a log
          </button>
        </section>
      )}
      <section class="tp-section">
        <h3 class="tp-section-title">Auto tables</h3>
        <p class="tp-help-text tp-help-gap">Learns the message patterns in the log and builds one table per pattern. No setup needed.</p>
        <button type="button" class="tp-btn tp-btn-primary tp-extract-run" onClick={() => void runAutoTables()}>
          Build auto tables
        </button>
      </section>
      <section class="tp-section">
        <h3 class="tp-section-title">Extract</h3>
        <ul class="tp-presets" role="list">
          {PRESETS.map((p) => (
            <li key={p.id}>
              <button type="button" class="tp-preset" onClick={() => void runExtract({ preset: p.id })}>
                <strong>{PRESET_TITLES[p.id]}</strong>
                <small>{p.hint}</small>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section class="tp-section">
        <h3 class="tp-section-title">Custom pattern</h3>
        <label class="tp-field">
          <span class="tp-field-label">
            Regular expression. Named groups become columns: <code class="tp-code">{'(?<order>\\d+)'}</code>
          </span>
          <input
            type="text"
            class={`tp-input tp-rule-pattern${problem ? ' is-invalid' : ''}`}
            placeholder={'orderId=(?<order>\\d+) total=(?<total>[\\d.]+)'}
            aria-label="Custom pattern"
            aria-invalid={!!problem}
            spellcheck={false}
            autocomplete="off"
            value={regex}
            onInput={(e) => setRegex((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
          />
          {problem && <span class="tp-field-error">{problem}</span>}
        </label>
        <button type="button" class="tp-btn" disabled={!regex || !!problem} onClick={run}>
          Extract to table
        </button>
      </section>
      <section class="tp-section">
        <h3 class="tp-section-title">Across files</h3>
        <div class="tp-extract-tools">
          <button type="button" class="tp-btn" onClick={() => void findInTabs()}>
            Find in all open tabs…
          </button>
          <button type="button" class="tp-btn" onClick={countDuplicates}>
            Count duplicate lines
          </button>
        </div>
      </section>
      {open > 0 && !panelOpen.value && (
        <section class="tp-section">
          <button type="button" class="tp-btn" onClick={() => (panelOpen.value = true)}>
            Show results panel ({open})
          </button>
        </section>
      )}
    </div>
  );
}
