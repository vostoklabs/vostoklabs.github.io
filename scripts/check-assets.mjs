#!/usr/bin/env node
/*
  pnpm check:assets

  Every font, typeface, symbol set, pattern set and model an app can bundle has a row in the
  asset registry (assets.json, and assets.private.json for gitignored files; see
  scripts/lib/assets.mjs), and every row is one a product may ship. It fails on:

  - a licence outside OFL-1.1, Apache-2.0, MIT, ISC and CC0-1.0;
  - an OFL face shipped modified (a cut, a conversion) under a name its licence reserves;
  - an asset file no row claims, or one that is not the file its row was written for (a
    hand-added or hand-replaced asset);
  - licence text inside a file that contradicts its row: an end-user licence agreement,
    personal-use, non-commercial or no-derivatives terms, the GPL, CC BY, or another licence;
  - a row whose notice file is missing or is not that licence's text;
  - a published registry that names a gitignored file.

    node scripts/check-assets.mjs          the check
    node scripts/check-assets.mjs --list   and which apps carry each row

  ## Why this exists

  "Only allowed licences, and anything else or unknown is replaced, never excepted" is a rule
  nobody can keep by reading: a font arrives as a file, and what the file is licensed under is
  written somewhere else. The font API's builds carry no Reserved Font Name to read, and a
  typeface can carry an end-user licence agreement inside it while its notice says Apache-2.0.
  This reads what the files say, and holds each to a row that says where it came from.

  Files are read from the disk, private ones included, as the other checks do; on a public clone
  the private files and their registry are simply absent.
*/

import { readFileSync, existsSync } from 'node:fs';
import { abs, ignored, privateApps } from './lib/source.mjs';
import { ALLOWED, REGISTRY, PRIVATE_REGISTRY, assetKind, contradiction, embedded, fileHash, licenceAllowed, publicPaths, readRegistry, NOTICE_MARKS } from './lib/assets.mjs';
import { assetFiles } from './assets.mjs';
import { reach, appIds } from './lib/bundle.mjs';
import { reservedFontNames, reservedNameIn } from '../packages/fonts/scripts/reserved-names.mjs';

/*
  Rows that fail and are known to, each with the reason and the evidence. Shrink-only: an entry
  goes when its row is fixed or removed, and the check fails while one is no longer needed. A
  new failure is fixed, never added here.
*/
/** @type {{ id: string, reason: string, evidence: string }[]} */
const EXCEPTIONS = [];

const KINDS = new Set(['font', 'typeface', 'ui-font', 'icons', 'ui-icons', 'symbols', 'patterns', 'model', 'data']);
const SHIPS_AS = new Set(['original', 'cut', 'converted']);
const LIST = process.argv.includes('--list');

const rows = readRegistry();
const problems = [];
const excused = new Map(); // row id -> what its exception covered
const exception = new Map(EXCEPTIONS.map((e) => [e.id, e]));
const refresh = (row) => (row.writtenBy === 'packages/fonts/scripts/fetch-fonts.mjs'
  ? 'pnpm --filter @vostok/fonts fetch-fonts'
  : row.writtenBy === 'hand' ? `describe it again by hand in ${PRIVATE_REGISTRY}` : 'pnpm gen:assets');
/** A failure; `excusable` ones (the licence, what the file says) are what EXCEPTIONS can cover. */
const fail = (row, what, excusable = false) => {
  if (excusable && exception.has(row.id)) {
    excused.set(row.id, [...(excused.get(row.id) ?? []), what]);
    return;
  }
  problems.push(`${row.id}: ${what}`);
};

const bufs = new Map();
const read = (p) => {
  if (!bufs.has(p)) bufs.set(p, readFileSync(abs(p)));
  return bufs.get(p);
};
const hashes = new Map();
const hashOf = (p) => {
  if (!hashes.has(p)) hashes.set(p, fileHash(p, read(p)));
  return hashes.get(p);
};

