/**
 * Web entry. The generator itself lives in `mount.ts`.
 *
 * Split so the same code can run in a browser tab and inside a desktop host, which mounts
 * it into its own element and tears it down again. See mount.ts.
 */
import { mount } from './mount';

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('Missing #root');
mount(root);
