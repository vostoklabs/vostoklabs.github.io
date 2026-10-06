/**
 * The generator's markup, as a string.
 *
 * It used to live in index.html, which worked for exactly as long as this generator only
 * ever ran as its own page. A desktop host mounts it into an element it already owns and
 * unmounts it again, and there is no index.html in that story — so the markup has to be
 * something `mount()` can stamp into a container.
 *
 * A template string rather than DOM-building code on purpose: it is a straight lift of the
 * markup that was already there, so the diff is reviewable and the two builds cannot drift
 * apart in how the page is structured. `mount.js` finds everything by id.
 */
export const TEMPLATE = `
    <header id="topbar"></header>
    <!-- The frame (the panels, their scroll areas and the stage) is the kit's appShell(), built
         in mount.js. These holders carry what goes into each part. -->
    <div id="kcLeft">
        <div id="keycapAppHeader"></div>

        <!-- Mode tabs. Empty here and filled at runtime by the paid panel, which is a
             MakerWorld-build-only module — the public build leaves this empty and it
             renders nothing, so there is one shell rather than two. -->
        <div id="kcModeTabs"></div>

        <!-- Print-quality callout, built in mount.js from the kit's qualityCallout(). -->
        <div id="qualityCalloutMount"></div>

      <div class="section">
        <div class="label">Keycap</div>
        <div class="field">
          <label for="profileSelect">Profile</label>
          <select id="profileSelect" aria-label="Keycap profile"></select>
        </div>
        <div class="field" id="kcUnitField">
          <label for="unitSelect">Size</label>
          <select id="unitSelect" aria-label="Keycap size"></select>
        </div>
        <!-- Mode-specific controls belonging to this section (see #kcModeTabs). -->
        <div id="kcProfileExtra"></div>
        <!-- Per-profile print note, filled from index.json. No dismiss button: it's how the
             cap has to be printed, not a suggestion. -->
        <p class="profile-note" id="profileNote" hidden></p>
      </div>

      <div class="section">
        <div class="section-head">
          <span class="label">Placement &amp; size</span>
          <button id="resetPlacement" class="reset-btn" type="button" title="Reset placement &amp; size to defaults" aria-label="Reset placement and size">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          </button>
        </div>
        <!-- Mode-specific controls that must sit ABOVE the sliders rather than among them
             (see #kcModeTabs). This is where the paid modes' "which legend am I editing" switch
             goes: it decides what every control below it is pointed at, so it has to be read
             first. #kcPlacementExtra, further down, is for controls that belong among them. -->
        <div id="kcPlacementLead"></div>
        <div class="prow">
          <label for="size">Size</label>
          <input id="size" type="range" min="3" max="16" step="0.1" value="8" />
          <input id="sizeNum" type="number" step="0.1" />
          <span class="unit">mm</span>
        </div>
        <div class="prow">
          <label for="depth">Depth</label>
          <input id="depth" type="range" min="0.2" max="1.5" step="0.05" value="0.5" />
          <input id="depthNum" type="number" step="0.05" />
          <span class="unit">mm</span>
        </div>
        <!-- Mode-specific controls belonging to this section (see #kcModeTabs). -->
        <div id="kcPlacementExtra"></div>
        <div class="prow">
          <label for="rot">Rotation</label>
          <input id="rot" type="range" min="-180" max="180" step="1" value="0" />
          <input id="rotNum" type="number" step="1" />
          <span class="unit">°</span>
        </div>
        <!-- Nudge. A d-pad, because nudging is a DIRECTION — "a bit to the left" — and a pair
             of signed sliders makes you work out which sign that is and on which axis. The two
             range inputs are still here, hidden: they carry the per-cap limits (see
             setNudgeRange) that the pad clamps against, and they are what every other part of
             the app already listens to and writes to. The pad drives them; it does not replace
             them. The number boxes stay visible for typing an exact offset. -->
        <div class="nudge-block">
          <div class="fit-head">Nudge</div>
          <!-- The kit's nudgePad(): the d-pad and the X/Y fields as one control, built in
               mount.js. The two range inputs stay here, hidden — they carry the per-cap
               limits (see setNudgeRange) and they are what the rest of the app, and both
               paid modes, already listen to. The pad drives them; it never replaced them. -->
          <div id="nudgePadMount"></div>
          <input id="offx" type="range" min="-5" max="5" step="0.1" value="0" class="visually-hidden" tabindex="-1" aria-hidden="true" />
          <input id="offy" type="range" min="-5" max="5" step="0.1" value="0" class="visually-hidden" tabindex="-1" aria-hidden="true" />
        </div>
        <div class="fit-block">
          <div class="fit-head">Stem fit tolerance</div>
          <div class="tol-stepper">
            <button id="stemTolMinus" class="tol-btn" type="button" aria-label="Tighter stem">−</button>
            <span class="tol-val" id="stemTolVal">0.00 mm</span>
            <button id="stemTolPlus" class="tol-btn" type="button" aria-label="Looser stem">+</button>
          </div>
          <p class="fit-help">How tightly the stem grips the switch. Press <strong>+</strong> if the keycap is too hard to push on, <strong>−</strong> if it feels loose. 0 = as designed.</p>
          <!-- Cap / Fit test switch, built in mount.js from the kit's segmentedControl(). Sits
               right under the value it previews: pressing a real switch is the only way to
               answer "what number do I type" for this control. -->
          <div id="fitTestMount" class="kc-fit-row"></div>
          <!-- The fit test's step (kit segmentedControl, mount.js), shown only while it is open. -->
          <div id="fitTestStepMount" class="kc-fit-row" hidden></div>
          <p class="fit-help" id="fitTestNote" hidden>Fit test shows the stems only. Legend and placement settings wait until you switch back to Keycap.</p>
        </div>
        <div class="switch-row">
          <span class="switch-label">Mirror horizontally</span>
          <label class="toggle"><input id="mirror" type="checkbox" /><span class="slider"></span></label>
        </div>
        <div class="switch-row" id="homingBumpRow">
          <span class="switch-label">Homing bump</span>
          <label class="toggle"><input id="homingBump" type="checkbox" /><span class="slider"></span></label>
        </div>
        <div class="switch-block" id="shineThroughRow">
          <div class="switch-row">
            <span class="switch-label">Shine <span class="help-tail">through<button class="help-badge" type="button" aria-label="What does shine through do?" data-tip="Carves the icon all the way through the top of the keycap and prints the stem in the legend colour too. Print the legend and stem in transparent plastic (PLA or PETG) so the icon lights up.">?</button></span></span>
            <label class="toggle"><input id="through" type="checkbox" /><span class="slider"></span></label>
          </div>
        </div>
        <div class="switch-block">
          <div class="switch-row">
            <span class="switch-label">Single color, recessed <span class="help-tail">legend<button class="help-badge" type="button" aria-label="What does single color, recessed legend do?" data-tip="Engraves the icon as a recess into the top of the cap instead of a separate-colour body, so the whole keycap prints in one filament. Depth sets how deep the legend is carved.">?</button></span></span>
            <label class="toggle"><input id="single" type="checkbox" /><span class="slider"></span></label>
          </div>
        </div>
      </div>

      <!-- Colours live on the left with the rest of the model settings. The right
           panel is the legend/artwork source; what the two bodies are printed in is
           a property of the keycap itself, same as its profile and size. -->
      <div class="section">
        <div class="section-head">
          <span class="label">Colors (preview &amp; 3MF)</span>
          <button id="resetColors" class="reset-btn" type="button" title="Reset colors to defaults" aria-label="Reset colors">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          </button>
        </div>
        <!-- Filament swatches, built in mount.js from the kit's paletteRow() — the same
             palette the clicker picks from. These two inputs stay as the state the rest of
             the app reads and writes (capColor.value, and both paid modes listen for their
             input event); the swatch rows write into them and announce it. -->
        <div class="colors">
          <input id="capColor" type="color" value="#161616" hidden />
          <input id="logoColor" type="color" value="#f7f7f5" hidden />
          <div id="capColorMount"></div>
          <div id="logoColorMount"></div>
        </div>
        <div id="exportBlankMount"></div>
      </div>

      <!-- Print settings: what the exported 3MF tells the slicer. The control is the kit's
           segmentedControl(), built in mount.js; this is only its slot. -->
      <div class="section">
        <div class="label">Print settings</div>
        <div id="printSettingsMount"></div>
        <p class="fit-help">Arachne gives smoother walls and keeps thin legend lines solid. Saved into the exported 3MF.</p>
      </div>
    </div>

    <!-- Bottom-left credit strip: who made this, and what changed. The kit's
         panelCredit(), pinned under the left panel's scroll area so it does not scroll away
         with the controls; the Updates button lives here rather than competing with them. -->
    <div id="keycapCredit"></div>

    <div id="kcStage">
      <p class="vl-stage__label">Live 3D Preview</p>
      <p id="hint" class="vl-stage__hint">Hold left click to rotate, right click to pan, scroll to zoom.</p>
      <div id="status" role="status" aria-live="polite" aria-atomic="true">Loading…</div>
      <div class="meta" id="meta"></div>
    </div>

    <div id="kcRight">
        <div class="section legend-section">
          <div class="section-head">
            <span class="label">Legend</span>
            <button id="resetLegend" class="reset-btn" type="button" title="Reset legend to default icon" aria-label="Reset legend">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            </button>
          </div>
          <!-- Mode-specific controls belonging to this section (see #kcModeTabs). Sits above
               the type cards because in set mode it says WHICH key the cards are editing. -->
          <div id="kcLegendExtra"></div>
          <div class="import-grid" role="tablist" aria-label="Legend type">
            <button id="iconMode" class="import-card active" type="button" role="tab" aria-selected="true">
              <span class="card-icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg></span>
              <span class="card-label">Icon</span>
            </button>
            <button id="uploadMode" class="import-card" type="button" role="tab" aria-selected="false">
              <span class="card-icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></span>
              <span class="card-label">SVG</span>
            </button>
            <button id="letterMode" class="import-card" type="button" role="tab" aria-selected="false">
              <span class="card-icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg></span>
              <span class="card-label">Letter</span>
            </button>
          </div>
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
            <!-- The kit's dropZone(), built in mount.js: a real drop target. The panel used to
                 read "Drop any SVG here" above a file-picker label with no drop handler on it,
                 so a dropped file did nothing, or navigated the tab away and took the session
                 with it. The simpleicons pointer moved into the zone's own note. -->
            <div id="uploadDrop"></div>
          </div>
          <div id="letterPanel" class="mode-panel" hidden>
            <div class="field">
              <label for="letterText">Letter</label>
              <input id="letterText" type="text" value="A" maxlength="4" autocomplete="off" spellcheck="false" />
            </div>
            <div class="field">
              <label for="fontSelect">Font</label>
              <select id="fontSelect"></select>
              <label class="upload">
                + Import font
                <input id="fontUpload" type="file" accept=".ttf,.otf,.json,font/ttf,font/otf,application/json" />
              </label>
            </div>
            <div class="switch-block" id="alphabetBlock">
              <div id="alphabetSetMount"></div>
              <p class="switch-help" id="alphabetHelp">Generates 26 keycaps (A–Z) in the current font &amp; settings, zipped as 3MF files.</p>
            </div>
          </div>
        </div>

    </div>

    <!-- Mount point for the shared ui-kit sidebar footer (Export / Save / Load / Help / theme),
         pinned under the right panel's scroll area. -->
    <div id="keycapFooter"></div>

`;
