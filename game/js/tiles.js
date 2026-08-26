// Tile ids, flags and palettes. No DOM. Node-importable.

export const TILE = 16;

export const T = {
  VOID:0, DEEPWATER:1, WATER:2, SHALLOW:3, SAND:4, GRASS:5, TALLGRASS:6, DIRT:7, PATH:8,
  ROCK:9, CLIFF:10, SNOW:11, ICE:12, MARSH:13, JUNGLE:14, ASH:15, LAVA:16,
  TREE:17, PINE:18, PALM:19, CACTUS:20, BUSH:21, FLOWER:22, STUMP:23,
  FLOOR_WOOD:24, FLOOR_TILE:25, FLOOR_CAVE:26, WALL_BRICK:27, WALL_CAVE:28, WALL_WOOD:29,
  ROOF_RED:30, ROOF_BLUE:31, ROOF_GREY:32, WALL_HOUSE:33, DOOR:34, WINDOW:35,
  SIGN:36, FENCE:37, LEDGE_D:38, STAIRS:39, COUNTER:40, TABLE:41, SHELF:42,
  CARPET:43, WATER_EDGE:44, BRIDGE:45, PUDDLE:46, TALLGRASS_DARK:47, MUSHROOM:48,
  CRYSTAL:49, GRAVEL:50, SAVANNA:51, TUNDRA:52,
  DUNEGRASS:53, BEACHTUFT:54, SCREE:55, SNOWDRIFT:56, CAVEMOSS:57,
};

export const TILE_COUNT = 58;

// d(name, colors, opts) -> tile definition
function d(name, colors, o = {}) {
  return {
    name,
    colors,
    solid: !!o.solid,
    grass: !!o.grass,
    water: !!o.water,
    ledge: o.ledge || null,
    counter: !!o.counter,
    encounterRate: o.enc || 0,
    autotile: !!o.autotile,
    texture: o.texture || 'dither',   // how tileset.js rasterizes it
    tall: !!o.tall,                   // drawn on overlay, occludes lower half of entities
  };
}

