// Textbox, choice prompt and location banner.
// The dialogue scenes are non-opaque so the overworld keeps rendering beneath them.

import { pushScene, popScene, W, H } from './game.js';
import { drawWindow, drawText, wrapText, drawCursor, textWidth, PAL, LINE_H } from './ui.js';
import { Keys, pressed, consume } from './input.js';
import { S } from './state.js';

// ---- layout constants --------------------------------------------------
const MARGIN = 4;                       // gap from the screen edge
const BOX_H = 52;
const BOX_X = MARGIN;
const BOX_W = W - MARGIN * 2;           // 312
const BOX_Y = H - BOX_H - MARGIN;       // 184
const PAD = 8;                          // text inset from the box edge
const TEXT_X = BOX_X + PAD;
const TEXT_Y = BOX_Y + PAD;
const TEXT_W = BOX_W - PAD * 2;         // 296
const LINES_PER_PAGE = 2;

// Characters revealed per second, indexed by S.options.textSpeed.
const SPEEDS = [16, 32, 64, Infinity];

function speedChars() {
  const i = S && S.options ? (S.options.textSpeed | 0) : 2;
  return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i))];
}

// ---- helpers -----------------------------------------------------------
function normalizeLines(lines) {
  if (lines == null) return [];
  const arr = Array.isArray(lines) ? lines : [lines];
  const out = [];
  for (const raw of arr) {
    if (raw == null) continue;
    const str = String(raw);
    if (!str.trim()) continue;
    out.push(str);
  }
  return out;
}

// Turn a list of logical lines into pages of at most LINES_PER_PAGE wrapped rows.
function paginate(lines) {
  const pages = [];
  for (const line of normalizeLines(lines)) {
    const wrapped = wrapText(line, TEXT_W).filter((s) => s.length > 0);
    if (!wrapped.length) continue;
    for (let i = 0; i < wrapped.length; i += LINES_PER_PAGE) {
      pages.push(wrapped.slice(i, i + LINES_PER_PAGE));
    }
  }
  return pages;
}

function pageLength(page) {
  let n = 0;
  for (const l of page) n += l.length;
  return n;
}

function drawSpeakerPlate(ctx, speaker) {
  if (!speaker) return;
  const label = String(speaker);
  const rows = wrapText(label, TEXT_W);
  const text = rows[0] || '';
  const w = Math.max(24, measure(text) + 10);
  const h = LINE_H + 6;
  const y = BOX_Y - h + 2;
  drawWindow(ctx, BOX_X + 2, y, w, h, {});
  drawText(ctx, text, BOX_X + 7, y + 4, { color: PAL.accent });
}

function measure(text) {
  return textWidth(String(text == null ? '' : text));
}

function drawMoreArrow(ctx, t) {
  if (Math.sin(t * 6) < 0) return;
  const x = BOX_X + BOX_W - 12;
  const y = BOX_Y + BOX_H - 11;
  ctx.fillStyle = PAL.ink;
  for (let i = 0; i < 4; i++) ctx.fillRect(x + i, y + i, 7 - i * 2, 1);
}

function drawPage(ctx, page, revealed) {
  if (!page || !page.length) return;
  let left = revealed;
  for (let i = 0; i < page.length; i++) {
    const line = page[i];
    if (left <= 0) break;
    const shown = left >= line.length ? line : line.slice(0, Math.max(0, Math.floor(left)));
    left -= line.length;
    if (shown) drawText(ctx, shown, TEXT_X, TEXT_Y + i * LINE_H, { color: PAL.ink });
  }
}

// ---- open-scene bookkeeping -------------------------------------------
let openCount = 0;

export function isDialogueOpen() { return openCount > 0; }

// ---- say ---------------------------------------------------------------
export function say(lines, opts = {}) {
  const pages = paginate(lines);
  if (!pages.length) return Promise.resolve();

  const options = opts || {};
  return new Promise((resolve) => {
    const scene = {
      opaque: false,
      _resolve: resolve,
      _pages: pages,
      _page: 0,
      _revealed: 0,
      _total: pageLength(pages[0]),
      _t: 0,
      _fresh: true,

      enter() {
        openCount++;
        this._revealed = speedChars() === Infinity ? this._total : 0;
      },
      exit() {
        openCount = Math.max(0, openCount - 1);
        const r = this._resolve;
        this._resolve = null;
        if (r) r();
      },
      update(dt) {
        this._t += dt;
        const cps = speedChars();
        if (this._revealed < this._total) {
          const boost = Keys.a ? 3 : 1;   // holding A speeds the crawl
          this._revealed = cps === Infinity ? this._total : this._revealed + cps * boost * dt;
        }
        if (this._fresh) { this._fresh = false; return; }

        if (consume('a') || consume('start')) {
          if (this._revealed < this._total) {
            this._revealed = this._total;      // stage 1: finish the page
            return;
          }
          this._page++;                        // stage 2: advance
          if (this._page >= this._pages.length) { popScene(); return; }
          this._total = pageLength(this._pages[this._page]);
          this._revealed = speedChars() === Infinity ? this._total : 0;
        }
      },
      render(ctx) {
        drawWindow(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, {});
        drawSpeakerPlate(ctx, options.speaker);
        const idx = Math.min(this._page, this._pages.length - 1);
        drawPage(ctx, this._pages[idx], this._revealed);
        const done = this._revealed >= this._total;
        if (done) drawMoreArrow(ctx, this._t);
      },
    };
    pushScene(scene);
  });
}

