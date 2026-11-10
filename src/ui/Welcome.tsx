import { openSample } from '../app/actions';
import { runCommand } from '../app/commands';
import { activeDocEmpty, activeTab, isMac } from '../app/state';
import { closeTab, unlockTab } from '../app/tabs';
import { IconCommand, IconFlask, IconFolder, IconLock, IconUnlock, Logo } from './icons';

/** Shown over an empty, untitled tab. Typing anything hides it. */
export function Welcome() {
  const tab = activeTab.value;
  if (!tab || !tab.untitled || !activeDocEmpty.value || tab.dirty) return null;
  const mod = isMac ? '⌘' : 'Ctrl';
  return (
    <div class="tp-welcome">
      <div class="tp-welcome-card" role="region" aria-label="Welcome">
        <div class="tp-welcome-head">
          <Logo size={40} />
          <div>
            <h1 class="tp-welcome-title">Tracepad</h1>
            <p class="tp-welcome-sub">A text editor for reading logs and wrangling tables.</p>
          </div>
        </div>
        <div class="tp-welcome-actions">
          <button type="button" class="tp-welcome-action" onClick={() => runCommand('file.open')}>
            <IconFolder size={20} />
            <span class="tp-welcome-action-text">
              <strong>Open a file</strong>
              <small>or drop files anywhere</small>
            </span>
            <kbd class="tp-kbd">{mod}+O</kbd>
          </button>
          <button type="button" class="tp-welcome-action" onClick={openSample}>
            <IconFlask size={20} />
            <span class="tp-welcome-action-text">
              <strong>Try the sample log</strong>
              <small>Spring Boot, Kafka, Feign, stack traces</small>
            </span>
          </button>
          <button type="button" class="tp-welcome-action" onClick={() => runCommand('view.palette')}>
            <IconCommand size={20} />
            <span class="tp-welcome-action-text">
              <strong>Search commands</strong>
              <small>every action, with its shortcut</small>
            </span>
            <kbd class="tp-kbd">{mod}+Shift+P</kbd>
          </button>
        </div>
        <p class="tp-welcome-foot">
          <IconLock size={14} />
          <span>Files stay on this device. Nothing is uploaded. Just start typing to dismiss this card.</span>
        </p>
      </div>
    </div>
  );
}

/** Shown over a restored linked file until the browser is allowed to read it again. */
export function Locked() {
  const tab = activeTab.value;
  if (!tab?.locked) return null;
  return (
    <div class="tp-welcome tp-locked">
      <div class="tp-welcome-card" role="region" aria-label="File needs access">
        <div class="tp-welcome-head">
          <span class="tp-locked-icon">
            <IconUnlock size={22} />
          </span>
          <div>
            <h1 class="tp-locked-title">Reopen {tab.name}?</h1>
            <p class="tp-welcome-sub">Browsers ask again before a site may read a file after a restart. The file has not been read yet.</p>
          </div>
        </div>
        <div class="tp-locked-buttons">
          <button type="button" class="tp-btn" onClick={() => void closeTab(tab.id)}>
            Close tab
          </button>
          <button type="button" class="tp-btn tp-btn-primary" onClick={() => void unlockTab(tab.id)}>
            Allow access
          </button>
        </div>
      </div>
    </div>
  );
}
