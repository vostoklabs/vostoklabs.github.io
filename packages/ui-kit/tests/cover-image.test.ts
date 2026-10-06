/*
  captureCover() with a stand-in renderer: one fresh frame, read back in the same task, and with
  `fallback` the picture to hand back when the canvas cannot be read.

    pnpm --filter @vostok/ui-kit test
*/
import { captureCover, type RendererLike } from '../src/components/cover-image';

let pass = 0;
const fails: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fails.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
};

const PICTURE = `data:image/png;base64,${'A'.repeat(400)}`;
const BLANK = 'data:image/png;base64,blank';

/** A renderer whose canvas reads back `read` (or throws it), recording what was asked of it. */
function stand(read: string | Error, renderThrows?: Error) {
  const calls: string[] = [];
  const renderer = {
    render: () => {
      calls.push('render');
      if (renderThrows) throw renderThrows;
    },
    domElement: {
      toDataURL: (type?: string) => {
        calls.push(`read ${type}`);
        if (read instanceof Error) throw read;
        return read;
      },
    },
  } as unknown as RendererLike;
  return { renderer, calls };
}

/** Runs `fn` with console.error caught, and returns what it was sent. */
function logged(fn: () => void): unknown[] {
  const sent: unknown[] = [];
  const real = console.error;
  console.error = (...args: unknown[]) => void sent.push(args);
  try {
    fn();
  } finally {
    console.error = real;
  }
  return sent;
}

/* ------------------------------------------------------------------- as before */

{
  const { renderer, calls } = stand(PICTURE);
  check('a fresh frame is drawn, then read back as PNG', captureCover(renderer, {}, {}) === PICTURE && calls.join() === 'render,read image/png');
  const jpeg = stand(PICTURE);
  captureCover(jpeg.renderer, {}, {}, 'image/jpeg');
  check('a format as the last argument still picks the format', jpeg.calls.join() === 'render,read image/jpeg');
  check('without a fallback, a canvas with no size reads back as it came', captureCover(stand('data:,').renderer, {}, {}) === 'data:,');
  let thrown = '';
  try {
    captureCover(stand(new Error('context lost')).renderer, {}, {});
  } catch (e) {
    thrown = (e as Error).message;
  }
  check('without a fallback, a read-back that throws is the caller’s', thrown === 'context lost');
}

/* -------------------------------------------------------------------- fallback */

{
  const { renderer, calls } = stand(PICTURE);
  check('fallback: a picture that reads back is the picture', captureCover(renderer, {}, {}, { fallback: BLANK }) === PICTURE && calls.join() === 'render,read image/png');
  const jpeg = stand(PICTURE);
  captureCover(jpeg.renderer, {}, {}, { mimeType: 'image/jpeg', fallback: BLANK });
  check('fallback: the format rides in the options', jpeg.calls.join() === 'render,read image/jpeg');
  check('fallback: a canvas with no size (data:,) gives the fallback', captureCover(stand('data:,').renderer, {}, {}, { fallback: BLANK }) === BLANK);
  check('fallback: 128 characters or fewer is not a picture', captureCover(stand(PICTURE.slice(0, 128)).renderer, {}, {}, { fallback: BLANK }) === BLANK);
  check('fallback: 129 characters is', captureCover(stand(PICTURE.slice(0, 129)).renderer, {}, {}, { fallback: BLANK }) === PICTURE.slice(0, 129));
  let got = '';
  const sent = logged(() => {
    got = captureCover(stand(new Error('tainted')).renderer, {}, {}, { fallback: BLANK });
  });
  check('fallback: a read-back that throws gives the fallback', got === BLANK);
  check('fallback: and the failure goes to the console, once', sent.length === 1 && String((sent[0] as unknown[])[1]).includes('tainted'));
  const lost = stand(PICTURE, new Error('lost context'));
  logged(() => {
    got = captureCover(lost.renderer, {}, {}, { fallback: BLANK });
  });
  check('fallback: a render that throws gives the fallback, and nothing is read back', got === BLANK && lost.calls.join() === 'render');
  check('fallback: an empty string is a fallback too (a caller that wants "no picture")', captureCover(stand('data:,').renderer, {}, {}, { fallback: '' }) === '');
}

console.log(`\ncover image: ${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
