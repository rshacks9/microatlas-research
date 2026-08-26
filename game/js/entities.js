// Overworld entities: NPCs, trainers, signs, pickups, doors.
import { TILE } from './tiles.js';
import { drawSprite, hasSprite, walkKey } from './sprites.js';
import { getFlag } from './state.js';
import { rand } from './rng.js';

const DIRS = ['down', 'up', 'left', 'right'];
const DELTA = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
export const OPPOSITE = { down: 'up', up: 'down', left: 'right', right: 'left' };

let uid = 0;

export class Entity {
  constructor(spec) {
    this.id = 'e' + (uid++);
    this.kind = spec.kind || 'npc';
    this.x = spec.x | 0;
    this.y = spec.y | 0;
    this.homeX = this.x;
    this.homeY = this.y;
    this.dir = spec.dir || 'down';
    this.sprite = spec.sprite || 'npc_villager';
    this.name = spec.name || '';
    this.lines = Array.isArray(spec.lines) ? spec.lines : (spec.lines ? [spec.lines] : []);
    this.wander = !!spec.wander;
    this.sight = spec.sight | 0;
    this.team = spec.team || null;
    this.prize = spec.prize | 0;
    this.itemId = spec.itemId || null;
    this.flag = spec.flag || null;
    this.to = spec.to || null;
    this.tx = spec.tx; this.ty = spec.ty;
    this.blocking = spec.blocking !== undefined ? spec.blocking
      : (this.kind === 'npc' || this.kind === 'trainer' || this.kind === 'heal' || this.kind === 'shop');

    // animation / movement
    this.frame = 0;
    this.animT = 0;
    this.moving = false;
    this.fromX = this.x; this.fromY = this.y;
    this.moveT = 0;
    this.moveDur = 0.28;
    this.wanderTimer = 1 + rand.float() * 3;
    this.frozen = false;      // set while talking so they face the player
    this.defeated = false;
  }

  // A defeated trainer is not GONE, just beaten: they keep standing there with
  // their post-match line. Only pickups and one-shot events truly disappear.
  get hidden() {
    if (!this.flag || !getFlag(this.flag)) return false;
    return this.kind !== 'trainer';
  }

  get beaten() { return !!(this.flag && getFlag(this.flag) && this.kind === 'trainer'); }

  // Pixel position, including the tween between tiles.
  get px() {
    if (!this.moving) return this.x * TILE;
    const p = Math.min(1, this.moveT / this.moveDur);
    return (this.fromX + (this.x - this.fromX) * p) * TILE;
  }
  get py() {
    if (!this.moving) return this.y * TILE;
    const p = Math.min(1, this.moveT / this.moveDur);
    return (this.fromY + (this.y - this.fromY) * p) * TILE;
  }

  face(dir) { if (DELTA[dir]) this.dir = dir; }

  facePoint(tx, ty) {
    const dx = tx - this.x, dy = ty - this.y;
    if (Math.abs(dx) > Math.abs(dy)) this.dir = dx > 0 ? 'right' : 'left';
    else if (dy !== 0) this.dir = dy > 0 ? 'down' : 'up';
  }

  tryStep(dir, map) {
    if (this.moving || this.frozen) return false;
    const d = DELTA[dir];
    if (!d) return false;
    this.dir = dir;
    const nx = this.x + d[0], ny = this.y + d[1];
    if (!map || map.solidAt(nx, ny)) return false;
    if (map.entityAt(nx, ny)) return false;
    if (map.playerAt && map.playerAt(nx, ny)) return false;
    map.moveEntity(this, nx, ny);
    this.fromX = this.x; this.fromY = this.y;
    this.x = nx; this.y = ny;
    this.moving = true;
    this.moveT = 0;
    return true;
  }

  update(dt, map) {
    if (this.moving) {
      this.moveT += dt;
      this.animT += dt;
      if (this.animT > 0.14) { this.animT = 0; this.frame = (this.frame + 1) % 3; }
      if (this.moveT >= this.moveDur) {
        this.moving = false;
        this.moveT = 0;
        this.frame = 0;
        this.fromX = this.x; this.fromY = this.y;
      }
      return;
    }
    this.frame = 0;
    if (!this.wander || this.frozen || this.hidden) return;
    this.wanderTimer -= dt;
    if (this.wanderTimer > 0) return;
    this.wanderTimer = 2 + rand.float() * 4;
    const dir = DIRS[rand.int(4)];
    const d = DELTA[dir];
    // Stay within 3 tiles of home so villagers never wander into the wilderness.
    if (Math.abs(this.x + d[0] - this.homeX) > 3 || Math.abs(this.y + d[1] - this.homeY) > 3) {
      this.facePoint(this.homeX, this.homeY);
      return;
    }
    this.tryStep(dir, map);
  }

  spriteKey() {
    const base = this.sprite;
    const dir = this.dir === 'right' && !hasSprite(walkKey(base, 'right', 0)) ? 'left' : this.dir;
    const flip = dir !== this.dir;
    let key = walkKey(base, dir, this.frame);
    if (!hasSprite(key)) key = walkKey(base, dir, 0);
    if (!hasSprite(key)) key = walkKey(base, 'down', 0);
    return { key, flip };
  }

  render(ctx, cam) {
    if (this.hidden) return;
    const sx = Math.round(this.px - cam.ox);
    const sy = Math.round(this.py - cam.oy);
    if (sx < -32 || sy < -40 || sx > 340 || sy > 260) return;

    if (this.kind === 'sign' || this.kind === 'item' || this.kind === 'door') {
      if (this.kind === 'item' && hasSprite('ball_orb')) {
        drawSprite(ctx, 'ball_orb', sx + 2, sy + 2, {});
      }
      return;   // signs and doors are drawn as tiles
    }

    if (hasSprite('shadow')) drawSprite(ctx, 'shadow', sx, sy + 16, { alpha: 0.5 });
    const { key, flip } = this.spriteKey();
    drawSprite(ctx, key, sx, sy - 8, { flip });
  }

  // Does this trainer see the player? Returns the distance, or 0 if not.
  seesPlayer(px, py, map) {
    if (this.kind !== 'trainer' || this.hidden || this.beaten || this.sight <= 0) return 0;
    const d = DELTA[this.dir];
    if (!d) return 0;
    for (let i = 1; i <= this.sight; i++) {
      const cx = this.x + d[0] * i, cy = this.y + d[1] * i;
      if (map && map.solidAt(cx, cy)) return 0;   // line of sight is blocked
      if (cx === px && cy === py) return i;
    }
    return 0;
  }
}

export function makeEntities(specs) {
  return (Array.isArray(specs) ? specs : []).map((s) => new Entity(s));
}

// First trainer (in stable order) that can see the player.
export function findWatcher(entities, px, py, map) {
  for (const e of entities) {
    if (e.kind !== 'trainer' || e.hidden) continue;
    const d = e.seesPlayer(px, py, map);
    if (d > 0) return { entity: e, distance: d };
  }
  return null;
}

export function stepsToward(e, tx, ty) {
  const out = [];
  let x = e.x, y = e.y;
  while (x !== tx) { out.push(x < tx ? 'right' : 'left'); x += x < tx ? 1 : -1; }
  while (y !== ty) { out.push(y < ty ? 'down' : 'up'); y += y < ty ? 1 : -1; }
  return out;
}

export { DELTA, DIRS };
