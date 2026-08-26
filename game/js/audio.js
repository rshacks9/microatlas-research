// audio.js — Verdant Frontier chiptune engine.
//
// Everything you hear is synthesized at runtime: pulse/square voices with a
// selectable duty cycle, a triangle voice, and a white-noise percussion
// channel. There are no audio files and no external assets.
//
// All music in this file is original to Verdant Frontier.
//
// Safety contract: the module must import cleanly in Node (no top-level DOM or
// AudioContext access) and every exported function must be a silent no-op if
// the AudioContext is unavailable, blocked, or has been closed. Nothing here is
// ever allowed to throw into the game loop.

// ---------------------------------------------------------------------------
// engine state
// ---------------------------------------------------------------------------

const A = {
  ctx: null,
  ok: false,            // context exists and is usable
  dead: false,          // construction failed once; never retry
  master: null,
  musicGain: null,
  duckGain: null,       // musicGain -> duckGain -> master; battle danger ducking
  sfxGain: null,
  noiseBuf: null,
  waves: null,          // duty -> PeriodicWave cache
  timer: null,
  players: [],          // active bgm players (usually 1, 2 while crossfading)
  compiled: null,       // name -> compiled track cache
  pending: null,        // { name, at } resume after a one-shot fanfare
  musicOn: true,
  sfxOn: true,
  duck: false,          // remembered even before/without an AudioContext
};

const MASTER_GAIN = 0.25;   // deliberately quiet — must never startle
const LOOKAHEAD_MS = 25;    // scheduler wake interval
const SCHEDULE_AHEAD = 0.10; // seconds of notes queued in front of the clock
const FADE = 0.4;           // crossfade seconds
const DUCK_LEVEL = 0.35;    // music bus level while ducked
const DUCK_TIME = 0.25;     // seconds to ramp into/out of the duck

// ---------------------------------------------------------------------------
// note names -> frequency
// ---------------------------------------------------------------------------

const SEMITONE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const freqCache = Object.create(null);

