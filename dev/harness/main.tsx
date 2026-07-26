/**
 * Mounts the real plugin UI in a browser at the plugin's own width, with
 * Figma's colour tokens loaded so what appears here matches what appears in
 * Figma.
 */
import mountPlugin from '../../src/ui';
import { startHarness } from './fake-bus';

const root = document.getElementById('root');
if (root) {
  // The plugin's entry is `render(Plugin)`, which returns this mount function.
  (mountPlugin as unknown as (node: HTMLElement, props: object) => void)(root, {});
  startHarness();
}
