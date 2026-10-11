// The window "Get full alphabet set" opens before anything is exported: what the set is, a picture
// of the plate as it will be exported, capitals or small letters, and Cancel / Generate.
//
// The set is carved while the window is open (exports.js `startAlphabetSet`), so the picture is
// the real plate (blank caps in their places at once, then the carved ones), and Generate writes
// the caps the picture shows instead of carving them a second time.
import { splitDialog, segmentedControl, progressBar, skeleton, el } from '@vostok/ui-kit';
import { createViewer } from '@vostok/viewer';

/** The picture's edge in pixels: about twice the size it is shown at, for a sharp picture on a
 *  high-density screen. */
const PICTURE_PX = 720;

/** A picture as a data URL: what MakerLab takes as a cover, and an <img> shows as it is. */
const dataUrlOf = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/**
 * Open the window on a started set.
 *
 * @param {object} o
 * @param {object} o.session  `startAlphabetSet()`'s set: want, progress, previewParts, whenReady,
 *        deliver, close, layout, standing, typeSize, and the onChange / requestClose hooks this
 *        window fills in
 * @param {string} o.fontName
 * @param {{ upper: boolean, lower: boolean }} o.writes  which cases the font can write
 * @param {boolean} o.toHost  the set goes to MakerLab rather than into a file
 */
