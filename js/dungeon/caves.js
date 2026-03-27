import { Dungeon, Room, ROOM_TYPE } from './model.js';
import { RNG } from '../utils/random.js';

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function generatePolygon(rng, cx, cy, aveRadius, radiusVar, points = 6) {
  const pts = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const radius = Math.max(1, aveRadius + (rng.next() - 0.5) * radiusVar);
    pts.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return pts;
}

export class CavesGenerator {
  constructor() {
    this.rng = new RNG(0);
  }

  generate(seed, tags = []) {
    this.rng = new RNG(seed);

    const dungeon = new Dungeon(seed);

    let targetRooms = 25;
    if (tags.includes('small')) targetRooms = 12;
    if (tags.includes('medium')) targetRooms = 20;
    if (tags.includes('large')) targetRooms = 35;

    const worldW = 60;
    const worldH = 40;

    const uniqueRooms = [];

    for (let i = 0; i < targetRooms; i++) {
      const cx = this.rng.int(2, worldW - 2);
      const cy = this.rng.int(2, worldH - 2);
      const shapeType = this.rng.weighted(['rect', 'circle', 'poly'], [0.45, 0.35, 0.2]);

      if (shapeType === 'rect') {
        const w = this.rng.int(3, 9);
        const h = this.rng.int(2, 8);
        const x = clamp(Math.round(cx - w / 2), 1, worldW - w - 1);
        const y = clamp(Math.round(cy - h / 2), 1, worldH - h - 1);
        const room = new Room({ x, y, w, h });
        uniqueRooms.push(room);
      } else if (shapeType === 'circle') {
        const diameter = this.rng.int(3, 9);
        const x = clamp(Math.round(cx - diameter / 2), 1, worldW - diameter - 1);
        const y = clamp(Math.round(cy - diameter / 2), 1, worldH - diameter - 1);
        const room = new Room({ x, y, w: diameter, h: diameter, round: true });
        uniqueRooms.push(room);
      } else {
        const radius = this.rng.float(2.0, 5.0);
        const pts = generatePolygon(this.rng, cx, cy, radius, 2.5, this.rng.int(5, 9));
        const xs = pts.map(p => p.x);
        const ys = pts.map(p => p.y);
        const x0 = clamp(Math.floor(Math.min(...xs)) - 1, 1, worldW - 2);
        const y0 = clamp(Math.floor(Math.min(...ys)) - 1, 1, worldH - 2);
        const x1 = clamp(Math.ceil(Math.max(...xs)) + 1, 2, worldW - 1);
        const y1 = clamp(Math.ceil(Math.max(...ys)) + 1, 2, worldH - 1);
        const room = new Room({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        room.points = pts.map(p => ({ x: clamp(p.x, x0, x1), y: clamp(p.y, y0, y1) }));
        uniqueRooms.push(room);
      }
    }

    for (const room of uniqueRooms) {
      dungeon.addRoom(room);
    }

    // Entrance and Boss assignment
    if (dungeon.rooms.length > 0) {
      dungeon.rooms[0].type = ROOM_TYPE.ENTRANCE;
      dungeon.rooms[0].order = 'Entry';
      dungeon.rooms[0].icon = 'entrance';
    }

    if (dungeon.rooms.length > 1) {
      const entrance = dungeon.rooms[0];
      let bossRoom = dungeon.rooms[1];
      let maxDist = 0;
      for (const room of dungeon.rooms) {
        const dx = room.cx - entrance.cx;
        const dy = room.cy - entrance.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxDist) {
          maxDist = dist;
          bossRoom = room;
        }
      }
      bossRoom.type = ROOM_TYPE.BOSS;
      bossRoom.order = 'Boss';
      bossRoom.icon = 'boss';
    }

    return dungeon;
  }
}

export const cavesGenerator = new CavesGenerator();