export const TILE_DEFS = new Array(TILE_COUNT);
TILE_DEFS[T.VOID]        = d('void',        ['#000000','#000000','#000000'], { solid:true });
TILE_DEFS[T.DEEPWATER]   = d('deep water',  ['#1c3a78','#16305f','#2a4c92'], { solid:true, water:true, texture:'wave', autotile:true });
TILE_DEFS[T.WATER]       = d('water',       ['#2a5cb8','#204a98','#3c74d4'], { solid:true, water:true, texture:'wave', autotile:true });
TILE_DEFS[T.SHALLOW]     = d('shallows',    ['#4e8ad6','#3c74c0','#74aae8'], { solid:true, water:true, texture:'wave', autotile:true });
TILE_DEFS[T.SAND]        = d('sand',        ['#e0cf9a','#cbb87f','#f0e2b8'], { texture:'grain' });
TILE_DEFS[T.GRASS]       = d('grass',       ['#5aa044','#4a8838','#6ebc54'], { texture:'blade' });
TILE_DEFS[T.TALLGRASS]   = d('tall grass',  ['#3f8a34','#2f6c28','#5aa844'], { grass:true, enc:0.13, texture:'tallblade', tall:true });
TILE_DEFS[T.DIRT]        = d('dirt',        ['#9a7748','#82633a','#b08d5c'], { texture:'grain' });
TILE_DEFS[T.PATH]        = d('path',        ['#c8b48c','#b09c74','#dcc9a4'], { texture:'grain', autotile:true });
TILE_DEFS[T.ROCK]        = d('rock',        ['#8a8578','#6e6a5e','#a8a294'], { solid:true, texture:'stone' });
TILE_DEFS[T.CLIFF]       = d('cliff',       ['#6e6a5e','#514e44','#8a8578'], { solid:true, texture:'cliff', autotile:true });
TILE_DEFS[T.SNOW]        = d('snow',        ['#e8eef4','#cdd6e0','#ffffff'], { texture:'grain' });
TILE_DEFS[T.ICE]         = d('ice',         ['#b4dcea','#94c2d6','#d8f0fa'], { texture:'shine' });
TILE_DEFS[T.MARSH]       = d('marsh',       ['#4c6a44','#3c5636','#5e7e54'], { grass:true, enc:0.12, texture:'blade' });
TILE_DEFS[T.JUNGLE]      = d('jungle',      ['#2f7a3a','#22602c','#43964c'], { grass:true, enc:0.15, texture:'tallblade', tall:true });
TILE_DEFS[T.ASH]         = d('ash',         ['#6a6668','#545052','#84807e'], { texture:'grain' });
TILE_DEFS[T.LAVA]        = d('lava',        ['#d8501c','#a83a10','#f89038'], { solid:true, texture:'wave' });
TILE_DEFS[T.TREE]        = d('tree',        ['#2e6b30','#1e4a22','#3f8c40','#6a4a28'], { solid:true, texture:'tree' });
TILE_DEFS[T.PINE]        = d('pine',        ['#245a34','#173d24','#356f44','#5a4028'], { solid:true, texture:'pine' });
TILE_DEFS[T.PALM]        = d('palm',        ['#3f8f4c','#2c6c38','#58a862','#8a6a3a'], { solid:true, texture:'palm' });
TILE_DEFS[T.CACTUS]      = d('cactus',      ['#4c8c48','#3a6c38','#66a860'], { solid:true, texture:'cactus' });
TILE_DEFS[T.BUSH]        = d('bush',        ['#3d7a38','#2c5c2a','#54994c'], { solid:true, texture:'bush' });
TILE_DEFS[T.FLOWER]      = d('flowers',     ['#5aa044','#4a8838','#f0e070','#e87090'], { texture:'flower' });
TILE_DEFS[T.STUMP]       = d('stump',       ['#7a5a34','#5c4426','#96714a'], { solid:true, texture:'stone' });
TILE_DEFS[T.FLOOR_WOOD]  = d('wood floor',  ['#b08850','#96703e','#c8a068'], { texture:'plank' });
TILE_DEFS[T.FLOOR_TILE]  = d('tiled floor', ['#d8d4c8','#bcb8ac','#eeeae0'], { texture:'checker' });
TILE_DEFS[T.FLOOR_CAVE]  = d('cave floor',  ['#6a6258','#544e46','#847c70'], { texture:'grain' });
TILE_DEFS[T.WALL_BRICK]  = d('brick wall',  ['#a4604c','#83493a','#c07a62'], { solid:true, texture:'brick' });
TILE_DEFS[T.WALL_CAVE]   = d('cave wall',   ['#4a443c','#36322c','#605850'], { solid:true, texture:'cliff', autotile:true });
TILE_DEFS[T.WALL_WOOD]   = d('wood wall',   ['#8a6a40','#6e5230','#a68256'], { solid:true, texture:'plank' });
TILE_DEFS[T.ROOF_RED]    = d('red roof',    ['#c04838','#9a3628','#dc6450'], { solid:true, texture:'shingle' });
TILE_DEFS[T.ROOF_BLUE]   = d('blue roof',   ['#3c68b8','#2c5098','#5484d8'], { solid:true, texture:'shingle' });
TILE_DEFS[T.ROOF_GREY]   = d('grey roof',   ['#7a8290','#5e6672','#98a0ae'], { solid:true, texture:'shingle' });
TILE_DEFS[T.WALL_HOUSE]  = d('house wall',  ['#e0d4b8','#c4b89c','#f2e8d0'], { solid:true, texture:'plaster' });
TILE_DEFS[T.DOOR]        = d('door',        ['#6a4628','#4e3420','#8a6038','#2a1c10'], { texture:'door' });
TILE_DEFS[T.WINDOW]      = d('window',      ['#8ec4e0','#6aa4c4','#b8e0f2','#6a4628'], { solid:true, texture:'window' });
TILE_DEFS[T.SIGN]        = d('sign',        ['#8a6038','#6a4628','#c8a870'], { solid:true, texture:'sign' });
TILE_DEFS[T.FENCE]       = d('fence',       ['#a8845c','#8a6a44','#c4a078'], { solid:true, texture:'fence' });
TILE_DEFS[T.LEDGE_D]     = d('ledge',       ['#9a8158','#7c6644','#b8a078'], { ledge:'down', texture:'ledge' });
TILE_DEFS[T.STAIRS]      = d('stairs',      ['#9c9488','#7e766a','#b8b0a4'], { texture:'stairs' });
TILE_DEFS[T.COUNTER]     = d('counter',     ['#c8a068','#a88048','#e0bc88'], { solid:true, counter:true, texture:'plank' });
TILE_DEFS[T.TABLE]       = d('table',       ['#b08850','#8e6a3c','#c8a068'], { solid:true, texture:'plank' });
TILE_DEFS[T.SHELF]       = d('shelf',       ['#8a6a40','#6a5030','#b09068'], { solid:true, texture:'shelf' });
TILE_DEFS[T.CARPET]      = d('carpet',      ['#c04868','#9c3450','#dc6a88'], { texture:'checker' });
TILE_DEFS[T.WATER_EDGE]  = d('water edge',  ['#74aae8','#5490d0','#a0cef4'], { water:true, solid:true, texture:'wave', autotile:true });
TILE_DEFS[T.BRIDGE]      = d('bridge',      ['#a8804c','#8a6438','#c49c68'], { texture:'plank' });
TILE_DEFS[T.PUDDLE]      = d('puddle',      ['#6a9ad0','#5484b8','#8ab4e0'], { texture:'wave' });
TILE_DEFS[T.TALLGRASS_DARK] = d('deep grass',['#2c6428','#1e4a1c','#3f8038'], { grass:true, enc:0.18, texture:'tallblade', tall:true });
TILE_DEFS[T.MUSHROOM]    = d('mushrooms',   ['#4c6a44','#3c5636','#d8746a','#f0e4d0'], { texture:'flower' });
TILE_DEFS[T.CRYSTAL]     = d('crystal',     ['#7a68c0','#5c4c9c','#a894e0'], { solid:true, texture:'crystal' });
TILE_DEFS[T.GRAVEL]      = d('gravel',      ['#8e8880','#726c64','#aaa49c'], { texture:'stone' });
TILE_DEFS[T.SAVANNA]     = d('savanna',     ['#b4a45c','#9a8a48','#ccbc78'], { grass:true, enc:0.11, texture:'blade' });
TILE_DEFS[T.TUNDRA]      = d('tundra',      ['#a8bcae','#8ea294','#c2d4c6'], { grass:true, enc:0.10, texture:'blade' });
// Encounter terrain for the biomes that had NONE — four surface biomes plus caves
// were measured at 0.0% encounter tiles, which silently made ~12 species
// (both PEAK legendaries included) uncatchable in practice.
TILE_DEFS[T.DUNEGRASS]   = d('dune grass',  ['#cbb478','#a8925c','#e2d097'], { grass:true, enc:0.11, texture:'blade' });
TILE_DEFS[T.BEACHTUFT]   = d('beach tufts', ['#d5c98e','#b2a86e','#a4c084'], { grass:true, enc:0.09, texture:'blade' });
TILE_DEFS[T.SCREE]       = d('scree',       ['#7e786a','#5f5a50','#9c968a'], { grass:true, enc:0.11, texture:'stone' });
TILE_DEFS[T.SNOWDRIFT]   = d('snow drift',  ['#dbe6ee','#b8c8d6','#f4f8fc'], { grass:true, enc:0.10, texture:'grain' });
TILE_DEFS[T.CAVEMOSS]    = d('cave moss',   ['#4e6858','#3a5044','#6a8a72'], { grass:true, enc:0.13, texture:'blade' });

for (let i = 0; i < TILE_COUNT; i++) {
  if (!TILE_DEFS[i]) TILE_DEFS[i] = d('unused', ['#ff00ff','#aa00aa','#ff88ff'], { solid:true });
}

const def = (id) => TILE_DEFS[id] || TILE_DEFS[T.VOID];

export function isSolid(id)       { return def(id).solid; }
export function isGrass(id)       { return def(id).grass; }
export function isWater(id)       { return def(id).water; }
export function isTall(id)        { return def(id).tall; }
export function ledgeDir(id)      { return def(id).ledge; }
export function isCounter(id)     { return def(id).counter; }
export function encounterRate(id) { return def(id).encounterRate; }
export function isAutotile(id)    { return def(id).autotile; }

// Overlay 0 means "no overlay", but tile id 0 is VOID which IS solid. Any code that
// tests the overlay layer must special-case 0 or the entire map reads as blocked.
export function overlayBlocks(id) { return id !== T.VOID && def(id).solid; }
export function overlayEmpty(id)  { return id === T.VOID; }
export function tileName(id)      { return def(id).name; }
