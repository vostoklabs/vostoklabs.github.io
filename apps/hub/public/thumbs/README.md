# Generator Thumbnails

One image per tool, named `<id>.png`, where `<id>` is the `id` field in `generators.json`.
`cards.ts` loads `./thumbs/<id>.png` and nothing else — a `.webp` here is a file the hub will
never ask for, which is what this note used to tell you to make.

Recommended size: 800×500 (16:10). A missing file is not an error: the card falls back to a
styled letter placeholder, so a new tool can ship its card before its photo.

Present:

- `clicker.png`, `keycap.png`, `magnet.png`, `name-keychain.png`, `keychain-carabiner.png`
  (a render from `scripts/render-carabiner.mjs`, until there is a photo)
- `large-box.png`, `rugged-box.png`, `washer-spacer.png`, `headphone-hook.png`,
  `edge-mount-dock.png`, `powerstrip-holder.png`
- `laser-studio.png` — six of its designs, built for real and laid out three across
  (`pnpm render:laserStudioThumb`). A catalogue app is badly served by one product photo:
  the pitch is that there are forty-two of these. Replace it with a photo of a cut piece
  when there is one worth showing.

Missing:

- `house-number.png` — the card is live and links correctly; it is showing the letter
  placeholder until a render is dropped in.