// The rows themselves
const leaked = ignored(publicPaths());
for (const row of rows) {
  if (!KINDS.has(row.kind)) fail(row, `kind "${row.kind}" is not one of ${[...KINDS].join(', ')}`);
  if (!SHIPS_AS.has(row.shipsAs)) fail(row, `shipsAs "${row.shipsAs}" is not original, cut or converted`);
  if (!licenceAllowed(row.licence)) fail(row, `licence ${row.licence} is not allowed (allowed: ${ALLOWED.join(', ')})`, true);
  for (const [path, hash] of Object.entries(row.files)) {
    if (leaked.has(path)) problems.push(`${REGISTRY} names ${path}, which is gitignored: its row belongs in ${PRIVATE_REGISTRY} (pnpm gen:assets)`);
    if (!existsSync(abs(path))) { fail(row, `claims ${path}, which is not on disk: ${refresh(row)}`); continue; }
    if (hashOf(path) !== hash) { fail(row, `${path} is not the file this row was written for: ${refresh(row)}`); continue; }
    if (!assetKind(path)) continue;
    const own = embedded(path, read(path));
    const why = contradiction(own.licence, row.licence);
    if (why) fail(row, `${path}: ${why}`, true);
    // OFL 3: no Modified Version may use a Reserved Font Name. An original carries its name
    // legitimately; a cut or a conversion may not.
    if (row.shipsAs !== 'original' && /\bOFL-1\.1\b/.test(row.licence)) {
      const clash = reservedNameIn(own.names, [...(row.reservedNames ?? []), ...reservedFontNames(own.licence)]);
      if (clash) fail(row, `${path} ships ${row.shipsAs} under the Reserved Font Name "${clash}": ship the original file, or rename it`);
    }
  }
  const notices = row.notice ?? [];
  if (!notices.length) fail(row, 'names no notice file: its licence text has to travel with it');
  for (const n of notices) if (!existsSync(abs(n))) fail(row, `notice ${n} is not on disk`);
  for (const id of String(row.licence).split(/\s+(?:AND|OR)\s+/)) {
    const mark = NOTICE_MARKS[id];
    if (mark && !notices.some((n) => existsSync(abs(n)) && mark.test(readFileSync(abs(n), 'utf8')))) fail(row, `no notice file holds the ${id} text`);
  }
}

// The files on disk
const claims = new Map(); // sha256 -> row ids
for (const row of rows) for (const hash of Object.values(row.files)) claims.set(hash, [...(claims.get(hash) ?? []), row.id]);
const files = assetFiles();
for (const path of files) {
  if (!claims.has(hashOf(path))) problems.push(`${path}: no row claims this file. A new or replaced asset is described by pnpm gen:assets, and a face of @vostok/fonts by its fetch.`);
}

// Exceptions that no longer excuse anything
const stale = EXCEPTIONS.filter((e) => !excused.has(e.id));

// Which apps carry each row: derived from their source, never stored.
const carriers = new Map(rows.map((r) => [r.id, new Set()]));
const rowFiles = new Set(rows.flatMap((r) => Object.keys(r.files)));
const appsOf = new Map();
for (const app of appIds()) {
  const { files: reached } = reach(app);
  for (const path of reached) {
    if (!assetKind(path) && !rowFiles.has(path)) continue;
    const ids = claims.get(hashOf(path)) ?? [];
    for (const id of ids) carriers.get(id)?.add(app);
  }
}
for (const [id, apps] of carriers) appsOf.set(id, [...apps].sort());

if (LIST) {
  const hidden = privateApps();
  for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    const apps = appsOf.get(row.id) ?? [];
    console.log(`${row.id}  ${row.licence}${row.shipsAs !== 'original' ? ` (${row.shipsAs})` : ''}  ${apps.length ? apps.map((a) => (hidden.has(a) ? `${a}*` : a)).join(', ') : 'no app'}`);
  }
  console.log('');
}

if (problems.length) {
  console.error('\nAssets: a file is not one a product may ship as it stands.\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\nOnly ${ALLOWED.join(', ')} ship, and an OFL face never ships modified under a name it reserves. Anything`);
  console.error('else, or of unknown origin, is replaced or removed: never excepted.\n');
}
if (stale.length) {
  console.error('\nAssets: these exceptions no longer excuse anything. Drop them from EXCEPTIONS in scripts/check-assets.mjs:\n');
  for (const e of stale) console.error(`  ${e.id}`);
  console.error('');
}
if (problems.length || stale.length) process.exit(1);
const carried = rows.filter((r) => appsOf.get(r.id)?.length).length;
console.log(`assets ok — ${rows.length} rows, ${files.length} asset files, ${carried} rows carried by an app; ${excused.size} known exceptions`);
