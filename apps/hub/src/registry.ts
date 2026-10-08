// Generator & seller-tool registry types, matching generators.json schema.

import type { BRAND } from '@vostok/brand';

/** A key of `BRAND.urls`, so the registry names a link and never holds the address itself. */
export type BrandUrlKey = keyof typeof BRAND.urls;

export interface Generator {
  id: string;
  name: string;
  route: 'mw' | 'app' | 'both';
  status: 'live' | 'coming-soon';
  blurb: string;
  mwUrl?: string;
  appUrl?: string;
  external?: boolean;
  /** Cover file name in /thumbs/, when it is not <id>.png. */
  thumb?: string;
  /** What it makes, as topic ids from `src/site/topics.ts`. The first is its home topic. */
  topics: string[];
  process: '3d-print' | 'laser';
  /** Position on the home page's featured shelf; absent = not featured. */
  featured?: number;
  /** The product page's opening paragraph. Falls back to the blurb. */
  intro?: string;
  /** The product page's feature list: a title, or a title and the line under it. No list, no block. */
  features?: (string | [title: string, line: string])[];
  /** The product page's gallery after the thumbnail: photos, app shots, the intro film. */
  media?: Media[];
  /** The design's own lifetime licence, if it is sold on its own. */
  lifetimeLicence?: BrandUrlKey;
  /** The single-file offline build. No address, no button. */
  offlineUrl?: string;
}

export interface Media {
  type: 'image' | 'video';
  /** Site path, e.g. /media/keycap/all-sizes.jpg. */
  src: string;
  /** What the picture shows; also the strip's label. */
  alt: string;
  /** A video's still frame. */
  poster?: string;
}

export interface SellerTool {
  id: string;
  name: string;
  status: 'live' | 'coming-soon';
  blurb: string;
  appUrl?: string;
}

export interface Registry {
  generators: Generator[];
  sellerTools: SellerTool[];
}
