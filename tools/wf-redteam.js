export const meta = {
  name: 'verdant-redteam',
  description: 'Perspective-diverse adversarial passes over the game, with refute-first verification',
  phases: [
    { title: 'Attack', detail: 'five red teams, each with a distinct lens' },
    { title: 'Verify', detail: 'independent skeptics try to refute each finding' },
  ],
}

const REPO = '/home/user/microatlas-research'

const BASE = `You are a red-team reviewer on "Verdant Frontier", an original open-world
creature-collector RPG. Repo root: ${REPO}. The game is a static browser page under game/.

READ FIRST: ${REPO}/docs/CONTRACT.md and ${REPO}/game/README.md.

You are REVIEWING, not fixing. Do NOT edit any file under game/. You may write throwaway
scripts in the scratchpad and run them, and you may run the existing tools:
  node ${REPO}/tools/simulate.mjs 800      (battle balance)
  node ${REPO}/tools/attack-save.mjs       (save hardening)
  node ${REPO}/tools/check-graph.mjs       (module graph)
  node ${REPO}/tools/harness.mjs --shots   (headless Chromium playthrough)

Ground every finding in EVIDENCE you actually produced — a script you ran, an assertion that
failed, a specific line of code you read. A finding you cannot demonstrate is not a finding.
Prefer few real defects over many speculative ones. Do not report style opinions,
missing features, or "consider adding" suggestions.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'severity', 'evidence', 'failure', 'fix'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          evidence: { type: 'string' },
          failure: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reason'],
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    severityCorrection: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'none'] },
  },
}

const TEAMS = [
  {
    key: 'crash',
    prompt: `LENS: CRASHES AND EDGE CASES.

Hunt for inputs and states that throw, hang, or produce NaN. Concentrate on:
  - battle.js with degenerate state: every move at 0 PP (Struggle path), a party of one that
    faints, switching to a fainted creature, a foe fainting to end-of-turn poison on the same
    turn the player faints, catching on the same turn the foe would faint.
  - party.js giveExp at level 100, exp overflow, evolution at exactly the threshold level,
    learning a 5th move, evolving a creature whose species has no evolve target.
  - worldgen.js across many seeds: run generateWorld for at least 40 different seeds and assert
    it never throws, always returns a start on a walkable tile, and always finishes.
  - overworld.js coordinate handling at map edges (0,0 and w-1,h-1), warps with missing tx/ty.
  - save.js round-trips of extreme values.
Write and RUN scripts that actually exercise these paths.`,
  },
  {
    key: 'design',
    prompt: `LENS: SOFTLOCKS AND UNWINNABLE STATES.

A softlock is any state a player can reach and not escape. Specifically check:
  - Can the player be stranded? Run generateWorld over 40+ seeds and flood-fill from start;
    assert every town and cave mouth is reachable. Report any seed where it is not, by number.
  - Money: can the player reach 0 money with 0 usable healing items and a fainted party?
    Trace what happens after a total party wipe in overworld.js afterBattle — is healing free
    and is the respawn point always reachable?
  - Can the player permanently lose their last creature? (Check every path that removes from
    S.party.)
  - Difficulty: use levelAt from worldgen to sample wild levels at increasing distance from the
    start and confirm the curve is walkable — i.e. a player leaving the start town does not
    immediately meet level 30 wilds. Report actual numbers.
  - Can a trainer's line-of-sight trigger repeatedly after being defeated, or trap the player
    against a wall? Read the triggerWatcher walk loop in overworld.js.
  - Is it possible to enter an interior and be unable to leave (exit warp unreachable)?`,
  },
  {
    key: 'balance',
    prompt: `LENS: BALANCE AND PROGRESSION.

Use and EXTEND ${REPO}/tools/simulate.mjs (copy it to the scratchpad and modify your copy —
do not edit the original). Produce numbers, not opinions.
  - Run at least 3000 battles. Report any non-legendary species with a win rate above 80% or
    below 20% at equal level, and explain mechanically WHY (typing, stat spread, movepool).
  - Check that every one of the 13 types has at least one usable damaging move at low, mid and
    high power, and that no type is strictly dominated.
  - Verify evolution is actually an upgrade: for each evolution line, simulate stage-1 vs
    stage-2 at the same level and confirm stage 2 wins clearly.
  - Check the AI in aiChooseMove is not exploitable or self-defeating: does it ever pick a
    0-power status move when it could KO? Does it use a move the target is immune to?
  - Check economy: sum the prize money from early trainers against shop prices. Can a player
    afford healing items early, and is money meaningless by mid-game?
  - Report the actual average battle length and one-shot rate.`,
  },
  {
    key: 'security',
    prompt: `LENS: SECURITY AND ABUSE.

