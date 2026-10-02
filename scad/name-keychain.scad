// Name Keychain — Vostok Labs (https://ko-fi.com/vostoklabs)
// © Vostok Labs. Personal use only (MakerWorld Standard Digital File License).
// Selling prints or redistributing this file requires a Vostok Labs commercial
// license — see the listing description.
//
// Plate-style personalized name keychain. Layered multicolor (plate / halo / name)
// in clean Z-bands for AMS or no-AMS pause-and-swap printing. Multi-language,
// raised or engraved letters, deterministic always-fused keyring.
//
// This is the simple, quick MakerWorld version. The web app at vostoklabs.github.io
// adds the extras (letter/line spacing, boldness, bevelled edges, rectangle plate,
// vertical layout, live font & colour preview).

/* [Please read] */
// I acknowledge that selling prints of this design without a valid commercial license is illegal and may result in legal consequences. Licensing is in the listing description.
acknowledge_license = true; // [true, false]

/* [Text] */
name_text = "Name";
// Optional second line under the name (empty = off)
name_text2 = "";
// Second-line size relative to the first (1 = same size; lower = smaller subtitle)
line2_scale = 1;       // [0.3:0.1:1.5]

/* [Font] */
font_name = "Fredoka"; // font
font_style = "Regular"; // [Regular, Bold, Black, SemiBold, Medium, Light, Italic, Bold Italic, Black Italic]
// For right-to-left names. Latin & CJK (Chinese/Japanese/Korean): leave on Latin and
// just choose a matching font above (e.g. a Noto Sans SC / JP / KR from the picker).
script = "Latin"; // [Latin, Arabic, Hebrew]

/* [Colours] */
// One solid, plate + name, or plate + outline halo + name.
color_scheme = "Plate + Outline + Text"; // [Single, Plate + Text, Plate + Outline + Text]
base_hex = "#1d2027";    // color
outline_hex = "#5b9dff"; // color
// Name colour
text_hex = "#f2f4f8";    // color

/* [Size & shape] */
text_size = 18;        // [8:1:40]
base_thickness = 2;    // [1:0.2:4]
// Raised-letter height
text_thickness = 1.6;  // [0.6:0.2:4]
// Plate border around the letters
outline_width = 2.5;   // [0:0.5:8]
// Merges tight gaps between letters & smooths the outline (raise if a font looks notchy)
smoothing = 2;         // [0:0.5:5]
letter_style = "Raised"; // [Raised, Engraved]

/* [Keyring] */
ring_style = "Loop tab"; // [Loop tab, Corner hole]
// Hole size for the split ring / clip
hole_dia = 4;          // [2:0.5:8]
// How chunky the loop is (material around the hole)
ring_thickness = 2.2;  // [1:0.5:6]
// Nudge the ring position
ring_pos_x = 0;        // [-30:0.5:30]
ring_pos_y = 0;        // [-30:0.5:30]

/* [Hidden] */
show_base = true;
show_text = true;
$fn = $preview ? 16 : 24;

// Fixed layered-look constants (exposed as sliders in the web app, kept simple here).
halo_width = 1.2;      // coloured outline halo hugging each letter
halo_thickness = 0.8;  // height of the halo colour band (= 2nd no-AMS pause layer)

// ---- font resolution --------------------------------------------------------
// Bare family name for Regular is most compatible; only append :style= for real styles.
the_font = font_style == "Regular" ? font_name : str(font_name, ":style=", font_style);
rtl = script == "Arabic" || script == "Hebrew";
// script/language help HarfBuzz shape Arabic (contextual joining) & order RTL. Best-effort,
// unverifiable locally (fonts not installed) — confirm Arabic/Hebrew on MW at upload.
scr = script == "Arabic" ? "arabic" : script == "Hebrew" ? "hebrew" : "latin";
lng = script == "Arabic" ? "ar"     : script == "Hebrew" ? "he"     : "en";

// ---- derived ----------------------------------------------------------------
has_halo   = color_scheme == "Plate + Outline + Text";
multicolor = color_scheme != "Single";
plate_margin = outline_width + (has_halo ? halo_width : 0);
nchars   = len(name_text);
letter_z = base_thickness + (has_halo ? halo_thickness : 0);
total_h  = letter_z + text_thickness;

// Ring lug: size the FINAL outer radius directly (independent of outline_width), then
// pre-shrink by plate_margin so the offset restores it — this stops the plate offset from
// inflating the loop into a huge disc.
lug_outer = hole_dia/2 + ring_thickness;
lug_pre   = max(lug_outer - plate_margin, 0.6);
gap       = 2*lug_outer + 2;   // text starts here, clearing the ring
line2_on  = name_text2 != "";
line2_sz  = text_size * line2_scale;
dy        = (text_size + line2_sz) * 0.62;  // baseline-to-baseline gap

