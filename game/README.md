# Verdant Frontier

An open-world 2D creature-collecting RPG that runs entirely in the browser. No build step, no
dependencies, no external assets — every sprite is pixel data in a JS file, every tile is drawn
procedurally at load, and every note of music is synthesized with WebAudio.

The world is generated from a seed, so no two journeys share a map.

## Play

The game needs to be served over `http://` (ES modules do not load from `file://`):

```sh
python3 -m http.server 8000
# then open http://localhost:8000/game/
```

## Controls

| Action  | Keyboard                | Touch      |
|---------|-------------------------|------------|
| Move    | Arrow keys / WASD       | D-pad      |
| Confirm | Z / Enter / Space       | A          |
| Cancel  | X / Esc / Backspace     | B          |
| Menu    | C / Tab                 | MENU       |
| Run     | Hold Shift              | RUN        |

Touch controls appear automatically on touch devices.

## What's in it

- **Open world** — a 384×384 seeded island with eleven biomes, rivers, caves and 8–10 towns.
  There is no route gating: you can walk in any direction from the start, and wild levels scale
  with distance from your home town, so wandering far is the difficulty curve.
- **34 original creatures** across 13 original types, with two-stage evolution lines, per-creature
  stat variation, and a full effectiveness chart.
- **Turn-based battles** — physical/special split, stat stages, five status conditions,
  confusion and flinch, priority moves, critical hits, and a capture system with four ball tiers.
- **The usual RPG loop** — a party of six plus a storage screen, an item bag, tiered shops with
  permanent-stat tonics, recovery centres, trainer archetypes with line-of-sight, a field dex
  with habitat lines, and a fog-of-war region map that charts as you explore.
- **Named Wardens** — one per settlement (worlds generate 8-10), each with a type specialty their team expresses, a named Seal, and a
  truthful pre-battle tell. Distance decides difficulty, so any Seal order works.
- **An actual ending** — hold every Seal and the Wardens' Circle convenes the Verdant Trial:
  three Keepers, back to back, no healing between rounds. Legendaries live at fixed, Seal-gated
  shrines at the far reaches of their biomes, marked on the chart once you find them.
- **A meta across journeys** — the Frontier Record keeps lifetime stats on your device outside
  any save slot, and finishing the Trial unlocks New Journey+: a fresh seed where your field
  notes (dex sightings) travel with you.
- **Saving** — three slots in `localStorage`. Saves store the seed rather than the map, so they
  stay tiny; the world is rebuilt deterministically on load. Old save versions migrate rather
  than vanish.

## Architecture

Everything is a plain ES module under `js/`. `docs/CONTRACT.md` at the repo root is the frozen
interface every module was written against — read that first if you're changing anything.

The dependency graph is acyclic by construction: `game.js` holds the scene stack and imports
nothing back, so scenes can push and pop each other without cycles.

Modules that must stay **DOM-free** (they are imported by the headless Node tools):
`rng.js`, `types.js`, `tiles.js`, `state.js`, `creatures.js`, `moves.js`, `items.js`,
`battlecalc.js`, `party.js`, `worldgen.js`, `towns.js`.

### Notable design decisions

- **The world is never serialized.** `worldgen.js` is pure and deterministic in its seed, so a
  save only needs the seed. This keeps saves well under any storage quota and means save/load is
  also a continuous test of generator determinism.
- **Back sprites are derived, not authored.** Each creature has one 32×32 front sprite; the back
  view is the same sprite flipped and scaled. Half the art for no loss in readability.
- **Text has a fallback path.** `ui.drawText` uses the 5×7 bitmap font in `font.js`, but falls
  back to `ctx.fillText` for any glyph that is missing, so an incomplete font can never blank the
  screen.
- **Battle flow is a coroutine.** `battle.js` reads top-to-bottom as an `async` function that
  awaits `msg()` / `anim()` / `menuSelect()`; the fixed-timestep `update()` resolves those
  promises. This keeps a long, branchy turn sequence readable instead of a state-machine soup.
- **Damage constants are measured, not guessed.** `damageDivisor(level)` in `battlecalc.js` is
  level-scaled (`70 + level*0.55`) rather than the classic flat 50 because `tools/simulate.mjs`
  showed a flat divisor cannot hold pacing across levels — 50 produced 2.1-turn battles with 28%
  one-shots. See the comment there before changing it.
- **Entities carry every spec field.** The `Entity` wrapper passes unknown generator fields
  through verbatim; a whitelist once silently dropped `warden`/`seal`, which meant Seals never
  incremented while every spec-level checker stayed green. `tools/check-entities.mjs` asserts on
  the wrapped side now.
- **Town content forks its rng.** `stampTown` draws exactly one value from the world's shared
  stream and forks a private generator, so adding town content can never reshuffle later towns
  or cave mouths for an existing seed (enforced in `tools/check-world.mjs`).

## Tools

```sh
node tools/simulate.mjs 500     # headless battle balance report
node tools/attack-save.mjs      # adversarial tests against save deserialization
node tools/harness.mjs --shots  # headless Chromium play-test, screenshots to .harness/
node tools/harness.mjs --script=mobile
```

Eleven deterministic checkers (plus the attack-save suite above) cover the
invariants that have actually broken during development — run them all with:

```sh
for c in graph movesets capture evolution curve firstwalk entitylock world \
         onboarding huntable entities; do node tools/check-$c.mjs || break; done
```

Each checker's header comment names the shipped bug that motivated it; `check-huntable`
(species reachable in the world, not merely present in tables) and `check-entities`
(fields survive the Entity wrapper) exist because table-level checks stayed green through
both of those bugs.

`harness.mjs` drives a real playthrough in Chromium, fails on any console error or unhandled
rejection, and checks framerate and mobile layout.

## Original work

This is an original game in the creature-collector genre. All creatures, names, types, moves,
places, art and music are original to this project. It contains no assets, names, or code from
any existing franchise.
