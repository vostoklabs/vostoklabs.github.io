/*
 * The keycap's exports: the single cap, the blank cap, the fit-test row and the full alphabet
 * set. Each goes to MakerLab as an OBJ, to an embedding host as a 3MF for its library, or to the
 * browser's downloads as a 3MF (the alphabet set as one 3MF of 26 caps on one plate).
 *
 * mount.js owns the screen and the state, and hands this module what an export reads through
 * `ctx`, at the moment the export runs:
 *
 *   ctx.$(id)                  an element of this generator
 *   ctx.host                   the desktop host, or undefined on the web
 *   ctx.setStatus(msg, kind)   the status line
 *   ctx.setBusy(text, cancel)  the busy chip (null hides it); ctx.busyText(text) relabels it
 *   ctx.cover()                the stage as a PNG data URL, for MakerLab's cover
 *   ctx.pro()                  the paid panel, or null
 *   ctx.begin(), ctx.end()     take and give back the rebuild lock: a batch must not share the
 *                              engine with a preview rebuild; ctx.busy() says it is taken
 *   ctx.settled()              the carve that matches the panel, once it is made (rebuild.js)
 *   ctx.flushStem()            apply a stem-fit step still waiting for its frame
 *   ctx.state()                what the controls say now (see `exportState` in mount.js)
 *   ctx.fontWrites(id, text)   can this face write every letter of `text` (letterFonts.js); kept
 *                              out of this module, whose node tests have no font library
 */
import { BRAND } from '@vostok/brand';
import { downloadFile, textToArrayBuffer } from '@vostok/export';
import { BLANK_COVER } from '@vostok/export/makerlab';
import { captureCover, ExportBlockedError, licenseAfterExport, toast } from '@vostok/ui-kit';
import { plateSize, loadPlateChoice } from '@vostok/plates';
// MakerLab integration seam. Resolves to a no-op stub in the public build and to the real
// host glue in the MakerWorld build (`--mode makerworld`) — see vite.config.js.
import { MAKERLAB, isReady as mlReady, can as mlCan, sdkExport, sdkToast } from 'virtual:makerlab';
import { buildBodies } from './geometry.js';
import { FONT_OPTIONS, parseLetter } from './letter.js';
import { keycapThreeMF } from './export3mf.js';
import { keycapObjMtl } from './exportObj.js';
import {
  capParts, orientForPrint, blankParts, fitTestParts, capFileName, blankFileName, fitTestFileName,
  alphabetFileName, alphabetLetters, shelfPart,
} from './exportParts.js';
import { createSetCarver, footprintOf, placeCap, setLayout, setTypeSizes } from './alphabetSet.js';
import { textHeightOf } from './legendSize.js';
import { printMatrix } from './meshUtils.js';
import { openAlphabetDialog } from './alphabetDialog.js';
import { CarveDeclined } from './rebuild.js';

/* The licence, on the one export path a file-level mark cannot reach: a comment in an OBJ
   is not metadata, so on the embedded route the licence rides in the export description. */
export const LICENSE_NOTE = `Free for personal use; selling prints requires a commercial license: ${BRAND.urls.mwCommercial}`;

/**
 * The stage as a PNG data URL, for the MakerLab export's cover: one fresh frame, read back in the
 * same task (the kit's `captureCover`). When the canvas cannot be read (a lost WebGL context, or
 * a canvas with no size, which reads back as `data:,`) the shelf's blank picture stands in, so a
 * cover can never cost an export.
 */
export const stageCover = (renderer, scene, camera) => captureCover(renderer, scene, camera, { fallback: BLANK_COVER });

