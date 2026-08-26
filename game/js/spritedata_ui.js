// UI sprite pixel data for Verdant Frontier.
//
// Format: { w, h, pal:[cssColour...], rows:[h strings of w chars] }
//   '.'  -> transparent
//   else -> index into '0123456789abcdefghijklmnopqrstuv' selects pal[i]
//
// Pure data, no DOM: safe to import in Node. Rasterizing lives in sprites.js.

// ---------------------------------------------------------------------------
// Capture spheres — 12x12
//
// All four share one silhouette so they read as the same object class: a
// 12px circle, a two-pixel dark equator band with a lit button at its centre,
// a coloured upper shell and a pale lower shell. Only the palette and the
// shell markings change, so they stay distinguishable at 1x while still
// obviously belonging to the same family. A white highlight sits at the
// upper-left of every shell to sell the curvature.
// ---------------------------------------------------------------------------

// Standard Orb — crimson shell over white.
const ball_orb = {
  w: 12, h: 12,
  pal: [
    '#181820', // 0 outline / equator band
    '#e04038', // 1 shell red
    '#a82830', // 2 shell red, shaded
    '#f8f8f8', // 3 lower shell white
    '#c0c0cc', // 4 lower shell, shaded
    '#ffffff', // 5 specular highlight
    '#e8e8e8', // 6 release button
  ],
  rows: [
    '....0000....',
    '..00111100..',
    '.0155111110.',
    '.0151111110.',
    '011111112220',
    '000006600000',
    '000006600000',
    '033333334440',
    '.0333333440.',
    '.0333334440.',
    '..00444400..',
    '....0000....',
  ],
};

// Great Orb — cobalt shell with swept scarlet stripes down the shoulders.
const ball_greatorb = {
  w: 12, h: 12,
  pal: [
    '#181820', // 0 outline / band
    '#3870d0', // 1 shell blue
    '#204890', // 2 shell blue, shaded
    '#f8f8f8', // 3 lower shell white
    '#c0c0cc', // 4 lower shell, shaded
    '#ffffff', // 5 specular highlight
    '#e8e8e8', // 6 release button
    '#d83848', // 7 scarlet stripe
  ],
  rows: [
    '....0000....',
    '..00111100..',
    '.0175111710.',
    '.0775111770.',
    '077111112770',
    '000006600000',
    '000006600000',
    '033333334440',
    '.0333333440.',
    '.0333334440.',
    '..00444400..',
    '....0000....',
  ],
};

// Ultra Orb — matte black shell with a gold chevron pair.
const ball_ultraorb = {
  w: 12, h: 12,
  pal: [
    '#101014', // 0 outline / band
    '#303038', // 1 shell black
    '#1c1c22', // 2 shell black, shaded
    '#f8f8f8', // 3 lower shell white
    '#c0c0cc', // 4 lower shell, shaded
    '#9098a8', // 5 highlight (cool grey reads as gloss on black)
    '#e8e8e8', // 6 release button
    '#f0c020', // 7 gold marking
  ],
  rows: [
    '....0000....',
    '..00711700..',
    '.0177517710.',
    '.0117117110.',
    '011171171220',
    '000006600000',
    '000006600000',
    '033333334440',
    '.0333333440.',
    '.0333334440.',
    '..00444400..',
    '....0000....',
  ],
};

// Dusk Orb — deep violet shell over mossy green, with a glowing green button.
const ball_duskorb = {
  w: 12, h: 12,
  pal: [
    '#101014', // 0 outline / band
    '#503468', // 1 shell violet
    '#301c44', // 2 shell violet, shaded
    '#24462c', // 3 lower shell green
    '#152c1c', // 4 lower shell green, shaded
    '#c0a8e8', // 5 specular highlight
    '#68e878', // 6 glowing button
    '#3c9c4c', // 7 green notch
  ],
  rows: [
    '....0000....',
    '..00111100..',
    '.0755111570.',
    '.0151111110.',
    '011111112220',
    '000006600000',
    '000006600000',
    '033333334440',
    '.0333333440.',
    '.0333334440.',
    '..00444400..',
    '....0000....',
  ],
};

