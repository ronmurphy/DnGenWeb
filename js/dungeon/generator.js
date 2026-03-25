/**
 * Procedural dungeon generator.
 *
 * Builds a dungeon by placing rooms one at a time, attaching each new room
 * to an existing one via a shared wall face.  Mirrors the growth strategy
 * from One Page Dungeon (BSP-adjacent corridor/room expansion).
 *
 * Tags supported:
 *   Size:   small | medium | large
 *   Shape:  cramped | spacious | winding | compact
 *   Order:  ordered | chaotic
 */
import { Dungeon, Room, Door, DOOR_TYPE, ROOM_TYPE } from './model.js';
import { RNG } from '../utils/random.js';
import { Vec2 } from '../utils/vec2.js';

const DIRS = [Vec2.UP, Vec2.DOWN, Vec2.LEFT, Vec2.RIGHT];

export class Generator {
  /**
   * @param {number} seed
   * @param {string[]} tags - optional descriptive tags
   */
  generate(seed, tags = []) {
    this.rng  = new RNG(seed);
    this.tags = tags;

    const dungeon = new Dungeon(seed);

    // Size parameters
    let minSize = 3, maxSize = 8, targetRooms = 10;
    if (tags.includes('small'))  { minSize = 2; maxSize = 5;  targetRooms = 6;  }
    if (tags.includes('medium')) { minSize = 3; maxSize = 8;  targetRooms = 10; }
    if (tags.includes('large'))  { minSize = 5; maxSize = 15; targetRooms = 18; }

    // Shape style weights: [corridor, small, normal, large, round]
    let styleWeights = [0.15, 0.2, 0.45, 0.1, 0.1];
    if (tags.includes('cramped'))  styleWeights = [0.25, 0.35, 0.3,  0.05, 0.05];
    if (tags.includes('spacious')) styleWeights = [0.05, 0.1,  0.4,  0.3,  0.15];
    if (tags.includes('winding'))  styleWeights = [0.4,  0.2,  0.3,  0.05, 0.05];
    if (tags.includes('compact'))  styleWeights = [0.05, 0.4,  0.4,  0.1,  0.05];

    // Ordered vs chaotic growth
    const ordered = tags.includes('ordered') ? true
                  : tags.includes('chaotic') ? false
                  : this.rng.next() > 0.35;

    // Build
    const maxAttempts = 200;
    let attempts = 0;

    // Seed room
    const firstRoom = this._makeRoom(styleWeights, minSize, maxSize, 0, 0);
    dungeon.addRoom(firstRoom);

    const queue = [firstRoom];

    while (dungeon.rooms.length < targetRooms && attempts < maxAttempts) {
      attempts++;
      if (queue.length === 0) break;

      // Pick an existing room to expand from
      const parent = ordered
        ? queue[queue.length - 1]
        : this.rng.pick(queue);

      const dir = this.rng.pick(DIRS);
      const newRoom = this._tryAttachRoom(dungeon, parent, dir, styleWeights, minSize, maxSize);

      if (newRoom) {
        dungeon.addRoom(newRoom);
        queue.push(newRoom);
        // Place a door between them
        const door = this._makeDoor(parent, newRoom, dir);
        dungeon.addDoor(door);
      } else if (attempts % 5 === 0 && queue.length > 1) {
        queue.splice(queue.indexOf(parent), 1);
      }
    }

    // Assign entrance and boss rooms
    this._assignSpecialRooms(dungeon);

    // Generate story
    dungeon.name = this._generateName();
    dungeon.hook = this._generateHook(dungeon.name);

    return dungeon;
  }

  // ── Room placement ──────────────────────────────────────────────────────────

  _makeRoom(styleWeights, minSize, maxSize, atX, atY) {
    const types = ['corridor', 'small', 'normal', 'large', 'round'];
    const type  = this.rng.weighted(types, styleWeights);

    let w, h, round = false;
    switch (type) {
      case 'corridor':
        if (this.rng.next() > 0.5) { w = this.rng.int(1, 2);  h = this.rng.int(4, 8); }
        else                        { w = this.rng.int(4, 8);  h = this.rng.int(1, 2); }
        break;
      case 'small':
        w = this.rng.int(minSize, Math.min(minSize + 2, maxSize));
        h = this.rng.int(minSize, Math.min(minSize + 2, maxSize));
        break;
      case 'large':
        w = this.rng.int(Math.max(minSize, maxSize - 2), maxSize);
        h = this.rng.int(Math.max(minSize, maxSize - 2), maxSize);
        break;
      case 'round':
        w = h = this.rng.int(minSize, maxSize);
        round = true;
        break;
      default: // normal
        w = this.rng.int(minSize, maxSize);
        h = this.rng.int(minSize, maxSize);
    }

    return new Room({ x: atX, y: atY, w, h, round });
  }

