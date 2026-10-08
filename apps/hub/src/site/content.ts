// The registry, read once, and the questions every page asks of it.

import { BRAND } from '@vostok/brand';
import registryData from '../../../../generators.json';
import type { Generator, Registry, SellerTool } from '../registry';
import { TOPICS, type Topic } from './topics';

export const registry = registryData as unknown as Registry;

export const live = registry.generators.filter((g) => g.status === 'live');
export const sellerTools: SellerTool[] = registry.sellerTools;

export const isApp = (g: Generator) => g.route === 'app' || g.route === 'both';
export const isMw = (g: Generator) => g.route === 'mw' || g.route === 'both';

/** Web apps (including the ones also on MakerWorld), then the MakerWorld-only listings. */
export const webApps = live.filter(isApp);
export const mwOnly = live.filter((g) => g.route === 'mw');

export const featured = live
  .filter((g) => g.featured)
  .sort((a, b) => (a.featured ?? 0) - (b.featured ?? 0));

export const productPath = (g: Generator) => `/generators/${g.id}/`;
export const topicPath = (t: Topic) => `/make/${t.id}/`;
export const thumbPath = (g: Generator) => `/thumbs/${g.thumb ?? `${g.id}.png`}`;

export function appHref(g: Generator): string | null {
  if (!isApp(g)) return null;
  return g.appUrl ?? `/${g.id}/`;
}

export function mwHref(g: Generator): string | null {
  if (!isMw(g)) return null;
  return g.mwUrl && !g.mwUrl.startsWith('TODO') ? g.mwUrl : BRAND.urls.makerworld;
}

export function inTopic(t: Topic): Generator[] {
  return live.filter((g) => g.topics.includes(t.id));
}

export const topicById = (id: string) => TOPICS.find((t) => t.id === id);

/** Other generators sharing a topic, nearest first. */
export function related(g: Generator, max = 4): Generator[] {
  const seen = new Set([g.id]);
  const out: Generator[] = [];
  for (const id of g.topics) {
    for (const other of live) {
      if (out.length >= max) return out;
      if (seen.has(other.id) || !other.topics.includes(id)) continue;
      seen.add(other.id);
      out.push(other);
    }
  }
  return out;
}

/** What to look at next: the ones sharing a topic first, then the web apps, then the rest. */
export function moreLike(g: Generator, max = 8): Generator[] {
  const near = related(g, max);
  const seen = new Set([g.id, ...near.map((o) => o.id)]);
  const rest = [...webApps, ...mwOnly].filter((o) => !seen.has(o.id));
  return [...near, ...rest].slice(0, max);
}

export const fmtPrice = (n: number) => `$${n.toLocaleString('en-US')}`;

export { TOPICS };
