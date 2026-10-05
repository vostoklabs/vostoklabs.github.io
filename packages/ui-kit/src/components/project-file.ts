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
 * instead of an uncaught error, which is what every hand-written loader did.
 */
export async function readProjectFile(file: File, apply?: (data: unknown) => void | Promise<void>): Promise<unknown | null> {
  try {
    const data: unknown = JSON.parse(await file.text());
    if (apply) await apply(data);
    return data;
  } catch {
    toast(`"${file.name}" is not a project file`, { kind: 'error' });
    return null;
  }
}
