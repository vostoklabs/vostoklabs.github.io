/*
  How the stage's message button reads the status line. The message itself sits behind the
  button; the button only says what kind it is: a spinner while a build runs, an "i" for news, a
  "!" in the warning colour for a build's notes, and the error colour when something failed.

  Pure: no DOM, no kit. A note is a warning while the status line still says exactly what the
  build flagged (`statusWarnText`), so a later message (a save, a load) never inherits its colour.
*/

export type StatusTone = 'busy' | 'idle' | 'warn' | 'error';

/** The app's own words for a failure: every one of them starts this way. */
const FAILED = /^(Error\b|Export failed|Could not|Couldn't|Failed\b|That font could not)/;

export function statusTone(s: { status: string; statusWarnText: string; building: boolean }): StatusTone {
  if (s.building) return 'busy';
  if (FAILED.test(s.status)) return 'error';
  if (s.status && s.status === s.statusWarnText) return 'warn';
  return 'idle';
}
