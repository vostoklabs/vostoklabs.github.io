import { toast } from './toast';

/**
 * Read a project file the person picked: its parsed JSON, or `null` after telling them it is not
 * a project file.
 *
 * Every generator had written this for itself (a FileReader, a JSON.parse, an error toast),
 * each slightly differently. The parsed value is untrusted: pass it through the app's own
 * `coerce…()` and then `syncControls()`, so a hand-edited file cannot put a value on screen that
 * the controls would not allow. Saving is `downloadFile()` from `@vostok/export`.
 */
export async function readProjectFile(file: File): Promise<unknown | null> {
  try {
    return JSON.parse(await file.text());
  } catch {
    toast(`"${file.name}" is not a project file`, { kind: 'error' });
    return null;
  }
}
