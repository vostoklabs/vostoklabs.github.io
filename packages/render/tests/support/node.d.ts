// The little of node the tests use, typed here: the package does not depend on @types/node.
declare const process: {
  argv: string[];
  exitCode: number | undefined;
  exit(code?: number): never;
  on(event: 'beforeExit', listener: () => void): void;
};
