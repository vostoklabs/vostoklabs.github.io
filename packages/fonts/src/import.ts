// A font the user brings, made usable everywhere at once.
//
// Four generators each did this their own way, and drifted:
//  - two injected a `<style>` @font-face for the previews, which a strict content-security
//    policy refuses without a word. The FontFace API is not a stylesheet and is allowed;
//  - one gave the font a new id on every import, so a saved project that named the font could
//    never find it again after a reopen, and silently rendered in another face;
//  - only one accepted the .zip that font sites actually hand out.
// This is the one version. The previews and pickers are the kit's job (`fontChooser`); keeping
// the file for next time (a desktop host's project assets) stays with the app.
import { unzipSync } from 'fflate';
import { FONTS, type FontChoice } from './registry';
import { fontFamilyFor, isFontSupported, parseFont, registerCustomFont } from './index';

/** A font file's own name for itself, when it has one. */
function familyName(parsed: unknown): string | undefined {
  const names = (parsed as { names?: { fullName?: { en?: string }; fontFamily?: { en?: string } } })?.names;
  return names?.fullName?.en ?? names?.fontFamily?.en;
}

/**
 * A 64-bit fingerprint of the bytes (two FNV-1a passes with different seeds), as the font's id.
 *
 * From the bytes alone, not the file name: a host may hand the same file back as "Font (1).ttf",
 * and a project that names the font must still find it. Short and fixed-length, so an app that
 * caps the length of a saved font id never cuts one in half.
 */
function fingerprint(bytes: Uint8Array): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i]!, 0x01000193);
    b = Math.imul(b ^ bytes[i]!, 0x5bd1e995);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

/**
 * Register one .ttf/.otf/.woff: parsed for the geometry (`getFont(id)`), loaded as a FontFace for
 * the previews (`fontFamilyFor(id)`), and listed first in `FONTS` as a curated face, so every
 * picker shows it. Throws if the bytes are not a font. The same bytes always get the same id,
 * whatever the file is called, and importing them twice returns the entry already there.
 */
export async function importFontBuffer(fileName: string, buffer: ArrayBuffer): Promise<FontChoice> {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const id = `custom-${fingerprint(new Uint8Array(buffer))}`;
  const existing = FONTS.find((f) => f.id === id);
  if (existing) return existing;

  const parsed = parseFont(buffer);
  registerCustomFont(id, parsed);
  if (typeof FontFace !== 'undefined' && typeof document !== 'undefined') {
    const face = new FontFace(fontFamilyFor(id), buffer.slice(0));
    await face.load();
    document.fonts.add(face);
  }
  const choice: FontChoice = {
    id,
    label: familyName(parsed) ?? base,
    category: 'Custom',
    curated: true,
    // A font file says nothing reliable about its coverage here, so it is not flagged as
    // missing anything; the geometry shows the truth.
    subsets: ['latin', 'latin-ext', 'cyrillic', 'greek'],
  };
  FONTS.unshift(choice);
  return choice;
}

/** Every .ttf/.otf/.woff inside a zip, as `[fileName, bytes]`. Folders and other files are skipped. */
function fontsInZip(buffer: ArrayBuffer): [string, ArrayBuffer][] {
  const out: [string, ArrayBuffer][] = [];
  for (const [path, data] of Object.entries(unzipSync(new Uint8Array(buffer)))) {
    if (path.endsWith('/') || !/\.(ttf|otf|woff)$/i.test(path) || path.includes('__MACOSX')) continue;
    out.push([path, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer]);
  }
  return out;
}

/** What one file brought: the fonts that loaded, and the names of any that did not. */
export interface ImportedFonts {
  fonts: FontChoice[];
  /** The file itself, or each font inside a zip, as `[fileName, bytes]`, for an app that keeps
   *  them. Bare file names: a zip's folders are dropped. */
  files: [string, ArrayBuffer][];
  /** The file names that were not fonts, or would not load. */
  failed: string[];
}

/** A .ttf, .otf, .woff or a .zip of them, from a file input or a host's picker. */
export async function importFontFiles(file: File): Promise<ImportedFonts> {
  const buffer = await file.arrayBuffer();
  const files = /\.zip$/i.test(file.name) ? fontsInZip(buffer) : [[file.name, buffer] as [string, ArrayBuffer]];
  const result: ImportedFonts = { fonts: [], files: [], failed: [] };
  for (const [path, bytes] of files) {
    const name = path.replace(/^.*[\\/]/, '');
    try {
      result.fonts.push(await importFontBuffer(name, bytes));
      result.files.push([name, bytes]);
    } catch {
      result.failed.push(name);
    }
  }
  return result;
}

/** A font as the kit's pickers take it. */
export function toPickerFont(f: FontChoice): { id: string; label: string; family: string; category: string } {
  return { id: f.id, label: f.label, family: fontFamilyFor(f.id), category: f.category };
}

/** Whether the font with this id has every character in `text`. An unknown id is not flagged. */
export function fontSupportsText(fontId: string, text: string): boolean {
  const f = FONTS.find((x) => x.id === fontId);
  return f ? isFontSupported(f, text) : true;
}
