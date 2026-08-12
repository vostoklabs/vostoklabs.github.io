/**
 * Web entry. The generator itself lives in `mount.js`.
 *
 * Split so the same code can run in a browser tab and inside a desktop host, which mounts
 * it into its own element and tears it down again. See mount.js.
 */
import { mount } from './mount.js';

const app = document.querySelector('#app');
if (!app) throw new Error('Missing #app');
mount(app);
