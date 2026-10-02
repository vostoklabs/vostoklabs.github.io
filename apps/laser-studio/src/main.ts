import '@vostok/ui-kit/styles.css';
import '@vostok/fonts/fonts.css';
import './style.css';

import { applyTheme, resolveTheme } from '@vostok/ui-kit';
import { MAKERLAB, initMakerlab } from 'virtual:makerlab';
import { templateById, type Values } from './templates';
import { createGallery, rememberOpened } from './gallery';
import { createEditor } from './editor';
import { watchForStaleChunks } from './stale';

/*
  Laser Studio — a gallery of laser designs, each with a short form and a download.

  Two screens and a hash: `#/` is the gallery, `#/t/<template>` is that template's editor.
  Everything a design needs to say lives in src/templates/<id>.ts (a form schema and one
  build function); the engine, the preview, the form renderer and the export are shared.
  Plan and the reuse map: README.md.
*/

const app = document.getElementById('app')!;
watchForStaleChunks();
applyTheme(resolveTheme('laser-studio-theme'), 'laser-studio-theme');

/* The host connection, as early as it can go, and exactly ONCE — here rather than in the
   editor, which is built fresh for every template the user opens. `MAKERLAB` is the literal
   `false` in every other build, so the bundler drops this and the host glue with it. Not
   awaited: the gallery and the editor work while it is in flight, and the export path checks
   `isReady()` for itself (and reconnects) at the moment it actually needs the host. */
if (MAKERLAB) {
  void initMakerlab({
    onDisconnect: () => console.warn('[laser-studio] MakerLab disconnected; the next export will reconnect.'),
  });
}

/** Values carried from one template to the next: the ones whose key the new one also has. */
let carried: Values = {};

/*
  The gallery is built ONCE and kept. Leaving it for the editor detaches the node and notes how
  far down the page it was; coming back — the editor's own back control or the browser's Back —
  re-attaches that same node and puts the page back where it was, rather than at the top.
  Keeping the node keeps the filter chip
  it was on and every thumbnail it has already drawn, so nothing is rebuilt on the way back.

  The browser's own scroll restoration is off: on a Back to `#/` it would restore the offset it
  recorded for that entry against the EDITOR's page, which never scrolls — so it lands on 0, the
  very bug, and then fights the offset set here.
*/
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
let gallery: HTMLElement | null = null;
let galleryScroll = 0;

function show(node: HTMLElement, scrollY = 0) {
  if (app.firstElementChild === node) return; // already showing: leave the page where it is
  if (gallery && app.firstElementChild === gallery) galleryScroll = window.scrollY;
  app.replaceChildren(node);
  window.scrollTo(0, scrollY);
}

function route() {
  const m = /^#\/t\/([\w-]+)/.exec(location.hash);
  const t = m ? templateById(m[1]!) : undefined;
  if (!t) {
    if (location.hash && location.hash !== '#/') history.replaceState(null, '', '#/');
    gallery ??= createGallery((picked) => { location.hash = `#/t/${picked.id}`; });
    show(gallery, galleryScroll);
    return;
  }
  rememberOpened(t.id); // the gallery's "Recently opened", whichever way the editor was reached
  show(createEditor({
    template: t,
    values: carried,
    onBack: () => { carried = {}; location.hash = '#/'; },
    onSwitch: (id, values) => { carried = { ...values }; location.hash = `#/t/${id}`; },
  }));
  carried = {};
}

window.addEventListener('hashchange', route);
route();
