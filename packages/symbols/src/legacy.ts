/*
  What older symbol codes become in the library.

  Font Awesome. Name Keychain offered 52 Font Awesome symbols, stored as the icon font's
  character inside the name, until the icon font became Material Symbols (2026-09-18). From then
  on those characters draw an unrelated Material glyph or nothing at all, in the picker and in
  every project saved before. Each code below is the symbol the customer picked, by the name the
  button showed, matched by eye: Material's filled glyph where one is close (nearest to Font
  Awesome's solid style), then Tabler's, then a Fluent drawing. Key on a project's version
  stamp, never on the character alone: 16 of these codes are also valid Material characters.

  Lucide. The clicker and keycap list a shortlist of Lucide icons first in their icon gallery,
  and the clicker's Arrows preset names four. Each name's twin in the library is below; null is a
  name none of the three sets draws, which an app keeps reading from Lucide itself (and saved
  projects may hold any Lucide name, not only these).
*/

/** [code point, the name the button showed, the library id]. */
export const FONT_AWESOME_TWINS: readonly (readonly [number, string, string])[] = [
  [0xf118, 'Smile', 'material:sentiment_satisfied'],
  [0xf599, 'Laugh', 'fluent:grinning-squinting-face'],
  [0xf004, 'Heart', 'material:favorite'],
  [0xf005, 'Star', 'material:star'],
  [0xf6be, 'Cat', 'fluent:black-cat'],
  [0xf6d3, 'Dog', 'fluent:dog'],
  [0xf1b0, 'Paw', 'material:pets'],
  [0xf6f0, 'Horse', 'fluent:horse'],
  [0xf52e, 'Frog', 'fluent:frog'],
  [0xf6d5, 'Dragon', 'fluent:dragon'],
  [0xf578, 'Fish', 'fluent:fish'],
  [0xf717, 'Spider', 'fluent:spider'],
  [0xf135, 'Rocket', 'material:rocket'],
  [0xf197, 'Space Shuttle', 'material:rocket_launch'],
  [0xf753, 'Meteor', 'fluent:comet'],
  [0xf0e7, 'Lightning', 'material:bolt'],
  [0xf06d, 'Fire', 'material:local_fire_department'],
  [0xf185, 'Sun', 'material:sunny'],
  [0xf186, 'Moon', 'material:bedtime'],
  [0xf0c2, 'Cloud', 'material:cloud'],
  [0xf2dc, 'Snowflake', 'material:ac_unit'],
  [0xf1bb, 'Tree', 'material:park'],
  [0xf06c, 'Leaf', 'material:eco'],
  [0xf4d8, 'Seedling', 'fluent:seedling'],
  [0xf5bb, 'Flower', 'material:local_florist'],
  [0xf187, 'Skull', 'material:skull'],
  [0xf6e2, 'Ghost', 'tabler:ghost'],
  [0xf11b, 'Gamepad', 'material:sports_esports'],
  [0xf522, 'Dice', 'material:casino'],
  [0xf439, 'Chess Knight', 'material:chess_knight'],
  [0xf521, 'Crown', 'material:crown'],
  [0xf3a5, 'Gem', 'material:diamond'],
  [0xf70b, 'Ring', 'fluent:ring'],
  [0xf001, 'Music', 'material:music_note'],
  [0xf7a6, 'Guitar', 'fluent:guitar'],
  [0xf0f4, 'Coffee', 'material:local_cafe'],
  [0xf818, 'Pizza', 'material:local_pizza'],
  [0xf810, 'Ice Cream', 'material:icecream'],
  [0xf3d1, 'Apple', 'material:nutrition'],
  [0xf1b9, 'Car', 'material:directions_car'],
  [0xf21c, 'Motorcycle', 'material:two_wheeler'],
  [0xf206, 'Bicycle', 'material:pedal_bike'],
  [0xf072, 'Plane', 'material:flight'],
  [0xf13d, 'Anchor', 'material:anchor'],
  [0xf091, 'Trophy', 'material:emoji_events'],
  [0xf030, 'Camera', 'material:photo_camera'],
  [0xf53f, 'Palette', 'material:palette'],
  [0xf0d0, 'Magic', 'material:auto_fix_high'],
  [0xf1e2, 'Bomb', 'fluent:bomb'],
  [0xf2fe, 'Poo', 'fluent:pile-of-poo'],
  [0xf6ad, 'Yin Yang', 'fluent:yin-yang'],
  [0xf67c, 'Peace', 'fluent:peace-symbol'],
];

