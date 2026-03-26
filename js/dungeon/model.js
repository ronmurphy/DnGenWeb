import { Vec2 } from '../utils/vec2.js';

let _nextId = 1;
const uid = () => _nextId++;

// ── Door types ───────────────────────────────────────────────────────────────
export const DOOR_TYPE = {
  OPEN:       'open',
  DOOR:       'door',
  LOCKED:     'locked',
  SECRET:     'secret',
  PORTCULLIS: 'portcullis',
};

// ── Room types ───────────────────────────────────────────────────────────────
export const ROOM_TYPE = {
  NORMAL:   'normal',
  ENTRANCE: 'entrance',
  BOSS:     'boss',
  TREASURE: 'treasure',
  TRAP:     'trap',
};

// ── Room icons ────────────────────────────────────────────────────────────────
/** Map of icon key → { label, symbol } used by the renderer and legend. */
export const ROOM_ICONS = {
  none:     { label: 'None',        symbol: ''   },
  entrance: { label: 'Entrance',    symbol: '▲'  },
  exit:     { label: 'Exit',        symbol: '▼'  },
  boss:     { label: 'Boss',        symbol: '☠'  },
  treasure: { label: 'Treasure',    symbol: '★'  },
  trap:     { label: 'Trap',        symbol: '⚠'  },
  shrine:   { label: 'Shrine',      symbol: '✝'  },
  arcane:   { label: 'Arcane',      symbol: '✦'  },
  prison:   { label: 'Prison',      symbol: '⊠'  },
  armory:   { label: 'Armory',      symbol: '⚔'  },
  forge:    { label: 'Forge',       symbol: '⚒'  },
  throne:   { label: 'Throne',      symbol: '♛'  },
  crypt:    { label: 'Crypt',       symbol: '✠'  },
  library:  { label: 'Library',     symbol: '≡'  },
  tavern:   { label: 'Tavern',      symbol: '◆'  },
  guard:    { label: 'Guard Post',  symbol: '⊕'  },
  puzzle:   { label: 'Puzzle',      symbol: '?'  },
};

// ── Room ─────────────────────────────────────────────────────────────────────
/**
 * A dungeon room in grid coordinates.
 * Rectangular rooms: x, y, w, h (top-left origin)
 * Round rooms:       cx, cy stored in x, y; w=h=diameter
 */
export class Room {
  constructor({ x = 0, y = 0, w = 4, h = 4, round = false, points = null } = {}) {
    this.id    = uid();
    this.x     = x;
    this.y     = y;
    this.w     = w;
    this.h     = h;
    this.round = round;
    this.points = points;

    this.type    = ROOM_TYPE.NORMAL;
    this.label   = '';
    this.notes   = '';
    this.water   = false;
    this.hidden  = false;
    this.icon    = 'none';   // key into ROOM_ICONS; 'none' = use type default
    this.order   = '';       // narrative order label: 'Entry', '1', '2', 'Boss', 'End', etc.

    this.doors   = [];   // Door references
  }

