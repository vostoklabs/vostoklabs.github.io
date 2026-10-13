// The hub's pictures at the size its pages show them. A card's picture is drawn 800 x 600 at most
// and a gallery strip tile at about a tenth of that, but public/ holds whatever a camera or a
// render wrote: thumbnails up to 4000 x 3000 and 5 MB, and a strip that loaded every full-size
// gallery picture to show it as a tile. The home page asked for 17 MB of pictures, a product page
// (whose side column shows every card) 18 to 20 MB.
//
// The build writes a WebP of each at its shown size beside the source (src/site/pictures.ts names
// them), and the dev server makes the same on request, so a picture dropped into public/ needs no
// step. Then the build reads every page it wrote and fails on a picture that is not there, or one
// heavier than PICTURE_MAX: the check that would have caught the 5 MB thumbnails.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import sharp from 'sharp';
import type { Plugin, ViteDevServer } from 'vite';
import { LARGE_WIDTH, STRIP_WIDTH, THUMB_WIDTH, largeFor, stripFor, thumbFor } from './src/site/pictures';

/** The most a picture a page shows may weigh. The heaviest gallery picture is about 350 KB. */
const PICTURE_MAX = 400 * 1024;
const SOURCE = /\.(png|jpe?g|webp)$/i;

interface Job {
  source: string;
  width: number;
  quality: number;
}

const filesUnder = (dir: string): string[] =>
  !existsSync(dir)
    ? []
    : readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? filesUnder(join(dir, d.name)) : [join(dir, d.name)]));

/** Every picture the pages ask for, by its site path, and the source it is made from. */
function jobs(publicDir: string): Map<string, Job> {
  const out = new Map<string, Job>();
  const site = (file: string) => '/' + relative(publicDir, file).split(sep).join('/');
  for (const file of filesUnder(join(publicDir, 'thumbs')).filter((f) => SOURCE.test(f))) {
    const name = site(file).slice('/thumbs/'.length);
    out.set(thumbFor(name), { source: file, width: THUMB_WIDTH, quality: 82 });
    out.set(largeFor(name), { source: file, width: LARGE_WIDTH, quality: 82 });
  }
  for (const file of filesUnder(join(publicDir, 'media')).filter((f) => SOURCE.test(f) && !/\.strip\.webp$/i.test(f))) {
    out.set(stripFor(site(file)), { source: file, width: STRIP_WIDTH, quality: 72 });
  }
  return out;
}

const make = (job: Job) =>
  sharp(readFileSync(job.source)).resize({ width: job.width, withoutEnlargement: true }).webp({ quality: job.quality }).toBuffer();

export function hubImages(): Plugin {
  let publicDir = '';
  let outDir = '';
  return {
    name: 'hub-images',
    configResolved(config) {
      publicDir = config.publicDir;
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server: ViteDevServer) {
      const made = new Map<string, Buffer>();
      server.middlewares.use(async (req, res, next) => {
        const path = req.url ? decodeURI(req.url.split(/[?#]/)[0]!) : '';
        if (!path.endsWith('.webp')) return next();
        const job = jobs(publicDir).get(path);
        if (!job) return next();
        try {
          const key = `${path}@${statSync(job.source).mtimeMs}`;
          let buf = made.get(key);
          if (!buf) made.set(key, (buf = await make(job)));
          res.setHeader('Content-Type', 'image/webp');
          res.end(buf);
        } catch (err) {
          next(err);
        }
      });
    },
    // After the pages are written (site-plugin.ts), so the check reads the finished site.
    closeBundle: {
      order: 'post',
      sequential: true,
      async handler() {
        for (const [path, job] of jobs(publicDir)) {
          const file = join(outDir, path);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, await make(job));
        }
        const problems = new Set<string>();
        for (const page of filesUnder(outDir).filter((f) => f.endsWith('.html'))) {
          for (const m of readFileSync(page, 'utf8').matchAll(/<img\b[^>]*?\ssrc="(\/[^"]*)"/g)) {
            const file = join(outDir, decodeURI(m[1]!));
            if (!existsSync(file)) problems.add(`${m[1]}: no such file`);
            else if (statSync(file).size > PICTURE_MAX) problems.add(`${m[1]}: ${Math.round(statSync(file).size / 1024)} KB, over ${PICTURE_MAX / 1024} KB`);
          }
        }
        if (problems.size) throw new Error(`Pictures the pages show:\n  ${[...problems].sort().join('\n  ')}`);
      },
    },
  };
}
