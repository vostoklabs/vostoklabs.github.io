/**
 * Web entry. The generator itself lives in `mount.ts`.
 *
 * Split so the same code can run in a browser tab and inside a desktop host, which mounts
 * it into its own element and tears it down again. See mount.ts.
 */
import { mount } from './mount';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app');
mount(app);
