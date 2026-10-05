import { toast } from './toast';

/**
 * Which app a project file belongs to, and what one looks like. Saving hands it to
 * `markProject`, loading to `readProjectFile`.
 */
export interface ProjectShape {
  /** The app's id, written into every file it saves as `app`. */
  app: string;
  /**
   * Top-level keys every file this app has ever saved carries. A file from before the `app`
   * field opens when it has all of them; one missing any is not this app's project, which is
   * what refuses `{}` and an older file saved by another app.
   */
  keys: readonly string[];
}

/**
 * The object to save: the app's project with the app's id in front, as `app`.
 *
 * A project file used to say nothing about where it came from, so another app's file, or `{}`,
 * opened as defaults with "Project loaded". `readProjectFile` refuses a file whose `app` names
 * another app, and takes the field off again before the app sees the file.
 */
export function markProject<T extends object>(shape: ProjectShape, project: T): { app: string } & T {
  return { app: shape.app, ...project };
}

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
 *
 * Give it the app's `shape` as well and the file is checked before `apply` sees it: one saved by
 * another app (its `app` names another) is refused with a message saying so, and one without
 * this app's keys is not a project file. `apply` gets, and this returns, the file without its
 * `app` field, so the app reads back exactly what it saved.
 */
export async function readProjectFile(
  file: File,
  apply?: (data: unknown) => void | Promise<void>,
  shape?: ProjectShape,
): Promise<unknown | null> {
  let message = `"${file.name}" is not a project file`;
  try {
    let data: unknown = JSON.parse(await fileText(file));
    if (shape) {
      if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
      const { app, ...project } = data as Record<string, unknown>;
      if (app !== undefined && app !== shape.app) {
        message = `"${file.name}" was saved by another generator`;
        throw new Error(`saved by ${String(app)}, not ${shape.app}`);
      }
      const missing = shape.keys.filter((k) => !Object.prototype.hasOwnProperty.call(project, k));
      if (missing.length) throw new Error(`no ${missing.join(', ')}, so not a ${shape.app} project`);
      data = project;
    }
    if (apply) await apply(data);
    return data;
  } catch (err) {
    console.error(`[project] "${file.name}" could not be opened:`, err);
    toast(message, { kind: 'error' });
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
