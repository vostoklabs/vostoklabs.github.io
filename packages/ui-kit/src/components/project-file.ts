import { toast } from './toast';

/**
 * Read a project file the person picked: its parsed JSON, or `null` after telling them it is not
 * a project file.
 *
 * Every generator had written this for itself (a FileReader, a JSON.parse, an error toast),
 * each slightly differently. The parsed value is untrusted: pass it through the app's own
 * `coerce…()` and then `syncControls()`, so a hand-edited file cannot put a value on screen that
 * the controls would not allow. Saving is `downloadFile()` from `@vostok/export`.
 *
 * Give it `apply` and it runs that on the parsed value inside the same guard: a file that parses
 * but that the app cannot use (a missing field its loader relies on) gets the same message
 * instead of an uncaught error, which is what every hand-written loader did. The cause goes to
 * the console, so a loader bug does not hide behind "not a project file".
 */
export async function readProjectFile(file: File, apply?: (data: unknown) => void | Promise<void>): Promise<unknown | null> {
  try {
    const data: unknown = JSON.parse(await fileText(file));
    if (apply) await apply(data);
    return data;
  } catch (err) {
    console.error(`[project] "${file.name}" could not be opened:`, err);
    toast(`"${file.name}" is not a project file`, { kind: 'error' });
    return null;
  }
}

/**
 * The file's text, honouring a byte-order mark. An editor saving as "Unicode" writes UTF-16,
 * which the loaders' old `FileReader.readAsText` decoded and `Blob.text()` (always UTF-8) does
 * not. The decoder drops the mark itself.
 */
async function fileText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  return new TextDecoder(encoding).decode(bytes);
}
