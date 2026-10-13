// The preview's sample picture as a viewer part (src/photoPreview.ts), in node with no browser:
// the crop that covers a rectangle of any shape without stretching the picture, and a quad that
// faces the customer with the picture upright and not mirrored.
import { coverUv, photoPart } from '../src/photoPreview';

let failures = 0;
let checks = 0;
function check(ok: boolean, what: string) {
  checks++;
  if (!ok) {
    failures++;
    console.error('FAIL', what);
  }
}
/** Close enough for a uv kept in a Float32Array. */
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/* ------------------------------------------------------------------ the crop */

{
  const same = coverUv(4 / 3, 4 / 3);
  check(same.u0 === 0 && same.u1 === 1 && same.v0 === 0 && same.v1 === 1, 'the same shape as the picture: all of it');
  const shapes: [number, number][] = [[46 / 62, 4 / 3], [54 / 86, 4 / 3], [1, 4 / 3], [3 / 2, 4 / 3], [2, 4 / 3], [62 / 46, 4 / 3], [1, 3 / 4], [0.5, 1], [2.5, 1]];
  for (const [rect, image] of shapes) {
    const { u0, u1, v0, v1 } = coverUv(rect, image);
    const what = `a ${rect.toFixed(3)} rectangle on a ${image.toFixed(3)} picture`;
    check(near(((u1 - u0) * image) / (v1 - v0), rect), `${what}: the part shown has the rectangle's shape, so nothing is stretched`);
    check(near(u0 + u1, 1) && near(v0 + v1, 1), `${what}: the middle of the picture`);
    check(u0 >= 0 && u1 <= 1 && v0 >= 0 && v1 <= 1, `${what}: inside the picture`);
    check((u0 === 0 && u1 === 1) || (v0 === 0 && v1 === 1), `${what}: all of the picture one way, so it covers`);
  }
  const instant = coverUv(46 / 62, 4 / 3);
  check(instant.v0 === 0 && instant.v1 === 1 && near(instant.u1 - instant.u0, 46 / 62 / (4 / 3)), 'an instant print on a landscape picture: its whole height and the middle of its width');
  const wide = coverUv(2, 4 / 3);
  check(wide.u0 === 0 && wide.u1 === 1 && near(wide.v1 - wide.v0, 4 / 3 / 2), 'a wide plaque on the same picture: its whole width and the middle of its height');
}

/* ------------------------------------------------------------------ the quad */

{
  // A 46 x 62 print standing upright, seen from the front: from -y, where the viewer's front view
  // stands, with +x to the customer's right and +z up.
  const image = { naturalWidth: 1200, naturalHeight: 900, width: 0, height: 0 } as unknown as HTMLImageElement;
  const part = photoPart([[-23, 0, 0], [23, 0, 0], [23, 0, 62], [-23, 0, 62]], image);
  const uv = part.uv!;
  check(part.positions.length === 12 && part.indices.join() === '0,1,2,0,2,3' && uv.length === 8, 'two triangles on four corners, a uv for each');
  check(part.texture === image && part.color.join() === '255,255,255' && part.name === 'photo', 'the picture, on white, named');
  const corner = (i: number) => [part.positions[i * 3]!, part.positions[i * 3 + 1]!, part.positions[i * 3 + 2]!];
  for (let t = 0; t < part.indices.length; t += 3) {
    const [a, b, c] = [corner(part.indices[t]!), corner(part.indices[t + 1]!), corner(part.indices[t + 2]!)];
    // The y of (b - a) x (c - a): negative is a face turned to -y, towards the customer.
    const normalY = (b[2]! - a[2]!) * (c[0]! - a[0]!) - (b[0]! - a[0]!) * (c[2]! - a[2]!);
    check(normalY < 0, `triangle ${t / 3} faces the customer`);
  }
  check(uv[2]! > uv[0]! && uv[4]! > uv[6]! && uv[5]! > uv[3]! && uv[7]! > uv[1]!, 'upright and not mirrored: u grows to the right, v upwards');
  const { u0, u1 } = coverUv(46 / 62, 4 / 3);
  check(near(uv[0]!, u0) && near(uv[2]!, u1) && uv[1] === 0 && uv[5] === 1, 'cropped to cover: the middle of the picture, all of its height');

  // The same print lying on its back, face up, read from the front edge: the corners say which way is up.
  const flat = photoPart([[-23, -31, 0], [23, -31, 0], [23, 31, 0], [-23, 31, 0]], image);
  check(flat.uv!.join() === part.uv!.join(), 'lying flat, the same crop: only the corners moved');

  // A canvas is measured by its width and height.
  const canvas = { width: 600, height: 600 } as unknown as HTMLCanvasElement;
  const square = photoPart([[0, 0, 0], [50, 0, 0], [50, 0, 50], [0, 0, 50]], canvas, 'square');
  check(square.uv!.join() === '0,0,1,0,1,1,0,1' && square.name === 'square', 'a square on a square canvas: all of it');
}

console.log(`photo preview: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
