// Every user-facing action is declared here once.
import { addCursorAbove, addCursorBelow, redo, undo } from '@codemirror/commands';
import { selectNextOccurrence } from '@codemirror/search';
import sampleLog from '../assets/sample-spring.log?raw';
import { applyEditorSettings, focusEditor, getView, goToLine, selectAll } from '../editor/editor';
import { openFiles, saveTab, saveTabAs } from '../files/fileio';
import { findStep, openFind } from '../ui/FindBar';
import { registerCommands, type Command } from './commands';
import { ask, toast } from './feedback';
import { FONT_MAX, FONT_MIN, DEFAULTS, settings, updateSettings } from './settings';
import { activeId, cursor, filesFocus, paletteOpen, patchTab, sidebar, tabs, type SidebarPanel } from './state';
import { activateTab, addTab, closeOthers, closeTab, copyTabName, cycleTab, moveTab, newTab, startRename } from './tabs';
import { ACCENTS, THEMES } from './themes';

export function toggleSidebar(panel: SidebarPanel): void {
  sidebar.value = sidebar.value === panel ? null : panel;
}

export function openSample(): void {
  const existing = tabs.value.find((t) => t.name === 'sample-spring-boot.log');
  if (existing) activateTab(existing.id);
  else addTab({ name: 'sample-spring-boot.log', text: sampleLog, encoding: 'UTF-8', eol: 'LF' });
}

export async function goToLineDialog(): Promise<void> {
  const max = cursor.value.lines;
  const r = await ask({
    title: 'Go to line',
    input: {
      label: `Line number (1 – ${max.toLocaleString()}), optionally line:column`,
      value: String(cursor.value.line),
      validate: (v) => (/^\s*\d+\s*(:\s*\d+)?\s*$/.test(v) ? null : 'Type a line number such as 120 or 120:8'),
    },
    buttons: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'go', label: 'Go', primary: true },
    ],
  });
  if (!r || r.button !== 'go') {
    focusEditor();
    return;
  }
  const [line, col] = r.value.split(':').map((x) => parseInt(x.trim(), 10));
  goToLine(line, col || 1);
}

export function setFontSize(size: number): void {
  updateSettings({ fontSize: Math.max(FONT_MIN, Math.min(FONT_MAX, size)) });
  getView().requestMeasure();
}

export function toggleSetting(key: 'wordWrap' | 'minimap' | 'lineNumbers'): void {
  updateSettings({ [key]: !settings.value[key] });
  applyEditorSettings();
  window.dispatchEvent(new CustomEvent('tp-appearance'));
}

export function toggleEol(): void {
  const id = activeId.value;
  const tab = tabs.value.find((t) => t.id === id);
  if (!tab || id == null) return;
  const eol = tab.eol === 'LF' ? 'CRLF' : 'LF';
  patchTab(id, { eol, dirty: true });
  toast(`Line endings will be saved as ${eol}`, { ms: 2200 });
}

const editorCmd = (fn: (v: ReturnType<typeof getView>) => unknown) => () => {
  const v = getView();
  v.focus();
  fn(v);
};

