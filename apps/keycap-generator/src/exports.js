/*
 * The keycap's exports: the single cap, the blank cap, the fit-test row and the full alphabet
 * set. Each goes to MakerLab as an OBJ, to an embedding host as a 3MF for its library, or to the
 * browser's downloads as a 3MF (the alphabet set as a zip of them).
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
 */
import { BRAND } from '@vostok/brand';
import { buildZip, downloadFile, textToArrayBuffer } from '@vostok/export';
import { BLANK_COVER } from '@vostok/export/makerlab';
import { captureCover, licenseAfterExport, toast } from '@vostok/ui-kit';
// MakerLab integration seam. Resolves to a no-op stub in the public build and to the real
// host glue in the MakerWorld build (`--mode makerworld`) — see vite.config.js.
import { MAKERLAB, isReady as mlReady, can as mlCan, sdkExport, sdkToast } from 'virtual:makerlab';
import { buildBodies } from './geometry.js';
import { FONT_OPTIONS, parseLetter } from './letter.js';
import { keycapThreeMF } from './export3mf.js';
import { keycapObjMtl } from './exportObj.js';
import {
  capParts, orientForPrint, blankParts, fitTestParts, capFileName, blankFileName, fitTestFileName,
  alphabetFileName, ALPHABET, ALPHABET_MTL, alphabetEntryName,
} from './exportParts.js';
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
   */
  async function deliverModel(makeParts, baseName, downloadMsg, description) {
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
              coverImage: ctx.cover(),
              description: `${description} ${LICENSE_NOTE}`,
              printConfig: printConfig(),
            },
          ],
        });
        if (result.success) {
          setStatus('Exported to MakerLab ✓');
          sdkToast({ message: 'Keycap exported to MakerLab', type: 'success' });
          nudgeLicense();
        } else {
          setStatus(`Export failed: ${result.errorMessage ?? result.errorCode}`, 'err');
          sdkToast({ message: 'Export failed', type: 'error' });
        }
      } catch (err) {
        console.error(err);
        setStatus(`Export failed: ${err.message || err}`, 'err');
      }
      return;
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
      } catch (err) {
        console.error(err);
        setStatus(`Export failed: ${err.message || err}`, 'err');
      }
      return;
    }

    downloadFile(blob, `${baseName}.3mf`, 'model/3mf');
    setStatus(downloadMsg);
    // The status line is 12px of muted grey in the corner of the viewport, which is the whole
    // reason a finished export used to feel like nothing had happened. The detail stays there;
    // the toast is the part you cannot miss.
    toast(downloadMsg.split('  ')[0], { kind: 'success' });
    nudgeLicense();
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
      const msg = err instanceof CarveDeclined || err?.name === 'NothingBuiltError'
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
  // Batch-generate A–Z keycaps in the current font + placement/colour settings and
  // download them as a single ZIP of 3MFs. 1u-only for now (button is disabled on
  // other sizes). Each letter is carved with the same buildBodies path as the live
  // preview, so what you set up for one letter is what every cap in the pack gets.
  const alphabetBtn = $('alphabetSet');
  const alphabetHelp = $('alphabetHelp');

  // The set only makes sense for a 1u cap right now; reflect that on the button.
  function updateAlphabetAvailability() {
    const ok = ctx.state().unit === 1;
    alphabetBtn.disabled = !ok || ctx.busy();
    alphabetHelp.textContent = ok
      ? 'Generates 26 keycaps (A–Z) in the current font & settings, zipped as 3MF files.'
      : 'Full alphabet set is available for the 1u keycap only. Switch size to 1u to enable.';
  }

  async function generateAlphabetSet() {
    if (ctx.state().unit !== 1 || !ctx.state().meta || !ctx.state().shell) return;
    // A carve in progress finishes first (a press during one used to be dropped). Never awaited
    // once the batch holds the loop: it would wait for the batch's own release.
    await ctx.settled().catch(() => {});

    // The cap and the settings as they are now, for every letter: a change made during the
    // batch is carved for the preview once the batch lets go, not half way through the set.
    const { fontId, opts, capColor, logoColor, through, profileTag, unit, meta, shell, profile } = ctx.state();
    if (unit !== 1 || !meta || !shell) return;
    const fontName = FONT_OPTIONS.find((f) => f.id === fontId)?.name || 'font';
    // Host path: one OBJ per letter, handed over as a multi-plate export. Every letter
    // shares the same two colours, so one MTL covers the whole set. Standalone path still
    // zips 26 of our own .3mf files.
    const toHost = MAKERLAB && mlReady() && mlCan('export');
    const files = {};
    const plates = [];
    let plateMtl = '';
    let cancelled = false;

    // The batch holds the loop, so no preview rebuild runs Manifold beside it, and lets go in the
    // `finally` whatever happens: a hold has no timeout, and one never released would leave every
    // later export waiting for good. The loop's `busy` says nothing of a hold, so the button is
    // this function's to disable.
    if (!ctx.begin()) return;
    try {
      alphabetBtn.disabled = true;
      // Twenty-six carves. Same trap the paid keyboard set had: without this the only way out
      // of a slow font was closing the tab.
      ctx.setBusy('generating…', () => { cancelled = true; });
      for (let i = 0; i < ALPHABET.length; i++) {
        if (cancelled) break;
        const ch = ALPHABET[i];
        setStatus(`Generating alphabet set… ${ch} (${i + 1}/26)`);
        // Text only: rebuilding the chip here would throw away the Cancel button's own
        // "Cancelling…" state twenty-six times.
        ctx.busyText(`generating ${ch} (${i + 1}/26)…`);
        await new Promise((r) => setTimeout(r, 0)); // let the spinner/status paint

        const legend = parseLetter(ch, fontId, 1);
        const bodies = await buildBodies(shell, meta, legend, opts);
        const parts = buildExportParts({ bodies, profile, meta, opts: { through } }, { capColor, logoColor });
        if (toHost) {
          const { obj, mtl } = keycapObjMtl(parts, { mtlFileName: ALPHABET_MTL });
          plates.push(textToArrayBuffer(obj));
          plateMtl = mtl;
        } else {
          files[alphabetEntryName(ch)] = new Uint8Array(await keycapThreeMF(parts, { process: projectProcess() }).arrayBuffer());
        }
        bodies.keycapGeometry.dispose();
        bodies.logoGeometry?.dispose();
      }

      if (cancelled) {
        setStatus('Alphabet set cancelled. Nothing was exported.', 'warn');
        // Toast as well as status: the `finally` hands the preview back, and the rebuild's own
        // "Ready ·  …" lands on this line a moment later and wipes the only notice there was.
        toast('Alphabet set cancelled', { kind: 'warn' });
        return; // the finally below still runs: lock released, chip cleared, preview restored
      }

      const baseName = alphabetFileName(fontName, profileTag);

      if (toHost) {
        setStatus('Sending alphabet set to MakerLab…');
        const result = await sdkExport({
          artifacts: [
            {
              fileName: `${baseName}.obj`,
              format: 'obj',
              buffer: plates, // ArrayBuffer[] — one print plate per letter
              mtl: plateMtl,
              coverImage: ctx.cover(),
              description: `Full A–Z keycap alphabet set (26 print plates). ${LICENSE_NOTE}`,
              printConfig: printConfig(),
            },
          ],
        });
        if (result.success) {
          setStatus('Exported alphabet set to MakerLab ✓  26 keycaps (A–Z).');
          sdkToast({ message: 'Alphabet set exported', type: 'success' });
          nudgeLicense();
        } else {
          setStatus(`Export failed: ${result.errorMessage ?? result.errorCode}`, 'err');
          sdkToast({ message: 'Export failed', type: 'error' });
        }
      } else {
        // 3MFs are already deflated zips — store (level 0) rather than re-compress.
        const zipped = buildZip(files, { level: 0 });

        if (host) {
          /*
           * An embedding host takes the set through its own export path, the same way the
           * single-cap path does. `toHost` above is MakerWorld's host, a different one, so
           * without this branch the set would fall through to the browser download below.
           *
           * One zip rather than twenty-six exports: the set is one thing the user asked for.
           */
          try {
            const { indexed } = await host.exportToLibrary(
              { name: `${baseName}.zip`, bytes: new Uint8Array(zipped) },
              { designer: 'Keycap Legend Generator' },
            );
            setStatus(
              indexed
                ? 'Exported the full alphabet set to your library ✓  26 keycaps (A–Z).'
                : `Exported the full alphabet set ✓  26 keycaps (A–Z), as ${baseName}.zip.`,
            );
            toast('Alphabet set exported', { kind: 'success' });
            nudgeLicense();
          } catch (err) {
            console.error(err);
            setStatus(`Export failed: ${err.message || err}`, 'err');
          }
          return;
        }

        downloadFile(zipped, `${baseName}.zip`, 'application/zip');
        setStatus('Exported full alphabet set ✓  26 keycaps (A–Z) zipped. Open each 3MF in your slicer.');
        toast('Alphabet set exported ✓', { kind: 'success' });
        nudgeLicense();
      }
    } catch (e) {
      console.error(e);
      setStatus('Could not generate the alphabet set (try a simpler font or smaller size).', 'err');
    } finally {
      // The lock back first, and the live preview rebuilt for the current inputs: nothing after
      // it in this block can then keep the loop held, and with it every later Export.
      ctx.end();
      ctx.setBusy(null);
      updateAlphabetAvailability();
    }
  }

  alphabetBtn.addEventListener('click', generateAlphabetSet);

  return { runPrimaryExport, exportBlank, updateAlphabetAvailability, nudgeLicense, printConfig, buildExportParts };
}
