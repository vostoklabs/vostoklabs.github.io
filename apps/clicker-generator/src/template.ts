/**
 * The generator's shell, as a string.
 *
 * It used to live in index.html, which worked for exactly as long as this generator only
 * ever ran as its own page. A desktop host mounts it into an element it already owns and
 * unmounts it again, and there is no index.html in that story — so the shell has to be
 * something `mount()` can stamp into a container.
 *
 * `createUi()` fills the two asides and `createViewer()` takes `#app`; the ids are unchanged
 * so nothing downstream had to move.
 */
export const TEMPLATE = `
    <header id="topbar"></header>
    <main class="vl-app">
      <!-- The scrolling body is created inside by createUi(), so a pinned block (the
           MakerLab credit) can sit in the bottom-left corner. Mirrors #sidebar-right. -->
      <aside id="sidebar-left" class="vl-panel vl-panel--left"></aside>
      <div id="viewport" class="vl-stage">
        <p class="vl-stage__label">Live 3D Preview</p>
        <div id="app"></div>
        <div id="status">Booting…</div>
        <p id="hint" class="vl-stage__hint">Hold left click to rotate, right click to pan, scroll to zoom.</p>
      </div>
      <aside id="sidebar-right" class="vl-panel vl-panel--right"></aside>
    </main>
`;
