/*
  What a build has to say about the model it made, and the rule that an error stops the export.

  Each generator grew its own: a list of warning strings, and a status line showing the first
  one. Six showed only `warnings[0]`, one showed none at all, and only Fold-Up Box refused to
  export a model that would not print. This is Fold-Up Box's model, lifted:

   - every diagnostic has a level, and an error means "this will not print";
   - the status line shows the worst one and how many there are (`stageStatus().setDiagnostics`),
     and `diagnosticsList()` shows every one, with what to do about it;
   - an export refuses while any error stands, in that error's own words (`assertExportable`,
     which `buildLoop` runs inside `settled()` when it is given `diagnose`).

  Nothing here touches the DOM, so a worker can build its diagnostics with the same type.
*/

export type DiagnosticLevel = 'error' | 'warning' | 'info';

/** Something the user should know about the model as built, in their words. */
export interface Diagnostic {
  /** `error`: this will not print, and export refuses. `warning`: it will print, though probably
   *  not as hoped. `info`: worth knowing, and nothing is wrong. */
  level: DiagnosticLevel;
  /** What is wrong. An error's message is what a refused export says, word for word. */
  message: string;
  /** What to do about it. */
  fix?: string;
  /** A stable name for code and tests to find this one by. Never shown. */
  code?: string;
}

/** An export refused because the model carries an error. Its message is the error's own. */
export class ExportBlockedError extends Error {
  readonly diagnostic: Diagnostic;
  constructor(diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.name = 'ExportBlockedError';
    this.diagnostic = diagnostic;
  }
}

/**
 * Refuse an export while any diagnostic in the list is an error: throws `ExportBlockedError` in
 * the first error's own words, which the export panel shows as its message. Warnings and notes
 * never refuse.
 *
 * `buildLoop` runs this inside `settled()` when it is given `diagnose`, so an export that awaits
 * the loop needs nothing more. An app without a loop calls it before it writes the file.
 */
export function assertExportable(list: readonly Diagnostic[]): void {
  const error = list.find((d) => d.level === 'error');
  if (error) throw new ExportBlockedError(error);
}
