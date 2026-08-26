// Shared runtime context + scene stack. Imported by every scene; imports nothing back.

export const W = 320, H = 240, TILE = 16;

export const Game = {
  canvas: null,
  ctx: null,
  scenes: [],
  t: 0,
  paused: false,
  scale: 1,
};

export function topScene() { return Game.scenes[Game.scenes.length - 1] || null; }

export function pushScene(scene, params) {
  Game.scenes.push(scene);
  if (typeof scene.enter === 'function') scene.enter(params);
  return scene;
}

export function popScene(result) {
  const s = Game.scenes.pop();
  if (s && typeof s.exit === 'function') s.exit();
  const below = topScene();
  if (below && typeof below.resume === 'function') below.resume(result);
  return result;
}

export function replaceScene(scene, params) {
  const s = Game.scenes.pop();
  if (s && typeof s.exit === 'function') s.exit();
  return pushScene(scene, params);
}

export function clearScenes() {
  while (Game.scenes.length) {
    const s = Game.scenes.pop();
    if (s && typeof s.exit === 'function') s.exit();
  }
}

// ---- screen fade -------------------------------------------------------
const fadeState = { active: false, kind: 'out', t: 0, dur: 0.3, alpha: 0, resolve: null, color: '#000' };

export function fade(kind = 'out', durationSec = 0.35, color = '#000') {
  // Never strand an awaiter. There is one fadeState.resolve slot, so a second
  // fade() overwrote the first's resolver and its `await fade(...)` hung forever
  // — which left doWarp's finally unreached and O's busy lock held permanently,
  // a full input-dead softlock. A superseded fade now settles immediately.
  const prev = fadeState.resolve;
  fadeState.resolve = null;
  if (prev) prev();
  fadeState.active = true;
  fadeState.kind = kind;
  fadeState.t = 0;
  fadeState.dur = Math.max(0.01, durationSec);
  fadeState.color = color;
  fadeState.alpha = kind === 'out' ? 0 : 1;
  return new Promise((res) => { fadeState.resolve = res; });
}

export function isFading() { return fadeState.active; }
export function fadeAlpha() { return fadeState.alpha; }

export function updateFade(dt) {
  if (!fadeState.active) return;
  fadeState.t += dt;
  const p = Math.min(1, fadeState.t / fadeState.dur);
  fadeState.alpha = fadeState.kind === 'out' ? p : 1 - p;
  if (p >= 1) {
    fadeState.active = false;
    const r = fadeState.resolve;
    fadeState.resolve = null;
    if (r) r();
  }
}

export function renderFade(ctx) {
  if (fadeState.alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, fadeState.alpha);
  ctx.fillStyle = fadeState.color;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// Convenience: fade out, run fn, fade in.
export async function transition(fn, dur = 0.28) {
  await fade('out', dur);
  try { if (fn) await fn(); } finally { await fade('in', dur); }
}

export function clear(ctx, color = '#000') {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
}
