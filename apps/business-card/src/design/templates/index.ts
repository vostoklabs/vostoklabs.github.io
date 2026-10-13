// Every template, in the order the Design category shows them. A new template is one file here and
// one line in this list.
import type { Template, TemplateGroup } from '../build';
import { band } from './band';
import { cornerQr } from './corner-qr';
import { dots } from './dots';
import { framed } from './framed';
import { half } from './half';
import { logoTile } from './logo-tile';
import { minimal } from './minimal';
import { monogram } from './monogram';
import { orbit_ } from './orbit';
import { sash_ } from './sash';
import { scanBack } from './scan-back';
import { split } from './split';
import { splitName } from './split-name';
import { swoosh } from './swoosh';
import { tall } from './tall';
import { tap } from './tap';
import { texture } from './texture';
import { window_ } from './window';

export const TEMPLATES: Template[] = [minimal, swoosh, orbit_, split, band, window_, half, framed, tall, logoTile, cornerQr, tap, scanBack, monogram, sash_, dots, splitName, texture];

export const templateById = (id: string): Template => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]!;

/** The template menu's groups, in the order it shows them. */
export const TEMPLATE_GROUPS: { id: TemplateGroup; label: string }[] = [
  { id: 'clean', label: 'Clean' },
  { id: 'shapes', label: 'Shapes' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'qr', label: 'QR and NFC' },
];
