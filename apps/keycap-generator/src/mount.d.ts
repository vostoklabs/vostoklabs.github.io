/**
 * Types for `mount.js`.
 *
 * This generator is JavaScript, and it stays JavaScript — rewriting 2,300 working lines into
 * TypeScript to satisfy a host is exactly the kind of churn that forks a codebase which is
 * still live and still shipping on the web. But the host *does* type-check the one function
 * it calls, so that one function gets a declaration.
 *
 * The signature must match `GeneratorModule` in Opal's `src/generators/registry.ts`.
 */
import type { DesktopHost } from '@vostok/ui-kit';

/**
 * Builds the generator into `container` and returns its teardown.
 *
 * Call the returned function before dropping the container: it stops the frame loop, hands
 * the WebGL context back, disconnects the observers, and removes the tooltip bubble that
 * lives on `<body>` rather than inside the container.
 */
export function mount(container: HTMLElement, host?: DesktopHost): () => void;
