import { useEffect, useRef } from 'preact/hooks';
import { sidebar, tabs } from '../app/state';
import { newTab } from '../app/tabs';
import { mountEditor } from '../editor/editor';
import { FindBar } from './FindBar';
import { DialogHost, DropOverlay, Toasts } from './Overlays';
import { Palette } from './Palette';
import { Rail, Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import { LogBar } from './LogBar';
import { ResultsPanel } from './ResultsPanel';
import { panelMaximised, panelOpen, results } from '../app/results';
import { BigViewer } from '../viewer/BigViewer';
import { initWatcher } from '../files/watch';
import { MenuHost } from './Menu';
import { initLogs } from '../app/logs';
import { Locked, Welcome } from './Welcome';
import { initSessionPersistence, restoreSession } from '../app/session';
import { installLaunchQueue } from '../files/fileio';

export function App() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountEditor(host.current!);
    void (async () => {
      // Bring back last session's tabs; start with an empty tab otherwise.
      await restoreSession().catch((e) => console.error('session restore failed', e));
      if (tabs.value.length === 0) newTab();
      initSessionPersistence();
      initLogs();
      initWatcher();
      installLaunchQueue();
      document.documentElement.dataset.ready = 'true';
    })();
  }, []);

  return (
    <div class={`tp-app${sidebar.value ? ' has-sidebar' : ''}`}>
      <TopBar />
      <div class="tp-body">
        <Rail />
        <Sidebar />
        <main class={`tp-main${panelOpen.value && results.value.length && panelMaximised.value ? ' is-panel-max' : ''}`}>
          <LogBar />
          <div class="tp-editor-area">
            <div class="tp-editor-host" ref={host} />
            <BigViewer />
            <Welcome />
            <Locked />
            <FindBar />
          </div>
          <ResultsPanel />
        </main>
      </div>
      <StatusBar />
      <Palette />
      <MenuHost />
      <DialogHost />
      <Toasts />
      <DropOverlay />
    </div>
  );
}
