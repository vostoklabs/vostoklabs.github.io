// How long the geometry worker may take over one build before it counts as stuck, and the race
// that holds a build to it. Pure, so a node test can hold both to their numbers.
import { BuildTimeoutError } from '@vostok/ui-kit/build-loop';
import type { BuildInput } from './types';

/**
 * The time a build may take, ms: a minute, and two seconds more for every piece of the run. A
 * Batch is a piece a name, at about a quarter of a second each on a fast machine, so a long list
 * still finishes on a slow one; a worker that answers nothing at all is let go after a minute.
 */
export function deadlineFor(input: Pick<BuildInput, 'parts'>): number {
  return 60_000 + 2_000 * (input.parts?.length ?? 0);
}

/** `work`'s answer, or a `BuildTimeoutError` once `ms` have passed without one, `onLate` being
 *  called then (after the rejection, so `work` failing because of it changes nothing). */
export function withDeadline<T>(work: Promise<T>, ms: number, onLate: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new BuildTimeoutError(ms));
      onLate();
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