export function registerAllCommands(): void {
  const list: Command[] = [
    { id: 'file.new', title: 'New tab', category: 'File', keys: ['Alt+N'], run: () => void newTab() },
    { id: 'file.open', title: 'Open files…', category: 'File', keys: ['Ctrl+O'], run: openFiles },
    { id: 'file.save', title: 'Save', category: 'File', keys: ['Ctrl+S'], run: () => void saveTab() },
    { id: 'file.saveAs', title: 'Save As…', category: 'File', keys: ['Ctrl+Shift+S'], run: () => void saveTabAs() },
    { id: 'file.close', title: 'Close tab', category: 'File', keys: ['Alt+W'], run: () => void (activeId.value != null && closeTab(activeId.value)) },
    { id: 'file.sample', title: 'Open the sample Spring Boot log', category: 'File', run: openSample },
    { id: 'tab.next', title: 'Next tab', category: 'Tabs', keys: ['Alt+PageDown', 'Alt+.'], run: () => cycleTab(1) },
    { id: 'tab.prev', title: 'Previous tab', category: 'Tabs', keys: ['Alt+PageUp', 'Alt+,'], run: () => cycleTab(-1) },
    { id: 'tab.rename', title: 'Rename tab or file…', category: 'Tabs', keys: ['F2'], run: () => {
        // In the Open files list, F2 renames the focused row; otherwise the current tab.
        const row = document.activeElement?.closest<HTMLElement>('.tp-file[data-tab-id]');
        if (row) startRename(Number(row.dataset.tabId), 'list');
        else if (activeId.value != null) startRename(activeId.value, 'tab');
      },
    },
    { id: 'tab.moveStart', title: 'Move tab to start', category: 'Tabs', run: () => void (activeId.value != null && moveTab(activeId.value, 0)) },
    { id: 'tab.moveEnd', title: 'Move tab to end', category: 'Tabs', run: () => void (activeId.value != null && moveTab(activeId.value, tabs.value.length - 1)) },
    { id: 'tab.copyName', title: 'Copy file name', category: 'Tabs', run: () => void (activeId.value != null && copyTabName(activeId.value)) },
    { id: 'tab.closeOthers', title: 'Close other tabs', category: 'Tabs', run: () => void (activeId.value != null && closeOthers(activeId.value)) },

    { id: 'edit.find', title: 'Find', category: 'Edit', keys: ['Ctrl+F'], run: () => openFind('find') },
    { id: 'edit.replace', title: 'Replace', category: 'Edit', keys: ['Ctrl+H'], run: () => openFind('replace') },
    { id: 'edit.findNext', title: 'Find next', category: 'Edit', keys: ['F3'], run: () => findStep(1) },
    { id: 'edit.findPrev', title: 'Find previous', category: 'Edit', keys: ['Shift+F3'], run: () => findStep(-1) },
    { id: 'edit.goto', title: 'Go to line…', category: 'Edit', keys: ['Ctrl+G'], run: goToLineDialog },
    { id: 'edit.selectAll', title: 'Select all', category: 'Edit', hint: 'Ctrl+A', run: selectAll },
    { id: 'edit.undo', title: 'Undo', category: 'Edit', hint: 'Ctrl+Z', run: editorCmd(undo) },
    { id: 'edit.redo', title: 'Redo', category: 'Edit', hint: 'Ctrl+Y', run: editorCmd(redo) },
    { id: 'edit.cursorAbove', title: 'Add cursor above', category: 'Multi-cursor', hint: 'Ctrl+Alt+↑', run: editorCmd(addCursorAbove) },
    { id: 'edit.cursorBelow', title: 'Add cursor below', category: 'Multi-cursor', hint: 'Ctrl+Alt+↓', run: editorCmd(addCursorBelow) },
    { id: 'edit.nextOccurrence', title: 'Select next occurrence', category: 'Multi-cursor', hint: 'Ctrl+D', run: editorCmd(selectNextOccurrence) },
    {
      id: 'edit.columnHelp',
      title: 'Column (box) selection: hold Alt and drag',
      category: 'Multi-cursor',
      hint: 'Alt+drag',
      run: () => void toast('Hold Alt and drag to select a column. Ctrl+click adds another cursor.', { ms: 5000 }),
    },

    { id: 'view.palette', title: 'Command palette', category: 'View', keys: ['Ctrl+Shift+P', 'F1'], run: () => void (paletteOpen.value = !paletteOpen.value) },
    { id: 'view.wrap', title: 'Toggle word wrap', category: 'View', keys: ['Alt+Z'], run: () => toggleSetting('wordWrap') },
    { id: 'view.minimap', title: 'Toggle minimap', category: 'View', run: () => toggleSetting('minimap') },
    { id: 'view.lineNumbers', title: 'Toggle line numbers', category: 'View', run: () => toggleSetting('lineNumbers') },
    { id: 'view.fontBigger', title: 'Increase font size', category: 'View', keys: ['Alt+='], run: () => setFontSize(settings.value.fontSize + 1) },
    { id: 'view.fontSmaller', title: 'Decrease font size', category: 'View', keys: ['Alt+-'], run: () => setFontSize(settings.value.fontSize - 1) },
    { id: 'view.fontReset', title: 'Reset font size', category: 'View', keys: ['Alt+0'], run: () => setFontSize(DEFAULTS.fontSize) },
    {
      id: 'view.files',
      title: 'Show open files',
      category: 'View',
      keys: ['Ctrl+Shift+E'],
      run: () => {
        // The shortcut always lands in the filter box; a second press closes the panel.
        if (sidebar.value === 'files' && document.activeElement?.classList.contains('tp-files-input')) sidebar.value = null;
        else {
          sidebar.value = 'files';
          filesFocus.value++;
        }
      },
    },
    { id: 'view.appearance', title: 'Appearance settings', category: 'View', run: () => toggleSidebar('appearance') },
    { id: 'view.help', title: 'Help and shortcuts', category: 'View', run: () => toggleSidebar('help') },
    { id: 'view.closeSidebar', title: 'Close sidebar', category: 'View', run: () => void (sidebar.value = null) },
    {
      id: 'view.density',
      title: 'Toggle compact density',
      category: 'View',
      run: () => updateSettings({ density: settings.value.density === 'compact' ? 'comfortable' : 'compact' }),
    },
    ...THEMES.map<Command>((t) => ({ id: `theme.${t.id}`, title: `Theme: ${t.name} (${t.dark ? 'dark' : 'light'})`, category: 'Appearance', run: () => updateSettings({ theme: t.id }) })),
    ...ACCENTS.map<Command>((a) => ({ id: `accent.${a.id}`, title: `Accent colour: ${a.name}`, category: 'Appearance', run: () => updateSettings({ accent: a.id }) })),
  ];
  registerCommands(list);
}
