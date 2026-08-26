// Character walk sprites for Verdant Frontier — 16x24, 3 frames per direction.
//
// Art is authored with mnemonic role letters and compiled to palette-index chars
// at module load, so the source stays readable and every record is validated once.
//
//   o = outline        H = hat / hair       h = hat / hair shade
//   S = skin           s = skin shade       C = garment (top)
//   c = lower garment  A = accent (boots, belt, pack, band)
//   . = transparent
//
// Layout: rows 0-1 empty, head, torso, then 5 leg rows (19-23) swapped per frame.
// Frame 0 stands, frames 1 and 2 lift opposite feet.
// No DOM access — safe to import in Node.

const W = 16, H = 24;

// Role letter -> index into the sprite's own palette.
const ROLES = 'oHhSsCcA';
const KEY = '0123456789abcdefghijklmnopqrstuv';

function compile(row, where) {
  let out = '';
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '.') { out += '.'; continue; }
    const idx = ROLES.indexOf(ch);
    if (idx < 0) throw new Error('spritedata_chars: bad role char "' + ch + '" in ' + where);
    out += KEY[idx];
  }
  return out;
}

// Builds + validates one sprite record.
function mk(key, pal, artRows) {
  if (!Array.isArray(pal) || pal.length === 0 || pal.length > 8) {
    throw new Error('spritedata_chars: ' + key + ' palette must hold 1..8 colours');
  }
  for (const c of pal) {
    if (typeof c !== 'string' || !/^#[0-9a-f]{6}$/i.test(c)) {
      throw new Error('spritedata_chars: ' + key + ' bad palette entry ' + c);
    }
  }
  if (artRows.length !== H) {
    throw new Error('spritedata_chars: ' + key + ' has ' + artRows.length + ' rows, want ' + H);
  }
  const rows = artRows.map((r, y) => {
    if (typeof r !== 'string' || r.length !== W) {
      throw new Error('spritedata_chars: ' + key + ' row ' + y + ' width ' +
        (r && r.length) + ', want ' + W);
    }
    return compile(r, key + ' row ' + y);
  });
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < W; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      const idx = KEY.indexOf(ch);
      if (idx < 0 || idx >= pal.length) {
        throw new Error('spritedata_chars: ' + key + ' row ' + y + ' col ' + x + ' out of palette');
      }
    }
  }
  return { w: W, h: H, pal: pal.slice(), rows };
}

function mirror(rows) {
  return rows.map(r => r.split('').reverse().join(''));
}

const BLANK2 = ['................', '................'];

// ---------------------------------------------------------------------------
// Leg cycles. Each entry is [frame0, frame1, frame2]; every frame is 5 rows.
// ---------------------------------------------------------------------------

const LEG_STAND = [
  '...occo..occo...',
  '...occo..occo...',
  '...occo..occo...',
];

const LEGS = {
  normal: [
    [...LEG_STAND, '...oAAo..oAAo...', '...oooo..oooo...'],
    [...LEG_STAND, '...oAAo...oAAo..', '...oooo.........'],
    [...LEG_STAND, '..oAAo...oAAo...', '.........oooo...'],
  ],
  broad: [
    ['..occo....occo..', '..occo....occo..', '..occo....occo..', '..oAAo....oAAo..', '..oooo....oooo..'],
    ['..occo....occo..', '..occo....occo..', '..occo....occo..', '..oAAo.....oAAo.', '..oooo..........'],
    ['..occo....occo..', '..occo....occo..', '..occo....occo..', '.oAAo.....oAAo..', '..........oooo..'],
  ],
  // Bare-legged child: shorts, then short skin legs.
  kid: [
    ['...occcccccco...', '...oSSo..oSSo...', '...oSSo..oSSo...', '...oAAo..oAAo...', '...oooo..oooo...'],
    ['...occcccccco...', '...oSSo..oSSo...', '...oSSo..oSSo...', '...oAAo...oAAo..', '...oooo.........'],
    ['...occcccccco...', '...oSSo..oSSo...', '...oSSo..oSSo...', '..oAAo...oAAo...', '.........oooo...'],
  ],
  // Floor-length robe: only the sandals shuffle.
  robe: [
    ['..oCCCCCCCCCCo..', '..oCCCCCCCCCCo..', '.oCCCCCCCCCCCCo.', '.oCCCCCCCCCCCCo.', '.oooAAoooAAooo..'],
    ['..oCCCCCCCCCCo..', '..oCCCCCCCCCCo..', '.oCCCCCCCCCCCCo.', '.oCCCCCCCCCCCCo.', '.ooAAoooooAAoo..'],
    ['..oCCCCCCCCCCo..', '..oCCCCCCCCCCo..', '.oCCCCCCCCCCCCo.', '.oCCCCCCCCCCCCo.', '.oooAAooAAoooo..'],
  ],
};

