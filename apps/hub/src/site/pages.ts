// Every page of the site: its address, its title and description, and the blocks it is
// built from. Adding a generator or a topic to the data adds its page here by itself.

import { BRAND } from '@vostok/brand';
import { el, linkButton } from '@vostok/ui-kit';
import type { Generator } from '../registry';
import {
  breadcrumb, cardGrid, faqList, featuredGrid, hero, homeTopicOf, licenceBand, mobileActionBar,
  productCard, productLayout, section, supportStrip, toolCard, topicTiles, whatsNew,
} from './blocks';
import {
  fmtPrice, inTopic, live, moreLike, mwOnly, productPath, sellerTools, TOPICS, topicPath, webApps,
} from './content';
import { FAQ } from './faq';
import type { Topic } from './topics';

export interface Page {
  path: string;
  title: string;
  description: string;
  render(): HTMLElement[];
}

type Block = HTMLElement | null | false;
const blocks = (list: Block[]) => list.filter(Boolean) as HTMLElement[];

const s = BRAND.pricing.subscription;
const l = BRAND.pricing.lifetime;
const lifetimeGenerators = () => live.filter((g) => g.lifetimeLicence);

function home(): Page {
  const news = whatsNew();
  return {
    path: '/',
    title: `${BRAND.name}: generators for things you print and cut`,
    description: 'Free browser generators and MakerWorld models for keychains, boxes, signs, fidgets and laser cuts. Customise, download, print. Commercial licences for sellers.',
    render: () => blocks([
      hero(),
      section({ title: 'Featured', more: ['All generators', '/make/'] }, [featuredGrid()]),
      section({ title: 'Browse by what you make' }, [topicTiles()]),
      news && section({ title: 'New this month' }, [news]),
      section({ title: 'Free to make, licensed to sell' }, [licenceBand()]),
    ]),
  };
}

function catalogue(): Page {
  return {
    path: '/make/',
    title: `Generators · ${BRAND.name}`,
    description: 'Every Vostok Labs generator: web apps that run in your browser, MakerWorld listings, and the seller tools on the way.',
    render: () => [
      section({
        title: 'Generators',
        level: 'h1',
        lead: 'Free for personal use. Web apps run in your browser; MakerWorld models customise on MakerWorld.',
        // The script mounts the search here, and the topic and process filters below.
        aside: el('div', { className: 'hub-search', attrs: { 'data-catalogue-search': '' } }),
      }, [
        el('div', { className: 'hub-filter', attrs: { 'data-catalogue-filter': '' } }),
      ]),
      section({ id: 'web-apps', title: `Web apps · ${webApps.length}`, lead: 'Run right here in your browser, with a live preview.', className: 'hub-shelf' }, [
        cardGrid(webApps.map(productCard)),
      ]),
      section({ id: 'makerworld', title: `On MakerWorld · ${mwOnly.length}`, lead: 'Customise in MakerWorld’s Parametric Model Maker and print from there.', className: 'hub-shelf' }, [
        cardGrid(mwOnly.map(productCard)),
      ]),
      section({ id: 'coming-soon', title: `Coming soon · ${sellerTools.length}`, lead: 'Tools for people who sell what they print.', className: 'hub-shelf' }, [
        cardGrid(sellerTools.map(toolCard), 'hub-grid--compact'),
      ]),
      el('p', { className: 'hub-container hub-empty', text: 'Nothing matches that search.', attrs: { 'data-empty': '', hidden: '' } }),
    ],
  };
}

function topicPage(t: Topic): Page {
  const items = inTopic(t);
  return {
    path: topicPath(t),
    title: `${t.name} generators · ${BRAND.name}`,
    description: `${t.line} ${items.length} free generators: customise in your browser or on MakerWorld, then print.`,
    render: () => [
      section({ className: 'hub-section--crumbs' }, [breadcrumb([['Generators', '/make/'], [t.name]])]),
      section({ title: t.name, level: 'h1', lead: t.line }, [cardGrid(items.map(productCard))]),
      section({ title: 'Selling what you make?' }, [licenceBand()]),
      section({ title: 'Make something else' }, [topicTiles(TOPICS.filter((o) => o.id !== t.id))]),
    ],
  };
}

function productPage(g: Generator): Page {
  const topic = homeTopicOf(g);
  return {
    path: productPath(g),
    title: `${g.name} · ${BRAND.name}`,
    description: g.blurb,
    render: () => blocks([
      section({ className: 'hub-section--crumbs' }, [breadcrumb([['Generators', '/make/'], ...(topic ? [[topic.name, topicPath(topic)] as [string, string]] : []), [g.name]])]),
      section({ className: 'hub-product' }, [productLayout(g, moreLike(g))]),
      mobileActionBar(g),
    ]),
  };
}

function plan(opts: {
  id: string; name: string; price: string; per?: string; note: string; points: string[]; actions: HTMLElement[];
  highlight?: boolean; mount?: string;
}): HTMLElement {
  const price = el('p', { className: 'hub-plan__price' }, [opts.price, ...(opts.per ? [el('span', { text: opts.per })] : [])]);
  return el('article', { className: `hub-plan${opts.highlight ? ' hub-plan--highlight' : ''}`, attrs: { id: opts.id } }, blocks([
    el('h2', { className: 'hub-plan__name', text: opts.name }),
    // The script mounts a term switch here, and it rewrites the price beneath it.
    opts.mount ? el('div', { attrs: { [opts.mount]: '' } }) : null,
    price,
    el('p', { className: 'hub-plan__note', text: opts.note }),
    el('ul', { className: 'hub-points' }, opts.points.map((p) => el('li', { text: p }))),
    el('div', { className: 'hub-plan__actions' }, opts.actions),
  ]));
}

