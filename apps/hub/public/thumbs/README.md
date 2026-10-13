# Generator Thumbnails

One image per tool, named `<id>.png`, where `<id>` is the `id` field in `generators.json`
(or the name its `thumb` field gives). Pages never load this file: the build writes
`/thumbs/<id>.webp`, 800 wide, from it (`images-plugin.ts`, names in `src/site/pictures.ts`), and the
dev server makes the same on request. So any size works, but make it 4:3, which is how the card
crops it (`--hub-thumb-ratio`).

Present:

- `clicker.png`, `keycap.png`, `magnet.png`, `name-keychain.png`, `keychain-carabiner.png`
  (a render from `scripts/render-carabiner.mjs`, until there is a photo)
- `large-box.png`, `rugged-box.png`, `washer-spacer.png`, `headphone-hook.png`,
  `edge-mount-dock.png`, `powerstrip-holder.png`
- `laser-studio.png` — six of its designs, built for real and laid out three across
  (`pnpm render:laserStudioThumb`). A catalogue app is badly served by one product photo:
  the pitch is that there are forty-two of these. Replace it with a photo of a cut piece
  when there is one worth showing.
- `laser-box.png` — six of its templates, from the template pictures in
  `apps/laser-box/src/assets/templates/`, three across, at 800×600: the card crops to 4:3
  (`--hub-thumb-ratio`), so a 16:10 grid loses its outer columns. Replace it with a photo of a cut box when
  there is one.
- `business-card.png` — six of its templates, built with the app's own geometry, two across so
  the names stay readable on the card, at 800×600 (`node scripts/render-business-card.mjs`, which
  also writes the product page's renders).
- `photo-frame.png` — six of its designs, built with the app's own geometry and a sample photo in
  each, three across at 800×600 (`node scripts/render-photo-frame.mjs`, which also writes the
  product page's renders).
- `house-number.png`