// ---------------------------------------------------------------------------
// Shared torso blocks (rows 11-18) for the standard 9-row-head build.
// ---------------------------------------------------------------------------

const TORSO_PLAIN_FRONT = [
  '..oCCCCCCCCCCo..',
  '.oCoCCCCCCCCoCo.',
  '.oCoCCCCCCCCoCo.',
  '.oCoCCCCCCCCoCo.',
  '.oSoCCCCCCCCoSo.',
  '..ooCCCCCCCCoo..',
  '...oAAAAAAAAo...',
  '...occcccccco...',
];

const TORSO_PLAIN_SIDE = [
  '..oCCCCCCCCCCo..',
  '.oCoCCCCCCCCCo..',
  '.oCoCCCCCCCCCo..',
  '.oCoCCCCCCCCCo..',
  '.oSoCCCCCCCCCo..',
  '..ooCCCCCCCCoo..',
  '...oAAAAAAAAo...',
  '...occcccccco...',
];

// Rolled sleeves — bare arms all the way down.
const TORSO_BARE_FRONT = [
  '..oCCCCCCCCCCo..',
  '.oSoCCCCCCCCoSo.',
  '.oSoCCCCCCCCoSo.',
  '.oSoCCCCCCCCoSo.',
  '.oSoCCCCCCCCoSo.',
  '..ooCCCCCCCCoo..',
  '...oAAAAAAAAo...',
  '...occcccccco...',
];

const TORSO_BARE_SIDE = [
  '..oCCCCCCCCCCo..',
  '.oSoCCCCCCCCCo..',
  '.oSoCCCCCCCCCo..',
  '.oSoCCCCCCCCCo..',
  '.oSoCCCCCCCCCo..',
  '..ooCCCCCCCCoo..',
  '...oAAAAAAAAo...',
  '...occcccccco...',
];

const TORSO_ROBE_FRONT = [
  '..oCCCCCCCCCCo..',
  '.oCoCCCCCCCCoCo.',
  '.oCoCCCCCCCCoCo.',
  '.oCoCCCCCCCCoCo.',
  '.oSoCCCCCCCCoSo.',
  '..ooCCCCCCCCoo..',
  '..oCCCCCCCCCCo..',
  '..oCCCCCCCCCCo..',
];

const TORSO_ROBE_SIDE = [
  '..oCCCCCCCCCCo..',
  '.oCoCCCCCCCCCo..',
  '.oCoCCCCCCCCCo..',
  '.oCoCCCCCCCCCo..',
  '.oSoCCCCCCCCCo..',
  '..ooCCCCCCCCoo..',
  '..oCCCCCCCCCCo..',
  '..oCCCCCCCCCCo..',
];

const TORSO_BROAD_FRONT = [
  '.oCCCCCCCCCCCCo.',
  'oCoCCCCCCCCCCoCo',
  'oCoCCCCCCCCCCoCo',
  'oCoCCCCCCCCCCoCo',
  'oSoCCCCCCCCCCoSo',
  '.ooCCCCCCCCCCoo.',
  '..oAAAAAAAAAAo..',
  '..occcccccccco..',
];

