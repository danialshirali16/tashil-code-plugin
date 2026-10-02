/**
 * Mounts the real plugin UI in a browser at the plugin's own width, with
 * Figma's colour tokens loaded so what appears here matches what appears in
 * Figma.
 *
 * Deep links (dev-only visual-gate helper):
 *   `#design-health`            → opens the Design Health tab
 *   `#design-health/library`    → Design Health tab with the Library sub-tab active
 *   `#design-health/library/dark` → any route above with the dark theme classes
 */
import mountPlugin from '../../src/ui';
import { startHarness } from './fake-bus';

const DARK_THEME_SUFFIX = '/dark';

function applyThemeFromHash(hash: string): void {
  const wantsDark = hash.endsWith(DARK_THEME_SUFFIX);
  document.body.classList.toggle('figma-dark', wantsDark);
  document.body.classList.toggle('figma-dark-theme', wantsDark);
  document.body.classList.toggle('figma-light', !wantsDark);
  document.body.classList.toggle('figma-light-theme', !wantsDark);
}

function applyDeepLink(route: string): void {
  if (route !== '#design-health/library') {
    return;
  }
  // The sub-tab state lives inside the view; the harness shell reaches it the
  // same way a user does — by clicking the Library segment once it renders.
  // The panel mounts a tick after the tab click, so poll briefly.
  let attempts = 0;
  const clickLibraryWhenPresent = (): void => {
    const libraryRadio = Array.from(
      document.querySelectorAll<HTMLInputElement>('#tashil-tabpanel-design-health input[type="radio"]'),
    ).find((input) => input.closest('label')?.textContent?.includes('Library'));
    if (libraryRadio) {
      libraryRadio.click();
    } else if (attempts++ < 40) {
      window.setTimeout(clickLibraryWhenPresent, 50);
    }
  };
  clickLibraryWhenPresent();
}

const DESIGN_HEALTH_TAB_SELECTOR = '[role="tab"][aria-controls="tashil-tabpanel-design-health"]';

function openWorkflowTabFromHash(): void {
  const hash = window.location.hash;
  if (!hash.startsWith('#design-health')) {
    return;
  }
  applyThemeFromHash(hash);
  window.setTimeout(() => {
    (document.querySelector(DESIGN_HEALTH_TAB_SELECTOR) as HTMLElement | null)?.click();
    applyDeepLink(hash.replace(DARK_THEME_SUFFIX, ''));
  }, 0);
}

const root = document.getElementById('root');
if (root) {
  // The plugin's entry is `render(Plugin)`, which returns this mount function.
  (mountPlugin as unknown as (node: HTMLElement, props: object) => void)(root, {});
  startHarness();
  openWorkflowTabFromHash();
  window.addEventListener('hashchange', openWorkflowTabFromHash);
}
