// WebAudio chiptune engine. No audio files — every voice is synthesized.
// Every export is a safe no-op when there is no AudioContext (Node, blocked autoplay).

let ctx = null;
let master = null, musicGain = null, sfxGain = null;
let ready = false;
let musicOn = true, sfxOn = true;

let current = null;        // name of the playing track
let timer = null;          // scheduler interval
let nextNoteTime = 0;
let step = 0;
let queuedAfter = null;    // track to return to after a one-shot fanfare

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;

// ---------------------------------------------------------------- notes
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function freq(note) {
  if (!note) return 0;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(note);
  if (!m) return 0;
  let s = SEMI[m[1]];
  if (m[2] === '#') s++;
  else if (m[2] === 'b') s--;
  const midi = (parseInt(m[3], 10) + 1) * 12 + s;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------------------------------------------------------------- tracks
// Each track: { bpm, div (steps per beat), lead[], bass[], drum[] }
// Note strings, or null for a rest. Arrays loop independently, so a 16-step
// bass under a 32-step lead gives cheap variation.
const TRACKS = {
  title: {
    bpm: 82, div: 2, wave: 'triangle', gain: 0.5,
    lead: ['E4', null, 'G4', null, 'B4', null, 'A4', null, 'G4', null, 'E4', null, 'D4', null, null, null,
           'C4', null, 'E4', null, 'G4', null, 'F4', null, 'E4', null, 'D4', null, 'E4', null, null, null],
    bass: ['E2', null, null, null, 'C2', null, null, null, 'G2', null, null, null, 'D2', null, null, null],
    drum: [],
  },
  town: {
    bpm: 118, div: 2, wave: 'square', gain: 0.42,
    lead: ['G4', 'A4', 'B4', 'D5', 'B4', 'A4', 'G4', 'E4', 'G4', 'A4', 'B4', 'A4', 'G4', null, 'D4', null,
           'C5', 'B4', 'A4', 'G4', 'A4', 'B4', 'G4', 'E4', 'D4', 'E4', 'G4', 'A4', 'G4', null, null, null],
    bass: ['G2', null, 'D3', null, 'C3', null, 'G2', null, 'E2', null, 'B2', null, 'D3', null, 'D2', null],
    drum: [1, 0, 0, 2, 1, 0, 2, 0],
  },
  overworld: {
    bpm: 138, div: 2, wave: 'square', gain: 0.4,
    lead: ['C4', 'E4', 'G4', 'C5', 'B4', 'G4', 'E4', 'G4', 'A4', 'C5', 'A4', 'F4', 'G4', 'E4', 'C4', null,
           'D4', 'F4', 'A4', 'D5', 'C5', 'A4', 'F4', 'A4', 'G4', 'B4', 'G4', 'E4', 'C4', null, null, null],
    bass: ['C2', 'C2', 'G2', null, 'F2', 'F2', 'C3', null, 'A2', 'A2', 'E3', null, 'G2', 'G2', 'D3', null],
    drum: [1, 0, 2, 0, 1, 0, 2, 2],
  },
  cave: {
    bpm: 76, div: 1, wave: 'triangle', gain: 0.45,
    lead: ['A3', null, null, 'C4', null, null, 'E4', null, 'D4', null, null, 'C4', null, null, null, null],
    bass: ['A1', null, null, null, 'F1', null, null, null, 'G1', null, null, null, 'E1', null, null, null],
    drum: [0, 0, 0, 0, 1, 0, 0, 0],
  },
  battle: {
    bpm: 166, div: 2, wave: 'square', gain: 0.44,
    lead: ['E4', 'E4', 'B4', 'E4', 'G4', 'E4', 'B4', 'D5', 'C5', 'B4', 'A4', 'G4', 'A4', 'B4', 'E4', null,
           'F4', 'F4', 'C5', 'F4', 'A4', 'F4', 'C5', 'E5', 'D5', 'C5', 'B4', 'A4', 'G4', null, 'E4', null],
    bass: ['E2', 'E2', 'E2', 'B1', 'G2', 'G2', 'D2', 'D2'],
    drum: [1, 2, 1, 2, 1, 2, 1, 3],
  },
  victory: {
    bpm: 150, div: 2, wave: 'square', gain: 0.5, once: true,
    lead: ['C5', 'C5', 'C5', 'C5', 'G4', 'A4', 'C5', null, 'A4', 'C5', null, null, null, null, null, null],
    bass: ['C3', null, 'C3', null, 'G2', null, 'C3', null, 'F2', 'C3', null, null, null, null, null, null],
    drum: [1, 0, 1, 0, 1, 1, 1, 0],
  },
};

// ---------------------------------------------------------------- core
let noiseBuffer = null;

function makeNoise() {
  if (noiseBuffer || !ctx) return noiseBuffer;
  const len = Math.floor(ctx.sampleRate * 0.4);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

export function initAudio() {
  if (ready || ctx) return isAudioReady();
  try {
    const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.25;                 // deliberately quiet
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = musicOn ? 1 : 0;
    musicGain.connect(master);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = sfxOn ? 1 : 0;
    sfxGain.connect(master);
    makeNoise();
    ready = true;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  } catch (_) {
    ctx = null; ready = false;
    return false;
  }
}

export function isAudioReady() { return !!(ready && ctx && ctx.state !== 'closed'); }

function tone(when, f, dur, wave, gain, dest) {
  if (!f || !isAudioReady()) return;
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = wave || 'square';
    o.frequency.setValueAtTime(f, when);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    o.connect(g); g.connect(dest || musicGain);
    o.start(when);
    o.stop(when + dur + 0.03);
  } catch (_) { /* a dropped note must never break the game */ }
}

function noise(when, dur, gain, dest, hp) {
  if (!isAudioReady()) return;
  try {
    const src = ctx.createBufferSource();
    src.buffer = makeNoise();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp || 1200;
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    src.connect(f); f.connect(g); g.connect(dest || musicGain);
    src.start(when);
    src.stop(when + dur + 0.02);
  } catch (_) { /* ignore */ }
}

// ---------------------------------------------------------------- scheduler
function scheduler() {
  if (!isAudioReady() || !current) return;
  const track = TRACKS[current];
  if (!track) return;
  const stepDur = 60 / track.bpm / track.div;

  while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
    const t = nextNoteTime;

    if (track.lead && track.lead.length) {
      const n = track.lead[step % track.lead.length];
      if (n) tone(t, freq(n), stepDur * 0.9, track.wave, (track.gain || 0.4) * 0.5);
    }
    if (track.bass && track.bass.length) {
      const n = track.bass[step % track.bass.length];
      if (n) tone(t, freq(n), stepDur * 1.5, 'triangle', (track.gain || 0.4) * 0.7);
    }
    if (track.drum && track.drum.length) {
      const d = track.drum[step % track.drum.length];
      if (d === 1) noise(t, 0.06, 0.30, musicGain, 900);
      else if (d === 2) noise(t, 0.035, 0.16, musicGain, 3800);
      else if (d === 3) noise(t, 0.12, 0.26, musicGain, 2400);
    }

    step++;
    nextNoteTime += stepDur;

    if (track.once) {
      const len = Math.max(track.lead.length, track.bass.length);
      if (step >= len) {
        const back = queuedAfter;
        queuedAfter = null;
        stopBgm();
        if (back) setTimeout(() => playBgm(back), 60);
        return;
      }
    }
  }
}

