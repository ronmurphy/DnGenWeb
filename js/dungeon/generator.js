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
    dungeon.rooms[0].type  = ROOM_TYPE.ENTRANCE;
    dungeon.rooms[0].icon  = 'entrance';
    dungeon.rooms[0].order = 'Entry';

    // Boss = room furthest from entrance (by index, simple heuristic)
    const last = dungeon.rooms[dungeon.rooms.length - 1];
    last.type  = ROOM_TYPE.BOSS;
    last.icon  = 'boss';
    last.order = 'Boss';

    // Treasure: a random medium room
    const candidates = dungeon.rooms.slice(1, -1).filter(r => r.w >= 3 && r.h >= 3);
    if (candidates.length) {
      const t = this.rng.pick(candidates);
      t.type = ROOM_TYPE.TREASURE;
      t.icon = 'treasure';
    }

    // Trap: another random room
    const trapCandidates = dungeon.rooms.slice(1, -1).filter(r => r.type === ROOM_TYPE.NORMAL);
    if (trapCandidates.length) {
      const t = this.rng.pick(trapCandidates);
      t.type = ROOM_TYPE.TRAP;
      t.icon = 'trap';
    }

    // Number the remaining normal rooms
    let n = 1;
    for (const r of dungeon.rooms) {
      if (!r.order) r.order = String(n++);
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

// ── Shared story helpers ───────────────────────────────────────────────────

function generateName(rng) {
  const adj  = ['Sunken','Forsaken','Blighted','Ancient','Cursed','Forgotten','Shadowed','Ruined','Crumbling','Infernal'];
  const noun = ['Crypt','Vault','Lair','Sanctum','Citadel','Depths','Catacomb','Dungeon','Fortress','Tomb'];
  const of   = ['the Dragon','the Dead','Shadow','Eternal Night','the Betrayer','Despair','Lost Souls','the Broken Crown'];
  return `${rng.pick(adj)} ${rng.pick(noun)} of ${rng.pick(of)}`;
}

function generateHook(rng, name) {
  const hooks = [
    `A dying adventurer spoke of untold riches within ${name}.`,
    `The village elder pleads for the return of a stolen relic from ${name}.`,
    `Strange lights have been seen near the entrance to ${name}.`,
    `A bounty has been placed on the head of the creature that lurks in ${name}.`,
    `An old map reveals a secret passage into ${name}.`,
    `The nightmares of the townsfolk all lead to ${name}.`,
  ];
  return rng.pick(hooks);
}

function assignSpecials(dungeon, rng) {
  if (!dungeon.rooms.length) return;
  dungeon.rooms[0].type  = ROOM_TYPE.ENTRANCE;
  dungeon.rooms[0].icon  = 'entrance';
  dungeon.rooms[0].order = 'Entry';

  const last = dungeon.rooms[dungeon.rooms.length - 1];
  last.type  = ROOM_TYPE.BOSS;
  last.icon  = 'boss';
  last.order = 'Boss';

  const candidates = dungeon.rooms.slice(1, -1).filter(r => r.w >= 3 && r.h >= 3);
  if (candidates.length) {
    const t = rng.pick(candidates);
    t.type = ROOM_TYPE.TREASURE; t.icon = 'treasure';
  }
  const trapCandidates = dungeon.rooms.slice(1, -1).filter(r => r.type === ROOM_TYPE.NORMAL);
  if (trapCandidates.length) {
    const t = rng.pick(trapCandidates);
    t.type = ROOM_TYPE.TRAP; t.icon = 'trap';
  }
  let n = 1;
  for (const r of dungeon.rooms) { if (!r.order) r.order = String(n++); }
}

function randomDoorType(rng) {
  return rng.weighted(
    [DOOR_TYPE.OPEN, DOOR_TYPE.DOOR, DOOR_TYPE.LOCKED, DOOR_TYPE.SECRET, DOOR_TYPE.PORTCULLIS],
    [0.15, 0.5, 0.15, 0.1, 0.1]
  );
}

// ── BSP Generator ─────────────────────────────────────────────────────────────
//
// Each BSP split stores its direction (splitH). When connecting two sibling
// subtrees we pick the room CLOSEST TO THE SPLIT BOUNDARY from each side, then
// draw a corridor that stays entirely in the guaranteed gap between the two
// partitions — so it can never cross through any room.

export class BSPGenerator {
  generate(seed, tags = []) {
    this.rng = new RNG(seed);

    let space = 44, maxDepth = 3;
    if (tags.includes('small')) { space = 28; maxDepth = 2; }
    if (tags.includes('large')) { space = 60; maxDepth = 4; }

    const dungeon = new Dungeon(seed);
    const tree    = this._buildTree({ x: 0, y: 0, w: space, h: space }, 0, maxDepth);
    this._collectTree(tree, dungeon);

    assignSpecials(dungeon, this.rng);
    dungeon.name = generateName(this.rng);
    dungeon.hook = generateHook(this.rng, dungeon.name);
    return dungeon;
  }

  _buildTree(node, depth, maxDepth) {
    if (depth >= maxDepth || node.w < 12 || node.h < 12) {
      node.leaf = true;
      node.room = this._roomInPartition(node);
      return node;
    }

    const splitH = node.h > node.w || (node.w === node.h && this.rng.next() > 0.5);
    const s = splitH
      ? Math.floor(this.rng.float(0.4, 0.6) * node.h)
      : Math.floor(this.rng.float(0.4, 0.6) * node.w);

    if (s < 6 || (splitH ? node.h : node.w) - s < 6) {
      node.leaf = true;
      node.room = this._roomInPartition(node);
      return node;
    }

    node.splitH = splitH;
    if (splitH) {
      node.left  = this._buildTree({ x: node.x, y: node.y,     w: node.w, h: s          }, depth + 1, maxDepth);
      node.right = this._buildTree({ x: node.x, y: node.y + s, w: node.w, h: node.h - s  }, depth + 1, maxDepth);
    } else {
      node.left  = this._buildTree({ x: node.x,     y: node.y, w: s,          h: node.h }, depth + 1, maxDepth);
      node.right = this._buildTree({ x: node.x + s, y: node.y, w: node.w - s, h: node.h }, depth + 1, maxDepth);
    }
    return node;
  }

  /** Collect all leaf rooms from a subtree (not corridor rooms). */
  _gatherRooms(node, out) {
    if (node.leaf) { if (node.room) out.push(node.room); return; }
    this._gatherRooms(node.left,  out);
    this._gatherRooms(node.right, out);
  }

  /**
   * Pick the room from a subtree whose wall is closest to the split boundary.
   * criterion: 'maxY' | 'minY' | 'maxX' | 'minX'
   */
  _closestRoom(node, criterion) {
    const rooms = [];
    this._gatherRooms(node, rooms);
    if (!rooms.length) return null;
    switch (criterion) {
      case 'maxY': return rooms.reduce((b, r) => r.y + r.h > b.y + b.h ? r : b);
      case 'minY': return rooms.reduce((b, r) => r.y < b.y ? r : b);
      case 'maxX': return rooms.reduce((b, r) => r.x + r.w > b.x + b.w ? r : b);
      case 'minX': return rooms.reduce((b, r) => r.x < b.x ? r : b);
    }
  }

  _collectTree(node, dungeon) {
    if (node.leaf) {
      if (node.room) dungeon.addRoom(node.room);
      return;
    }
    this._collectTree(node.left,  dungeon);
    this._collectTree(node.right, dungeon);

    // Pick rooms whose walls face the split boundary
    const r1 = this._closestRoom(node.left,  node.splitH ? 'maxY' : 'maxX');
    const r2 = this._closestRoom(node.right, node.splitH ? 'minY' : 'minX');
    if (r1 && r2) this._connectAtSplit(dungeon, r1, r2, node.splitH);
  }

  _roomInPartition(part) {
    const margin = 2;
    const maxW = part.w - margin * 2;
    const maxH = part.h - margin * 2;
    if (maxW < 3 || maxH < 3) return null;
    const w = this.rng.int(Math.max(3, maxW - 4), maxW);
    const h = this.rng.int(Math.max(3, maxH - 4), maxH);
    const x = part.x + margin + this.rng.int(0, Math.max(0, maxW - w));
    const y = part.y + margin + this.rng.int(0, Math.max(0, maxH - h));
    const round = w === h && this.rng.next() < 0.2;
    return new Room({ x, y, w: round ? Math.min(w, h) : w, h: round ? Math.min(w, h) : h, round });
  }

  /**
   * Corridor between two rooms across a BSP split boundary.
   * For a horizontal split: r1 is the bottommost room of the top partition,
   * r2 is the topmost room of the bottom partition.  The corridor only ever
   * occupies the gap rows/columns between the two partitions — guaranteed empty.
   */
  _connectAtSplit(dungeon, r1, r2, horizontal) {
    if (horizontal) {
      const wallA = r1.y + r1.h;   // r1's bottom wall
      const wallB = r2.y;           // r2's top wall
      if (wallB <= wallA) return;   // partitions too close (shouldn't happen with margin=2)

      const xL = Math.max(r1.x, r2.x);
      const xR = Math.min(r1.x + r1.w, r2.x + r2.w);

      if (xL < xR) {
        // Rooms share an x overlap — straight vertical corridor through that band
        const cx = Math.floor((xL + xR) / 2);
        dungeon.addRoom(new Room({ x: cx, y: wallA, w: 1, h: wallB - wallA }));
      } else {
        // No x overlap — L-shape: horizontal along wallA row, then vertical
        const hx0 = Math.min(Math.round(r1.cx), Math.round(r2.cx));
        const hx1 = Math.max(Math.round(r1.cx), Math.round(r2.cx));
        if (hx1 > hx0)
          dungeon.addRoom(new Room({ x: hx0, y: wallA, w: hx1 - hx0 + 1, h: 1 }));
        dungeon.addRoom(new Room({ x: Math.round(r2.cx), y: wallA, w: 1, h: wallB - wallA }));
      }
    } else {
      const wallA = r1.x + r1.w;   // r1's right wall
      const wallB = r2.x;           // r2's left wall
      if (wallB <= wallA) return;

      const yT = Math.max(r1.y, r2.y);
      const yB = Math.min(r1.y + r1.h, r2.y + r2.h);

      if (yT < yB) {
        // Straight horizontal corridor through the y overlap band
        const cy = Math.floor((yT + yB) / 2);
        dungeon.addRoom(new Room({ x: wallA, y: cy, w: wallB - wallA, h: 1 }));
      } else {
        // No y overlap — L-shape: vertical along wallA column, then horizontal
        const vy0 = Math.min(Math.round(r1.cy), Math.round(r2.cy));
        const vy1 = Math.max(Math.round(r1.cy), Math.round(r2.cy));
        if (vy1 > vy0)
          dungeon.addRoom(new Room({ x: wallA, y: vy0, w: 1, h: vy1 - vy0 + 1 }));
        dungeon.addRoom(new Room({ x: wallA, y: Math.round(r2.cy), w: wallB - wallA, h: 1 }));
      }
    }
  }
}

export const bspGenerator = new BSPGenerator();

// ── Classic (Rooms + Corridors) Generator ────────────────────────────────────

export class ClassicGenerator {
  generate(seed, tags = []) {
    this.rng = new RNG(seed);

    let cols = 4, rows = 3, minSz = 3, maxSz = 8, spacing = 14;
    if (tags.includes('small'))  { cols = 3; rows = 2; minSz = 2; maxSz = 5;  spacing = 10; }
    if (tags.includes('large'))  { cols = 5; rows = 4; minSz = 4; maxSz = 10; spacing = 18; }

    const dungeon = new Dungeon(seed);

    // Place rooms on a grid of cells
    const placed = [];
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        if (this.rng.next() < 0.15) continue; // occasionally skip a cell
        const w = this.rng.int(minSz, maxSz);
        const h = this.rng.int(minSz, maxSz);
        const bx = col * spacing;
        const by = row * spacing;
        const x  = bx + Math.floor((spacing - w) / 2);
        const y  = by + Math.floor((spacing - h) / 2);
        const round = w === h && this.rng.next() < 0.18;
        const room = new Room({ x, y, w: round ? Math.min(w,h) : w, h: round ? Math.min(w,h) : h, round });
        dungeon.addRoom(room);
        placed.push({ room, col, row });
      }
    }

    if (!dungeon.rooms.length) {
      // Fallback: place a single room
      dungeon.addRoom(new Room({ x: 0, y: 0, w: 6, h: 6 }));
    }

    // Connect horizontally and vertically adjacent cells
    const index = new Map(placed.map(p => [`${p.col},${p.row}`, p.room]));
    for (const { room, col, row } of placed) {
      // Right neighbour
      const right = index.get(`${col + 1},${row}`);
      if (right) this._corridor(dungeon, room, right, 'h');
      // Down neighbour
      const down  = index.get(`${col},${row + 1}`);
      if (down)  this._corridor(dungeon, room, down,  'v');
    }

    assignSpecials(dungeon, this.rng);
    dungeon.name = generateName(this.rng);
    dungeon.hook = generateHook(this.rng, dungeon.name);
    return dungeon;
  }

  // Corridor clipped to room walls — never overlaps either room.
  _corridor(dungeon, a, b, axis) {
    const ax = Math.round(a.cx), ay = Math.round(a.cy);
    const bx = Math.round(b.cx), by = Math.round(b.cy);

    if (axis === 'h') {
      // Horizontal: from A's right wall to B's left wall at y=ay
      const aWx = bx >= ax ? a.x + a.w : a.x;
      const bWx = bx >= ax ? b.x       : b.x + b.w;
      const hLen = Math.abs(bWx - aWx);
      if (hLen > 0)
        dungeon.addRoom(new Room({ x: Math.min(aWx, bWx), y: ay, w: hLen, h: 1 }));
      // V jog at bWx if ay is outside B's y range
      if (ay < b.y)
        dungeon.addRoom(new Room({ x: bWx, y: ay,        w: 1, h: b.y - ay }));
      else if (ay > b.y + b.h)
        dungeon.addRoom(new Room({ x: bWx, y: b.y + b.h, w: 1, h: ay - b.y - b.h }));

    } else {
      // Vertical: from A's bottom wall to B's top wall at x=ax
      const aWy = by >= ay ? a.y + a.h : a.y;
      const bWy = by >= ay ? b.y       : b.y + b.h;
      const vLen = Math.abs(bWy - aWy);
      if (vLen > 0)
        dungeon.addRoom(new Room({ x: ax, y: Math.min(aWy, bWy), w: 1, h: vLen }));
      // H jog at bWy if ax is outside B's x range
      if (ax < b.x)
        dungeon.addRoom(new Room({ x: ax,        y: bWy, w: b.x - ax,        h: 1 }));
      else if (ax > b.x + b.w)
        dungeon.addRoom(new Room({ x: b.x + b.w, y: bWy, w: ax - b.x - b.w,  h: 1 }));
    }
  }
}

export const classicGenerator = new ClassicGenerator();