const BY_CODE = new Map(FONT_AWESOME_TWINS.map(([cp, , id]) => [cp, id]));

/** The library id for a Font Awesome character from an old Name Keychain project, or undefined
 *  for any other character. */
export function fontAwesomeTwin(char: string): string | undefined {
  return char.length === 1 ? BY_CODE.get(char.charCodeAt(0)) : undefined;
}

/** Lucide name → library id, or null where no set has one. */
export const LUCIDE_TWINS: Readonly<Record<string, string | null>> = {
  copy: 'material:content_copy', clipboard: 'material:content_paste', 'clipboard-paste': 'material:content_paste',
  scissors: 'material:content_cut', 'trash-2': 'material:delete', save: 'material:save', file: 'material:draft',
  files: 'material:file_copy', folder: 'material:folder', 'folder-open': 'material:folder_open', archive: 'material:archive',
  download: 'material:download', upload: 'material:upload', 'undo-2': 'material:undo', 'redo-2': 'material:redo',
  search: 'material:search', replace: 'material:find_replace', eraser: null, pencil: 'material:edit', type: 'material:title',
  bold: null, italic: null, underline: null, home: 'material:home',
  'arrow-up': 'tabler:arrow-big-up', 'arrow-down': 'tabler:arrow-big-down', 'arrow-left': 'tabler:arrow-big-left',
  'arrow-right': 'tabler:arrow-big-right', 'corner-down-left': 'material:subdirectory_arrow_left', 'chevron-up': 'tabler:caret-up',
  'chevron-down': 'tabler:caret-down', keyboard: 'tabler:keyboard', mouse: 'material:mouse', command: null,
  delete: 'material:backspace', play: 'tabler:player-play', pause: 'tabler:player-pause', 'skip-back': 'tabler:player-skip-back',
  'skip-forward': 'tabler:player-skip-forward', 'volume-2': null, 'volume-x': null, mic: 'material:mic', 'mic-off': null,
  music: 'material:music_note', headphones: 'material:headphones', sun: 'material:light_mode', moon: 'material:dark_mode',
  monitor: 'material:desktop_windows', lock: 'material:lock', unlock: 'material:lock_open', eye: 'material:visibility',
  'eye-off': null, power: 'material:power_settings_new', wifi: 'material:wifi', bluetooth: 'material:bluetooth',
  battery: 'tabler:battery-4', terminal: 'material:terminal', code: 'material:code', settings: 'material:settings',
  bell: 'material:notifications', calendar: 'material:calendar_today', mail: 'material:mail',
  'message-circle': 'material:chat_bubble', phone: 'material:call', camera: 'material:photo_camera', image: 'material:image',
  star: 'material:star', heart: 'material:favorite', circle: 'material:circle', bookmark: 'material:bookmark',
  flag: 'material:flag', check: 'material:check', x: 'material:close', plus: 'material:add', minus: 'material:remove',
  'refresh-cw': 'material:refresh', 'rotate-cw': 'material:redo', flame: 'material:local_fire_department',
  zap: 'material:bolt', rocket: 'material:rocket', ghost: 'tabler:ghost', skull: 'material:skull',
  coffee: 'material:local_cafe', 'gamepad-2': 'material:sports_esports', trophy: 'material:emoji_events', crown: 'material:crown',
};

/** The library id for a Lucide icon name, or undefined where the library has none. */
export function lucideTwin(name: string): string | undefined {
  return LUCIDE_TWINS[name] ?? undefined;
}
