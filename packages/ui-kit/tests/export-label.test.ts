/*
  setExportLabel() in the stand-in document (support/mini-dom.ts): one export button relabelled
  after the panel is built, found through the panel or the sidebar footer round it, and a panel
  nobody relabels built exactly as before.

    pnpm --filter @vostok/ui-kit test
*/
import './support/install-mini-dom';
import { html, miniDocument, type MiniElement } from './support/mini-dom';
import { exportPanel, setExportLabel, setExportNote } from '../src/components/export-panel';
import { sidebarFooter } from '../src/components/sidebar-footer';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};
const buttons = (root: unknown) => [...(root as MiniElement).querySelectorAll('.vl-export__buttons button')].map((b) => b.textContent);

const panel = exportPanel({ formats: [{ id: '3mf', label: '3MF' }, { id: 'stl', label: 'STL' }], onExport: () => {} });
const before = html(panel as unknown as MiniElement);
check('the buttons say Download and their format', buttons(panel).join() === 'Download 3MF,Download STL');
check('no attribute was added for relabelling', !before.includes('data-format'));

setExportLabel(panel, 'stl', 'Download 8 photos');
check('setExportLabel relabels the one button', buttons(panel).join() === 'Download 3MF,Download 8 photos');
setExportLabel(panel, 'stl', 'photo');
check('through the host rule, so a bare word gets its verb', buttons(panel).join() === 'Download 3MF,Download photo');
setExportLabel(panel, 'nope', 'X');
check('an unknown format changes nothing', buttons(panel).join() === 'Download 3MF,Download photo');
setExportLabel(panel, 'stl', 'Generate 6 renders');
check('an action of its own keeps its verb', buttons(panel).join() === 'Download 3MF,Generate 6 renders');
setExportLabel(panel, 'stl', 'photo');

const footer = sidebarFooter({ formats: [{ id: 'photos', label: 'Download 4 photos' }], onExport: () => {}, onSave: () => {}, onLoad: () => {} });
setExportLabel(footer, 'photos', 'Download photo');
check('a sidebar footer is found through', buttons(footer).join() === 'Download photo');

// On a phone `appShell` moves the export panel out of the footer into its pinned bar.
const moved = sidebarFooter({ formats: [{ id: 'photos', label: 'Download 4 photos' }], onExport: () => {}, onSave: () => {}, onLoad: () => {} });
const block = (moved as unknown as MiniElement).querySelector('.vl-export')!;
const bar = (miniDocument.body as MiniElement).appendChild(block as unknown as MiniElement);
setExportLabel(moved, 'photos', 'Download 3 photos');
setExportNote(moved, 'One ZIP');
check('a panel moved out of its footer is still found through the footer', buttons(bar).join() === 'Download 3 photos' && (bar as MiniElement).querySelector('.vl-hint')?.textContent === 'One ZIP');

console.log(`\nexport label: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