const TORSO_BROAD_SIDE = [
  '.oCCCCCCCCCCCCo.',
  'oCoCCCCCCCCCCCo.',
  'oCoCCCCCCCCCCCo.',
  'oCoCCCCCCCCCCCo.',
  'oSoCCCCCCCCCCCo.',
  '.ooCCCCCCCCCCoo.',
  '..oAAAAAAAAAAo..',
  '..occcccccccco..',
];

// Scout: pack straps in front, the pack itself on the back.
const TORSO_PACK_FRONT = [
  '..oCCCCCCCCCCo..',
  '.oCoACCCCCCAoCo.',
  '.oCoACCCCCCAoCo.',
  '.oCoACCCCCCAoCo.',
  '.oSoACCCCCCAoSo.',
  '..ooCCCCCCCCoo..',
  '...oAAAAAAAAo...',
  '...occcccccco...',
];

const TORSO_PACK_BACK = [
  '..oCCCCCCCCCCo..',
  '.oCoAAAAAAAAoCo.',
  '.oCoAAAAAAAAoCo.',
  '.oCoAAAAAAAAoCo.',
  '.oSoAAAAAAAAoSo.',
  '..ooAAAAAAAAoo..',
  '...oAAAAAAAAo...',
  '...occcccccco...',
];

const TORSO_PACK_SIDE = [
  '..oCCCCCCCCCCo..',
  '.oCoCCCCCCCAAo..',
  '.oCoCCCCCCCAAo..',
  '.oCoCCCCCCCAAo..',
  '.oSoCCCCCCCAAo..',
  '..ooCCCCCCCAAo..',
  '...oAAAAAAAAo...',
  '...occcccccco...',
];

// Kid torso is only 6 rows — the head eats the difference.
const TORSO_KID_FRONT = [
  '..oCCCCCCCCCCo..',
  '.oCoCCCCCCCCoCo.',
  '.oCoCCCCCCCCoCo.',
  '.oSoCCCCCCCCoSo.',
  '..ooCCCCCCCCoo..',
  '...occcccccco...',
];

const TORSO_KID_SIDE = [
  '..oCCCCCCCCCCo..',
  '.oCoCCCCCCCCCo..',
  '.oCoCCCCCCCCCo..',
  '.oSoCCCCCCCCCo..',
  '..ooCCCCCCCCoo..',
  '...occcccccco...',
];

// ---------------------------------------------------------------------------
// Heads (rows 2-10, or 2-12 for the kid).
// ---------------------------------------------------------------------------

// Peaked cap with a brim — hero and scout share the silhouette.
const HEAD_CAP_FRONT = [
  '.....oooooo.....',
  '...oHHHHHHHHo...',
  '..oHHHHHHHHHHo..',
  '..oHhHHHHHHhHo..',
  '..oooooooooooo..',
  '...oSSSSSSSSo...',
  '...oSoSSSSoSo...',
  '...osSSSSSSso...',
  '....oooooooo....',
];

const HEAD_CAP_SIDE = [
  '.....oooooo.....',
  '...oHHHHHHHHo...',
  '..oHHHHHHHHHHo..',
  '..oHhHHHHHHhHo..',
  '.ooooooooooooo..',
  '...oSSSSSSSAo...',
  '...oSoSSSSSAo...',
  '...osSSSSSSAo...',
  '....oooooooo....',
];

const HEAD_CAP_BACK_HAIR = [
  '.....oooooo.....',
  '...oHHHHHHHHo...',
  '..oHHHHHHHHHHo..',
  '..oHhHHHHHHhHo..',
  '..oooooooooooo..',
  '...oAAAAAAAAo...',
  '...oAAAAAAAAo...',
  '...oAAAAAAAAo...',
  '....oooooooo....',
];