export function createExports(ctx) {
  const { $, host, setStatus } = ctx;

  /**
   * The licence nudge, per invariant #3: the full modal on the first export of a session, a
   * quiet reminder after. Every export path in this file ends here — single cap, blank cap,
   * A-Z batch, host or browser — because a path that forgets to call it is a silent export,
   * which is the thing the invariant exists to prevent. Both no-op inside a desktop host.
   */
  function nudgeLicense() {
    if (ctx.pro()?.hasLicence?.()) return; // owns the lifetime licence: nothing left to pitch
    licenseAfterExport();
  }

  /* The Print settings choice, in the two shapes the two export routes need.

     `printConfig()` is the same choice for the embedded export.

     `projectProcess()` is the same choice for a 3MF we build ourselves: an override over the
     system process in project_settings.config. Classic is the system preset's own value, so it
     is left out rather than written, or Studio would show an untouched process as modified. */
  const printConfig = () => ({ wallGenerator: ctx.state().wallGenerator });
  const projectProcess = () => {
    const walls = ctx.state().wallGenerator;
    return walls === 'classic' ? {} : { wall_generator: walls };
  };

  /**
   * The parts one carve exports, at the stem's current fit, laid out the way the carve's profile
   * prints. A carve brings the cap, the profile and the shine-through setting it was made with,
   * so a file can never pair one cap with another profile's orientation; the colours and the
   * stem's fit are read now (neither is carved).
   *
   * @param {{ bodies: object, profile: object, meta: object, opts: { through: boolean } }} carve
   */
  function buildExportParts(carve, { capColor, logoColor }) {
    ctx.flushStem();
    const { extraColors, stem } = ctx.state();
    const through = !!carve.opts.through;
    return orientForPrint(capParts(carve.bodies, { capColor, logoColor, through, extraColors, stem }), carve.profile, carve.meta);
  }

  /**
   * Deliver the finished keycap.
   *
   * In the MakerWorld build, when embedded, hand the host an OBJ (one `o` object per part)
   * plus an MTL carrying the colours.
   *
   * Standalone (public site, or the built app opened outside the host) still downloads the
   * two-colour .3mf we build ourselves — unchanged.
   *
   * @param {() => Array} makeParts  Deferred so the standalone path doesn't pay for OBJ work
   *                                 and the host path doesn't pay for 3MF zipping.
   * @param {{ cover?: string, what?: string }} [more]  `cover`: MakerLab's cover picture, the
   *        stage's when left out; `what`: what MakerLab's toast says was exported
   * @returns {Promise<boolean>} whether the file went out
   */
  async function deliverModel(makeParts, baseName, downloadMsg, description, { cover, what = 'Keycap' } = {}) {
    if (MAKERLAB && mlReady() && mlCan('export')) {
      setStatus('Sending to MakerLab…');
      try {
        const { obj, mtl } = keycapObjMtl(makeParts(), { mtlFileName: `${baseName}.mtl` });
        const result = await sdkExport({
          artifacts: [
            {
              fileName: `${baseName}.obj`,
              format: 'obj',
              buffer: textToArrayBuffer(obj),
              mtl,
              coverImage: cover ?? ctx.cover(),
              description: `${description} ${LICENSE_NOTE}`,
              printConfig: printConfig(),
            },
          ],
        });
        if (result.success) {
          setStatus('Exported to MakerLab ✓');
          sdkToast({ message: `${what} exported to MakerLab`, type: 'success' });
          nudgeLicense();
          return true;
        }
        setStatus(`Export failed: ${result.errorMessage ?? result.errorCode}`, 'err');
        sdkToast({ message: 'Export failed', type: 'error' });
      } catch (err) {
        console.error(err);
        setStatus(`Export failed: ${err.message || err}`, 'err');
      }
      return false;
    }

    const blob = keycapThreeMF(makeParts(), { process: projectProcess() });

    if (host) {
      // With a host the file goes to the host's own export path rather than the browser's
      // download bar.
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const { indexed } = await host.exportToLibrary(
          { name: `${baseName}.3mf`, bytes },
          { designer: 'Keycap Legend Generator' },
        );
        setStatus(indexed ? 'Exported to your library ✓' : `Exported as ${baseName}.3mf ✓`);
        toast(indexed ? 'Exported to your library' : `Exported as ${baseName}.3mf`, { kind: 'success' });
        nudgeLicense();
        return true;
      } catch (err) {
        console.error(err);
        setStatus(`Export failed: ${err.message || err}`, 'err');
      }
      return false;
    }

    downloadFile(blob, `${baseName}.3mf`, 'model/3mf');
    setStatus(downloadMsg);
    // The status line is 12px of muted grey in the corner of the viewport, which is the whole
    // reason a finished export used to feel like nothing had happened. The detail stays there;
    // the toast is the part you cannot miss.
    toast(downloadMsg.split('  ')[0], { kind: 'success' });
    nudgeLicense();
    return true;
  }

  /** Export whatever fit-test row is currently on screen, through the one export function
   *  every other path in this app uses — provenance, the licence nudge, and the MakerLab vs
   *  browser branching all come for free (invariant 8). */
  async function exportFitTest() {
    // A stem-fit step still waiting for its frame rebuilds the row first: the frame stops in a
    // background tab, and a press just before the click must be the row that goes out.
    ctx.flushStem();
    const { fitTestPieces: pieces, capColor, profileTag } = ctx.state();
    if (!pieces?.length) return;
    const n = pieces.length;
    await deliverModel(
      () => fitTestParts(pieces, capColor),
      fitTestFileName(profileTag),
      `Exported fit test 3MF ✓  ${n} piece${n === 1 ? '' : 's'} to test-fit, one filament.`,
      `Keycap stem fit test (${n} piece${n === 1 ? '' : 's'}), made with the Keycap Legend Generator.`,
    );
  }

  /**
   * The one primary action, whatever the mode is pointed at.
   *
   * A named async function rather than the click handler it used to be, because the footer has
   * to be able to AWAIT it. The kit's export panel disables its buttons for as long as
   * `onExport` is pending — but the footer reached this through `$('export').click()`, which
   * returns the moment the handler starts, so the button un-greyed itself immediately and a
   * twenty-minute keyboard set ran with no sign that anything had happened.
   */
  async function runPrimaryExport() {
    // Checked BEFORE the Pro panel gets a say: Fit test is free, and unlike Full set it does
    // not take the stage, so a paid mode active underneath it (Double legends) would otherwise
    // get first refusal here even while Fit test is what is actually on screen.
    if (ctx.state().fitTestActive) { await exportFitTest(); return; }
    // The footer's primary button is the same button in every mode. When a Pro mode owns the
    // stage it owns this too — the keyboard set generates a board, not the cap behind it — so
    // it gets first refusal before the single-cap path runs.
    if (await ctx.pro()?.handleExport?.()) return;
    // The cap the panel describes: a change made a moment ago is carved first, where this used
    // to take whichever carve had finished last. One that cannot be carved is refused, in words,
    // rather than answered with the cap from before it.
    let carve;
    try {
      carve = await ctx.settled();
    } catch (err) {
      // A cap the build refuses for an error it found (its diagnostics, decision 17) is refused
      // in that error's own words; "nothing yet" and a failed carve get the app's sentences.
      const msg = err instanceof ExportBlockedError
        ? err.message
        : err instanceof CarveDeclined || err?.name === 'NothingBuiltError'
          ? 'Nothing to export yet: pick a legend for the cap first.'
          : 'Nothing exported: this legend could not be carved (try a simpler icon/letter or smaller size).';
      setStatus(msg, 'err');
      throw new Error(msg); // the export panel says it too
    }
    const { capColor, logoColor } = ctx.state();
    const baseName = capFileName(carve.legend.name, carve.profileTag);
    // Counted from the parts rather than assumed to be two: a cap with a second legend in its
    // own colour is a three-filament print, and "assign two filaments" would be wrong advice
    // at the one moment the user is standing in front of the slicer.
    const parts = buildExportParts(carve, { capColor, logoColor });
    const filaments = new Set(parts.map((p) => p.extruder)).size;
    const count = ['no', 'one', 'two', 'three', 'four'][filaments] ?? String(filaments);
    await deliverModel(
      () => parts,
      baseName,
      carve.opts.singleColor
        ? 'Exported 3MF ✓  Single-colour cap with an engraved legend, one filament.'
        : `Exported 3MF ✓  Open in your slicer and assign ${count} filaments.`,
      `Keycap in ${count} colour${filaments === 1 ? '' : 's'}, made with the Keycap Legend Generator.`
    );
  }

  // Export the bare cap (uncarved shell + stem) in a single colour — no legend.
  // Works for any size; uses the loaded shell directly (already a clean indexed solid).
  async function exportBlank() {
    ctx.flushStem();
    if (!ctx.state().shell) return;
    await deliverModel(
      () => {
        const { shell, stem, capColor } = ctx.state();
        return blankParts(shell, stem, capColor);
      },
      blankFileName(ctx.state().profileTag, ctx.state().unitId),
      'Exported blank keycap ✓  Single-colour cap with no legend.',
      'Blank keycap, made with the Keycap Legend Generator.'
    );
  }

  // -------------------------------------------------------- full alphabet set
  // 26 keycaps, one per letter, in the current font and placement/colour settings, laid out on one
  // plate in one file. The button opens a window first (alphabetDialog.js): what the set is, the
  // plate as it will be exported, capitals or small letters. The letters are carved while it is
  // open, with the same buildBodies path as the live preview, so what you set up for one letter
  // is what every cap in the set gets, and Generate writes the caps the picture shows.
  const alphabetBtn = $('alphabetSet');

  /** The A–Z set is made of 1u caps: on any other size the button is not there (hidden, never
   *  greyed), and what it does is its tooltip rather than a paragraph under it. */
  function updateAlphabetAvailability() {
    const ok = ctx.state().unit === 1;
    alphabetBtn.hidden = !ok;
    alphabetBtn.disabled = ctx.busy();
    alphabetBtn.title = `26 keycaps, A–Z or a–z, in your font and settings, on one plate ${MAKERLAB ? 'sent to MakerLab' : 'in one 3MF'}. Shows the plate first.`;
  }

  /**
   * Start a set: the cap and the settings as they are now, the plate laid out for them, and a
   * carver that fills it a letter at a time. The set holds the rebuild loop from here until
   * `close()`, so no preview carve runs Manifold beside it; a change made meanwhile is carved for
   * the preview once the set lets go. Null when there is nothing to carve or the loop is not free.
   */
  async function startAlphabetSet() {
    if (ctx.state().unit !== 1 || !ctx.state().meta || !ctx.state().shell) return null;
    // A carve in progress finishes first (a press during one used to be dropped). Never awaited
    // once the set holds the loop: it would wait for the set's own release.
    const carved = await ctx.settled().catch(() => null);
    ctx.flushStem();
    const { fontId, opts, capColor, logoColor, through, profileTag, unit, meta, shell, profile, stem } = ctx.state();
    if (unit !== 1 || !meta || !shell) return null;
    if (!ctx.begin()) {
      setStatus('The preview is still rebuilding. Try again in a moment.', 'warn');
      return null;
    }
    // The loop's `busy` says nothing of a hold, so the button is the set's to disable.
    alphabetBtn.disabled = true;

    try {
      const fontName = FONT_OPTIONS.find((f) => f.id === fontId)?.name || 'font';
      // Every cap is the same 1u, so the blank cap gives the plate its grid, and each carved cap
      // is moved by the blank's amount: the caps line up whatever their legends.
      const blank = orientForPrint(blankParts(shell, stem, capColor), profile, meta);
      const footprint = footprintOf(blank);
      const layout = setLayout(26, footprint, plateSize(loadPlateChoice()));
      // 26 1u caps fit on every plate the picker offers (tests/alphabet-set.test.mjs).
      if (layout.plates > 1) throw new Error(`the set needs ${layout.plates} plates`);

      // Which cases the font can write: one it cannot would carve placeholder glyphs.
      const writes = {
        upper: ctx.fontWrites?.(fontId, alphabetLetters('upper')) ?? true,
        lower: ctx.fontWrites?.(fontId, alphabetLetters('lower')) ?? true,
      };
      // One type size for the set (alphabetSet.js `setTypeSizes`): every capital as tall as the
      // next, the small letters at the capitals' scale. The capitals' height is read off the Size
      // slider the way the single cap reads its text height: the height of the text on the cap
      // now, or the slider itself when the cap carries an icon.
      const legends = new Map();
      const lettersOf = (c) => (writes[c] ? [...alphabetLetters(c)].map((ch) => [ch, parseLetter(ch, fontId, 1)]) : null);
      const byCase = { upper: lettersOf('upper'), lower: lettersOf('lower') };
      for (const list of Object.values(byCase)) for (const [ch, legend] of list ?? []) legends.set(ch, legend);
      const asked = carved?.legend?.metrics ? textHeightOf(carved.legend.box, carved.opts.widthMM) : opts.widthMM;
      const types = setTypeSizes(byCase, meta, asked, opts.rotationDeg);
      const placeOf = (letter) => types[letter === letter.toLowerCase() ? 'lower' : 'upper']?.places.get(letter);

      const viewParts = (parts) => parts.map((p) => {
        const s = shelfPart(p);
        return { name: s.name, positions: s.positions, indices: s.indices, color: s.color };
      });
      const blanks = layout.slots.map((slot) => viewParts(placeCap(blank, '', slot, footprint)));
      const views = new WeakMap();

      let current = null;
      let ending = false;
      let chip = false;
      let exported = false;
      let closing = null;

      /** The status line and the busy chip, for the case being carved. */
      const report = () => {
        if (ending || current === null) return;
        const { done, total, error, next } = carver.progress(current);
        if (!error && done < total) {
          setStatus(`Generating alphabet set… ${next} (${done + 1}/${total})`);
          // The chip once, then its text: rebuilding it would throw away its own "Cancelling…".
          if (!chip) ctx.setBusy('generating…', () => session.requestClose?.());
          chip = true;
          ctx.busyText(`generating ${next} (${done + 1}/${total})…`);
          return;
        }
        if (error) setStatus('Could not generate the alphabet set (try a simpler font or smaller size).', 'err');
        else setStatus(`Alphabet set ready ✓  ${total} keycaps on one plate.`);
        if (chip) ctx.setBusy(null);
        chip = false;
      };

      const carver = createSetCarver({
        letters: alphabetLetters,
        carve: async (letter, i) => {
          try {
            // At the set's type size: its size, and the nudge that puts its band on the middle.
            const place = placeOf(letter);
            const bodies = await buildBodies(shell, meta, legends.get(letter) ?? parseLetter(letter, fontId, 1), place
              ? { ...opts, widthMM: place.widthMM, centerX: opts.centerX + place.dx, centerY: opts.centerY + place.dy }
              : opts);
            try {
              const parts = buildExportParts({ bodies, profile, meta, opts: { through } }, { capColor, logoColor });
              return placeCap(parts, letter, layout.slots[i], footprint);
            } finally {
              bodies.keycapGeometry.dispose();
              bodies.logoGeometry?.dispose();
            }
          } catch (err) {
            console.error(err); // the carver keeps it, and the window names the letter
            throw err;
          }
        },
        onChange: () => {
          report();
          session.onChange?.();
        },
      });

      const session = {
        fontName,
        layout,
        /** The caps print standing on their side (the profile turns them), legends to the front. */
        standing: !!printMatrix(profile, meta),
        writes,
        /** One case's type size: how tall a capital is at its scale, and the letter that held it
         *  below the asked size so it would fit its cap (null when nothing did). */
        typeSize(letterCase) {
          const t = types[letterCase];
          if (!t) return null;
          const by = t.fit < 1 ? t.limit : letterCase === 'lower' && types.upper?.fit < 1 ? types.upper.limit : null;
          return { capHeightMM: t.capHeightMM, shrunkFor: by };
        },
        /** Set by the window: called after every change, and to close it from the busy chip. */
        onChange: null,
        requestClose: null,
        want(letterCase) {
          current = letterCase;
          carver.want(letterCase);
        },
        progress: (letterCase) => carver.progress(letterCase),
        whenReady: (letterCase) => carver.whenReady(letterCase),
        /** One case's plate for the picture: the caps carved so far, then blank ones. */
        previewParts(letterCase) {
          const { caps } = carver.progress(letterCase);
          return layout.slots.flatMap((_, i) => {
            const cap = caps[i];
            if (!cap) return blanks[i];
            if (!views.has(cap)) views.set(cap, viewParts(cap.parts));
            return views.get(cap);
          });
        },
        /**
         * Write one case's set through the app's one export path: one 3MF of 26 caps (each its own
         * slicer object, on the single cap's filament slots), or one plate to MakerLab with
         * `cover` as its picture. Waits for the last letter. Resolves whether it went out.
         */
        async deliver(letterCase, { cover } = {}) {
          const caps = await carver.whenReady(letterCase);
          if (!caps) return false;
          const parts = caps.flatMap((cap) => cap.parts);
          const range = letterCase === 'lower' ? 'a–z' : 'A–Z';
          const filaments = new Set(parts.map((p) => p.extruder)).size;
          const count = ['no', 'one', 'two', 'three', 'four'][filaments] ?? String(filaments);
          try {
            const ok = await deliverModel(
              () => parts,
              alphabetFileName(fontName, profileTag, letterCase),
              `Exported full alphabet set ✓  26 keycaps (${range}) on one plate. Open it in your slicer and assign ${count} filament${filaments === 1 ? '' : 's'}.`,
              `Full alphabet set (${range}): 26 keycaps on one print plate, made with the Keycap Legend Generator.`,
              { cover, what: 'Alphabet set' },
            );
            exported ||= ok;
            return ok;
          } catch (err) {
            console.error(err);
            setStatus(`Could not write the alphabet set: ${err.message || err}`, 'err');
            return false;
          }
        },
        /** Stop carving, free every cap, and give the loop back. Once, however often it is called. */
        close() {
          closing ??= (async () => {
            ending = true;
            const wasCarving = carver.busy;
            try {
              const caps = await carver.stop();
              for (const cap of caps) for (const p of cap.parts) p.geom.dispose();
            } finally {
              // The lock back first, and the live preview rebuilt for the current inputs: nothing
              // after it here can then keep the loop held, and with it every later Export.
              ctx.end();
              try {
                ctx.setBusy(null);
              } finally {
                updateAlphabetAvailability();
              }
            }
            if (wasCarving && !exported) {
              setStatus('Alphabet set cancelled. Nothing was exported.', 'warn');
              // Toast as well as status: the rebuild's own "Ready ·  …" lands on this line a
              // moment later and wipes the only notice there was.
              toast('Alphabet set cancelled', { kind: 'warn' });
            }
          })();
          return closing;
        },
      };
      return session;
    } catch (err) {
      ctx.end();
      ctx.setBusy(null);
      updateAlphabetAvailability();
      throw err;
    }
  }

  /** "Get full alphabet set": the window first, and the export from its Generate. */
  async function openAlphabetSet() {
    let session = null;
    try {
      session = await startAlphabetSet();
      if (!session) return;
      openAlphabetDialog({
        session,
        fontName: session.fontName,
        writes: session.writes,
        toHost: !!(MAKERLAB && mlReady() && mlCan('export')),
      });
    } catch (err) {
      console.error(err);
      session?.close().catch(() => {});
      setStatus('Could not generate the alphabet set (try a simpler font or smaller size).', 'err');
    }
  }

  alphabetBtn.addEventListener('click', () => void openAlphabetSet());

  return { runPrimaryExport, exportBlank, updateAlphabetAvailability, nudgeLicense, printConfig, buildExportParts, startAlphabetSet };
}
