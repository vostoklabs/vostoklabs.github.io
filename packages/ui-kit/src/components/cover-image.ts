/** Cover-image capture that never comes out blank.
 *
 *  The trap (hit in both the clicker and keycap projects): a WebGL canvas whose
 *  renderer was created without `preserveDrawingBuffer` reads back an EMPTY buffer
 *  from `toDataURL()` once the frame has been presented. The fix that costs nothing:
 *  render synchronously, then read back in the same task, no preserveDrawingBuffer
 *  needed, no per-frame overhead.
 */

export interface RendererLike {
  render(scene: unknown, camera: unknown): void;
  domElement: HTMLCanvasElement;
}

export interface CaptureCoverOptions {
  /** The picture's format. Default PNG. */
  mimeType?: string;
  /**
   * What to hand back when the canvas cannot be read: the render or the read-back throws (a lost
   * WebGL context, a canvas a cross-origin picture has tainted), or what comes back is too short
   * to be a picture (128 characters or fewer: a canvas with no size reads back as `data:,`). The
   * failure goes to the console. For a cover that must never cost the export, a blank picture
   * say. Without it, a throw is the caller's and the read-back is returned as it came.
   */
  fallback?: string;
}

/** Render one fresh frame and capture it as a data URL (PNG by default). The last argument is the
 *  format, or the options. */
export function captureCover(
  renderer: RendererLike,
  scene: unknown,
  camera: unknown,
  options: string | CaptureCoverOptions = {},
): string {
  const { mimeType = 'image/png', fallback } = typeof options === 'string' ? { mimeType: options } : options;
  if (fallback === undefined) {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL(mimeType);
  }
  try {
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL(mimeType);
    return url.length > 128 ? url : fallback;
  } catch (err) {
    console.error('Cover capture failed:', err);
    return fallback;
  }
}
