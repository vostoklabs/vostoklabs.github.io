// A page opened before a deploy asks for its lazily loaded code (the 3D view, the pattern
// library, the gallery's thumbnails) under the file names of the build it came from, and the
// deploy has replaced those files. Nothing is broken but the page's age (2026-09-29: "3D
// could not start: Failed to fetch dynamically imported module", on the live site after the
// morning's push). Never reload on the customer's behalf: nothing they typed is stored, so a
// reload is theirs to choose after Save.
import { toast } from '@vostok/ui-kit';

/** Each browser words a failed dynamic import its own way. */
export function isStaleChunk(err: unknown): boolean {
  const m = String((err as Error)?.message ?? err);
  return /dynamically imported module|Importing a module script failed/i.test(m);
}

let told = false;

/** A panel that says it in place (the 3D view) — the toast would only repeat it. */
export function staleSaidHere(): void {
  told = true;
}

/** Once per page: when Vite reports code it could not load, say why and what to do. The error
 *  still reaches the caller (no preventDefault). The toast waits a tick, so the caller's own
 *  catch (a microtask) runs first and can say it in place instead; this is for the imports that
 *  have no catch of their own. */
export function watchForStaleChunks(): void {
  window.addEventListener('vite:preloadError', () => {
    setTimeout(() => {
      if (told) return;
      told = true;
      toast('Laser Studio was updated. Save your design, then reload the page.', { kind: 'warn', duration: 15000 });
    }, 0);
  });
}
