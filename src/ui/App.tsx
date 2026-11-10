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
import { Welcome } from './Welcome';

export function App() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountEditor(host.current!);
    if (tabs.value.length === 0) newTab();
    document.documentElement.dataset.ready = 'true';
  }, []);

  return (
    <div class={`tp-app${sidebar.value ? ' has-sidebar' : ''}`}>
      <TopBar />
      <div class="tp-body">
        <Rail />
        <Sidebar />
        <main class="tp-main">
          <div class="tp-editor-host" ref={host} />
          <Welcome />
          <FindBar />
        </main>
      </div>
      <StatusBar />
      <Palette />
      <DialogHost />
      <Toasts />
      <DropOverlay />
    </div>
  );
}
