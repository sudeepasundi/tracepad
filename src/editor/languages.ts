import type { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { sql } from '@codemirror/lang-sql';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { shell } from '@codemirror/legacy-modes/mode/shell';

interface Lang {
  name: string;
  exts: string[];
  load: () => Extension;
}

const LANGS: Lang[] = [
  { name: 'Log', exts: ['log', 'out', 'err'], load: () => [] },
  { name: 'Markdown', exts: ['md', 'markdown'], load: () => markdown() },
  { name: 'JSON', exts: ['json', 'jsonl', 'ndjson'], load: () => json() },
  { name: 'XML', exts: ['xml', 'html', 'htm', 'xsd', 'pom', 'svg'], load: () => xml() },
  { name: 'YAML', exts: ['yml', 'yaml'], load: () => yaml() },
  { name: 'SQL', exts: ['sql'], load: () => sql() },
  { name: 'Java', exts: ['java'], load: () => java() },
  { name: 'JavaScript', exts: ['js', 'mjs', 'cjs', 'jsx'], load: () => javascript({ jsx: true }) },
  { name: 'TypeScript', exts: ['ts', 'tsx'], load: () => javascript({ typescript: true, jsx: true }) },
  { name: 'Properties', exts: ['properties', 'ini', 'conf', 'env'], load: () => StreamLanguage.define(properties) },
  { name: 'Shell', exts: ['sh', 'bash'], load: () => StreamLanguage.define(shell) },
];

export function languageName(fileName: string): string {
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase() : '';
  return LANGS.find((l) => l.exts.includes(ext))?.name ?? 'Plain text';
}

export function languageExtension(name: string): Extension {
  return LANGS.find((l) => l.name === name)?.load() ?? [];
}
