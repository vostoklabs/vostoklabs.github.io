/**
 * The generator's markup, as a string.
 *
 * It used to live in index.html, which worked for exactly as long as this generator only
 * ever ran as its own page. A desktop host mounts it into an element it already owns and
 * unmounts it again, and there is no index.html in that story — so the markup has to be
 * something `mount()` can stamp into a container.
 *
 * Most of what is here is a mount point: mount.js builds the kit's controls into them, keeping
 * the ids everything else (the paid modes included) finds them by. The left panel is the kit's
 * settings rail: each `data-rail` holder is one category, and its top-level elements are that
 * category's rows (mount.js moves them into the rail).
 */
export const TEMPLATE = `
    <header id="topbar"></header>
    <!-- The frame (the panels, their scroll areas and the stage) is the kit's appShell(), built
         in mount.js. These holders carry what goes into each part. -->
    <div id="kcLeft">
      <div id="keycapAppHeader"></div>
      <!-- The lifetime licence offer, on top of the rail (the paid build's host). -->
      <div id="kcLicenceMount"></div>

      <div data-rail="keycap">
        <div id="profilePickerMount"></div>
        <!-- The profile the cap is made from. Hidden: the picture picker above drives it, and the
             app and the paid modes read and listen to it. -->
        <select id="profileSelect" hidden aria-hidden="true" tabindex="-1"></select>
        <div id="unitFieldMount"></div>
        <!-- Mode-specific controls belonging to this category (the paid modes' host). -->
        <div id="kcProfileExtra"></div>
        <!-- Per-profile print note, filled from index.json. No dismiss button: it's how the
             cap has to be printed, not a suggestion. -->
        <p class="profile-note" id="profileNote" hidden></p>
        <div id="homingBumpMount"></div>
        <div id="exportBlankMount"></div>
      </div>

      <div data-rail="layout">
        <!-- A paid mode's board settings (its host). Hidden, and with it the category, until a
             mode shows it; empty in the public build. -->
        <div id="kcLayoutExtra" hidden></div>
      </div>

      <div data-rail="dimensions">
        <!-- A generated shape's size (kit sliderRow, mount.js), then Cap height and Stem height
             on caps whose socket has room. The category hides when none of them apply. -->
        <div id="shapeCapMount"></div>
        <div id="capTrimMount"></div>
      </div>

      <div data-rail="legend">
        <!-- Mode-specific controls that must sit ABOVE the sliders: which legend they edit. -->
        <div id="kcPlacementLead"></div>
        <div id="sizeRowMount"></div>
        <div id="depthRowMount"></div>
        <!-- Mode-specific controls belonging among the sliders. -->
        <div id="kcPlacementExtra"></div>
        <div id="rotRowMount"></div>
        <!-- Nudge. The kit's nudgePad(), built in mount.js with its own caption. The two range
             inputs stay here, hidden: they carry the per-cap limits (see setNudgeRange) and they
             are what the rest of the app, and the paid modes, listen to. The pad drives them. -->
        <div class="nudge-block">
          <div id="nudgePadMount"></div>
          <input id="offx" type="range" min="-5" max="5" step="0.1" value="0" class="visually-hidden" tabindex="-1" aria-hidden="true" />
          <input id="offy" type="range" min="-5" max="5" step="0.1" value="0" class="visually-hidden" tabindex="-1" aria-hidden="true" />
        </div>
        <div id="resetPlacementMount"></div>
      </div>

      <div data-rail="style">
        <!-- How the legend is made (flush, raised, engraved, shine-through), its raise, mirror. -->
        <div id="styleMount"></div>
        <div id="capSwitchesMount"></div>
      </div>

      <div data-rail="font">
        <!-- The kit's font chooser (mount.js): curated cards in the legend's own text, Browse all,
             Import a font. -->
        <div id="fontChooserMount"></div>
      </div>

      <div data-rail="colors">
        <!-- Filament swatches, built in mount.js from the kit's paletteRow(). These two inputs
             stay as the state the rest of the app reads and writes (both paid modes listen for
             their input event); the swatch rows write into them and announce it. -->
        <div class="colors">
          <input id="capColor" type="color" value="#161616" hidden />
          <input id="logoColor" type="color" value="#f7f7f5" hidden />
          <div id="capColorMount"></div>
          <div id="logoColorMount"></div>
          <!-- Mode-specific colour rows (the paid modes' host). -->
          <div id="kcColorsExtra"></div>
        </div>
        <div id="resetColorsMount"></div>
      </div>

      <div data-rail="fit">
        <!-- Print-quality callout, built in mount.js from the kit's qualityCallout(). -->
        <div id="qualityCalloutMount"></div>
        <!-- MX or low-profile MX stem (kit segmentedControl, mount.js). -->
        <div id="stemTypeMount"></div>
        <!-- Stem fit tolerance (kit stepperRow), then the Keycap / Fit test switch right under the
             value it previews: pressing a real switch is the only way to answer "what number do
             I type" for this control. -->
        <div id="stemTolMount"></div>
        <div id="fitTestMount" class="kc-fit-row"></div>
        <!-- The fit test's step (kit segmentedControl, mount.js), shown only while it is open. -->
        <div id="fitTestStepMount" class="kc-fit-row" hidden></div>
        <p class="fit-help" id="fitTestNote" hidden>Fit test shows the stems only. Legend and placement settings wait until you switch back to Keycap.</p>
        <!-- Print settings: what the exported 3MF tells the slicer (kit segmentedControl). -->
        <div id="printSettingsMount"></div>
      </div>
    </div>

    <!-- Bottom-left credit strip: who made this, and what changed. The kit's
         panelCredit(), pinned under the left panel's scroll area. -->
    <div id="keycapCredit"></div>

    <div id="kcStage">
      <p class="vl-stage__label">Live 3D Preview</p>
      <p id="hint" class="vl-stage__hint">Hold left click to rotate, right click to pan, scroll to zoom.</p>
      <div id="status" role="status" aria-live="polite" aria-atomic="true">Loading…</div>
      <div class="meta" id="meta"></div>
      <!-- The paid modes' switch, on the stage bar; empty in the public build. -->
      <div id="kcModeTabs"></div>
    </div>

    <div id="kcRight">
        <div class="section legend-section">
          <div class="section-head">
            <span class="label">Legend</span>
            <div id="resetLegendMount"></div>
          </div>
          <!-- Mode-specific controls belonging to this section (the paid modes' host). Sits above
               the source cards because in a paid mode it says WHICH legend or key they edit. -->
          <div id="kcLegendExtra"></div>
          <!-- Icon / SVG / Text (kit segmentedControl cards, mount.js). -->
          <div id="legendSourceMount"></div>
          <div id="iconPanel" class="mode-panel">
            <div id="iconSearchWrap">
              <input id="iconSearch" type="search" placeholder="Search Lucide icons…" autocomplete="off" spellcheck="false" />
              <button id="iconSearchClear" type="button" aria-label="Clear search">×</button>
            </div>
            <div id="iconCount"></div>
            <div id="gallery"></div>
          </div>
          <div id="uploadPanel" class="mode-panel" hidden>
            <div id="uploadGallery"></div>
            <!-- The kit's dropZone(), built in mount.js. -->
            <div id="uploadDrop"></div>
          </div>
          <div id="letterPanel" class="mode-panel" hidden>
            <div class="field">
              <label for="letterText">Text</label>
              <input id="letterText" type="text" value="A" maxlength="32" autocomplete="off" spellcheck="false" />
            </div>
            <div id="alphabetBlock">
              <div id="alphabetSetMount"></div>
            </div>
          </div>
        </div>
    </div>

    <!-- Mount point for the shared ui-kit sidebar footer (Export / Save / Load / Help / theme),
         pinned under the right panel's scroll area. -->
    <div id="keycapFooter"></div>
`;
