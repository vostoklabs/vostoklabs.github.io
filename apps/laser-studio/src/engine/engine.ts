// The main-thread side of the engine: one worker, every request answered by its own id
// (`workerClient`), and a worker that dies is replaced on the next build. The editor's build loop
// decides what to coalesce; the gallery uses this to render every template's thumbnail from its
// own default build, so a new template is its own picture.
import { workerClient } from '@vostok/ui-kit';
import type { BuildInput, BuildOutput, WorkerRequest } from './types';

const engine = workerClient<WorkerRequest, BuildOutput | null>(
  () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
);

// The kernel starts loading while the gallery is on screen, as it always has, rather than on the
// first build.
engine.call({ type: 'warm' }).catch((err) => console.error('[laser-studio] the geometry engine failed to start', err));

/** Every boolean the part needs, in the worker, as one call. */
export async function build(input: BuildInput): Promise<BuildOutput> {
  return (await engine.call({ type: 'build', input }))!;
}
