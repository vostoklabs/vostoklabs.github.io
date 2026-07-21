// Card rendering — the same component for EVERY generator, external or internal.
// The only difference is where the action button links to.

import { BRAND } from '@vostok/brand';
import { el } from '@vostok/ui-kit';
import type { Generator, SellerTool } from './registry';

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

  // Action footer only for live cards. For coming-soon ones the status badge
  // already says so, so we don't repeat it in a redundant footer line.
  if (gen.status === 'live') {
    // Spacer pushes the footer to the bottom of the card.
    body.append(el('div', { className: 'hub-card__spacer' }));
    const footer = el('div', { className: 'hub-card__footer' });

    // Build action button(s) based on route.
    if (gen.route === 'app' || gen.route === 'both') {
      const url = gen.external
        ? gen.appUrl ?? '#'
        : gen.appUrl ?? `/${gen.id}/`;
      const btn = el('a', {
        className: 'vl-btn vl-btn--primary hub-card__action',
        text: 'Open App',
        attrs: {
          href: url,
          ...(gen.external ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
        },
      });
      footer.append(btn);
    }

    if (gen.route === 'mw' || gen.route === 'both') {
      const mwUrl = gen.mwUrl && !gen.mwUrl.startsWith('TODO')
        ? gen.mwUrl
        : BRAND.urls.makerworld;
      const btn = el('a', {
        className: `vl-btn ${gen.route === 'mw' ? 'vl-btn--primary' : 'vl-btn--secondary'} hub-card__action`,
        text: 'MakerWorld',
        attrs: { href: mwUrl, target: '_blank', rel: 'noopener noreferrer' },
      });
      footer.append(btn);
    }

    body.append(footer);
  }

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

  // Action footer only when the tool is live and has somewhere to go; otherwise
  // the "Coming Soon" badge already carries the status.
  if (tool.status === 'live' && tool.appUrl) {
    body.append(el('div', { className: 'hub-card__spacer' }));
    const footer = el('div', { className: 'hub-card__footer' });
    footer.append(
      el('a', {
        className: 'vl-btn vl-btn--primary hub-card__action',
        text: 'Open Tool',
        attrs: { href: tool.appUrl },
      }),
    );
    body.append(footer);
  }

  card.append(body);
  return card;
}