// Same cap, but the back of the head is shaded cap fabric (scout wears it low).
const HEAD_CAP_BACK_FULL = [
  '.....oooooo.....',
  '...oHHHHHHHHo...',
  '..oHHHHHHHHHHo..',
  '..oHhHHHHHHhHo..',
  '..oHHHHHHHHHHo..',
  '...ohhhhhhhho...',
  '...ohhhhhhhho...',
  '...ohhhhhhhho...',
  '....oooooooo....',
];

// Bare head with a fringe and hair framing the cheeks.
const HEAD_HAIR_FRONT = [
  '.....oooooo.....',
  '...oHHHHHHHHo...',
  '..oHHHHHHHHHHo..',
  '..oHHHHHHHHHHo..',
  '..oHhhhhhhhhHo..',
  '..oHSSSSSSSSHo..',
  '..oHSoSSSSoSHo..',
  '..ooSSSSSSSSoo..',
  '....oooooooo....',
];

const HEAD_HAIR_BACK = [
  '.....oooooo.....',
  '...oHHHHHHHHo...',
  '..oHHHHHHHHHHo..',
  '..oHHHHHHHHHHo..',
  '..oHhHHHHHHhHo..',
  '..oHHHHHHHHHHo..',
  '..oHHHHHHHHHHo..',
  '..ooHHHHHHHHoo..',
  '....oooooooo....',
];

const HEAD_HAIR_SIDE = [
  '.....oooooo.....',
  '...oHHHHHHHHo...',
  '..oHHHHHHHHHHo..',
  '..oHHHHHHHHHHo..',
  '..ohhhhhhHHHHo..',
  '..oSSSSSSSHHHo..',
  '..oSoSSSSSSHHo..',
  '..ooSSSSSSSHoo..',
  '....oooooooo....',
];

// Elder: long grey hair plus a full beard.
const HEAD_ELDER_FRONT = [
  '.....oooooo.....',
  '...oHHHHHHHHo...',
  '..oHHHHHHHHHHo..',
  '..oHHHHHHHHHHo..',
  '..oHhhhhhhhhHo..',
  '..oHSSSSSSSSHo..',
  '..oHSoSSSSoSHo..',
  '..oHSHHHHHHSHo..',
  '...ooHHHHHHoo...',
];

const HEAD_ELDER_BACK = [
  '.....oooooo.....',
  '...oHHHHHHHHo...',
  '..oHHHHHHHHHHo..',
  '..oHHHHHHHHHHo..',
  '..oHhHHHHHHhHo..',
  '..oHHHHHHHHHHo..',
  '..oHHHHHHHHHHo..',
  '..oHHHHHHHHHHo..',
  '..oooooooooooo..',
];

const HEAD_ELDER_SIDE = [
  '.....oooooo.....',
  '...oHHHHHHHHo...',
  '..oHHHHHHHHHHo..',
  '..oHHHHHHHHHHo..',
  '..ohhhhhhHHHHo..',
  '..oSSSSSSSHHHo..',
  '..oSoSSSSSSHHo..',
  '..oHHHSSSSSHHo..',
  '...oHHHoooooo...',
];

// Hiker: pulled-down beanie with a turned band, wider skull.
const HEAD_BEANIE_FRONT = [
  '....oooooooo....',
  '..ooHHHHHHHHoo..',
  '..oHHHHHHHHHHo..',
  '..oHhhHHHHhhHo..',
  '..ohhhhhhhhhho..',
  '..oSSSSSSSSSSo..',
  '..oSSoSSSSoSSo..',
  '..osSSSSSSSSso..',
  '...oooooooooo...',
];

const HEAD_BEANIE_BACK = [
  '....oooooooo....',
  '..ooHHHHHHHHoo..',
  '..oHHHHHHHHHHo..',
  '..oHhhHHHHhhHo..',
  '..ohhhhhhhhhho..',
  '..oAAAAAAAAAAo..',
  '..oAAAAAAAAAAo..',
  '..oAAAAAAAAAAo..',
  '...oooooooooo...',
];