This page is served from a domain that also hosts a commercial storefront, so a real XSS here
would matter.
  - Audit EVERY use of innerHTML, outerHTML, insertAdjacentHTML, document.write, eval, new
    Function, and setTimeout/setInterval with a string argument across game/js and game/index.html.
    Report any that touch data the player or a save file controls.
  - Audit save.js deserialization. Run node ${REPO}/tools/attack-save.mjs first, then try to
    find an attack it does NOT cover. Specifically attempt prototype pollution through every
    object-valued field, and try to make a loaded save produce NaN/Infinity that propagates
    into rendering or stats.
  - Check that the player name and any nickname can never reach the DOM as markup.
  - Check localStorage keys cannot be influenced by loaded data.
  - Check index.html for anything that would violate a strict CSP or load an external origin
    (the site sets X-Frame-Options: DENY and ships no bundler).
  - Confirm no network requests are made at all.`,
  },
  {
    key: 'perf',
    prompt: `LENS: PERFORMANCE.

  - Time generateWorld across 10 seeds. Report min/median/max in ms. Anything over ~1500ms is
    a defect on a mobile device.
  - Read tilemap.render: confirm it only iterates tiles inside the camera view. Count the
    actual per-frame tile draw calls for a 320x240 view and check the autotile mask computation
    is not doing redundant work per tile.
  - Look for per-frame allocation in the hot path (update/render of overworld.js, battle.js,
    tilemap.js, menus.js) — object/array/closure creation inside a loop that runs every frame
    causes GC hitches.
  - Check menus.js openWorldMap: is the 384x384 downsample cached, or recomputed each frame?
  - Run node ${REPO}/tools/harness.mjs and report the boot time and observed rAF rate.
  - Check that sprite rasterization is cached and not redone per draw.`,
  },
]

phase('Attack')

const rounds = await pipeline(
  TEAMS,
  (team) => agent(`${BASE}\n\n${team.prompt}\n\nReturn your findings via the structured output tool.`, {
    label: 'red:' + team.key,
    phase: 'Attack',
    schema: SCHEMA,
  }),
  (result, team) => {
    const findings = (result && result.findings) || []
    if (!findings.length) return []
    // Each finding faces two independent skeptics prompted to REFUTE it.
    return parallel(findings.map((f) => () =>
      parallel([0, 1].map((n) => () =>
        agent(
          `${BASE}\n\nYou are skeptic #${n + 1}. Another reviewer claims the following defect in ` +
          `Verdant Frontier. Your job is to REFUTE it. Read the actual code and run whatever you ` +
          `need to. Default to refuted=true when you are uncertain — a plausible-sounding claim ` +
          `that you cannot reproduce is refuted.\n\n` +
          `TITLE: ${f.title}\nFILE: ${f.file}${f.line ? ':' + f.line : ''}\n` +
          `CLAIMED EVIDENCE: ${f.evidence}\nCLAIMED FAILURE: ${f.failure}\n\n` +
          `Verify by reading the code and reproducing. Return your verdict.`,
          { label: 'refute:' + team.key, phase: 'Verify', schema: VERDICT }
        )
      )).then((votes) => {
        const live = votes.filter(Boolean)
        const refutes = live.filter((v) => v.refuted).length
        return {
          team: team.key,
          finding: f,
          survived: live.length > 0 && refutes < live.length,   // needs at least one defender
          refutes,
          voters: live.length,
          notes: live.map((v) => v.reason).join(' || ').slice(0, 400),
          severityVotes: live.map((v) => v.severityCorrection).filter(Boolean),
        }
      })
    ))
  }
)

const all = rounds.flat().filter(Boolean)
const survived = all.filter((r) => r.survived)
const killed = all.filter((r) => !r.survived)

log(`red teams: ${all.length} findings raised, ${survived.length} survived refutation, ${killed.length} refuted`)

const rank = { critical: 0, high: 1, medium: 2, low: 3 }
survived.sort((a, b) => (rank[a.finding.severity] ?? 9) - (rank[b.finding.severity] ?? 9))

return {
  survived: survived.map((r) => ({
    team: r.team,
    severity: r.finding.severity,
    title: r.finding.title,
    file: r.finding.file + (r.finding.line ? ':' + r.finding.line : ''),
    failure: r.finding.failure,
    fix: r.finding.fix,
    evidence: String(r.finding.evidence).slice(0, 500),
    refuteVotes: r.refutes + '/' + r.voters,
  })),
  refuted: killed.map((r) => ({ team: r.team, title: r.finding.title, why: r.notes.slice(0, 200) })),
}
