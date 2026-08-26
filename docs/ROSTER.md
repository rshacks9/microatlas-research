# Species Roster — FROZEN

34 species. `id` is the key everywhere: it is the `SPECIES` key, the `sprite` key, and the
value stored in save files. Do not rename, reorder, or renumber.

Creature sprites are **32x32**, one per species, front-facing. Back sprites are derived by
flipping — do not author them.

| dexNo | id | Name | Types | Line | Biomes | Rarity |
|---|---|---|---|---|---|---|
| 1 | sproutle | Sproutle | BLOOM | starter, →thornmane @16 | — | starter |
| 2 | thornmane | Thornmane | BLOOM/BRAWL | stage 2 | — | starter |
| 3 | cindercub | Cindercub | EMBER | starter, →pyrelynx @16 | — | starter |
| 4 | pyrelynx | Pyrelynx | EMBER | stage 2 | — | starter |
| 5 | driblet | Driblet | TIDE | starter, →tidalquill @16 | — | starter |
| 6 | tidalquill | Tidalquill | TIDE/GALE | stage 2 | — | starter |
| 7 | mottlemouse | Mottlemouse | PLAIN | →burrowarden @18 | MEADOW, FOREST | common |
| 8 | burrowarden | Burrowarden | PLAIN/TERRA | stage 2 | MEADOW, SAVANNA | uncommon |
| 9 | flitterwing | Flitterwing | GALE | →galeplume @18 | MEADOW, FOREST, BEACH | common |
| 10 | galeplume | Galeplume | GALE | stage 2 | MOUNTAIN, PEAK | uncommon |
| 11 | pebblit | Pebblit | TERRA | →boulderkin @22 | MOUNTAIN, DESERT | common |
| 12 | boulderkin | Boulderkin | TERRA/ALLOY | stage 2 | MOUNTAIN, PEAK | uncommon |
| 13 | zapkit | Zapkit | SPARK | →voltlope @20 | MEADOW, SAVANNA | common |
| 14 | voltlope | Voltlope | SPARK | stage 2 | SAVANNA | uncommon |
| 15 | glimmoth | Glimmoth | BLOOM/GALE | — | FOREST, JUNGLE | common |
| 16 | mudpuff | Mudpuff | TIDE/TERRA | — | SWAMP, BEACH | common |
| 17 | sporecap | Sporecap | BLOOM/TOXIN | →myconaut @24 | SWAMP, JUNGLE | common |
| 18 | myconaut | Myconaut | BLOOM/TOXIN | stage 2 | SWAMP | uncommon |
| 19 | emberbat | Emberbat | EMBER/GALE | — | MOUNTAIN, DESERT | uncommon |
| 20 | frostkit | Frostkit | FROST | →rimewolf @24 | TUNDRA | common |
| 21 | rimewolf | Rimewolf | FROST | stage 2 | TUNDRA, PEAK | uncommon |
| 22 | dunewyrm | Dunewyrm | TERRA | →sandcoil @26 | DESERT | common |
| 23 | sandcoil | Sandcoil | TERRA/TOXIN | stage 2 | DESERT | uncommon |
| 24 | tinplate | Tinplate | ALLOY | →ironclad @28 | MOUNTAIN | uncommon |
| 25 | ironclad | Ironclad | ALLOY/BRAWL | stage 2 | PEAK | rare |
| 26 | bogwisp | Bogwisp | TOXIN/PSION | — | SWAMP | uncommon |
| 27 | cragfang | Cragfang | TERRA/UMBRA | — | MOUNTAIN, PEAK | uncommon |
| 28 | lumibud | Lumibud | BLOOM/PSION | — | JUNGLE, FOREST | uncommon |
| 29 | thunderjaw | Thunderjaw | SPARK/BRAWL | — | SAVANNA, MOUNTAIN | rare |
| 30 | shadewisp | Shadewisp | UMBRA | →nightveil @26 | FOREST, SWAMP | common |
| 31 | nightveil | Nightveil | UMBRA/PSION | stage 2 | FOREST | uncommon |
| 32 | aurorix | Aurorix | FROST/PSION | — | PEAK | legendary |
| 33 | magmaroth | Magmaroth | EMBER/TERRA | — | PEAK | legendary |
| 34 | verdilith | Verdilith | BLOOM/ALLOY | — | JUNGLE | legendary |

Starters have `biomes: []` (never spawn wild). Legendaries are rarity `legendary`,
appear only in PEAK/JUNGLE, and must have `catchRate` 3–8.

Design intent per species (for sprite artists):
- sproutle: round seedling, big leaf sprouting from head, green
- thornmane: quadruped with a mane of thorny vines, deep green + bark brown
- cindercub: small round cub, ember-orange fur, flame tuft on tail
- pyrelynx: lean feline, flame ruff at neck, orange to red gradient
- driblet: teardrop blob with fins, pale blue, big eyes
- tidalquill: sleek bird-fish, blue and white, feathered fins
- mottlemouse: brown speckled rodent, big ears
- burrowarden: broad badger-like digger, tan + earth-brown, claw paws
- flitterwing: tiny songbird, sky blue with white belly
- galeplume: raptor silhouette, slate + white crest
- pebblit: rounded rock with two eyes and stubby legs, grey
- boulderkin: boulder golem with metallic ore veins
- zapkit: yellow fox kit with a forked lightning tail
- voltlope: antelope, yellow body, electric antler arcs
- glimmoth: pale-green moth, luminous wing spots
- mudpuff: mud-brown puffball with a wave crest on top
- sporecap: mushroom creature, purple cap with pale spots
- myconaut: tall mushroom, glowing gill ring, purple + teal
- emberbat: small bat, charcoal body, ember-orange wing membranes
- frostkit: white fox kit, ice-blue tail tip
- rimewolf: white wolf, frost crystals along the spine
- dunewyrm: sand-coloured serpent, ridged back
- sandcoil: larger coiled serpent, sand + violet venom markings
- tinplate: small armoured turtle-thing, dull steel plates
- ironclad: heavy armoured biped, steel + rivets, fists raised
- bogwisp: floating purple wisp with a glowing violet core
- cragfang: dark quadruped, rocky hide, glowing red eyes
- lumibud: flower bud with a glowing pink pistil, third-eye motif
- thunderjaw: muscular yellow-and-black reptile, jagged jaw
- shadewisp: dark violet shade with white hollow eyes
- nightveil: tall cloaked shade, star motes in the veil
- aurorix: crystalline deer, aurora-gradient antlers (cyan→violet)
- magmaroth: hulking mammoth of stone and lava cracks
- verdilith: vine-wrapped stone guardian with metallic leaves