const HEAD_BEANIE_SIDE = [
  '....oooooooo....',
  '..ooHHHHHHHHoo..',
  '..oHHHHHHHHHHo..',
  '..oHhhHHHHhhHo..',
  '..ohhhhhhhhhho..',
  '..oSSSSSSSAAAo..',
  '..oSoSSSSSSAAo..',
  '..osSSSSSSSAAo..',
  '...oooooooooo...',
];

// Angler: broad straw hat that overhangs the whole sprite.
const HEAD_STRAW_FRONT = [
  '.....oooooo.....',
  '....oHHHHHHo....',
  '..ooHHHHHHHHoo..',
  'ooHHHHHHHHHHHHoo',
  'oHhhhhhhhhhhhhHo',
  'oooooooooooooooo',
  '...oSoSSSSoSo...',
  '...osSSSSSSso...',
  '....oooooooo....',
];

const HEAD_STRAW_BACK = [
  '.....oooooo.....',
  '....oHHHHHHo....',
  '..ooHHHHHHHHoo..',
  'ooHHHHHHHHHHHHoo',
  'oHhhhhhhhhhhhhHo',
  'oooooooooooooooo',
  '...oAAAAAAAAo...',
  '...oAAAAAAAAo...',
  '....oooooooo....',
];

const HEAD_STRAW_SIDE = [
  '.....oooooo.....',
  '....oHHHHHHo....',
  '..ooHHHHHHHHoo..',
  'ooHHHHHHHHHHHHoo',
  'oHhhhhhhhhhhhhHo',
  'oooooooooooooooo',
  '...oSoSSSSSAo...',
  '...osSSSSSSAo...',
  '....oooooooo....',
];

// Kid: eleven-row oversized head.
const HEAD_KID_FRONT = [
  '....oooooooo....',
  '..oooHHHHHHooo..',
  '..oHHHHHHHHHHo..',
  '.oHHHHHHHHHHHHo.',
  '.oHHhhhhhhhhHHo.',
  '.oHSSSSSSSSSSHo.',
  '.oHSSSSSSSSSSHo.',
  '.oHSoSSSSSSoSHo.',
  '.oHSSSSSSSSSSHo.',
  '.ooSSSsssSSSSoo.',
  '..oooooooooooo..',
];

const HEAD_KID_BACK = [
  '....oooooooo....',
  '..oooHHHHHHooo..',
  '..oHHHHHHHHHHo..',
  '.oHHHHHHHHHHHHo.',
  '.oHHhHHHHHHhHHo.',
  '.oHHHHHHHHHHHHo.',
  '.oHHHHHHHHHHHHo.',
  '.oHHHHHHHHHHHHo.',
  '.oHHHHHHHHHHHHo.',
  '.ooHHHHHHHHHHoo.',
  '..oooooooooooo..',
];

const HEAD_KID_SIDE = [
  '....oooooooo....',
  '..oooHHHHHHooo..',
  '..oHHHHHHHHHHo..',
  '.oHHHHHHHHHHHHo.',
  '.ohhhhhhhHHHHHo.',
  '.oSSSSSSSSSHHHo.',
  '.oSSSSSSSSSHHHo.',
  '.oSoSSSSSSSHHHo.',
  '.oSSSSSSSSSHHHo.',
  '.ooSSSSSSSSHHoo.',
  '..oooooooooooo..',
];

// ---------------------------------------------------------------------------
// Cast. pal order is [outline, hat, hatShade, skin, skinShade, top, lower, accent].
// ---------------------------------------------------------------------------