/** 'C4' | 'F#3' | 'Bb1' -> Hz. Unknown input returns 0 (treated as a rest). */
function noteFreq(name) {
  if (typeof name !== 'string') return 0;
  const hit = freqCache[name];
  if (hit !== undefined) return hit;
  const m = /^([A-Ga-g])([#sb]?)(-?\d)$/.exec(name);
  let f = 0;
  if (m) {
    let semi = SEMITONE[m[1].toLowerCase()];
    if (m[2] === '#' || m[2] === 's') semi += 1;
    else if (m[2] === 'b') semi -= 1;
    const midi = (parseInt(m[3], 10) + 1) * 12 + semi;
    f = 440 * Math.pow(2, (midi - 69) / 12);
  }
  freqCache[name] = f;
  return f;
}

// ---------------------------------------------------------------------------
// note tables
//
// Music is stored as one-bar patterns (4 beats of 4/4) plus a sequence string
// that names the bar order, so a 16-bar loop costs only a handful of patterns.
// A melodic pattern is an array of [pitch, beats]; pitch is a note name or null
// for a rest. A percussion pattern is a string, one character per step:
//   k = kick, s = snare, h = hat, . = rest
// ---------------------------------------------------------------------------

/** Eight driving eighth-notes alternating between two octaves of one root. */
function pulse8(lo, hi) {
  return [[lo, 0.5], [lo, 0.5], [hi, 0.5], [lo, 0.5],
          [lo, 0.5], [lo, 0.5], [hi, 0.5], [lo, 0.5]];
}
/** Bouncy town bass: root, fifth-ish, root, colour tone, all off-beat gapped. */
function bounce(a, b, c) {
  return [[a, 0.5], [null, 0.5], [b, 0.5], [null, 0.5],
          [a, 0.5], [null, 0.5], [c, 0.5], [null, 0.5]];
}

const TRACKS = {
  // ---- title: slow and wistful, A minor -----------------------------------
  title: {
    tempo: 76,
    lead: { voice: { type: 'square', duty: 0.125, gain: 0.30, legato: 0.96 },
      pat: {
        a: [['A4', 1], ['C5', 1], ['B4', 1.5], ['G4', 0.5]],
        b: [['E5', 2], ['D5', 1], ['C5', 1]],
        c: [['F4', 1], ['A4', 1], ['G4', 2]],
        d: [[null, 1], ['E4', 1], ['G4', 1], ['A4', 1]],
        e: [['C5', 1.5], ['B4', 0.5], ['A4', 2]],
        f: [['D5', 1], ['C5', 1], ['E5', 2]],
        g: [['G4', 2], ['F4', 1], ['E4', 1]],
        h: [['A4', 3], [null, 1]],
      },
      seq: 'dabcdabefgehdabh',
    },
    bass: { voice: { type: 'triangle', gain: 0.42, legato: 0.9 },
      pat: {
        p: [['A2', 2], ['E2', 2]],
        q: [['F2', 2], ['C3', 2]],
        r: [['D2', 2], ['G2', 2]],
        s: [['E2', 2], ['B2', 2]],
      },
      seq: 'ppqrppqsqrsppqrs',
    },
    perc: { gain: 0.5,
      pat: { x: '........', y: '....h...', z: 'h...h...' },
      seq: 'xxxyxxxyxxyzxxyz',
    },
  },

  // ---- town: warm and bouncy, G major -------------------------------------
  town: {
    tempo: 132,
    lead: { voice: { type: 'square', duty: 0.5, gain: 0.26, legato: 0.86 },
      pat: {
        a: [['D5', 0.5], ['G5', 0.5], ['F#5', 0.5], ['G5', 0.5], ['A5', 1], ['G5', 1]],
        b: [['B4', 0.5], ['D5', 0.5], ['G5', 1], ['F#5', 1], ['D5', 1]],
        c: [['E5', 0.5], ['D5', 0.5], ['C5', 1], ['B4', 1], ['A4', 1]],
        d: [['G4', 0.5], ['A4', 0.5], ['B4', 0.5], ['C5', 0.5], ['D5', 2]],
        e: [['A5', 0.5], ['G5', 0.5], ['E5', 1], ['D5', 1], ['B4', 1]],
        f: [['C5', 1], ['E5', 1], ['D5', 1], ['B4', 0.5], ['G4', 0.5]],
        g: [['G5', 2], [null, 0.5], ['D5', 0.5], ['E5', 1]],
        h: [['D5', 0.5], ['E5', 0.5], ['D5', 0.5], ['B4', 0.5], ['G4', 2]],
      },
      seq: 'abcdabefghcdabgh',
    },
    bass: { voice: { type: 'triangle', gain: 0.40, legato: 0.7 },
      pat: {
        p: bounce('G2', 'D3', 'B2'),
        q: bounce('C3', 'G3', 'E3'),
        r: bounce('D3', 'A3', 'F#3'),
        s: bounce('E3', 'B3', 'G3'),
      },
      seq: 'pprqppsrqspppqrp',
    },
    perc: { gain: 0.8,
      pat: { y: 'k.h.s.h.', z: 'k.h.s.hh', w: 'k.hks.h.' },
      seq: 'yyyzyywzyyyzyywz',
    },
  },

  // ---- overworld: bright marching, D major --------------------------------
  overworld: {
    tempo: 148,
    lead: { voice: { type: 'square', duty: 0.25, gain: 0.26, legato: 0.88 },
      pat: {
        a: [['D5', 1], ['F#5', 0.5], ['A5', 0.5], ['D6', 1], ['A5', 1]],
        b: [['B5', 1], ['A5', 0.5], ['F#5', 0.5], ['E5', 1], ['D5', 1]],
        c: [['E5', 0.5], ['F#5', 0.5], ['G5', 1], ['F#5', 1], ['E5', 1]],
        d: [['A5', 2], ['F#5', 1], ['D5', 1]],
        e: [['G5', 1], ['A5', 0.5], ['B5', 0.5], ['A5', 1], ['F#5', 1]],
        f: [['D5', 0.5], ['E5', 0.5], ['F#5', 0.5], ['G5', 0.5], ['A5', 2]],
        g: [['C#5', 1], ['D5', 1], ['E5', 1], ['F#5', 1]],
        h: [['D5', 2.5], [null, 1.5]],
      },
      seq: 'abcdabefgcebabdh',
    },
    bass: { voice: { type: 'triangle', gain: 0.42, legato: 0.6 },
      pat: {
        p: [['D2', 1], ['A2', 1], ['D3', 1], ['A2', 1]],
        q: [['G2', 1], ['D3', 1], ['G3', 1], ['D3', 1]],
        r: [['A2', 1], ['E3', 1], ['A3', 1], ['E3', 1]],
        s: [['B2', 1], ['F#3', 1], ['B3', 1], ['F#3', 1]],
      },
      seq: 'ppqrppsqrqsrpprp',
    },
    perc: { gain: 0.85,
      pat: { y: 'k.s.k.s.', z: 'k.s.k.ss', w: 'kks.k.s.' },
      seq: 'yyyzyywzyyyzyyzz',
    },
  },

  // ---- cave: sparse and low, D minor --------------------------------------
  cave: {
    tempo: 84,
    lead: { voice: { type: 'square', duty: 0.125, gain: 0.22, legato: 0.95 },
      pat: {
        a: [['D4', 2], [null, 1], ['F4', 1]],
        b: [['A4', 3], [null, 1]],
        c: [[null, 1], ['C4', 1], ['D4', 2]],
        d: [['E4', 2], ['D4', 2]],
        e: [[null, 4]],
        f: [['G4', 1.5], ['F4', 0.5], ['E4', 2]],
        g: [['A3', 2], ['D4', 2]],
        h: [['F4', 1], ['E4', 1], ['D4', 2]],
      },
      seq: 'aebecdefgebeahee',
    },
    bass: { voice: { type: 'triangle', gain: 0.46, legato: 0.98 },
      pat: {
        p: [['D2', 4]],
        q: [['A1', 4]],
        r: [['Bb1', 4]],
        s: [['G1', 4]],
      },
      seq: 'ppqprrsqppqprsqq',
    },
    perc: { gain: 0.55,
      pat: { x: '........', y: '....h...', z: 'k.......' },
      seq: 'xxyxxzxyxxyxzxyx',
    },
  },

  // ---- battle: fast and driving, E minor ----------------------------------
  battle: {
    tempo: 168,
    lead: { voice: { type: 'square', duty: 0.5, gain: 0.26, legato: 0.82 },
      pat: {
        a: [['E5', 0.5], ['E5', 0.5], ['G5', 0.5], ['B5', 0.5], ['A5', 1], ['G5', 1]],
        b: [['F#5', 0.5], ['E5', 0.5], ['D5', 0.5], ['E5', 0.5], ['B4', 2]],
        c: [['G5', 0.5], ['A5', 0.5], ['B5', 0.5], ['C6', 0.5], ['B5', 1], ['A5', 1]],
        d: [['E5', 0.25], ['F#5', 0.25], ['G5', 0.5], ['A5', 0.5], ['B5', 0.5], ['E6', 2]],
        e: [['D5', 0.5], ['E5', 0.5], ['F#5', 0.5], ['G5', 0.5], ['A5', 0.5], ['B5', 0.5], ['A5', 1]],
        f: [['B5', 1], ['A5', 0.5], ['G5', 0.5], ['F#5', 1], ['E5', 1]],
        g: [['C6', 0.5], ['B5', 0.5], ['A5', 0.5], ['G5', 0.5], ['F#5', 2]],
        h: [['E5', 0.5], ['B4', 0.5], ['E5', 0.5], ['G5', 0.5], ['B5', 2]],
      },
      seq: 'abcdabefghcdabfh',
    },
    bass: { voice: { type: 'triangle', gain: 0.44, legato: 0.62 },
      pat: {
        p: pulse8('E2', 'E3'),
        q: pulse8('G2', 'G3'),
        r: pulse8('A2', 'A3'),
        s: pulse8('B2', 'B3'),
      },
      seq: 'ppqrppsqrqsspprs',
    },
    perc: { gain: 0.9,
      pat: { y: 'khshkhsh', z: 'khshkhss', w: 'khskkhsh' },
      seq: 'yyyzyywzyyyzyyzz',
    },
  },

  // ---- victory: short fanfare, C major, plays once ------------------------
  victory: {
    tempo: 150,
    once: true,
    lead: { voice: { type: 'square', duty: 0.5, gain: 0.30, legato: 0.9 },
      pat: {
        a: [['G4', 0.5], ['G4', 0.5], ['G4', 0.5], ['C5', 1.5], [null, 1]],
        b: [['E5', 0.5], ['D5', 0.5], ['E5', 0.5], ['G5', 1.5], [null, 1]],
        c: [['F5', 0.5], ['E5', 0.5], ['D5', 1], ['E5', 2]],
        d: [['C5', 0.5], ['E5', 0.5], ['G5', 0.5], ['C6', 2.5]],
        z: [[null, 4]],
      },
      seq: 'abcdz',
    },
    bass: { voice: { type: 'triangle', gain: 0.44, legato: 0.7 },
      pat: {
        p: [['C2', 1], ['G2', 1], ['C3', 1], ['G2', 1]],
        q: [['G2', 1], ['D3', 1], ['G3', 1], ['D3', 1]],
        r: [['F2', 1], ['C3', 1], ['F3', 1], ['C3', 1]],
        s: [['C2', 2], ['C3', 2]],
        z: [[null, 4]],
      },
      seq: 'pqrsz',
    },
    perc: { gain: 0.9,
      pat: { y: 'k.s.k.s.', w: 'ksksksks', z: '........' },
      seq: 'yyywz',
    },
  },
};

// ---------------------------------------------------------------------------
// derived tracks: reuse an existing track's note tables at a different
// transposition (semitones) and tempo scale, so one melody buys several moods.
// ---------------------------------------------------------------------------

function deriveTrack(baseName, transpose, tempoScale) {
  const base = TRACKS[baseName];
  if (!base) return null;
  return {
    tempo: base.tempo,
    once: !!base.once,
    transpose: transpose,
    tempoScale: tempoScale,
    lead: base.lead,   // pattern tables are shared, never mutated
    bass: base.bass,
    perc: base.perc,
  };
}

TRACKS.overworld2 = deriveTrack('overworld', -3, 0.94);   // duskier, easier stride
TRACKS.cave2 = deriveTrack('cave', 2, 1.06);              // shallower, brighter cave
TRACKS.battle_warden = deriveTrack('battle', -2, 1.1);    // heavier, faster boss fight

// Map names other modules may hand us onto real tracks.
const TRACK_ALIAS = { wild: 'battle', fight: 'battle', map: 'overworld', world: 'overworld' };

const DRUMS = {
  k: { type: 'triangle', freq: 155, freq2: 46, dur: 0.14, gain: 0.90, hold: 0.25 },
  s: { type: 'noise', filter: 'highpass', cutoff: 1400, dur: 0.12, gain: 0.42, hold: 0.15 },
  h: { type: 'noise', filter: 'highpass', cutoff: 7200, dur: 0.035, gain: 0.16, hold: 0.2 },
};

// ---------------------------------------------------------------------------
// sound effects — short envelopes on the same three voices
// ---------------------------------------------------------------------------

const SFX = {
  select:    [{ type: 'square', duty: 0.5, freq: 880, freq2: 1320, dur: 0.08, gain: 0.5 }],
  cancel:    [{ type: 'square', duty: 0.5, freq: 520, freq2: 260, dur: 0.10, gain: 0.45 }],
  bump:      [{ type: 'noise', filter: 'lowpass', cutoff: 420, dur: 0.09, gain: 0.5 },
              { type: 'triangle', freq: 96, freq2: 60, dur: 0.10, gain: 0.5 }],
  hit:       [{ type: 'noise', filter: 'highpass', cutoff: 900, dur: 0.12, gain: 0.45 },
              { type: 'square', duty: 0.25, freq: 320, freq2: 120, dur: 0.13, gain: 0.35 }],
  crit:      [{ type: 'noise', filter: 'highpass', cutoff: 1600, dur: 0.20, gain: 0.55 },
              { type: 'square', duty: 0.5, freq: 540, freq2: 90, dur: 0.22, gain: 0.40 },
              { type: 'square', duty: 0.25, freq: 800, freq2: 140, dur: 0.20, gain: 0.28, delay: 0.03 }],
  faint:     [{ type: 'square', duty: 0.25, freq: 660, freq2: 78, dur: 0.55, gain: 0.42 },
              { type: 'triangle', freq: 330, freq2: 60, dur: 0.55, gain: 0.30, delay: 0.02 }],
  catch:     [{ type: 'square', duty: 0.5, freq: 523, dur: 0.07, gain: 0.42 },
              { type: 'square', duty: 0.5, freq: 659, dur: 0.07, gain: 0.42, delay: 0.09 },
              { type: 'square', duty: 0.5, freq: 880, dur: 0.16, gain: 0.42, delay: 0.18 }],
  heal:      [{ type: 'triangle', freq: 660, dur: 0.11, gain: 0.45 },
              { type: 'triangle', freq: 880, dur: 0.11, gain: 0.45, delay: 0.10 },
              { type: 'triangle', freq: 1100, dur: 0.22, gain: 0.42, delay: 0.20 }],
  levelup:   [{ type: 'square', duty: 0.25, freq: 523, dur: 0.09, gain: 0.42 },
              { type: 'square', duty: 0.25, freq: 659, dur: 0.09, gain: 0.42, delay: 0.09 },
              { type: 'square', duty: 0.25, freq: 784, dur: 0.09, gain: 0.42, delay: 0.18 },
              { type: 'square', duty: 0.5, freq: 1046, dur: 0.26, gain: 0.45, delay: 0.27 }],
  encounter: [{ type: 'square', duty: 0.25, freq: 180, freq2: 900, dur: 0.30, gain: 0.40 },
              { type: 'noise', filter: 'highpass', cutoff: 2200, dur: 0.22, gain: 0.28, delay: 0.28 },
              { type: 'square', duty: 0.5, freq: 900, freq2: 200, dur: 0.24, gain: 0.34, delay: 0.30 }],
  shake:     [{ type: 'square', duty: 0.125, freq: 300, freq2: 400, dur: 0.06, gain: 0.35 },
              { type: 'square', duty: 0.125, freq: 400, freq2: 300, dur: 0.06, gain: 0.35, delay: 0.07 }],
  open:      [{ type: 'noise', filter: 'highpass', cutoff: 1000, dur: 0.07, gain: 0.30 },
              { type: 'square', duty: 0.5, freq: 300, freq2: 720, dur: 0.09, gain: 0.30 }],
  error:     [{ type: 'square', duty: 0.5, freq: 200, dur: 0.15, gain: 0.45 },
              { type: 'square', duty: 0.5, freq: 150, dur: 0.20, gain: 0.45, delay: 0.15 }],
  // not-very-effective hit: dull lowpassed thud, no bright content at all
  hit_weak:  [{ type: 'noise', filter: 'lowpass', cutoff: 480, dur: 0.11, gain: 0.42 },
              { type: 'triangle', freq: 170, freq2: 68, dur: 0.13, gain: 0.40 }],
  // super-effective hit: short bright layered crack (snappier + higher than crit)
  hit_super: [{ type: 'noise', filter: 'highpass', cutoff: 2800, dur: 0.09, gain: 0.50 },
              { type: 'square', duty: 0.25, freq: 1500, freq2: 320, dur: 0.11, gain: 0.38 },
              { type: 'square', duty: 0.5, freq: 720, freq2: 180, dur: 0.13, gain: 0.28, delay: 0.015 }],
  // the capture CLICK: one short high tick, instant decay
  lock:      [{ type: 'square', duty: 0.125, freq: 2200, dur: 0.045, gain: 0.50, hold: 0.04 }],
  // EXP bar tick: single 30ms blip around 1.2kHz
  tick:      [{ type: 'square', duty: 0.25, freq: 1200, dur: 0.03, gain: 0.28, hold: 0.2 }],
  // catch jingle: ~1s, four rising-then-resolving notes (D5 A5 G5 D6),
  // deliberately not the C-major ladder that levelup uses
  fanfare_catch: [
              { type: 'square', duty: 0.5, freq: 587, dur: 0.14, gain: 0.42 },
              { type: 'square', duty: 0.5, freq: 880, dur: 0.14, gain: 0.42, delay: 0.16 },
              { type: 'square', duty: 0.5, freq: 784, dur: 0.16, gain: 0.42, delay: 0.32 },
              { type: 'square', duty: 0.25, freq: 1175, dur: 0.48, gain: 0.46, delay: 0.50 },
              { type: 'triangle', freq: 294, dur: 0.50, gain: 0.34, delay: 0.50 }],
};

// ---------------------------------------------------------------------------
// track compilation: patterns -> a flat, time-sorted event list
// ---------------------------------------------------------------------------

function addMelodic(chan, out, spb, freqMul) {
  if (!chan || !chan.pat || typeof chan.seq !== 'string') return;
  const mul = (freqMul > 0) ? freqMul : 1;
  const v = chan.voice || {};
  for (let bar = 0; bar < chan.seq.length; bar++) {
    const pat = chan.pat[chan.seq.charAt(bar)];
    if (!pat) continue;
    let beat = bar * 4;
    for (let i = 0; i < pat.length; i++) {
      const p = pat[i], dur = (p && p[1]) || 0;
      const f = noteFreq(p && p[0]);
      if (f > 0 && dur > 0) {
        out.push({
          t: beat * spb,
          type: v.type || 'square',
          duty: v.duty,
          freq: f * mul,
          dur: Math.max(0.03, dur * spb * (v.legato || 0.9)),
          gain: v.gain || 0.25,
        });
      }
      beat += dur;
    }
  }
}

function addPercussion(chan, out, spb) {
  if (!chan || !chan.pat || typeof chan.seq !== 'string') return;
  const scale = chan.gain == null ? 1 : chan.gain;
  for (let bar = 0; bar < chan.seq.length; bar++) {
    const pat = chan.pat[chan.seq.charAt(bar)];
    if (!pat || !pat.length) continue;
    const stepBeats = 4 / pat.length;
    for (let i = 0; i < pat.length; i++) {
      const d = DRUMS[pat.charAt(i)];
      if (!d) continue;
      out.push({
        t: (bar * 4 + i * stepBeats) * spb,
        type: d.type, freq: d.freq, freq2: d.freq2,
        filter: d.filter, cutoff: d.cutoff,
        dur: d.dur, hold: d.hold, gain: d.gain * scale,
      });
    }
  }
}

function compileTrack(name) {
  const def = TRACKS[name];
  if (!def) return null;
  if (!A.compiled) A.compiled = Object.create(null);
  if (A.compiled[name]) return A.compiled[name];
  // tempoScale stretches/compresses the whole track; transpose (in semitones)
  // shifts every melodic voice while leaving percussion tuning alone.
  const scale = (def.tempoScale > 0) ? def.tempoScale : 1;
  const spb = 60 / ((def.tempo || 120) * scale);
  const freqMul = def.transpose ? Math.pow(2, def.transpose / 12) : 1;
  const events = [];
  addMelodic(def.lead, events, spb, freqMul);
  addMelodic(def.bass, events, spb, freqMul);
  addPercussion(def.perc, events, spb);
  events.sort((x, y) => x.t - y.t);
  let bars = 0;
  if (def.lead && def.lead.seq) bars = Math.max(bars, def.lead.seq.length);
  if (def.bass && def.bass.seq) bars = Math.max(bars, def.bass.seq.length);
  if (def.perc && def.perc.seq) bars = Math.max(bars, def.perc.seq.length);
  const out = { events, loopLen: Math.max(0.5, bars * 4 * spb), once: !!def.once };
  A.compiled[name] = out;
  return out;
}

// ---------------------------------------------------------------------------
// audio graph
// ---------------------------------------------------------------------------

function pulseWave(duty) {
  // Fourier series of a rectangular pulse of the given duty cycle.
  const d = Math.min(0.49, Math.max(0.02, duty || 0.5));
  const key = d.toFixed(3);
  if (A.waves[key]) return A.waves[key];
  const N = 24;
  const real = new Float32Array(N + 1);
  const imag = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) real[n] = (2 / (n * Math.PI)) * Math.sin(Math.PI * n * d);
  const w = A.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  A.waves[key] = w;
  return w;
}

function makeNoiseBuffer(ctx) {
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let s = 0x1234abcd;
  for (let i = 0; i < len; i++) {
    // xorshift keeps the noise deterministic and cheap
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0;
    data[i] = (s / 0x7fffffff) % 1;
  }
  return buf;
}

/**
 * Schedule one voice: oscillator (or noise) -> envelope gain -> dest.
 * Every argument is optional except dest/time.
 */
function scheduleVoice(dest, ev, time) {
  const ctx = A.ctx;
  if (!ctx || !dest) return;
  const dur = Math.max(0.02, ev.dur || 0.1);
  const peak = Math.max(0.001, ev.gain == null ? 0.25 : ev.gain);
  const env = ctx.createGain();
  env.gain.value = 0.0001;
  env.connect(dest);

  let src;
  if (ev.type === 'noise') {
    src = ctx.createBufferSource();
    src.buffer = A.noiseBuf;
    src.loop = true;
    if (ev.filter) {
      const f = ctx.createBiquadFilter();
      f.type = ev.filter;
      f.frequency.value = ev.cutoff || 1000;
      src.connect(f);
      f.connect(env);
    } else {
      src.connect(env);
    }
  } else {
    src = ctx.createOscillator();
    if (ev.type === 'triangle' || ev.type === 'sine' || ev.type === 'sawtooth') src.type = ev.type;
    else src.setPeriodicWave(pulseWave(ev.duty));
    const f0 = Math.max(20, ev.freq || 440);
    src.frequency.setValueAtTime(f0, time);
    if (ev.freq2) {
      src.frequency.exponentialRampToValueAtTime(
        Math.max(20, ev.freq2), time + dur * (ev.slide || 0.9));
    }
    src.connect(env);
  }

  const atk = Math.min(0.008, dur * 0.25);
  const holdFrac = ev.hold == null ? 0.55 : ev.hold;
  const sustain = Math.max(0.001, peak * 0.62);
  env.gain.setValueAtTime(0.0001, time);
  env.gain.linearRampToValueAtTime(peak, time + atk);
  env.gain.exponentialRampToValueAtTime(sustain, time + atk + Math.max(0.005, dur * holdFrac));
  env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

  src.start(time);
  src.stop(time + dur + 0.02);
  src.onended = function () {
    try { src.disconnect(); } catch (_) { /* ignore */ }
    try { env.disconnect(); } catch (_) { /* ignore */ }
  };
}

// ---------------------------------------------------------------------------
// lookahead scheduler
// ---------------------------------------------------------------------------

function tick() {
  if (!A.ok || !A.ctx) return;
  const now = A.ctx.currentTime;
  const horizon = now + SCHEDULE_AHEAD;

  // hand back to the previous track shortly before a fanfare finishes
  if (A.pending && now >= A.pending.at - FADE * 0.75) {
    const back = A.pending.name;
    A.pending = null;
    if (back) playBgm(back);
    else stopBgm();
  }

  for (let i = A.players.length - 1; i >= 0; i--) {
    const p = A.players[i];
    if (p.killAt != null && now > p.killAt) {
      try { p.gain.disconnect(); } catch (_) { /* ignore */ }
      A.players.splice(i, 1);
      continue;
    }
    if (p.fading || p.finished) continue;
    const ev = p.comp.events;
    if (!ev.length) { p.finished = true; continue; }
    let guard = 0;
    while (p.base + ev[p.ptr].t < horizon && guard++ < 512) {
      scheduleVoice(p.gain, ev[p.ptr], Math.max(now, p.base + ev[p.ptr].t));
      p.ptr++;
      if (p.ptr >= ev.length) {
        p.ptr = 0;
        p.base += p.comp.loopLen;
        if (p.comp.once) {
          p.finished = true;
          p.killAt = p.base + 0.5;
          if (!A.pending) A.pending = { name: p.prev, at: p.base };
          break;
        }
      }
    }
  }
}

function startScheduler() {
  if (A.timer != null || !A.ok) return;
  try {
    A.timer = setInterval(tick, LOOKAHEAD_MS);
    if (A.timer && typeof A.timer.unref === 'function') A.timer.unref();
  } catch (_) { A.timer = null; }
}

function fadePlayerOut(p, now) {
  p.fading = true;
  p.killAt = now + FADE + 0.25;
  try {
    p.gain.gain.cancelScheduledValues(now);
    p.gain.gain.setValueAtTime(p.gain.gain.value, now);
    p.gain.gain.linearRampToValueAtTime(0.0001, now + FADE);
  } catch (_) { /* ignore */ }
}

function activePlayer() {
  for (let i = A.players.length - 1; i >= 0; i--) {
    if (!A.players[i].fading) return A.players[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

/**
 * Create the AudioContext. Must be called from a user gesture. Safe to call
 * repeatedly; safe to call where WebAudio does not exist (Node, old browsers).
 */
export function initAudio() {
  try {
    if (A.ok) {
      // A context can be auto-suspended; a later gesture resumes it.
      if (A.ctx.state === 'suspended' && A.ctx.resume) A.ctx.resume().catch(function () {});
      return true;
    }
    if (A.dead) return false;
    const g = (typeof globalThis !== 'undefined') ? globalThis : null;
    const Ctor = g && (g.AudioContext || g.webkitAudioContext);
    if (!Ctor) { A.dead = true; return false; }

    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);

    const music = ctx.createGain();
    music.gain.value = A.musicOn ? 1 : 0;
    const duck = ctx.createGain();
    duck.gain.value = A.duck ? DUCK_LEVEL : 1;
    music.connect(duck);
    duck.connect(master);

    const sfxg = ctx.createGain();
    sfxg.gain.value = A.sfxOn ? 1 : 0;
    sfxg.connect(master);

    A.ctx = ctx;
    A.master = master;
    A.musicGain = music;
    A.duckGain = duck;
    A.sfxGain = sfxg;
    A.waves = Object.create(null);
    A.noiseBuf = makeNoiseBuffer(ctx);
    A.ok = true;

    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {});
    startScheduler();
    return true;
  } catch (_) {
    A.dead = true;
    A.ok = false;
    return false;
  }
}

/** Cross-fade to a looping track. No-op if it is already the active track. */
export function playBgm(name) {
  try {
    if (!A.ok) return;
    let key = String(name || '');
    if (TRACK_ALIAS[key]) key = TRACK_ALIAS[key];
    const comp = compileTrack(key);
    if (!comp) return;

    const cur = activePlayer();
    if (cur && cur.name === key && !cur.finished) return;

    const now = A.ctx.currentTime;
    const prevName = cur ? cur.name : null;
    for (let i = 0; i < A.players.length; i++) {
      if (!A.players[i].fading) fadePlayerOut(A.players[i], now);
    }
    if (!comp.once) A.pending = null;

    const gain = A.ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(A.musicGain);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(1, now + (A.players.length ? FADE : 0.08));

    A.players.push({
      name: key,
      comp: comp,
      ptr: 0,
      base: now + 0.06,
      gain: gain,
      fading: false,
      finished: false,
      killAt: null,
      prev: comp.once ? (prevName && prevName !== key ? prevName : null) : null,
    });
    startScheduler();
    tick();
  } catch (_) { /* audio must never break the game */ }
}

/** Fade the music out. */
export function stopBgm() {
  try {
    if (!A.ok) return;
    const now = A.ctx.currentTime;
    A.pending = null;
    for (let i = 0; i < A.players.length; i++) {
      if (!A.players[i].fading) fadePlayerOut(A.players[i], now);
    }
  } catch (_) { /* ignore */ }
}

/** Play a short sound effect by name. */
export function sfx(name) {
  try {
    if (!A.ok || !A.sfxOn) return;
    const layers = SFX[String(name || '')];
    if (!layers) return;
    const now = A.ctx.currentTime + 0.005;
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];
      scheduleVoice(A.sfxGain, L, now + (L.delay || 0));
    }
  } catch (_) { /* ignore */ }
}