export function openAlphabetDialog({ session, fontName, writes, toHost }) {
  let letterCase = writes.upper ? 'upper' : 'lower';
  const canCarve = writes.upper || writes.lower;
  let closed = false;
  /** The picture's own viewer, never shown and never animated: the stage is not touched. */
  let viewer = null;
  /** The picture being taken, while one is. */
  let shooting = null;
  let again = false;
  /** The last whole-plate picture of each case, for MakerLab's cover. */
  const covers = new Map();
  let drawnAt = { letterCase: null, done: -1 };

  const caseSwitch = segmentedControl({
    options: [{ value: 'upper', label: 'ABC' }, { value: 'lower', label: 'abc' }],
    value: letterCase,
    ariaLabel: 'Capitals or small letters',
    onChange: (v) => {
      letterCase = v;
      sayTypeSize();
      session.want(v);
    },
  });
  // A case the font cannot write is not offered, and the line under it says why.
  caseSwitch.hidden = !(writes.upper && writes.lower);
  const note = !canCarve
    ? `${fontName} cannot write A–Z. Pick another font first.`
    : !writes.lower
      ? `${fontName} has no small letters, so the set is capitals.`
      : !writes.upper
        ? `${fontName} has no capitals, so the set is small letters.`
        : '';

  // The case's one type size (alphabetSet.js `setTypeSizes`), with the letter that held it below
  // the Size slider when one had to.
  const sizeLine = el('p', { className: 'vl-hint' });
  const sayTypeSize = () => {
    const t = session.typeSize(letterCase);
    if (!t) return;
    const mm = t.capHeightMM.toFixed(1);
    const lead = letterCase === 'lower' ? `Type sized to ${mm} mm capitals` : `Capitals ${mm} mm tall`;
    sizeLine.textContent = t.shrunkFor ? `${lead}, so “${t.shrunkFor}” fits its cap.` : `${lead}, one size for every letter.`;
  };
  sayTypeSize();

  const controls = el('div', { attrs: { style: 'display: grid; gap: var(--space-3);' } }, [
    el('p', {
      className: 'vl-hint',
      text: `26 keycaps in ${fontName}, with your current style and colours, on one plate ${toHost ? 'sent to MakerLab' : 'in one 3MF'}.`,
    }),
    caseSwitch,
  ]);
  if (canCarve) controls.append(sizeLine);
  if (note) controls.append(el('p', { className: 'vl-hint', text: note }));

  /* Caps lying face up are shown from above, cropped to the block, so the letters read as they do
     on the plate; caps that print standing on their side (Choc) show their legends to the front,
     so they are shown from the three-quarter view instead, whole. */
  const fromAbove = !session.standing;
  const [blockW, blockD] = session.layout.size;
  const aspect = fromAbove ? Math.min(2, Math.max(1, blockW / blockD)).toFixed(3) : '1';
  const picture = el('img', {
    attrs: {
      alt: 'The plate as it will be exported',
      style: `width: 100%; aspect-ratio: ${aspect}; object-fit: cover; border-radius: var(--radius-box); background: var(--bg);`,
    },
  });
  picture.hidden = true; // until its first picture: an empty <img> shows its alt text
  const placeholder = skeleton({ width: '100%', height: 'auto' });
  placeholder.style.aspectRatio = aspect;
  const bar = progressBar({ label: 'Carving the keycaps' });
  const footer = el('span');

  const handle = splitDialog({
    title: 'Full alphabet set',
    size: 'wide',
    stage: el('div', { attrs: { style: 'display: grid; gap: var(--space-2);' } }, [placeholder, picture, bar]),
    controls,
    footer,
    controlsWidth: 260,
    stageMinHeight: 0,
    actions: [
      { label: 'Cancel' },
      { label: 'Generate', primary: true, onClick: () => { void generate(); return false; } },
    ],
    // Cancel, Escape, the backdrop and Generate's own close all end here.
    onClose: () => {
      closed = true;
      session.onChange = null;
      session.requestClose = null;
      const v = viewer;
      viewer = null;
      // A picture still being read back finishes on the renderer first.
      Promise.resolve(shooting).finally(() => v?.dispose());
      session.close().catch((err) => console.error(err));
    },
  });
  /* `dialog()` builds its action buttons and hands back no reference to them; Generate is the one
     that has to show it is working, so it is found the way a test would find it. */
  const generateBtn = handle.root.querySelector('.vl-dialog__actions .vl-btn--primary');
  if (!canCarve) {
    // Nothing to carve or show: the line above says why, and only Cancel is left.
    if (generateBtn) generateBtn.hidden = true;
    placeholder.remove();
    bar.hidden = true;
  }

  try {
    viewer = createViewer(el('div'), { observeTheme: false });
    viewer.setPaused(true); // pictures are drawn on demand; a loop would draw a canvas nobody sees
  } catch (err) {
    console.warn('The alphabet set picture could not be drawn:', err);
  }

  /** Picture, progress bar and footer, for the case on show. The picture is taken when a case
   *  comes on show (its blank plate: the layout at once) and when its last letter is in, not
   *  as it fills: a picture of the plate costs more than a letter, and far more on a machine
   *  drawing without a graphics card, while the bar already shows the progress. */
  function draw() {
    if (closed || !canCarve) return;
    const { done, total, error, next } = session.progress(letterCase);
    bar.hidden = done === total || !!error;
    bar.setValue(done / total);
    footer.textContent = error
      ? `Could not carve “${next}”. Try a simpler font or a smaller size.`
      : done < total
        ? `Carving ${next} · ${done + 1} of ${total}`
        : `${total} caps, ${session.layout.columns} × ${session.layout.rows}, on one plate.`;
    const same = drawnAt.letterCase === letterCase;
    if (!viewer || (same && (drawnAt.done === done || done < total))) return;
    if (shooting) {
      again = true;
      return;
    }
    drawnAt = { letterCase, done };
    const shot = shoot(letterCase, done === total).finally(() => {
      if (shooting === shot) shooting = null;
      if (again && !closed) {
        again = false;
        draw();
      }
    });
    shooting = shot;
  }

  /** The plate as it lies in the file, shot as a cover: from the viewer's top view, or its
   *  three-quarter one for standing caps. */
  async function shoot(c, whole) {
    try {
      viewer.setParts(session.previewParts(c), true);
      if (fromAbove) viewer.setView('top');
      const blob = await viewer.renderCoverPng({ edge: PICTURE_PX, angle: fromAbove ? 'view' : 'iso' });
      if (!blob || closed) return;
      const url = await dataUrlOf(blob);
      if (closed) return;
      if (c === letterCase) {
        // The case may have changed while it was taken.
        picture.src = url;
        picture.hidden = false;
        placeholder.remove();
      }
      if (whole) covers.set(c, url);
    } catch (err) {
      console.warn('The alphabet set picture could not be drawn:', err);
    }
  }

  async function generate() {
    if (!canCarve) return;
    const c = letterCase;
    generateBtn?.setBusy(true);
    caseSwitch.setDisabled(true);
    try {
      // Pressed while the set is still carving: it goes out the moment the last letter is in.
      const caps = await session.whenReady(c);
      // MakerLab's cover is the last picture of the whole plate, which may still be being taken.
      while (toHost && shooting) await shooting;
      if (!caps || closed) return;
      if (await session.deliver(c, { cover: covers.get(c) })) {
        if (!closed) handle.close();
        return;
      }
    } catch (err) {
      // A letter that could not be carved: the footer names it, the status line says the rest.
      console.error(err);
    }
    if (closed) return;
    generateBtn?.setBusy(false);
    caseSwitch.setDisabled(false);
  }

  session.onChange = draw;
  session.requestClose = () => { if (!closed) handle.close(); };
  if (canCarve) session.want(letterCase);
  return handle;
}
