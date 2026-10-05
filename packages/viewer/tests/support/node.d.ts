// The little of node the tests use, typed here: the package does not depend on @types/node.
declare const process: { exit(code?: number): never; argv: string[]; env: Record<string, string | undefined> };
