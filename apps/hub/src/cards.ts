// Card rendering — the same component for EVERY generator, external or internal.
// The only difference is where the action button links to.

import { BRAND } from '@vostok/brand';
import { el } from '@vostok/ui-kit';
import type { Generator, SellerTool } from './registry';

/** Inline SVG icons used on hub cards. */
const CARD_ICONS = {
  externalLink:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  mw:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
};

function parseSvg(raw: string): SVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = raw.trim();
  return tpl.content.firstElementChild as unknown as SVGElement;
}

function statusBadge(status: string): HTMLElement {
  const isLive = status === 'live';
  const badge = el('span', {
    className: `hub-badge ${isLive ? 'hub-badge--live' : 'hub-badge--soon'}`,
    text: isLive ? 'Live' : 'Coming Soon',
  });
  return badge;
}

function cardThumb(gen: Generator | SellerTool): HTMLElement {
  const wrapper = el('div', { className: 'hub-card__thumb' });

  // Try to load the thumbnail image. If the generator provides one, use it;
  // otherwise show a styled placeholder with the tool's initial.
  const img = document.createElement('img');
  img.src = `./thumbs/${gen.id}.png`;
  img.alt = gen.name;
  img.loading = 'lazy';
  img.onerror = () => {
    // Replace broken img with a placeholder
    img.remove();
    const placeholder = el('div', { className: 'hub-card__placeholder' });
    placeholder.textContent = gen.name.charAt(0).toUpperCase();
    wrapper.prepend(placeholder);
  };
  wrapper.prepend(img);

  return wrapper;
}

/** Render a single generator card — identical appearance for all generators. */
export function generatorCard(gen: Generator): HTMLElement {
  const card = el('div', { className: 'hub-card' });

  card.append(cardThumb(gen));

  const body = el('div', { className: 'hub-card__body' });
  body.append(
    el('div', { className: 'hub-card__head' }, [
      el('h3', { className: 'hub-card__name', text: gen.name }),
      statusBadge(gen.status),
    ]),
    el('p', { className: 'hub-card__blurb', text: gen.blurb }),
  );

  // Spacer pushes the footer to the bottom of the card
  body.append(el('div', { className: 'hub-card__spacer' }));

  const footer = el('div', { className: 'hub-card__footer' });

  if (gen.status === 'live') {
    // Build action button(s) based on route
    if (gen.route === 'app' || gen.route === 'both') {
      const url = gen.external
        ? gen.appUrl ?? '#'
        : `/${gen.id}/`;
      const btn = el('a', {
        className: 'vl-btn vl-btn--primary hub-card__action',
        text: 'Open App ',
        attrs: {
          href: url,
          ...(gen.external ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
        },
      });
      if (gen.external) btn.append(parseSvg(CARD_ICONS.externalLink));
      footer.append(btn);
    }

    if (gen.route === 'mw' || gen.route === 'both') {
      const mwUrl = gen.mwUrl && !gen.mwUrl.startsWith('TODO')
        ? gen.mwUrl
        : BRAND.urls.makerworld;
      const btn = el('a', {
        className: `vl-btn ${gen.route === 'mw' ? 'vl-btn--primary' : 'vl-btn--secondary'} hub-card__action`,
        text: 'MakerWorld ',
        attrs: { href: mwUrl, target: '_blank', rel: 'noopener noreferrer' },
      });
      btn.append(parseSvg(CARD_ICONS.mw));
      footer.append(btn);
    }
  } else {
    footer.append(
      el('span', { className: 'hub-card__coming', text: 'Notification coming soon' }),
    );
  }

  body.append(footer);
  card.append(body);
  return card;
}

/** Render a seller-tool card — same visual style, simpler actions. */
export function sellerToolCard(tool: SellerTool): HTMLElement {
  const card = el('div', { className: 'hub-card' });

  card.append(cardThumb(tool));

  const body = el('div', { className: 'hub-card__body' });
  body.append(
    el('div', { className: 'hub-card__head' }, [
      el('h3', { className: 'hub-card__name', text: tool.name }),
      statusBadge(tool.status),
    ]),
    el('p', { className: 'hub-card__blurb', text: tool.blurb }),
  );

  body.append(el('div', { className: 'hub-card__spacer' }));

  const footer = el('div', { className: 'hub-card__footer' });
  if (tool.status === 'live' && tool.appUrl) {
    footer.append(
      el('a', {
        className: 'vl-btn vl-btn--primary hub-card__action',
        text: 'Open Tool',
        attrs: { href: tool.appUrl },
      }),
    );
  } else {
    footer.append(
      el('span', { className: 'hub-card__coming', text: 'Coming soon' }),
    );
  }

  body.append(footer);
  card.append(body);
  return card;
}