function compareTable(): HTMLElement {
  const rows: [string, string, string, string][] = [
    ['Print for yourself', 'Yes', 'Yes', 'Yes'],
    ['Sell the prints', 'No', 'Yes', 'Yes'],
    ['Sell the digital files', 'No', 'No', 'Yes'],
    ['Covers', 'Every generator', 'The whole catalogue', 'One generator'],
    ['You pay', 'Nothing', `${fmtPrice(s.month)}/month, ${fmtPrice(s.quarter)}/quarter or ${fmtPrice(s.year)}/year`, `${fmtPrice(l.one)} once, per generator`],
    ['Lasts', 'Always', 'While the membership is active', 'Forever'],
    ['Where', 'Nothing to buy', 'MakerWorld or Buy Me a Coffee', 'Buy Me a Coffee'],
  ];
  const head = el('tr', {}, ['', 'Free', 'Membership', 'Lifetime'].map((h) => el('th', { text: h, attrs: { scope: 'col' } })));
  return el('div', { className: 'hub-table-wrap' }, [
    el('table', { className: 'hub-table' }, [
      el('thead', {}, [head]),
      el('tbody', {}, rows.map(([label, ...cells]) =>
        el('tr', {}, [el('th', { text: label, attrs: { scope: 'row' } }), ...cells.map((c) => el('td', { text: c }))]))),
    ]),
  ]);
}

function licences(): Page {
  return {
    path: '/licences/',
    title: `Licences and pricing · ${BRAND.name}`,
    description: `Personal use is free. Selling prints needs a commercial licence: a membership for the whole catalogue from ${fmtPrice(s.month)}/month, or a lifetime licence for one generator.`,
    render: () => [
      section({ title: 'Licences', level: 'h1', lead: 'Printing for yourself is free, with every feature. Selling the prints needs a commercial licence.' }, [
        el('div', { className: 'hub-plans' }, [
          plan({
            id: 'free', name: 'Free', price: '$0', note: 'For you, your friends, your home.',
            points: ['Every generator, every feature', 'No watermark, no account', 'Print as many as you like'],
            actions: [linkButton({ label: 'Browse generators', href: '/make/', emphasis: 'secondary', block: true })],
          }),
          plan({
            id: 'membership', name: 'Membership', price: fmtPrice(s.month), per: '/month', highlight: true, mount: 'data-term-switch',
            note: 'The whole catalogue, while you are a member.',
            points: ['Sell prints from every generator', 'New generators included as they land', 'Stop any time'],
            actions: [
              linkButton({ label: 'Join on MakerWorld', href: BRAND.urls.mwCommercial, emphasis: 'cta', block: true, external: true }),
              linkButton({ label: 'Join on Buy Me a Coffee', href: BRAND.urls.buyMeACoffeeMembership, emphasis: 'secondary', block: true, external: true }),
            ],
          }),
          plan({
            id: 'lifetime', name: 'Lifetime', price: fmtPrice(l.one), per: ' once',
            note: 'Per generator, yours forever.',
            points: ['Sell physical prints', 'Sell the digital files', 'No subscription', 'No credit or attribution required'],
            actions: lifetimeGenerators().map((g) =>
              linkButton({ label: g.name, href: BRAND.urls[g.lifetimeLicence!], emphasis: 'secondary', block: true, external: true })),
          }),
        ]),
      ]),
      section({ id: 'finder', title: 'Which one do I need?', lead: 'Three questions.' }, [
        // The script mounts the questions here; the table below answers the same thing without it.
        el('div', { className: 'hub-finder', attrs: { 'data-licence-finder': '' } }),
      ]),
      section({ title: 'Side by side' }, [compareTable()]),
      section({ title: 'Questions about licences', more: ['All questions', '/faq/'] }, [faqList(FAQ.filter((g) => g.id === 'licences'), false)]),
      section({}, [supportStrip()]),
    ],
  };
}

function faq(): Page {
  return {
    path: '/faq/',
    title: `Questions · ${BRAND.name}`,
    description: 'Answers about licences, accounts, files and the difference between the web apps and the MakerWorld listings.',
    render: () => [
      section({ title: 'Questions', level: 'h1', lead: 'Licences, accounts and files.' }, [faqList(FAQ)]),
      section({}, [supportStrip()]),
    ],
  };
}

function notFound(): Page {
  return {
    path: '/404.html',
    title: `Page not found · ${BRAND.name}`,
    description: 'That page does not exist.',
    render: () => [
      section({ title: 'That page doesn’t exist', level: 'h1', lead: 'It may have moved. The generators are all one click away.' }, [
        el('div', { className: 'hub-actions' }, [linkButton({ label: 'Browse generators', href: '/make/', emphasis: 'primary' })]),
      ]),
    ],
  };
}

export function allPages(): Page[] {
  return [
    home(),
    catalogue(),
    ...TOPICS.map(topicPage),
    ...live.map(productPage),
    licences(),
    faq(),
    notFound(),
  ];
}
