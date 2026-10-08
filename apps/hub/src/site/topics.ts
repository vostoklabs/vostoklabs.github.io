// The "what do you want to make?" topics. A generator joins one by naming its id in its
// `topics` list in generators.json; each topic gets a page at /make/<id>/.

export interface Topic {
  id: string;
  name: string;
  /** One line under the tile, and the topic page's opening line. */
  line: string;
}

export const TOPICS: Topic[] = [
  { id: 'keychains', name: 'Keychains', line: 'Name tags, clips and charms, 3D printed or laser cut.' },
  { id: 'fidgets', name: 'Fidgets', line: 'Clickers and sliders, made from your own picture or text.' },
  { id: 'boxes', name: 'Boxes', line: 'Print-in-place, fold-up and laser-cut boxes, sized to what goes in them.' },
  { id: 'signs', name: 'Signs', line: 'House numbers, name plates and signs that fit where they hang.' },
  { id: 'desk-home', name: 'Desk & home', line: 'Keycaps, hooks, docks and holders that fit your actual desk.' },
];