export function playBgm(name) {
  if (!TRACKS[name]) return;
  if (!isAudioReady()) { current = null; return; }
  if (current === name) return;

  const track = TRACKS[name];
  if (track.once && current && !TRACKS[current].once) queuedAfter = current;

  stopTimer();
  current = name;
  step = 0;
  nextNoteTime = ctx.currentTime + 0.06;
  try {
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    musicGain.gain.linearRampToValueAtTime(musicOn ? 1 : 0, ctx.currentTime + 0.4);
  } catch (_) { /* ignore */ }
  timer = setInterval(scheduler, LOOKAHEAD_MS);
  scheduler();
}

function stopTimer() {
  if (timer !== null) { clearInterval(timer); timer = null; }
}

export function stopBgm() {
  stopTimer();
  current = null;
  if (!isAudioReady()) return;
  try {
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
    musicGain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
  } catch (_) { /* ignore */ }
}

export function currentBgm() { return current; }

// ---------------------------------------------------------------- sfx
const SFX = {
  select:    (t) => { tone(t, 880, 0.06, 'square', 0.32, sfxGain); },
  cancel:    (t) => { tone(t, 440, 0.07, 'square', 0.28, sfxGain); tone(t + 0.05, 300, 0.07, 'square', 0.22, sfxGain); },
  bump:      (t) => { noise(t, 0.05, 0.22, sfxGain, 500); tone(t, 150, 0.07, 'triangle', 0.22, sfxGain); },
  hit:       (t) => { noise(t, 0.09, 0.34, sfxGain, 800); tone(t, 220, 0.09, 'square', 0.20, sfxGain); },
  crit:      (t) => { noise(t, 0.14, 0.40, sfxGain, 600); tone(t, 320, 0.13, 'square', 0.26, sfxGain); tone(t + 0.06, 480, 0.12, 'square', 0.22, sfxGain); },
  faint:     (t) => { for (let i = 0; i < 6; i++) tone(t + i * 0.05, 500 - i * 62, 0.09, 'triangle', 0.26, sfxGain); },
  catch:     (t) => { tone(t, 700, 0.08, 'square', 0.26, sfxGain); tone(t + 0.07, 520, 0.10, 'square', 0.22, sfxGain); },
  shake:     (t) => { tone(t, 420, 0.05, 'square', 0.20, sfxGain); noise(t, 0.03, 0.10, sfxGain, 2000); },
  heal:      (t) => { ['C5', 'E5', 'G5'].forEach((n, i) => tone(t + i * 0.07, freq(n), 0.16, 'triangle', 0.24, sfxGain)); },
  levelup:   (t) => { ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => tone(t + i * 0.075, freq(n), 0.20, 'square', 0.26, sfxGain)); },
  encounter: (t) => { for (let i = 0; i < 5; i++) { tone(t + i * 0.06, i % 2 ? 300 : 660, 0.05, 'square', 0.28, sfxGain); } },
  open:      (t) => { tone(t, 300, 0.05, 'square', 0.20, sfxGain); tone(t + 0.05, 520, 0.07, 'square', 0.20, sfxGain); },
  error:     (t) => { tone(t, 180, 0.16, 'square', 0.28, sfxGain); },
};

export function sfx(name) {
  if (!sfxOn || !isAudioReady()) return;
  const fn = SFX[name];
  if (!fn) return;
  try { fn(ctx.currentTime + 0.005); } catch (_) { /* ignore */ }
}

// ---------------------------------------------------------------- toggles
export function setMusicEnabled(v) {
  musicOn = !!v;
  if (!isAudioReady()) return;
  try {
    musicGain.gain.cancelScheduledValues(ctx.currentTime);
    musicGain.gain.linearRampToValueAtTime(musicOn ? 1 : 0, ctx.currentTime + 0.15);
  } catch (_) { /* ignore */ }
}

export function setSfxEnabled(v) {
  sfxOn = !!v;
  if (!isAudioReady()) return;
  try { sfxGain.gain.setValueAtTime(sfxOn ? 1 : 0, ctx.currentTime); } catch (_) { /* ignore */ }
}

export function isMusicEnabled() { return musicOn; }
export function isSfxEnabled() { return sfxOn; }

export function suspendAudio() { try { if (ctx && ctx.state === 'running') ctx.suspend(); } catch (_) {} }
export function resumeAudio() { try { if (ctx && ctx.state === 'suspended') ctx.resume(); } catch (_) {} }