/** Toggle music independently of sound effects. */
export function setMusicEnabled(v) {
  try {
    A.musicOn = !!v;
    if (!A.ok) return;
    const now = A.ctx.currentTime;
    const g = A.musicGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(A.musicOn ? 1 : 0.0001, now + 0.12);
  } catch (_) { /* ignore */ }
}

/**
 * Duck the music bus while the player's creature is in danger.
 * v truthy: smoothly lower the music bus to DUCK_LEVEL (~35%) over ~0.25s;
 * v falsy: restore it over the same ramp. Independent of setMusicEnabled and
 * always a safe no-op when no AudioContext exists — the choice is remembered
 * and applied when the graph is built.
 */
export function setMusicDuck(v) {
  try {
    A.duck = !!v;
    if (!A.ok || !A.duckGain) return;
    const now = A.ctx.currentTime;
    const g = A.duckGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.linearRampToValueAtTime(A.duck ? DUCK_LEVEL : 1, now + DUCK_TIME);
  } catch (_) { /* ignore */ }
}

/** Toggle sound effects independently of music. */
export function setSfxEnabled(v) {
  try {
    A.sfxOn = !!v;
    if (!A.ok) return;
    const now = A.ctx.currentTime;
    const g = A.sfxGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(A.sfxOn ? 1 : 0.0001, now + 0.05);
  } catch (_) { /* ignore */ }
}

/** True once a usable, running AudioContext exists. */
export function isAudioReady() {
  try {
    return !!(A.ok && A.ctx && A.ctx.state !== 'closed');
  } catch (_) {
    return false;
  }
}