const CAST = [
  {
    key: 'hero',
    legs: 'normal',
    pal: ['#1a2028', '#2f8f4e', '#1e6435', '#eab98d', '#c2895c', '#3d6fb0', '#2b3a5c', '#5b432c'],
    down: [HEAD_CAP_FRONT, TORSO_PLAIN_FRONT],
    up: [HEAD_CAP_BACK_HAIR, TORSO_PLAIN_FRONT],
    left: [HEAD_CAP_SIDE, TORSO_PLAIN_SIDE],
  },
  {
    key: 'npc_villager',
    legs: 'normal',
    pal: ['#1a2028', '#7a5230', '#543718', '#eab98d', '#c2895c', '#c0392b', '#3f4a5e', '#6b4a2a'],
    down: [HEAD_HAIR_FRONT, TORSO_PLAIN_FRONT],
    up: [HEAD_HAIR_BACK, TORSO_PLAIN_FRONT],
    left: [HEAD_HAIR_SIDE, TORSO_PLAIN_SIDE],
  },
  {
    key: 'npc_elder',
    legs: 'robe',
    pal: ['#202028', '#bcbcc2', '#8e8e96', '#e0b892', '#b8906a', '#ece4d4', '#d0c6b4', '#7a6a58'],
    down: [HEAD_ELDER_FRONT, TORSO_ROBE_FRONT],
    up: [HEAD_ELDER_BACK, TORSO_ROBE_FRONT],
    left: [HEAD_ELDER_SIDE, TORSO_ROBE_SIDE],
  },
  {
    key: 'npc_kid',
    legs: 'kid',
    pal: ['#1a2028', '#8a5a30', '#63401f', '#f0c49a', '#c89a70', '#f0d040', '#4a7ab0', '#8a4a30'],
    down: [HEAD_KID_FRONT, TORSO_KID_FRONT],
    up: [HEAD_KID_BACK, TORSO_KID_FRONT],
    left: [HEAD_KID_SIDE, TORSO_KID_SIDE],
  },
  {
    key: 'trainer_hiker',
    legs: 'broad',
    pal: ['#1a1a1e', '#e07830', '#b45418', '#d8a070', '#a8764c', '#6b4a2a', '#4a3420', '#2e2620'],
    down: [HEAD_BEANIE_FRONT, TORSO_BROAD_FRONT],
    up: [HEAD_BEANIE_BACK, TORSO_BROAD_FRONT],
    left: [HEAD_BEANIE_SIDE, TORSO_BROAD_SIDE],
  },
  {
    key: 'trainer_angler',
    legs: 'normal',
    pal: ['#1a2028', '#e0c070', '#b08c40', '#e8b88a', '#bc8a5e', '#3a5f9e', '#2a4574', '#7a4a28'],
    down: [HEAD_STRAW_FRONT, TORSO_BARE_FRONT],
    up: [HEAD_STRAW_BACK, TORSO_BARE_FRONT],
    left: [HEAD_STRAW_SIDE, TORSO_BARE_SIDE],
  },
  {
    key: 'trainer_scout',
    legs: 'normal',
    pal: ['#1a2028', '#6a7a4a', '#4a5632', '#e8b88a', '#bc8a5e', '#b8b078', '#6a6a4a', '#8a4a2a'],
    down: [HEAD_CAP_FRONT, TORSO_PACK_FRONT],
    up: [HEAD_CAP_BACK_FULL, TORSO_PACK_BACK],
    left: [HEAD_CAP_SIDE, TORSO_PACK_SIDE],
  },
];

function assemble(head, torso, legs) {
  return [...BLANK2, ...head, ...torso, ...legs];
}

const OUT = Object.create(null);

for (const ch of CAST) {
  const cycle = LEGS[ch.legs];
  for (const view of ['down', 'up', 'left']) {
    const [head, torso] = ch[view];
    for (let f = 0; f < 3; f++) {
      const art = assemble(head, torso, cycle[f]);
      OUT[ch.key + '_' + view + '_' + f] = mk(ch.key + '_' + view + '_' + f, ch.pal, art);
      if (view === 'left') {
        OUT[ch.key + '_right_' + f] = mk(ch.key + '_right_' + f, ch.pal, mirror(art));
      }
    }
  }
}

export const CHAR_SPRITES = OUT;
export default CHAR_SPRITES;
