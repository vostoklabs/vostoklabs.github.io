// The main-thread side of the engine: one worker, every request answered by its own id
// (`workerClient`), and a worker that dies is replaced on the next build. The editor's build loop
// decides what to coalesce; the gallery uses this to render every template's thumbnail from its
// own default build, so a new template is its own picture.
import { BuildTimeoutError, workerClient } from '@vostok/ui-kit';
import { deadlineFor, withDeadline } from './deadline';
import type { BuildInput, BuildOutput, WorkerRequest } from './types';

const engine = workerClient<WorkerRequest, BuildOutput | null>(
  () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
);

// The kernel starts loading while the gallery is on screen, as it always has, rather than on the
// first build.
engine.call({ type: 'warm' }).catch((err) => console.error('[laser-studio] the geometry engine failed to start', err));

/** Bumped each time a build's deadline replaces the worker. */
let generation = 0;

/**
 * Every boolean the part needs, in the worker, as one call.
 *
 * A build still unanswered at its deadline (`deadlineFor`) fails, and the worker it is stuck in is
 * replaced, here rather than by whoever asked: the editor that asked may be gone, and the next
 * build would wait behind it. A build that was waiting behind the stuck one goes again, on the
 * new worker.
 */
export async function build(input: BuildInput): Promise<BuildOutput> {
  const asked = generation;
  try {
    const output = await withDeadline(engine.call({ type: 'build', input }), deadlineFor(input), () => {
      generation += 1;
      engine.restart();
    });
    return output!;
  } catch (err) {
    if (generation !== asked && !(err instanceof BuildTimeoutError)) return build(input);
    throw err;
  }
}