  _tryAttachRoom(dungeon, parent, dir, styleWeights, minSize, maxSize) {
    const candidate = this._makeRoom(styleWeights, minSize, maxSize, 0, 0);

    // Position candidate against parent's wall in direction dir
    let x, y;
    if (dir === Vec2.RIGHT) {
      x = parent.x + parent.w;
      y = parent.y + this.rng.int(0, Math.max(0, parent.h - candidate.h));
    } else if (dir === Vec2.LEFT) {
      x = parent.x - candidate.w;
      y = parent.y + this.rng.int(0, Math.max(0, parent.h - candidate.h));
    } else if (dir === Vec2.DOWN) {
      x = parent.x + this.rng.int(0, Math.max(0, parent.w - candidate.w));
      y = parent.y + parent.h;
    } else { // UP
      x = parent.x + this.rng.int(0, Math.max(0, parent.w - candidate.w));
      y = parent.y - candidate.h;
    }

    candidate.x = x;
    candidate.y = y;

    // Check overlap with all existing rooms (1-unit padding)
    for (const other of dungeon.rooms) {
      if (other === parent) continue;
      if (candidate.overlaps(other, 0)) return null;
    }

    // Must actually share a wall face with parent
    if (!this._sharesWall(parent, candidate, dir)) return null;

    return candidate;
  }

  _sharesWall(a, b, dir) {
    if (dir === Vec2.RIGHT || dir === Vec2.LEFT) {
      const overlapY0 = Math.max(a.y, b.y);
      const overlapY1 = Math.min(a.y + a.h, b.y + b.h);
      return overlapY1 - overlapY0 >= 1;
    } else {
      const overlapX0 = Math.max(a.x, b.x);
      const overlapX1 = Math.min(a.x + a.w, b.x + b.w);
      return overlapX1 - overlapX0 >= 1;
    }
  }

  // ── Door placement ──────────────────────────────────────────────────────────

  _makeDoor(from, to, dir) {
    let dx, dy;

    if (dir === Vec2.RIGHT) {
      dx = from.x + from.w;
      const oy0 = Math.max(from.y, to.y) + 0.5;
      const oy1 = Math.min(from.y + from.h, to.y + to.h) - 0.5;
      dy = (oy0 + oy1) / 2;
    } else if (dir === Vec2.LEFT) {
      dx = from.x;
      const oy0 = Math.max(from.y, to.y) + 0.5;
      const oy1 = Math.min(from.y + from.h, to.y + to.h) - 0.5;
      dy = (oy0 + oy1) / 2;
    } else if (dir === Vec2.DOWN) {
      dy = from.y + from.h;
      const ox0 = Math.max(from.x, to.x) + 0.5;
      const ox1 = Math.min(from.x + from.w, to.x + to.w) - 0.5;
      dx = (ox0 + ox1) / 2;
    } else { // UP
      dy = from.y;
      const ox0 = Math.max(from.x, to.x) + 0.5;
      const ox1 = Math.min(from.x + from.w, to.x + to.w) - 0.5;
      dx = (ox0 + ox1) / 2;
    }

    const door = new Door(dx, dy, from, to);
    door.dir  = dir;
    door.type = this._randomDoorType();
    return door;
  }

  _randomDoorType() {
    return this.rng.weighted(
      [DOOR_TYPE.OPEN, DOOR_TYPE.DOOR, DOOR_TYPE.LOCKED, DOOR_TYPE.SECRET, DOOR_TYPE.PORTCULLIS],
      [0.15, 0.5, 0.15, 0.1, 0.1]
    );
  }

  // ── Special rooms ──────────────────────────────────────────────────────────

  _assignSpecialRooms(dungeon) {
    if (dungeon.rooms.length === 0) return;

    // Entrance = first room
    dungeon.rooms[0].type = ROOM_TYPE.ENTRANCE;

    // Boss = room furthest from entrance (by index, simple heuristic)
    const last = dungeon.rooms[dungeon.rooms.length - 1];
    last.type = ROOM_TYPE.BOSS;

    // Treasure: a random medium room
    const candidates = dungeon.rooms.slice(1, -1).filter(r => r.w >= 3 && r.h >= 3);
    if (candidates.length) {
      this.rng.pick(candidates).type = ROOM_TYPE.TREASURE;
    }

    // Trap: another random room
    const trapCandidates = dungeon.rooms.slice(1, -1).filter(r => r.type === ROOM_TYPE.NORMAL);
    if (trapCandidates.length) {
      this.rng.pick(trapCandidates).type = ROOM_TYPE.TRAP;
    }
  }

  // ── Story generation ───────────────────────────────────────────────────────

  _generateName() {
    const adj  = ['Sunken','Forsaken','Blighted','Ancient','Cursed','Forgotten','Shadowed','Ruined','Crumbling','Infernal'];
    const noun = ['Crypt','Vault','Lair','Sanctum','Citadel','Depths','Catacomb','Dungeon','Fortress','Tomb'];
    const of   = ['the Dragon','the Dead','Shadow','Eternal Night','the Betrayer','Despair','Lost Souls','the Broken Crown'];
    return `${this.rng.pick(adj)} ${this.rng.pick(noun)} of ${this.rng.pick(of)}`;
  }

  _generateHook(name) {
    const hooks = [
      `A dying adventurer spoke of untold riches within ${name}.`,
      `The village elder pleads for the return of a stolen relic from ${name}.`,
      `Strange lights have been seen near the entrance to ${name}.`,
      `A bounty has been placed on the head of the creature that lurks in ${name}.`,
      `An old map reveals a secret passage into ${name}.`,
      `The nightmares of the townsfolk all lead to ${name}.`,
    ];
    return this.rng.pick(hooks);
  }
}

export const generator = new Generator();
