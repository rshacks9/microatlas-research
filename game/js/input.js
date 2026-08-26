// Unified keyboard + touch input. Edge-triggered presses roll once per frame.

export const Keys = {
  up: false, down: false, left: false, right: false,
  a: false, b: false, start: false, select: false, run: false,
};

const edges = Object.create(null);   // name -> true for this frame
let pending = Object.create(null);   // filled by events, promoted at updateInput()
let anyEdge = false;

const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  KeyZ: 'a', Enter: 'a', Space: 'a', KeyJ: 'a',
  KeyX: 'b', Escape: 'b', Backspace: 'b', KeyK: 'b',
  KeyC: 'start', Tab: 'start',
  ShiftLeft: 'run', ShiftRight: 'run',
};

function press(name) {
  if (!name) return;
  if (!Keys[name]) pending[name] = true;   // rising edge only
  Keys[name] = true;
}
function release(name) {
  if (!name) return;
  Keys[name] = false;
}

function onKeyDown(e) {
  const name = KEYMAP[e.code];
  if (!name) return;
  // Don't swallow browser shortcuts the player may need.
  if (!e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
  if (e.repeat) return;
  press(name);
}
function onKeyUp(e) {
  const name = KEYMAP[e.code];
  if (!name) return;
  if (!e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
  release(name);
}

function blurAll() {
  for (const k in Keys) Keys[k] = false;
}

let touchRoot = null;

export function initInput(canvasEl, touchRootEl) {
  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp, { passive: false });
  window.addEventListener('blur', blurAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) blurAll(); });

  touchRoot = touchRootEl || null;
  if (touchRoot) bindTouch(touchRoot);

  // Prevent iOS double-tap zoom / long-press callout on the play surface.
  if (canvasEl) {
    canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
    canvasEl.style.touchAction = 'none';
  }
}

function bindTouch(root) {
  const btns = root.querySelectorAll('[data-btn]');
  btns.forEach((el) => {
    const name = el.getAttribute('data-btn');
    el.style.touchAction = 'none';
    const down = (e) => {
      e.preventDefault();
      press(name);
      el.classList.add('held');
      if (el.setPointerCapture && e.pointerId !== undefined) {
        try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      }
    };
    const up = (e) => {
      e.preventDefault();
      release(name);
      el.classList.remove('held');
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  });
}

export function pressed(name) { return !!edges[name]; }

export function consume(name) {
  if (edges[name]) { edges[name] = false; return true; }
  return false;
}

export function anyPressed() { return anyEdge; }

// Promote pending event edges into this frame's edge set. Call ONCE at the top of the frame.
export function beginFrame() {
  anyEdge = false;
  for (const k in edges) edges[k] = false;
  for (const k in pending) {
    if (pending[k]) { edges[k] = true; anyEdge = true; }
  }
  pending = Object.create(null);
}

// Kept for contract compatibility: clears any edge not consumed this frame.
export function updateInput() {
  for (const k in edges) edges[k] = false;
}

export function setTouchVisible(v) {
  if (touchRoot) touchRoot.classList.toggle('hidden', !v);
}

export function clearInput() { blurAll(); pending = Object.create(null); for (const k in edges) edges[k] = false; }

// Direction currently held, honouring the most recently pressed axis.
export function heldDir() {
  if (Keys.up) return 'up';
  if (Keys.down) return 'down';
  if (Keys.left) return 'left';
  if (Keys.right) return 'right';
  return null;
}