// Split sphere for the catch animation: the two shells snapped apart with the
// flat rims facing each other across an empty gap.
const ball_open = {
  w: 12, h: 12,
  pal: [
    '#181820', // 0 outline / rim
    '#e04038', // 1 upper shell
    '#a82830', // 2 upper shell, shaded
    '#f8f8f8', // 3 lower shell
    '#c0c0cc', // 4 lower shell, shaded
    '#ffffff', // 5 specular highlight
  ],
  rows: [
    '....0000....',
    '..00111100..',
    '.0155111110.',
    '.0111111220.',
    '000000000000',
    '............',
    '............',
    '000000000000',
    '.0333333440.',
    '.0333334440.',
    '..00444400..',
    '....0000....',
  ],
};

// ---------------------------------------------------------------------------
// Cursor — 8x8 right-pointing selection arrow.
// Dark body, light rim along the top-left, mid-tone along the lower-right so
// it stays legible on both the paper windows and dark battle panels.
// ---------------------------------------------------------------------------
const cursor = {
  w: 8, h: 8,
  pal: [
    '#182028', // 0 body
    '#f8f4e8', // 1 light edge
    '#4a5464', // 2 lower shading
  ],
  rows: [
    '11......',
    '101.....',
    '1001....',
    '10001...',
    '10002...',
    '1002....',
    '102.....',
    '12......',
  ],
};

// ---------------------------------------------------------------------------
// Shadow — 16x6 soft ellipse laid under overworld characters.
// Drawn with a reduced globalAlpha by the caller; the lighter rim keeps the
// edge from reading as a hard oval cut-out.
// ---------------------------------------------------------------------------
const shadow = {
  w: 16, h: 6,
  pal: [
    '#1a1e26', // 0 core
    '#39404e', // 1 rim
  ],
  rows: [
    '....11111111....',
    '.11100000000111.',
    '1000000000000001',
    '1000000000000001',
    '.11100000000111.',
    '....11111111....',
  ],
};

// ---------------------------------------------------------------------------
// Grass tufts — 16x8, three-frame rustle played over tall grass when a
// creature is disturbed. Frame 0 upright, 1 swept right, 2 swept left.
// ---------------------------------------------------------------------------
const GRASS_PAL = [
  '#1e4a24', // 0 shadowed base
  '#3c8c3c', // 1 blade mid
  '#74c454', // 2 blade highlight
];

const grass_tuft_0 = {
  w: 16, h: 8,
  pal: GRASS_PAL,
  rows: [
    '................',
    '...2...2....2...',
    '...1.2.2..2.1...',
    '..11.1.1.21.12..',
    '..1121.1111.11..',
    '.11111111111111.',
    '0110111011101110',
    '.00000000000000.',
  ],
};

const grass_tuft_1 = {
  w: 16, h: 8,
  pal: GRASS_PAL,
  rows: [
    '................',
    '....2...2....2..',
    '...1.2..12...2..',
    '..11.1.11.1..12.',
    '..1121.1111.11..',
    '.11111111111111.',
    '0110111011101110',
    '.00000000000000.',
  ],
};

const grass_tuft_2 = {
  w: 16, h: 8,
  pal: GRASS_PAL,
  rows: [
    '................',
    '..2....2...2....',
    '..12..12...12...',
    '.11..11.1.11.1..',
    '..1121.1111.11..',
    '.11111111111111.',
    '0110111011101110',
    '.00000000000000.',
  ],
};

// ---------------------------------------------------------------------------
// Sparkles — 8x8, three growing frames for catch confirmation and level-up.
// ---------------------------------------------------------------------------
const STAR_PAL = [
  '#ffffff', // 0 white core
  '#fff4b0', // 1 pale gold
  '#f0c840', // 2 gold tip
];

const star_0 = {
  w: 8, h: 8,
  pal: STAR_PAL,
  rows: [
    '........',
    '........',
    '...22...',
    '..1001..',
    '..1001..',
    '...22...',
    '........',
    '........',
  ],
};

const star_1 = {
  w: 8, h: 8,
  pal: STAR_PAL,
  rows: [
    '........',
    '...22...',
    '...11...',
    '21000012',
    '21000012',
    '...11...',
    '...22...',
    '........',
  ],
};

const star_2 = {
  w: 8, h: 8,
  pal: STAR_PAL,
  rows: [
    '...22...',
    '...11...',
    '.2.00.2.',
    '21000012',
    '21000012',
    '.2.00.2.',
    '...11...',
    '...22...',
  ],
};

// ---------------------------------------------------------------------------
// hp_pip — 4x4 marker used for PP dots, party slots and dex tick marks.
// ---------------------------------------------------------------------------
const hp_pip = {
  w: 4, h: 4,
  pal: [
    '#182028', // 0 outline
    '#48c058', // 1 fill
  ],
  rows: [
    '.00.',
    '0110',
    '0110',
    '.00.',
  ],
};