  get cx() {
    if (this.points && this.points.length > 0) {
      const xs = this.points.map(p => p.x);
      return (Math.min(...xs) + Math.max(...xs)) / 2;
    }
    return this.x + this.w / 2;
  }
  get cy() {
    if (this.points && this.points.length > 0) {
      const ys = this.points.map(p => p.y);
      return (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    return this.y + this.h / 2;
  }

  /** Axis-aligned bounding box in grid units. */
  get bounds() {
    if (this.points && this.points.length > 0) {
      const xs = this.points.map(p => p.x);
      const ys = this.points.map(p => p.y);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      const x1 = Math.max(...xs);
      const y1 = Math.max(...ys);
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  /** Inflated/deflated copy (grid units). */
  inflate(dx, dy = dx) {
    return new Room({
      x: this.x - dx, y: this.y - dy,
      w: this.w + 2 * dx, h: this.h + 2 * dy,
      round: this.round,
    });
  }

  /** True if grid point (gx, gy) is inside this room. */
  contains(gx, gy) {
    if (this.points && this.points.length >= 3) {
      // Ray-casting point-in-polygon
      let inside = false;
      for (let i = 0, j = this.points.length - 1; i < this.points.length; j = i++) {
        const xi = this.points[i].x, yi = this.points[i].y;
        const xj = this.points[j].x, yj = this.points[j].y;

        const intersect = ((yi > gy) !== (yj > gy)) &&
          (gx < ((xj - xi) * (gy - yi)) / (yj - yi + Number.EPSILON) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }
    if (this.round) {
      const rx = this.w / 2, ry = this.h / 2;
      const dx = gx - this.cx, dy = gy - this.cy;
      return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
    }
    return gx >= this.x && gx <= this.x + this.w &&
           gy >= this.y && gy <= this.y + this.h;
  }

  /** True if this room's bounds overlap another room's bounds (with optional padding). */
  overlaps(other, pad = 0) {
    return this.x - pad < other.x + other.w &&
           this.x + this.w + pad > other.x &&
           this.y - pad < other.y + other.h &&
           this.y + this.h + pad > other.y;
  }

  /** Returns the shared wall direction from this room to other, or null. */
  adjacentDir(other) {
    if (Math.abs(this.x + this.w - other.x) < 0.5) return Vec2.RIGHT;
    if (Math.abs(other.x + other.w - this.x) < 0.5) return Vec2.LEFT;
    if (Math.abs(this.y + this.h - other.y) < 0.5) return Vec2.DOWN;
    if (Math.abs(other.y + other.h - this.y) < 0.5) return Vec2.UP;
    return null;
  }

  /** Serialize to plain object. */
  toJSON() {
    return { id: this.id, x: this.x, y: this.y, w: this.w, h: this.h,
             round: this.round, type: this.type, label: this.label,
             notes: this.notes, water: this.water, icon: this.icon, order: this.order,
             points: this.points };
  }

  static fromJSON(d) {
    const r = new Room(d);
    r.id    = d.id;
    r.type  = d.type;  r.label = d.label; r.notes = d.notes;
    r.water = d.water; r.icon  = d.icon ?? 'none'; r.order = d.order ?? '';
    r.points = d.points ?? null;
    return r;
  }
}

// ── Door ─────────────────────────────────────────────────────────────────────
export class Door {
  /**
   * @param {number} gx   - grid x (on the wall between two rooms)
   * @param {number} gy   - grid y
   * @param {Room}   from - room on one side
   * @param {Room}   to   - room on the other side (null = exterior)
   */
  constructor(gx, gy, from = null, to = null) {
    this.id   = uid();
    this.x    = gx;
    this.y    = gy;
    this.from = from;
    this.to   = to;
    this.type = DOOR_TYPE.DOOR;

    // Direction vector perpendicular to the wall (points from→to)
    this.dir  = this._calcDir();
  }

  _calcDir() {
    if (this.from && this.to) return this.from.adjacentDir(this.to) ?? Vec2.RIGHT;
    if (this.from) return Vec2.RIGHT;
    return Vec2.RIGHT;
  }

  toJSON() {
    return { id: this.id, x: this.x, y: this.y,
             from: this.from?.id ?? null, to: this.to?.id ?? null,
             type: this.type };
  }
}

// ── Dungeon ───────────────────────────────────────────────────────────────────
export class Dungeon {
  constructor(seed = 12345) {
    this.seed  = seed;
    this.name  = 'Unnamed Dungeon';
    this.hook  = '';
    this.rooms = [];
    this.doors = [];
  }

  addRoom(room) {
    this.rooms.push(room);
    return room;
  }

  removeRoom(room) {
    this.rooms = this.rooms.filter(r => r !== room);
    this.doors = this.doors.filter(d => d.from !== room && d.to !== room);
  }

  addDoor(door) {
    this.doors.push(door);
    if (door.from) door.from.doors.push(door);
    if (door.to)   door.to.doors.push(door);
    return door;
  }

  removeDoor(door) {
    this.doors = this.doors.filter(d => d !== door);
    if (door.from) door.from.doors = door.from.doors.filter(d => d !== door);
    if (door.to)   door.to.doors   = door.to.doors.filter(d => d !== door);
  }

  /** Find room at grid position (gx, gy). */
  roomAt(gx, gy) {
    return this.rooms.find(r => r.contains(gx, gy)) ?? null;
  }

  /** Bounding box of all rooms, in grid units. */
  bounds() {
    if (!this.rooms.length) return { x: 0, y: 0, w: 0, h: 0 };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of this.rooms) {
      if (r.x < x0) x0 = r.x;
      if (r.y < y0) y0 = r.y;
      if (r.x + r.w > x1) x1 = r.x + r.w;
      if (r.y + r.h > y1) y1 = r.y + r.h;
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  toJSON() {
    return {
      seed: this.seed, name: this.name, hook: this.hook,
      rooms: this.rooms.map(r => r.toJSON()),
      doors: this.doors.map(d => d.toJSON()),
    };
  }

  static fromJSON(data) {
    const d = new Dungeon(data.seed);
    d.name = data.name;
    d.hook = data.hook;
    const roomMap = {};
    for (const rd of data.rooms) {
      const r = Room.fromJSON(rd);
      d.rooms.push(r);
      roomMap[r.id] = r;
    }
    for (const dd of data.doors) {
      const door = new Door(dd.x, dd.y, roomMap[dd.from] ?? null, roomMap[dd.to] ?? null);
      door.id   = dd.id;
      door.type = dd.type;
      d.doors.push(door);
    }
    return d;
  }
}
