// The main-thread side of the engine: the geometry worker, asked through the kit's worker
// transport. Every build gets exactly its own answer, and a worker that dies fails the build
// waiting on it instead of leaving it hanging.
import { workerClient } from '@vostok/ui-kit';
import type { BuildRequest, BuildResult } from './build';
import type { WorkerRequest } from './worker';

const worker = workerClient<WorkerRequest, BuildResult>(() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));

export function build(request: BuildRequest): Promise<BuildResult> {
  return worker.call({ request });
}
