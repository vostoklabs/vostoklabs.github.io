/*
  sharp, for the scripts that encode pictures. It is in the pnpm store as a dependency of a
  dependency and linked into no workspace package, so it is loaded from there, whatever version
  folder this install made.
*/

import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export function loadSharp(root) {
  const store = join(root, 'node_modules', '.pnpm');
  const dir = readdirSync(store).find((d) => d.startsWith('sharp@'));
  if (!dir) throw new Error('sharp is not in node_modules/.pnpm: run pnpm install');
  return createRequire(import.meta.url)(join(store, dir, 'node_modules', 'sharp'));
}
