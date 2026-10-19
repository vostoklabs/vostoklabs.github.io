# Render Studio

Listing photos of your own 3D model, made in the browser: studio light, soft shadows, your
filament colours. STL, OBJ or 3MF in, PNG out.

```bash
pnpm --filter render-studio dev
pnpm --filter render-studio test
```

The house frame from `appShell()`: the settings rail on the left (Colors, Background, Lighting,
Rotate, Size), the photo in the middle in its own shape, the model and Download on the right.

- **The picture is the photo.** The stage is a `previewCard()` whose picture is sized to the
  photo's proportion, so what is framed is what the PNG holds. Dragging it turns, right-drag (or
  Shift-drag) moves the model in the frame, and the wheel zooms; all three are kept with the
  selected photo (`Shot.offset` holds the move). The angle switch over it points that photo at a
  preset angle, back in the middle.
- **The batch is photos × colorways.** The strip under the picture (`pictureStrip()`) is every
  photo you get; the tiles in Colors are every colorway. Generate (the button at the foot of the
  right panel) renders all of them into the Renders section under the model: each opens large with
  its own Download, and Download all gives one ZIP. A note says when the settings have moved on
  since. `?quick` on the dev server renders them small, for driving the tool headlessly.
- **Every look is a picture**: backgrounds and photo shapes are SVG swatches (`src/swatches.ts`),
  lights, finishes, resting sides and the strip tiles are small renders of the real scene, made
  one at a time a beat after the last change.
- **Photo size** is a ratio (Square 1:1, Portrait 4:5, Landscape 4:3, Wide 16:9, Story 9:16), each
  2000 px on its long side, or Custom: a width and height of 200 to 6000 px. The frame on the
  stage takes the shape at once, and the browser remembers it with the rest of the look.
- **The engine decides quality.** Every photo is 24 passes at 2× supersampling; there is no knob.
- The scene, the preview and the stills are `@vostok/render`. `src/shoot.ts` holds the decisions
  that need no screen (default photos, which way up, the batch and its file names) and is tested
  in `tests/shoot.test.mts`.

The first screen shows a sample: a Name Keychain exported from our own generator
(`public/samples/name-keychain.3mf`), three parts on three filaments.

The browser remembers only the shop's look (background, light, brightness, size). Save and Load
keep a whole shoot. The photos are of the customer's own model, so there is no licence window and
no provenance mark on them.
