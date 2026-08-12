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
 * apart in how the page is structured. `main.js` finds everything by id, and the ids are
 * unchanged.
 */
export const TEMPLATE = `
    <header id="topbar"></header>
    <main class="vl-app">
      <!-- The left panel is a flex column with its own scrolling body, mirroring the right
           panel, so a pinned block (the MakerLab credit) can sit in the bottom-left corner
           instead of scrolling away with the controls. -->
      <aside class="vl-panel vl-panel--left">
        <div class="vl-panel__scroll">
        <div id="keycapAppHeader"></div>

        <!-- Mode tabs. Empty here and filled at runtime by the Pro Pack, which is a
             MakerWorld-build-only module — the public build leaves this empty and it
             renders nothing, so there is one shell rather than two. -->
        <div id="kcModeTabs"></div>

        <!-- mw:strip:start — this callout points users off-platform to a MakerWorld model
             page, which the host doesn't want surfaced inside the embed. main.js removes it
             at runtime too, but stripping the markup here keeps it from flashing before the
             module loads (and keeps the copy out of the shipped file entirely). -->
        <div class="vl-callout" id="qualityCallout">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <div class="vl-callout__body">For the best quality printed keycap, please use the print profile and instructions available on <a class="hint-link" id="qualityCalloutLink" href="https://makerworld.com/en/models/2959969" target="_blank" rel="noopener">MakerWorld</a>.</div>
          <button class="vl-callout__dismiss" id="qualityCalloutDismiss" type="button" aria-label="Dismiss">&times;</button>
        </div>
        <!-- mw:strip:end -->

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
        <!-- Per-profile print note, filled from index.json. Deliberately NOT inside an
             mw:strip fence: that fence exists to keep an off-platform LINK out of the embed
             (see the quality callout above). This carries no link, and the embed is exactly
             where it matters most — people go straight from there into a slicer. No dismiss
             button either: it's how the cap has to be printed, not a suggestion. -->
        <p class="profile-note" id="profileNote" hidden></p>
      </div>

      <div class="section">
        <div class="section-head">
          <span class="label">Placement &amp; size</span>
          <button id="resetPlacement" class="reset-btn" type="button" title="Reset placement &amp; size to defaults" aria-label="Reset placement and size">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          </button>
        </div>
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
        <div class="prow">
          <label for="offx">Nudge X</label>
          <input id="offx" type="range" min="-5" max="5" step="0.1" value="0" />
          <input id="offxNum" type="number" step="0.1" />
          <span class="unit">mm</span>
        </div>
        <div class="prow">
          <label for="offy">Nudge Y</label>
          <input id="offy" type="range" min="-5" max="5" step="0.1" value="0" />
          <input id="offyNum" type="number" step="0.1" />
          <span class="unit">mm</span>
        </div>
        <div class="fit-block">
          <div class="fit-head">Stem fit tolerance</div>
          <div class="tol-stepper">
            <button id="stemTolMinus" class="tol-btn" type="button" aria-label="Tighter stem">−</button>
            <span class="tol-val" id="stemTolVal">0.00 mm</span>
            <button id="stemTolPlus" class="tol-btn" type="button" aria-label="Looser stem">+</button>
          </div>
          <p class="fit-help">How tightly the stem grips the switch. Press <strong>+</strong> if the keycap is too hard to push on, <strong>−</strong> if it feels loose. 0 = as designed.</p>
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
            <span class="switch-label">Shine through<button class="help-badge" type="button" aria-label="What does shine through do?" data-tip="Carves the icon all the way through the top of the keycap and prints the stem in the legend colour too. Print the legend and stem in transparent plastic (PLA or PETG) so the icon lights up.">?</button></span>
            <label class="toggle"><input id="through" type="checkbox" /><span class="slider"></span></label>
          </div>
        </div>
        <div class="switch-block">
          <div class="switch-row">
            <span class="switch-label">Single color, recessed legend<button class="help-badge" type="button" aria-label="What does single color, recessed legend do?" data-tip="Engraves the icon as a recess into the top of the cap instead of a separate-colour body, so the whole keycap prints in one filament. Depth sets how deep the legend is carved.">?</button></span>
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
        <div class="colors">
          <div class="color"><input id="capColor" type="color" value="#1c1c1e" /> Keycap</div>
          <div class="color"><input id="logoColor" type="color" value="#f2f2f2" /> Legend</div>
        </div>
        <button id="exportBlank" class="vl-btn vl-btn--secondary vl-btn--block" type="button" disabled style="margin-top:16px;">Export blank keycap</button>
      </div>
      </div><!-- .vl-panel__scroll -->

      <!-- Bottom-left credit slot. Only the MakerLab build fills this: per MakerWorld's
           review the Vostok Labs intro moves out of the top-left into a compact pinned
           line down here. Stays empty (and display:none) in the public build. -->
      <div id="keycapCredit"></div>
    </aside>

    <div id="viewport" class="vl-stage">
      <p class="vl-stage__label">Live 3D Preview</p>
      <div id="busy">generating…</div>
      <p id="hint" class="vl-stage__hint">Hold left click to rotate, right click to pan, scroll to zoom.</p>
      <div id="status">Loading…</div>
      <div class="meta" id="meta"></div>
    </div>

    <aside class="vl-panel vl-panel--right">
      <div class="vl-panel__scroll">
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
            <button id="iconMode" class="import-card active" type="button">
              <span class="card-icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg></span>
              <span class="card-label">Icon</span>
            </button>
            <button id="uploadMode" class="import-card" type="button">
              <span class="card-icon"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></span>
              <span class="card-label">SVG</span>
            </button>
            <button id="letterMode" class="import-card" type="button">
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
            <p class="hint-text">
              Drop any SVG here. For brand/app logos, browse <a class="hint-link" href="https://simpleicons.org/" target="_blank" rel="noopener">simpleicons.org</a> and download what you need.
            </p>
            <div id="uploadGallery"></div>
            <label class="upload-cta">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload SVG file(s)
              <input id="upload" type="file" accept=".svg,image/svg+xml" multiple />
            </label>
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
              <button id="alphabetSet" class="vl-btn vl-btn--secondary vl-btn--block" type="button" style="margin-top:8px;">Get full alphabet set (A–Z)</button>
              <p class="switch-help" id="alphabetHelp">Generates 26 keycaps (A–Z) in the current font &amp; settings, zipped as 3MF files.</p>
            </div>
          </div>
        </div>

      </div>

      <!-- Hidden legacy controls the shared ui-kit footer delegates to. These MUST
           live outside #keycapFooter: mounting the footer replaces #keycapFooter,
           which would otherwise destroy these and crash main.js ($('export') etc.). -->
      <div id="keycapLegacyControls" hidden>
        <button id="export" class="primary" disabled>Download 3MF</button>
        <button id="saveProj"></button>
        <input type="file" id="projFile" accept="application/json" hidden />
      </div>

      <!-- Mount point for the shared ui-kit sidebar footer (Export / Save / Load / Help / theme). -->
      <div id="keycapFooter"></div>
    </aside>
    </main><!-- .vl-app -->

    <div id="whatsNew" class="modal-overlay" hidden>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="whatsNewTitle">
        <h2 id="whatsNewTitle">What's new</h2>
        <p class="modal-sub">A few additions since you were last here:</p>
        <ul class="whatsnew-list">
          <li>
            <span class="wn-ico" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 11h.01M10 11h.01M14 11h.01M18 11h.01"/></svg></span>
            <span class="wn-body"><strong>Choc v1 profile</strong><span>Low-profile caps for Kailh Choc v1 switches, in 1u, 1.5u and 2u. Pick “Choc v1” in the Keycap → Profile dropdown. Print them standing on their side, as modelled, with supports for the stems — there's a note in the panel to remind you.</span></span>
          </li>
          <li>
            <span class="wn-ico" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg></span>
            <span class="wn-body"><strong>Thocky profile</strong><span>A new keycap profile. Pick it in the Keycap → Profile dropdown alongside Standard and Low.</span></span>
          </li>
          <li>
            <span class="wn-ico" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>
            <span class="wn-body"><strong>Stem fit tolerance</strong><span>A new “Stem fit” slider under Placement &amp; size loosens or tightens how the stem grips the switch. Nudge up if the cap is too tight, down if it's loose.</span></span>
          </li>
        </ul>
        <div class="modal-foot">
          <label class="whatsnew-dismiss"><input id="whatsNewHide" type="checkbox" /> Don't show this again</label>
          <button id="whatsNewClose" class="primary" type="button">Got it</button>
        </div>
      </div>
    </div>
`;
