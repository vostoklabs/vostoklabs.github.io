// Questions and answers, grouped. The licences page shows the licence group; /faq/ shows all.

import { BRAND } from '@vostok/brand';

export interface FaqGroup {
  id: string;
  title: string;
  items: [question: string, answer: string][];
}

const l = BRAND.pricing.lifetime;

export const FAQ: FaqGroup[] = [
  {
    id: 'licences',
    title: 'Licences',
    items: [
      ['Do I need a licence to print for myself?', 'No. Printing for yourself, friends and family is free, with every feature.'],
      ['What does a licence let me do?', `A membership lets you sell physical prints from every generator while it is active. A lifetime licence lets you sell the prints and the digital files from one generator, forever, for $${l.one} once.`],
      ['Which generators have a lifetime licence?', 'Image to Clicker, the Custom Keycap Generator and Laser Box, each sold on Buy Me a Coffee.'],
      ['Where do I join the membership?', 'On MakerWorld or on Buy Me a Coffee.'],
      ['Is there a watermark?', 'No. Nothing is printed on your model. Every exported file carries an invisible provenance mark; it never shows on a print and never limits what you can do.'],
    ],
  },
  {
    id: 'using',
    title: 'Using the generators',
    items: [
      ['Do I need an account?', 'Not for the web apps: there is nothing to sign up for. MakerWorld listings use your MakerWorld account.'],
      ['Where are my files made?', 'On your own computer. The web apps build the model in your browser, and nothing you upload leaves it.'],
      ['What is the difference between a web app and a MakerWorld listing?', 'A web app runs here, with a live 3D preview and more options. A MakerWorld listing is customised in MakerWorld’s Parametric Model Maker and printed from there. Some generators are both.'],
      ['Which file do I get?', '3D print generators export a 3MF that opens in Bambu Studio. Laser tools export an SVG cut file in millimetres.'],
    ],
  },
];