// ---- 2D text profile (deterministic origin: no textmetrics in 2021.01) -------
module row(txt, sz, y)
    translate([gap, y])
        text(txt, size = sz, font = the_font, halign = "left", valign = "center",
             direction = rtl ? "rtl" : "ltr", script = scr, language = lng);

// Name (+ optional second line), both left-aligned at `gap`.
module glyphs_2d() {
    row(name_text, text_size, line2_on ? dy/2 : 0);
    if (line2_on) row(name_text2, line2_sz, -dy/2);
}

// Ring position. Loop tab protrudes left; Corner hole embeds in the top of the name. A hull
// bridge to a point INSIDE the name guarantees the ring always fuses to the plate, whatever
// the leading glyph or plate_margin.
corner  = ring_style == "Corner hole";
ring_cx = corner ? gap + lug_outer*0.6 : lug_outer;
ring_cy = corner ? text_size*0.30 : 0;
hole_x  = ring_cx + ring_pos_x;
hole_y  = ring_cy + ring_pos_y;
bridge_x = gap + 0.5;
bridge_y = 0;

// Lug moves with the nudge; the bridge stays anchored in the name so the loop always fuses.
module tab_2d()
    hull() {
        translate([hole_x, hole_y]) circle(r = lug_pre);
        translate([bridge_x, bridge_y]) circle(r = 0.8);
    }

// Multi-word names ("Mary Jane") would split into separate plates across the space gap; a
// thin connector spanning the name fuses all words into one piece.
function has_space(s, i = 0) =
    i >= len(s) ? false : (s[i] == " " ? true : has_space(s, i + 1));
multiword = has_space(name_text);
module connector_2d()
    translate([gap + text_size*nchars*0.31, 0]) square([max(nchars,1)*text_size*0.62, text_size*0.42], center = true);

// Bar joining the two lines. Both lines are left-aligned at `gap`, so they always overlap on
// the left; a band as wide as the SHORTER line (estimated from char count) bridges them
// without the thin plastic neck a 3 mm bar leaves when the lines are spaced far apart.
overlap_w = max(min(len(name_text), len(name_text2)) * min(text_size, line2_sz) * 0.6, text_size);
module line_link_2d()
    translate([gap + overlap_w/2, 0]) square([overlap_w, dy], center = true);

// Plate source: the letters hugged by an outline (+ connectors to stay one piece).
module plate_src_2d() {
    glyphs_2d();
    tab_2d();
    if (multiword) connector_2d();
    if (line2_on) line_link_2d();
}

// offset(r=m) rounds the outer corners into the sticker silhouette AND merges letters.
// smoothing adds a morphological CLOSING (dilate then erode) that fills tight notches
// between letters — only adds material, never severs. Skipped when 0 (faster).
module offset_plate(m)
    if (smoothing > 0)
        offset(delta = -smoothing) offset(delta = smoothing)
            offset(r = m) plate_src_2d();
    else
        offset(r = m) plate_src_2d();

module plate_2d() offset_plate(plate_margin);

module halo_2d() offset(r = halo_width) glyphs_2d();
module hole_2d() translate([hole_x, hole_y]) circle(d = hole_dia);

// ---- 3D layers --------------------------------------------------------------
cut_h = total_h + 2;
module base_layer() linear_extrude(base_thickness) plate_2d();
module halo_layer() translate([0,0,base_thickness]) linear_extrude(halo_thickness) halo_2d();
module name_layer() translate([0,0,letter_z]) linear_extrude(text_thickness) glyphs_2d();
module hole_cut()   translate([0,0,-1]) linear_extrude(cut_h) hole_2d();

text_color = multicolor ? text_hex : base_hex;

module raised_assembly() {
    difference() {
        union() {
            if (show_base) color(base_hex) base_layer();
            if (has_halo && show_text) color(outline_hex) halo_layer();
            if (show_text) color(text_color) name_layer();
        }
        hole_cut();
    }
}

module engraved_assembly() {
    color(base_hex) difference() {
        base_layer();
        translate([0,0,base_thickness - min(text_thickness, base_thickness*0.6)])
            linear_extrude(text_thickness + 1) glyphs_2d();
        hole_cut();
    }
}

// ---- no-AMS pause info (single-nozzle, manual filament swap) -----------------
// The colours already sit in clean Z-bands, so on a single-nozzle printer just pause at
// these heights and swap filament. (AMS users can ignore this — it prints automatically.)
module report_pauses() {
    if (multicolor && letter_style == "Raised") {
        if (has_halo)
            echo(str("No-AMS: pause at ", base_thickness, " mm (swap to outline colour), then at ",
                     base_thickness + halo_thickness, " mm (swap to name colour)."));
        else
            echo(str("No-AMS: pause at ", base_thickness, " mm (swap to name colour)."));
    }
}
report_pauses();

if (letter_style == "Engraved") engraved_assembly();
else raised_assembly();
