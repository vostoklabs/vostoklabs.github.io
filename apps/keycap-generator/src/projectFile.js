/**
 * The keycap's project file: what Save writes and Load reads on the web. A desktop host keeps
 * projects itself and is handed the same state without it.
 *
 * Save marks the file with the app it came from (`markProject`), and Load reads it through the
 * kit's `readProjectFile` with this shape, so another generator's project, or `{}`, is refused
 * with a message rather than opening as the defaults under "Project loaded". `keys` are fields
 * every keycap project has carried, files from before `app` included: Save has always written
 * the legend's size, depth and rotation.
 */
import { markProject } from '@vostok/ui-kit';

export const PROJECT_FILE = { app: 'keycap-generator', keys: ['size', 'depth', 'rot'] };

/** The file's text for one state, indented as Save has always written it. */
export const projectFileText = (state) => JSON.stringify(markProject(PROJECT_FILE, state), null, 2);
