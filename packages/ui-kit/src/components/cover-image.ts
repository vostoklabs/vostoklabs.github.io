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

/** Render one fresh frame and capture it as a data URL (PNG by default). */
export function captureCover(
  renderer: RendererLike,
  scene: unknown,
  camera: unknown,
  mimeType = 'image/png',
): string {
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL(mimeType);
}