// ---------------------------------------------------------------------------
// Menu icons — 12x12. Each one is built around a different outer silhouette
// (satchel, orb trio, book, disk, pinned sheet, cog) so the row of them in the
// pause menu is readable at 1x without leaning on colour alone.
// ---------------------------------------------------------------------------

// Bag: flapped satchel with a carry loop above it.
const icon_bag = {
  w: 12, h: 12,
  pal: [
    '#1c1410', // 0 outline
    '#a86038', // 1 leather
    '#6e3c20', // 2 flap, darker leather
    '#e8c060', // 3 buckle
  ],
  rows: [
    '....0000....',
    '...0....0...',
    '..00000000..',
    '..02222220..',
    '..02222220..',
    '..00000000..',
    '..01111110..',
    '..01133110..',
    '..01133110..',
    '..01111110..',
    '..00000000..',
    '............',
  ],
};

// Party: three orbs in a triangle — a team, not a single creature.
const icon_party = {
  w: 12, h: 12,
  pal: [
    '#182028', // 0 outline
    '#f0e8d8', // 1 fill
  ],
  rows: [
    '............',
    '..00....00..',
    '.0110..0110.',
    '.0110..0110.',
    '..00....00..',
    '............',
    '.....00.....',
    '....0110....',
    '....0110....',
    '.....00.....',
    '............',
    '............',
  ],
};

// Dex: open book, twin pages either side of a dark spine. The page block
// bulges at the fore-edge so the outline is a lens, never a plain rectangle.
const icon_dex = {
  w: 12, h: 12,
  pal: [
    '#182028', // 0 outline / spine
    '#4878b0', // 1 text lines
    '#f8f4e8', // 2 page
  ],
  rows: [
    '............',
    '..00000000..',
    '.0222002220.',
    '.0211001120.',
    '022220022220',
    '021110011120',
    '022220022220',
    '.0211001120.',
    '..00000000..',
    '............',
    '............',
    '............',
  ],
};

// Save: storage disk, metal shutter across the top, big label below.
const icon_save = {
  w: 12, h: 12,
  pal: [
    '#182028', // 0 outline
    '#3868b8', // 1 shell
    '#e8e8e8', // 2 shutter / label
  ],
  rows: [
    '............',
    '.00000000...',
    '.0122221100.',
    '.0122221110.',
    '.0111111110.',
    '.0111111110.',
    '.0122222210.',
    '.0122222210.',
    '.0122222210.',
    '.0000000000.',
    '............',
    '............',
  ],
};

// Map: charted sheet with a marker pin standing proud of the top edge, so the
// silhouette can never be confused with the book or the disk.
const icon_map = {
  w: 12, h: 12,
  pal: [
    '#182028', // 0 outline
    '#e8dcb8', // 1 paper
    '#4a8ec8', // 2 route
    '#d84838', // 3 pin head
  ],
  rows: [
    '....0000....',
    '...033330...',
    '...033330...',
    '....0330....',
    '.0000000000.',
    '.0111111110.',
    '.0112211110.',
    '.0111221110.',
    '.0111112210.',
    '.0000000000.',
    '............',
    '............',
  ],
};

// Options: four-toothed cog with an open hub.
const icon_options = {
  w: 12, h: 12,
  pal: [
    '#182028', // 0 outline
    '#a8b0c0', // 1 metal
    '#e0e4ec', // 2 metal highlight
  ],
  rows: [
    '....0000....',
    '...011110...',
    '..02111110..',
    '..02111110..',
    '.0110000110.',
    '01110..01110',
    '01110..01110',
    '.0110000110.',
    '..01111110..',
    '..01111110..',
    '...011110...',
    '....0000....',
  ],
};

export const UI_SPRITES = {
  ball_orb,
  ball_greatorb,
  ball_ultraorb,
  ball_duskorb,
  ball_open,
  // Contract-era short aliases; same records, so they rasterize identically.
  ball_great: ball_greatorb,
  ball_ultra: ball_ultraorb,
  ball_dusk: ball_duskorb,

  cursor,
  shadow,

  grass_tuft_0,
  grass_tuft_1,
  grass_tuft_2,

  star_0,
  star_1,
  star_2,

  hp_pip,

  icon_bag,
  icon_party,
  icon_dex,
  icon_save,
  icon_map,
  icon_options,
};

export default UI_SPRITES;
