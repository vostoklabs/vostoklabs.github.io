import '@vostok/ui-kit/styles.css';
import './style.css';

import {
  appShell,
  topbarLinks,
  generatorHeader,
  qualityCallout,
  sidebarFooter,
  el,
  sliderRow,
  segmentedControl,
  toggleSwitch,
  selectField,
  toast,
  dialog,
} from '@vostok/ui-kit';
import { BRAND } from '@vostok/brand';

/*
  Vostok Labs generator template.

  This gives you the whole page frame already built and consistent with every
  other generator: topbar, left settings panel, center 3D stage, right panel,
  header + "Made by Vostok Labs", a dismissable quality callout, and the
  Export / Save / Load / Help / Light-mode footer.

  To make a new generator, copy this app and fill in the 5 numbered sections.
*/

// ---------------------------------------------------------------------------
// 1. STATE — every setting your generator has. Save/Load serialise this object.
// ---------------------------------------------------------------------------
const state = {
  size: 20,
  style: 'a' as 'a' | 'b',
};

// ---------------------------------------------------------------------------
// 2. REBUILD — recompute geometry and refresh the preview (debounce if heavy).
// ---------------------------------------------------------------------------
function triggerRebuild() {
  // TODO: post `state` to your geometry worker, then mount the result on
  // `shell.stage` (e.g. attach your three.js renderer's canvas to it).
}

// ---------------------------------------------------------------------------
// 3. SETTINGS — build your controls here. Delete the examples you don't need.
// ---------------------------------------------------------------------------
const settings = el('div', { className: 'vl-section' }, [
  el('p', { className: 'vl-label', text: 'Settings' }),
  sliderRow({
    label: 'Size', min: 5, max: 50, value: state.size, unit: 'mm',
    help: 'Example slider — every control supports an optional "?" tooltip.',
    onInput: (v) => { state.size = v; triggerRebuild(); },
  }),
  segmentedControl<'a' | 'b'>({
    label: 'Style',
    value: state.style,
    options: [{ value: 'a', label: 'Style A' }, { value: 'b', label: 'Style B' }],
    onChange: (v) => { state.style = v; triggerRebuild(); },
  }),
  // selectField({ label: 'Mode', options: [...], onChange: ... }),
  // toggleSwitch({ label: 'Feature', checked: false, onChange: ... }),
]);

// ---------------------------------------------------------------------------
// 4. CHROME — header, quality callout, export/footer. Mostly ready-made.
// ---------------------------------------------------------------------------
const quality = qualityCallout({
  html: `For the best print, use the profile on <a href="${BRAND.urls.makerworld}" target="_blank" rel="noopener">MakerWorld</a>.`,
  storageKey: 'template-quality-callout',
});

const footer = sidebarFooter({
  formats: [{ id: '3mf', label: '3MF' }],
  onExport: async () => { /* TODO: build + download your 3MF */ toast('Wire up export here', { kind: 'ok' }); },
  onSave: () => downloadJSON('project.json', state),
  onLoad: (file) => loadJSON(file, (data) => { Object.assign(state, data); triggerRebuild(); }),
  onHelp: () => dialog({
    title: 'My Generator — Help',
    content: 'Explain how to use your generator here.',
    actions: [{ label: 'Got it', primary: true }],
  }),
  themeStorageKey: 'template-theme',
});

// ---------------------------------------------------------------------------
// 5. ASSEMBLE — the shell wires it all into the standard 3-column layout.
// ---------------------------------------------------------------------------
const shell = appShell({
  topbar: topbarLinks({ githubUrl: BRAND.urls.github, themeToggle: false }),
  left: {
    scroll: [
      generatorHeader({ title: 'My Generator', description: 'One-line description of what it makes.' }),
      ...(quality ? [quality] : []),
      settings,
    ],
  },
  stage: [
    el('p', { className: 'tpl-stage-label', text: 'Live 3D Preview' }),
    el('div', { className: 'tpl-stage-placeholder', text: 'Mount your 3D preview canvas on shell.stage' }),
  ],
  right: {
    scroll: [
      el('div', { className: 'vl-section' }, [
        el('p', { className: 'vl-label', text: 'Output' }),
        el('p', { className: 'vl-hint', text: 'Use the right panel for fonts, presets, or leave it for export only.' }),
      ]),
    ],
    footer: [footer],
  },
});

document.getElementById('app')!.append(shell.root);

// The footer's Light-mode button flips <html data-theme>; observe it to re-theme
// your 3D viewer (scene.background, grid colours, …).
new MutationObserver(() => {
  const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  void theme; // TODO: viewer.setTheme(theme);
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

triggerRebuild();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function downloadJSON(name: string, data: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function loadJSON(file: File, apply: (data: any) => void) {
  const r = new FileReader();
  r.onload = () => { try { apply(JSON.parse(r.result as string)); } catch { toast('Invalid project file', { kind: 'error' }); } };
  r.readAsText(file);
}
