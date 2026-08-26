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
- **The usual RPG loop** — a party of six plus storage, an item bag, shops, recovery centres,
  roaming trainers with line-of-sight, a field dex, and a region map.
- **Saving** — three slots in `localStorage`. Saves store the seed rather than the map, so they
  stay tiny; the world is rebuilt deterministically on load.

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
- **Damage constants are measured, not guessed.** `DAMAGE_DIVISOR` in `battlecalc.js` is 80
  rather than the classic 50 because `tools/simulate.mjs` showed 50 produced 2.1-turn battles
  with 28% of them ending on a single hit. See the comment there before changing it.

## Tools

```sh
node tools/simulate.mjs 500     # headless battle balance report
node tools/attack-save.mjs      # adversarial tests against save deserialization
node tools/harness.mjs --shots  # headless Chromium play-test, screenshots to .harness/
node tools/harness.mjs --script=mobile
```

`harness.mjs` drives a real playthrough in Chromium, fails on any console error or unhandled
rejection, and checks framerate and mobile layout.

## Original work

This is an original game in the creature-collector genre. All creatures, names, types, moves,
places, art and music are original to this project. It contains no assets, names, or code from
any existing franchise.