// ---- ask ---------------------------------------------------------------
export function ask(prompt, choices, opts = {}) {
  const options = opts || {};
  const list = (Array.isArray(choices) ? choices : [choices])
    .filter((c) => c != null)
    .map((c) => String(c));
  if (!list.length) return Promise.resolve(-1);

  const pages = paginate(prompt);
  const cancelable = options.cancelable !== false;
  const cancelIndex = Number.isInteger(options.cancelIndex) ? options.cancelIndex : -1;

  // choice window geometry
  let cw = 0;
  for (const c of list) cw = Math.max(cw, measure(c));
  const CW = Math.min(W - MARGIN * 2, cw + 20);
  const CH = list.length * LINE_H + 8;
  const CX = W - MARGIN - CW;
  const CY = MARGIN;

  return new Promise((resolve) => {
    const scene = {
      opaque: false,
      _resolve: resolve,
      _result: -1,
      _pages: pages,
      _page: 0,
      _revealed: 0,
      _total: pages.length ? pageLength(pages[0]) : 0,
      _t: 0,
      _fresh: true,
      _sel: Math.max(0, Math.min(list.length - 1, options.initial | 0)),

      enter() {
        openCount++;
        this._revealed = speedChars() === Infinity ? this._total : 0;
      },
      exit() {
        openCount = Math.max(0, openCount - 1);
        const r = this._resolve;
        this._resolve = null;
        if (r) r(this._result);
      },
      _promptDone() {
        return this._page >= this._pages.length - 1 && this._revealed >= this._total;
      },
      update(dt) {
        this._t += dt;
        const cps = speedChars();
        if (this._revealed < this._total) {
          const boost = Keys.a ? 3 : 1;
          this._revealed = cps === Infinity ? this._total : this._revealed + cps * boost * dt;
        }
        if (this._fresh) { this._fresh = false; return; }

        // Still paging through the prompt: A completes / advances, no selecting yet.
        if (!this._promptDone()) {
          if (consume('a') || consume('start')) {
            if (this._revealed < this._total) { this._revealed = this._total; return; }
            this._page++;
            this._total = pageLength(this._pages[this._page]);
            this._revealed = speedChars() === Infinity ? this._total : 0;
          }
          return;
        }

        if (consume('up')) this._sel = (this._sel - 1 + list.length) % list.length;
        else if (consume('down')) this._sel = (this._sel + 1) % list.length;

        if (consume('a')) { this._result = this._sel; popScene(this._result); return; }
        if (pressed('b')) {
          consume('b');                      // swallow it either way
          if (!cancelable) return;
          this._result = cancelIndex >= 0 && cancelIndex < list.length ? cancelIndex : -1;
          popScene(this._result);
        }
      },
      render(ctx) {
        drawWindow(ctx, BOX_X, BOX_Y, BOX_W, BOX_H, {});
        if (this._pages.length) {
          drawPage(ctx, this._pages[Math.min(this._page, this._pages.length - 1)], this._revealed);
        }
        if (!this._promptDone()) {
          if (this._revealed >= this._total) drawMoreArrow(ctx, this._t);
          return;
        }
        drawWindow(ctx, CX, CY, CW, CH, {});
        for (let i = 0; i < list.length; i++) {
          const y = CY + 4 + i * LINE_H;
          drawText(ctx, list[i], CX + 12, y, { color: PAL.ink });
        }
        drawCursor(ctx, CX + 4, CY + 4 + this._sel * LINE_H, this._t);
      },
    };
    pushScene(scene);
  });
}

// ---- location banner ---------------------------------------------------
const banner = { active: false, text: '', t: 0, hold: 2, phase: 'in', x: 0 };

const BANNER_IN = 0.28;
const BANNER_OUT = 0.28;
const BANNER_Y = 8;
const BANNER_H = LINE_H + 8;

export function showBanner(text, sec = 2) {
  const str = text == null ? '' : String(text);
  if (!str.trim()) { banner.active = false; return; }
  banner.active = true;
  banner.text = str;
  banner.t = 0;
  banner.hold = Math.max(0.1, Number(sec) || 2);
  banner.phase = 'in';
  banner.x = 0;
}

export function hideBanner() { banner.active = false; }

export function bannerActive() { return banner.active; }

function bannerWidth() {
  return Math.min(W - 16, Math.max(40, measure(banner.text) + 16));
}

export function updateBanner(dt) {
  if (!banner.active) return;
  const d = Number(dt) || 0;
  banner.t += d;
  const w = bannerWidth();
  if (banner.phase === 'in') {
    const p = Math.min(1, banner.t / BANNER_IN);
    banner.x = -w + (w + 8) * (1 - (1 - p) * (1 - p));   // ease-out
    if (p >= 1) { banner.phase = 'hold'; banner.t = 0; banner.x = 8; }
  } else if (banner.phase === 'hold') {
    banner.x = 8;
    if (banner.t >= banner.hold) { banner.phase = 'out'; banner.t = 0; }
  } else {
    const p = Math.min(1, banner.t / BANNER_OUT);
    banner.x = 8 - (w + 8) * p * p;                      // ease-in
    if (p >= 1) { banner.active = false; }
  }
}

export function renderBanner(ctx) {
  if (!banner.active || !ctx) return;
  const w = bannerWidth();
  const x = Math.round(banner.x);
  drawWindow(ctx, x, BANNER_Y, w, BANNER_H, {});
  drawText(ctx, banner.text, x + 8, BANNER_Y + 4, { color: PAL.ink });
}
