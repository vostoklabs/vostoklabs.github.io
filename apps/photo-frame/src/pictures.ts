// Pictures of designs: the gallery's cards, the Stand and Holder tiles and the walkthrough's cards.
// Each is the real model, built in a worker of its own (so the stage never waits behind a page of
// pictures) and shot by a viewer that is never on screen, with a sample photo in its window. A
// picture can never drift from what Download gives.
import { workerClient } from '@vostok/ui-kit';
import { createViewer, type Viewer, type ViewerPart } from '@vostok/viewer';
import { FALLBACK_FONT_ID, getFont } from '@vostok/fonts';
import { frameLayout } from './geometry/layout';
import type { BuildRequest, BuildResult, MeshOut } from './geometry/build';
import { designOf } from './designs';
import { composeInk, secondFaceOf, type Faces, type Ink } from './ink';
import { patternInk } from './pattern';
import { photoPart } from './photoPreview';
import { buildSettingsOf, fitSettings, patternOf, specOf } from './rules';
import { samplePhotoImage } from './samples';
import type { FrameSettings } from './settings';
import { printOf } from './sizes';

/** The covert mark's seed, written here so it survives a copy of the source. */
export const SEED = 'vostok-labs/photo-frames/2026';

export async function facesFor(s: FrameSettings): Promise<Faces> {
  const [main, second, symbols] = await Promise.all([getFont(s.font), getFont(secondFaceOf(s.font)), getFont(FALLBACK_FONT_ID)]);
  return { main, second, symbols };
}

/** Everything printed in the second colour: the words, the art and the pattern. */
export async function inkFor(s: FrameSettings): Promise<Ink> {
  const faces = await facesFor(s);
  const pattern = patternOf(s) ? await patternInk(frameLayout(specOf(s), printOf(s)), s.pattern, s.patternSize / 100, s.patternDx, s.patternDy) : null;
  return composeInk(s, faces, pattern);
}

export const toViewer = (m: MeshOut): ViewerPart => ({ name: m.name, positions: m.vertProperties, indices: m.triVerts, color: m.color, stride: m.numProp });

/** The model as it stands, then the stand-in print and its sample photo (last, so the model's
 *  parts keep their places). Neither of those two is ever in a file. */
export function standingParts(result: BuildResult, photo: HTMLImageElement | null): ViewerPart[] {
  const parts = [...result.assembled.map(toViewer), toViewer(result.preview.card)];
  if (photo) parts.push(photoPart(result.preview.photo, photo));
  return parts;
}

/** A sample photo, or null when it will not decode (the plain card shows instead). */
export const sampleImage = (id: string): Promise<HTMLImageElement | null> => samplePhotoImage(id).catch(() => null);

/** Where a picture is taken from: about 20 degrees round from the front and 12 above, so the face,
 *  the photo and the stand all read; from the side, for a stand behind the frame; or from behind,
 *  for what is on the back. */
const FROM: Record<NonNullable<Shot['from']>, [number, number, number]> = {
  front: [0.3346, -0.9192, 0.2079],
  side: [0.866, -0.4415, 0.2347],
  back: [-0.3346, 0.9192, 0.2079],
};

export interface Shot {
  width: number;
  height: number;
  from?: 'front' | 'side' | 'back';
}

/* A few workers, so a page of cards builds side by side rather than one after another. Each starts
   only when it is first given a build. */
const POOL = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
const workers = Array.from({ length: POOL }, () => workerClient<BuildRequest, BuildResult>(() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })));
let turn = 0;
const build = (req: BuildRequest) => workers[turn++ % POOL]!.call(req);

let shooter: Viewer | null = null;
let resting = 0;
function camera(): Viewer {
  clearTimeout(resting);
  // Never on the page: it draws into its own canvas and hands back a picture.
  shooter ??= createViewer(document.createElement('div'), { alpha: true, observeTheme: false, forceContextLoss: true });
  return shooter;
}
/** A viewer draws every frame while it lives, so the one that takes pictures goes a few seconds
 *  after the last, its WebGL context with it, and comes back when the next one is asked for. */
function rest() {
  clearTimeout(resting);
  resting = window.setTimeout(() => {
    shooter?.dispose();
    shooter = null;
  }, 4000);
}

const made = new Map<string, Promise<string | null>>();
const KEEP = 160;

/** A picture of these settings, as a PNG data URL; null when it could not be made. Kept, so the
 *  same picture asked for twice is made once. */
export function pictureOf(raw: FrameSettings, shot: Shot, sample: string = designOf(raw).sample): Promise<string | null> {
  // As the editor would show it: inside the rules, the words sized for the room.
  const s = fitSettings(raw).settings;
  const key = JSON.stringify([s, shot, sample]);
  let picture = made.get(key);
  if (!picture) {
    picture = (async () => {
      const ink = await inkFor(s);
      const result = await build({ s: buildSettingsOf(s), ink: ink.rings, pattern: ink.pattern, seed: SEED });
      const parts = standingParts(result, await sampleImage(sample));
      const url = camera().renderThumbnail(shot.width, parts, { direction: FROM[shot.from ?? 'front'], height: shot.height, tight: true });
      rest();
      return url;
    })().catch((err: unknown) => {
      console.warn('[photo-frame] picture not made', err);
      made.delete(key);
      return null;
    });
    made.set(key, picture);
    if (made.size > KEEP) made.delete(made.keys().next().value!);
  }
  return picture;
}
