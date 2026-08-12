// Card rendering — the same component for EVERY generator, external or internal.
// The only difference is where the action button links to.

import { BRAND } from '@vostok/brand';
import { el } from '@vostok/ui-kit';
import type { Generator, SellerTool } from './registry';

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

// A non-clickable footer slot for tools that aren't shipped yet. It keeps the
// card's structure identical to a live one so footers line up across a row.
function comingSoonAction(): HTMLElement {
  return el('span', {
    className: 'vl-btn vl-btn--secondary hub-card__action hub-card__action--soon',
    text: 'Coming Soon',
    attrs: { 'aria-disabled': 'true' },
  });
}

// Every card is thumb → title → blurb → footer, with the title and blurb
// holding a fixed two-line box, so the action row sits at the same height on
// every card regardless of how long its name or description is.
function cardShell(item: Generator | SellerTool, actions: HTMLElement[]): HTMLElement {
  const card = el('div', { className: 'hub-card' });
  card.append(cardThumb(item));

  const footer = el('div', { className: 'hub-card__footer' }, actions);

  const body = el('div', { className: 'hub-card__body' }, [
    el('h3', { className: 'hub-card__name', text: item.name }),
    el('p', { className: 'hub-card__blurb', text: item.blurb }),
    el('div', { className: 'hub-card__spacer' }),
    footer,
  ]);

  card.append(body);
  return card;
}

/** Render a single generator card — identical appearance for all generators. */
export function generatorCard(gen: Generator): HTMLElement {
  if (gen.status !== 'live') return cardShell(gen, [comingSoonAction()]);

  const actions: HTMLElement[] = [];

  if (gen.route === 'app' || gen.route === 'both') {
    const url = gen.external
      ? gen.appUrl ?? '#'
      : gen.appUrl ?? `/${gen.id}/`;
    actions.push(el('a', {
      className: 'vl-btn vl-btn--primary hub-card__action',
      text: 'Open App',
      attrs: {
        href: url,
        ...(gen.external ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
      },
    }));
  }

  if (gen.route === 'mw' || gen.route === 'both') {
    const mwUrl = gen.mwUrl && !gen.mwUrl.startsWith('TODO')
      ? gen.mwUrl
      : BRAND.urls.makerworld;
    actions.push(el('a', {
      className: `vl-btn ${gen.route === 'mw' ? 'vl-btn--primary' : 'vl-btn--secondary'} hub-card__action`,
      text: 'MakerWorld',
      attrs: { href: mwUrl, target: '_blank', rel: 'noopener noreferrer' },
    }));
  }

  return cardShell(gen, actions);
}

/** Render a seller-tool card — same visual style, simpler actions. */
export function sellerToolCard(tool: SellerTool): HTMLElement {
  const action = tool.status === 'live' && tool.appUrl
    ? el('a', {
        className: 'vl-btn vl-btn--primary hub-card__action',
        text: 'Open Tool',
        attrs: { href: tool.appUrl },
      })
    : comingSoonAction();

  return cardShell(tool, [action]);
}
