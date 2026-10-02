// The main-thread side of the engine: one worker, one promise per build. The editor decides
// what to coalesce; the gallery uses it to render every template's thumbnail from its own
// default build, so a new template is its own picture.
import type { BuildInput, BuildOutput, WorkerRequest, WorkerResponse } from './types';

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let ready = false;
let nextId = 0;
const pending = new Map<number, { resolve: (out: BuildOutput) => void; reject: (err: Error) => void }>();
const queued: WorkerRequest[] = [];

worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
  const m = e.data;
  if (m.type === 'ready') {
    ready = true;
    for (const q of queued) worker.postMessage(q);
    queued.length = 0;
    return;
  }
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.type === 'error') p.reject(new Error(m.message));
  else p.resolve(m.output);
};

/** Every boolean the part needs, in the worker, as one call. */
export function build(input: BuildInput): Promise<BuildOutput> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    const msg: WorkerRequest = { type: 'build', id, input };
    if (ready) worker.postMessage(msg);
    else queued.push(msg);
  });
}
