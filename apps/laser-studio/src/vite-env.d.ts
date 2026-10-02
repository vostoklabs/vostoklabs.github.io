/// <reference types="vite/client" />

/** Every gallery card's picture, drawn at build time (scripts/thumbs.mjs, served by the
 *  `laser-thumbs` plugin in vite.config.ts): template id → a standalone `<svg>` string. A
 *  template missing from it builds its card live. */
declare module 'virtual:laser-thumbs' {
  const thumbs: Record<string, string>;
  export default thumbs;
}
