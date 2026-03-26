/**
 * Canvas renderer for the dungeon.
 * Draws in pixel space: grid units × CELL_SIZE = pixels.
 *
 * Layers (bottom to top):
 *   1. Paper background
 *   2. Room floor fills
 *   3. Water
 *   4. Wall outlines + shading/hatching
 *   5. Grid lines
 *   6. Doors
 *   7. Room labels / type icons
 *   8. Selection highlight
 */
import { Style, ShadingConfig, drawShading } from './shading.js';
import { DOOR_TYPE, ROOM_TYPE, ROOM_ICONS } from './model.js';
import { RNG } from '../utils/random.js';

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number} cellSize - pixels per grid unit (default 30)
   */
  constructor(canvas, cellSize = 30) {
    this.canvas   = canvas;
    this.ctx      = canvas.getContext('2d');
    this.cellSize = cellSize;

    // Viewport pan/zoom
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;

    // UI state
    this.selectedRoom = null;
    this.selectedDoor = null;
    this.ghostRoom    = null;  // preview while drawing a room
    this.ghostDoor    = null;  // preview while hovering in door mode
    this.ghostPolygon = null;  // preview while drawing a polygon room
    this.gridMode     = 'dotted';
    this.showShadows  = true;
    this.showProps    = true;
    this.mergeRooms   = false;
    this.showLegend   = true;
    this.showGraphPaper = false;
    this.showResizeHandles = false;
    this.hoverResizeHandle = null;
  }

  // ── Coordinate helpers ──────────────────────────────────────────────────────

  /** Grid units → canvas pixels (accounting for pan/zoom). */
  gx(g) { return (g * this.cellSize + this.panX) * this.zoom; }
  gy(g) { return (g * this.cellSize + this.panY) * this.zoom; }
  gs(g) { return  g * this.cellSize * this.zoom; }

  /** Canvas pixel → grid unit. */
  toGrid(px, py) {
    return {
      x: (px / this.zoom - this.panX) / this.cellSize,
      y: (py / this.zoom - this.panY) / this.cellSize,
    };
  }

  /** Snap a pixel coordinate to the nearest grid unit. */
  snapGrid(px, py) {
    const g = this.toGrid(px, py);
    return { x: Math.round(g.x), y: Math.round(g.y) };
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  render(dungeon) {
    const { canvas, ctx } = this;
    const W = canvas.width, H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Paper background
    ctx.fillStyle = Style.paper;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(this.panX, this.panY);

    if (this.showGraphPaper) this._drawGraphPaper(ctx, dungeon, this.cellSize);

    const cs = this.cellSize;
    const rng = new RNG(dungeon.seed);

    // 1. Floor fills
    this._drawFloors(ctx, dungeon, cs);

    // 2. Water
    this._drawWater(ctx, dungeon, cs);

    // 3. Wall outlines (non-merge) or merged exterior edges
    if (this.mergeRooms) {
      this._drawMergedWalls(ctx, dungeon, cs);
    } else {
      this._drawTargetedWalls(ctx, dungeon, cs);
    }

    // 4. Shading / hatching
    this._drawShadings(ctx, dungeon, cs, rng);

    // 4b. Redraw floors on top — covers any hatching that bled inside rooms
    this._drawFloors(ctx, dungeon, cs);
    this._drawWater(ctx, dungeon, cs);

    // 4c. Redraw walls on top of the floor redraw
    if (this.mergeRooms) {
      this._drawMergedWalls(ctx, dungeon, cs);
    } else {
      this._drawTargetedWalls(ctx, dungeon, cs);
    }

    // 5. Cracks / floor details
    if (this.showProps) this._drawDetails(ctx, dungeon, cs, rng);

    // 6. Grid lines
    this._drawGridLines(ctx, dungeon, cs);

    // 7. Shadows — drawn before doors so doors always appear on top
    if (this.showShadows) this._drawShadows(ctx, dungeon, cs);

    // 8. Doors
    this._drawDoors(ctx, dungeon, cs);

    // 8b. Polygon preview
    if (this.ghostPolygon && this.ghostPolygon.length >= 2) {
      this._drawGhostPolygon(ctx, cs);
    }

    // 9. Room labels
    this._drawLabels(ctx, dungeon, cs);

    // 10. Ghost previews
    if (this.ghostRoom) this._drawGhost(ctx, this.ghostRoom, cs);
    if (this.ghostDoor) this._drawGhostDoor(ctx, this.ghostDoor, cs);

    // 11. Selection
    this._drawSelection(ctx, cs);

    ctx.restore();

    // 12. Legend — drawn in screen space (not affected by pan/zoom)
    if (this.showLegend) this._drawLegend(ctx, dungeon);
  }

  // ── Floor fills ─────────────────────────────────────────────────────────────

  _drawFloors(ctx, dungeon, cs) {
    ctx.fillStyle = Style.floor;
    ctx.beginPath();
    for (const room of dungeon.rooms) {
      if (room.hidden) continue;
      this._roomPath(ctx, room, cs);
    }
    ctx.fill('nonzero');
  }

  // ── Water ──────────────────────────────────────────────────────────────────

  _drawWater(ctx, dungeon, cs) {
    ctx.fillStyle = Style.water;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (const room of dungeon.rooms) {
      if (!room.water || room.hidden) continue;
      this._roomPath(ctx, room, cs);
    }
    ctx.fill('nonzero');
    ctx.globalAlpha = 1;
  }

  // ── Walls ──────────────────────────────────────────────────────────────────

  _drawWalls(ctx, dungeon, cs) {
    const wallWidth = 2 * Style.thick;
    ctx.strokeStyle = Style.ink;
    ctx.lineWidth   = wallWidth;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';

    for (const room of dungeon.rooms) {
      if (room.hidden) continue;
      ctx.beginPath();
      this._roomPath(ctx, room, cs);
      ctx.stroke();
    }
  }

  // ── Targeted Merge: draw isolated rooms normally, groups merged ─────────────

  _drawTargetedWalls(ctx, dungeon, cs) {
    const groups = new Map();
    const isolated = [];

    // Group rooms by mergeGroup
    for (const room of dungeon.rooms) {
      if (room.hidden) continue;
      if (room.mergeGroup) {
        if (!groups.has(room.mergeGroup)) groups.set(room.mergeGroup, []);
        groups.get(room.mergeGroup).push(room);
      } else {
        isolated.push(room);
      }
    }

    // Draw isolated rooms uses regular smooth _drawWalls
    if (isolated.length > 0) {
      this._drawWalls(ctx, { rooms: isolated }, cs);
    }

    // Draw groups using continuous perimeter _drawMergedWalls
    for (const group of groups.values()) {
      if (group.length > 1) {
        this._drawMergedWalls(ctx, { rooms: group }, cs);
      } else {
        this._drawWalls(ctx, { rooms: group }, cs);
      }
    }
  }

  // ── Merge: draw only the exterior boundary of all rooms combined ─────────────
  //
  // Algorithm:
  //  1. Fill a grid with every cell covered by any room (handles true overlaps).
  //  2. For each occupied cell, emit an edge segment wherever a neighbour is empty.
  //  3. Merge collinear consecutive segments into single lines.
  //  4. Stroke the resulting lines — only the outer boundary gets drawn.

  _drawMergedWalls(ctx, dungeon, cs) {
    const floor = this._buildFloorGrid(dungeon);
    const { hEdges, vEdges } = this._extractExteriorEdges(floor);

    ctx.strokeStyle = Style.ink;
    ctx.lineWidth   = 2 * Style.thick;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.beginPath();

    for (const [yStr, segs] of hEdges) {
      const y = Number(yStr);
      for (const seg of this._mergeSegs(segs, 'a', 'b')) {
        ctx.moveTo(seg.a * cs, y * cs);
        ctx.lineTo(seg.b * cs, y * cs);
      }
    }
    for (const [xStr, segs] of vEdges) {
      const x = Number(xStr);
      for (const seg of this._mergeSegs(segs, 'a', 'b')) {
        ctx.moveTo(x * cs, seg.a * cs);
        ctx.lineTo(x * cs, seg.b * cs);
      }
    }
    ctx.stroke();
  }

  /** Build a Set of "gx,gy" strings for every grid cell inside any room. */
  _buildFloorGrid(dungeon) {
    const floor = new Set();
    for (const room of dungeon.rooms) {
      if (room.hidden) continue;
      if (room.points && room.points.length >= 3) {
        const b = room.bounds;
        const x0 = Math.floor(b.x);
        const y0 = Math.floor(b.y);
        const x1 = Math.ceil(b.x + b.w);
        const y1 = Math.ceil(b.y + b.h);
        for (let gx = x0; gx < x1; gx++) {
          for (let gy = y0; gy < y1; gy++) {
            if (room.contains(gx + 0.5, gy + 0.5)) floor.add(`${gx},${gy}`);
          }
        }
      } else if (room.round) {
        const cx = room.cx, cy = room.cy, r = room.w / 2, r2 = r * r;
        const x0 = Math.floor(room.x), y0 = Math.floor(room.y);
        const x1 = Math.ceil(room.x + room.w), y1 = Math.ceil(room.y + room.h);
        for (let gx = x0; gx < x1; gx++) {
          for (let gy = y0; gy < y1; gy++) {
            const dx = (gx + 0.5) - cx, dy = (gy + 0.5) - cy;
            if (dx * dx + dy * dy <= r2) floor.add(`${gx},${gy}`);
          }
        }
      } else {
        for (let gx = room.x; gx < room.x + room.w; gx++) {
          for (let gy = room.y; gy < room.y + room.h; gy++) {
            floor.add(`${gx},${gy}`);
          }
        }
      }
    }
    return floor;
  }

  /** Return horizontal and vertical exterior edge maps from a floor grid. */
  _extractExteriorEdges(floor) {
    // hEdges: Map<y_string, [{a:x0, b:x1}]>  — horizontal segments at grid y
    // vEdges: Map<x_string, [{a:y0, b:y1}]>  — vertical segments at grid x
    const hEdges = new Map();
    const vEdges = new Map();

    const addH = (y, x) => {
      const k = `${y}`;
      if (!hEdges.has(k)) hEdges.set(k, []);
      hEdges.get(k).push({ a: x, b: x + 1 });
    };
    const addV = (x, y) => {
      const k = `${x}`;
      if (!vEdges.has(k)) vEdges.set(k, []);
      vEdges.get(k).push({ a: y, b: y + 1 });
    };

    for (const key of floor) {
      const [gx, gy] = key.split(',').map(Number);
      if (!floor.has(`${gx},${gy - 1}`)) addH(gy,     gx); // top edge
      if (!floor.has(`${gx},${gy + 1}`)) addH(gy + 1, gx); // bottom edge
      if (!floor.has(`${gx - 1},${gy}`)) addV(gx,     gy); // left edge
      if (!floor.has(`${gx + 1},${gy}`)) addV(gx + 1, gy); // right edge
    }
    return { hEdges, vEdges };
  }

  /** Merge an array of {a, b} unit segments into the minimum set of covering segments. */
  _mergeSegs(segs, ak, bk) {
    if (!segs || segs.length === 0) return [];
    const sorted = [...segs].sort((x, y) => x[ak] - y[ak]);
    const out = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
      const last = out[out.length - 1];
      if (sorted[i][ak] <= last[bk]) {
        last[bk] = Math.max(last[bk], sorted[i][bk]);
      } else {
        out.push({ ...sorted[i] });
      }
    }
    return out;
  }

  // ── Shading ────────────────────────────────────────────────────────────────

  _drawShadings(ctx, dungeon, cs, rng) {
    if (ShadingConfig.mode === 'none') return;

    const areas = dungeon.rooms
      .filter(r => !r.hidden)
      .map(r => this._roomShadingArea(r, cs));

    drawShading(ctx, areas, rng);
  }

  _roomShadingArea(room, cs) {
    if (room.round) {
      return {
        type: 'circle',
        cx:   room.cx * cs,
        cy:   room.cy * cs,
        r:    (room.w / 2) * cs,
      };
    }
    if (room.points && room.points.length >= 3) {
      return {
        type: 'poly',
        points: room.points.map(p => ({ x: p.x * cs, y: p.y * cs })),
      };
    }
    return {
      type: 'rect',
      x:    room.x * cs,
      y:    room.y * cs,
      w:    room.w * cs,
      h:    room.h * cs,
    };
  }

  // ── Floor details (cracks) ──────────────────────────────────────────────────

  _drawDetails(ctx, dungeon, cs, rng) {
    ctx.strokeStyle = Style.ink;
    ctx.lineWidth   = Style.thin;
    ctx.globalAlpha = 0.65;

    const propTypes = ['bed', 'chair', 'table', 'chest'];

    for (const room of dungeon.rooms) {
      if (room.hidden || room.w < 4 || room.h < 4) continue;
      const area = room.w * room.h;
      const count = Math.max(1, Math.min(5, Math.floor(area * 0.05 + rng.next() * 1.5)));

      for (let i = 0; i < count; i++) {
        const px = (room.x + rng.float(0.7, room.w - 0.7)) * cs;
        const py = (room.y + rng.float(0.7, room.h - 0.7)) * cs;
        const psize = cs * rng.float(0.6, 1.2);
        const type = propTypes[Math.floor(rng.next() * propTypes.length)];

        ctx.save();
        this._drawProp(ctx, type, px, py, psize, rng);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  _drawProp(ctx, type, x, y, size, rng) {
    const half = size / 2;
    const direction = rng.next() < 0.5 ? 0 : Math.PI / 2;
    ctx.translate(x, y);
    ctx.rotate(direction);

    switch (type) {
      case 'bed':
        ctx.fillStyle = 'rgba(200, 200, 230, 0.7)';
        ctx.fillRect(-half, -half * 0.6, size, half * 1.2);
        ctx.strokeRect(-half, -half * 0.6, size, half * 1.2);
        ctx.beginPath();
        ctx.moveTo(-half, -half * 0.2);
        ctx.lineTo(half, -half * 0.2);
        ctx.stroke();
        break;

      case 'chair':
        ctx.fillStyle = 'rgba(220, 180, 140, 0.7)';
        ctx.fillRect(-half * 0.7, -half * 0.7, half * 1.4, half * 1.4);
        ctx.strokeRect(-half * 0.7, -half * 0.7, half * 1.4, half * 1.4);
        ctx.beginPath();
        ctx.moveTo(-half * 0.7, -half * 0.7);
        ctx.lineTo(-half * 0.7, -half * 1.1);
        ctx.moveTo(half * 0.7, -half * 0.7);
        ctx.lineTo(half * 0.7, -half * 1.1);
        ctx.stroke();
        break;

      case 'table':
        ctx.fillStyle = 'rgba(190, 160, 120, 0.7)';
        ctx.fillRect(-half * 0.9, -half * 0.4, half * 1.8, half * 0.8);
        ctx.strokeRect(-half * 0.9, -half * 0.4, half * 1.8, half * 0.8);
        // legs
        const leg = half * 0.15;
        ctx.fillRect(-half * 0.8, half * 0.3, leg, leg);
        ctx.fillRect(half * 0.65, half * 0.3, leg, leg);
        ctx.fillRect(-half * 0.8, -half * 0.45, leg, leg);
        ctx.fillRect(half * 0.65, -half * 0.45, leg, leg);
        break;

      case 'chest':
        ctx.fillStyle = 'rgba(160, 110, 90, 0.7)';
        ctx.fillRect(-half, -half * 0.5, size, half);
        ctx.strokeRect(-half, -half * 0.5, size, half);
        ctx.beginPath();
        ctx.moveTo(-half, -half * 0.5);
        ctx.lineTo(half, -half * 0.5);
        ctx.stroke();
        break;

      default:
        ctx.fillStyle = 'rgba(180, 180, 180, 0.7)';
        ctx.fillRect(-half, -half, size, size);
        ctx.strokeRect(-half, -half, size, size);
    }
  }

  // ── Grid lines ──────────────────────────────────────────────────────────────

  _drawGraphPaper(ctx, dungeon, cs) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const xMin = Math.floor((-this.panX) / cs) - 1;
    const yMin = Math.floor((-this.panY) / cs) - 1;
    const xMax = Math.ceil((W / this.zoom - this.panX) / cs) + 1;
    const yMax = Math.ceil((H / this.zoom - this.panY) / cs) + 1;

    ctx.save();
    ctx.strokeStyle = 'rgba(34, 86, 163, 0.25)'; // blue graph paper
    ctx.lineWidth = 1;

    // light every cell
    ctx.globalAlpha = 0.2;
    for (let gx = xMin; gx <= xMax; gx++) {
      const x = gx * cs;
      ctx.beginPath();
      ctx.moveTo(x, yMin * cs);
      ctx.lineTo(x, yMax * cs);
      ctx.stroke();
    }
    for (let gy = yMin; gy <= yMax; gy++) {
      const y = gy * cs;
      ctx.beginPath();
      ctx.moveTo(xMin * cs, y);
      ctx.lineTo(xMax * cs, y);
      ctx.stroke();
    }

    // heavier lines every 5th cell
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.5;
    for (let gx = Math.ceil(xMin / 5) * 5; gx <= xMax; gx += 5) {
      const x = gx * cs;
      ctx.beginPath();
      ctx.moveTo(x, yMin * cs);
      ctx.lineTo(x, yMax * cs);
      ctx.stroke();
    }
    for (let gy = Math.ceil(yMin / 5) * 5; gy <= yMax; gy += 5) {
      const y = gy * cs;
      ctx.beginPath();
      ctx.moveTo(xMin * cs, y);
      ctx.lineTo(xMax * cs, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawGridLines(ctx, dungeon, cs) {
    if (this.gridMode === 'none') return;

    ctx.strokeStyle = Style.ink;
    ctx.lineWidth   = Style.thin;
    ctx.globalAlpha = 0.25;

    for (const room of dungeon.rooms) {
      if (room.hidden) continue;
      this._drawRoomGrid(ctx, room, cs);
    }
    ctx.globalAlpha = 1;
  }

  _drawRoomGrid(ctx, room, cs) {
    if (room.round) {
      this._drawCircleGrid(ctx, room, cs);
      return;
    }

    const x0 = room.x * cs, y0 = room.y * cs;
    const x1 = (room.x + room.w) * cs, y1 = (room.y + room.h) * cs;

    // setLineDash INSIDE save so restore() returns lineDash to its prior [] state
    ctx.save();

    if (this.gridMode === 'dotted') {
      ctx.setLineDash([1, cs - 1]);
      ctx.lineDashOffset = 0;
    } else if (this.gridMode === 'dashed') {
      ctx.setLineDash([cs * 0.4, cs * 0.6]);
    }

    ctx.beginPath();
    this._roomPath(ctx, room, cs);
    ctx.clip();

    for (let gx = room.x; gx <= room.x + room.w; gx++) {
      ctx.beginPath();
      ctx.moveTo(gx * cs, y0);
      ctx.lineTo(gx * cs, y1);
      ctx.stroke();
    }
    for (let gy = room.y; gy <= room.y + room.h; gy++) {
      ctx.beginPath();
      ctx.moveTo(x0, gy * cs);
      ctx.lineTo(x1, gy * cs);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Grid for round rooms: draw directly at intersection points inside the circle
   *  instead of relying on clipped line-dashes which don't render reliably at the arc edge. */
  _drawCircleGrid(ctx, room, cs) {
    const cxPx = room.cx * cs, cyPx = room.cy * cs;
    const rPx  = (room.w / 2) * cs;
    const r2   = rPx * rPx;

    const gx0 = Math.ceil(room.x),           gy0 = Math.ceil(room.y);
    const gx1 = Math.floor(room.x + room.w), gy1 = Math.floor(room.y + room.h);

    if (this.gridMode === 'dotted') {
      // A filled dot at every grid intersection inside the circle
      ctx.beginPath();
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const dx = gx * cs - cxPx, dy = gy * cs - cyPx;
          if (dx * dx + dy * dy <= r2) {
            ctx.moveTo(gx * cs + 0.8, cyPx);
            ctx.arc(gx * cs, gy * cs, 0.8, 0, Math.PI * 2);
          }
        }
      }
      ctx.fill();
    } else {
      // Dashed / solid: clip lines to the circle as normal
      ctx.save();
      ctx.beginPath();
      this._roomPath(ctx, room, cs);
      ctx.clip();

      if (this.gridMode === 'dashed') ctx.setLineDash([cs * 0.4, cs * 0.6]);

      for (let gx = gx0; gx <= gx1; gx++) {
        ctx.beginPath();
        ctx.moveTo(gx * cs, (room.y) * cs);
        ctx.lineTo(gx * cs, (room.y + room.h) * cs);
        ctx.stroke();
      }
      for (let gy = gy0; gy <= gy1; gy++) {
        ctx.beginPath();
        ctx.moveTo((room.x) * cs, gy * cs);
        ctx.lineTo((room.x + room.w) * cs, gy * cs);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // ── Doors ──────────────────────────────────────────────────────────────────

  _drawDoors(ctx, dungeon, cs) {
    ctx.setLineDash([]);   // clear any dash pattern left by grid/detail drawing
    ctx.globalAlpha = 1;
    for (const door of dungeon.doors) {
      this._drawDoor(ctx, door, cs);
    }
  }

  _drawDoor(ctx, door, cs) {
    const px = door.x * cs;
    const py = door.y * cs;
    const dir = door.dir;
    const isH = dir.y !== 0;  // horizontal wall (door in top/bottom face)

    ctx.strokeStyle = Style.ink;
    ctx.fillStyle   = Style.floor;
    ctx.lineWidth   = Style.normal;

    // Gap in wall
    const gapW = isH ? cs     : Style.thick * 2;
    const gapH = isH ? Style.thick * 2 : cs;
    ctx.fillRect(px - gapW / 2, py - gapH / 2, gapW, gapH);

    switch (door.type) {
      case DOOR_TYPE.OPEN: {
        // Just the gap — draw small perpendicular lines at corners
        ctx.lineWidth = Style.normal;
        ctx.strokeStyle = Style.ink;
        if (isH) {
          ctx.beginPath(); ctx.moveTo(px - cs / 2, py - cs / 6); ctx.lineTo(px - cs / 2, py + cs / 6); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(px + cs / 2, py - cs / 6); ctx.lineTo(px + cs / 2, py + cs / 6); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.moveTo(px - cs / 6, py - cs / 2); ctx.lineTo(px + cs / 6, py - cs / 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(px - cs / 6, py + cs / 2); ctx.lineTo(px + cs / 6, py + cs / 2); ctx.stroke();
        }
        break;
      }
      case DOOR_TYPE.DOOR:
      default: {
        const hw = isH ? cs * 0.6 : cs * 0.25;
        const hh = isH ? cs * 0.25 : cs * 0.6;
        ctx.lineWidth = Style.normal;
        ctx.beginPath();
        ctx.rect(px - hw, py - hh, hw * 2, hh * 2);
        ctx.fill(); ctx.stroke();
        // Line through door (swing arc representation)
        ctx.beginPath();
        if (isH) { ctx.moveTo(px - hw, py); ctx.lineTo(px + hw, py); }
        else      { ctx.moveTo(px, py - hh); ctx.lineTo(px, py + hh); }
        ctx.stroke();
        break;
      }
      case DOOR_TYPE.LOCKED: {
        const hw = isH ? cs * 0.6 : cs * 0.25;
        const hh = isH ? cs * 0.25 : cs * 0.6;
        ctx.lineWidth = Style.normal;
        ctx.beginPath();
        ctx.rect(px - hw, py - hh, hw * 2, hh * 2);
        ctx.fill(); ctx.stroke();
        // Lock symbol: small filled circle
        ctx.fillStyle = Style.ink;
        ctx.beginPath();
        ctx.arc(px, py, cs * 0.12, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case DOOR_TYPE.SECRET: {
        // S mark
        ctx.lineWidth = Style.normal;
        ctx.strokeStyle = Style.ink;
        ctx.font = `bold ${cs * 0.5}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = Style.floor;
        ctx.fillText('S', px, py);
        ctx.strokeText('S', px, py);
        break;
      }
      case DOOR_TYPE.PORTCULLIS: {
        const hw = isH ? cs * 0.6 : cs * 0.2;
        const hh = isH ? cs * 0.2 : cs * 0.6;
        ctx.lineWidth = Style.thin;
        // Draw a small grid of bars
        const bars = 3;
        for (let i = 0; i <= bars; i++) {
          const t = i / bars;
          ctx.beginPath();
          if (isH) {
            const bx = px - hw + hw * 2 * t;
            ctx.moveTo(bx, py - hh * 2); ctx.lineTo(bx, py + hh * 2);
          } else {
            const by = py - hh + hh * 2 * t;
            ctx.moveTo(px - hw * 2, by); ctx.lineTo(px + hw * 2, by);
          }
          ctx.stroke();
        }
        break;
      }
    }

    // Selection highlight
    if (this.selectedDoor === door) {
      ctx.strokeStyle = '#89b4fa';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(px, py, cs * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  _drawGhostPolygon(ctx, cs) {
    const pts = this.ghostPolygon;
    if (!pts || pts.length < 2) return;

    ctx.save();
    ctx.strokeStyle = '#89b4fa';
    ctx.fillStyle = 'rgba(137, 180, 250, 0.15)';
    ctx.lineWidth = 2 / this.zoom;
    ctx.setLineDash([6 / this.zoom, 4 / this.zoom]);

    ctx.beginPath();
    const p0 = pts[0];
    ctx.moveTo(p0.x * cs, p0.y * cs);
    pts.slice(1).forEach(p => ctx.lineTo(p.x * cs, p.y * cs));

    // close when more than 2 points
    if (pts.length > 2) {
      ctx.closePath();
      ctx.fill();
    }
    ctx.stroke();

    ctx.restore();
  }
  // ── Shadows ────────────────────────────────────────────────────────────────

  _drawShadows(ctx, dungeon, cs) {
    const sd = Style.shadowDist * cs * 0.06;
    ctx.globalAlpha = 0.2;
    ctx.fillStyle   = '#000000';
    ctx.save();
    ctx.translate(sd, sd);
    ctx.beginPath();
    for (const room of dungeon.rooms) {
      if (room.hidden) continue;
      this._roomPath(ctx, room, cs);
    }
    ctx.fill('nonzero');
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ── Labels ─────────────────────────────────────────────────────────────────

  // Fallback icon per room type when no explicit icon is set
  static _TYPE_ICONS = {
    entrance: 'entrance', boss: 'boss', treasure: 'treasure', trap: 'trap',
  };

  _drawLabels(ctx, dungeon, cs) {
    ctx.fillStyle    = Style.ink;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha  = 0.75;

    for (const room of dungeon.rooms) {
      if (room.hidden) continue;
      const cx = room.cx * cs;
      const cy = room.cy * cs;

      if (room.label) {
        ctx.font = `${Math.min(cs * 0.55, 14)}px system-ui, sans-serif`;
        ctx.fillText(room.label, cx, cy);
        continue;
      }

      // Pick icon: explicit > type-derived > nothing
      const iconKey = (room.icon && room.icon !== 'none')
        ? room.icon
        : (Renderer._TYPE_ICONS[room.type] ?? null);

      if (iconKey) {
        const sym = ROOM_ICONS[iconKey]?.symbol ?? '';
        if (sym) {
          ctx.font = `${Math.min(cs * 0.7, 18)}px system-ui`;
          ctx.fillText(sym, cx, cy);
        }
      }

      // Order label — top-left area of room.
      // For round rooms the bounding-box corner is outside the circle, so we
      // shift 25% in from each edge so the text lands inside the arc.
      if (room.order) {
        ctx.font = `bold ${Math.min(cs * 0.38, 11)}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        const ox = room.round
          ? (room.x + room.w * 0.25) * cs
          : room.x * cs + 3;
        const oy = room.round
          ? (room.y + room.h * 0.25) * cs
          : room.y * cs + cs * 0.38;
        ctx.fillText(room.order, ox, oy);
        ctx.textAlign = 'center';
      }

      // Story role indicator top-right
      if (room.story && room.story.role) {
        const roleSym = ROOM_ICONS[room.story.role]?.symbol || room.story.role.toUpperCase();
        ctx.font = `bold ${Math.min(cs * 0.35, 11)}px system-ui, sans-serif`;
        ctx.textAlign = 'right';
        const rx = (room.x + room.w) * cs - 3;
        const ry = room.y * cs + cs * 0.4;
        ctx.fillText(roleSym, rx, ry);
        ctx.textAlign = 'center';
      }
    }
    ctx.globalAlpha = 1;
  }

  // ── Legend ─────────────────────────────────────────────────────────────────

  _drawLegend(ctx, dungeon) {
    const usedIcons = new Map(); // key → { label, symbol }
    const usedDoors = new Map(); // type → label

    const doorLabels = {
      open: 'Open Archway', door: 'Door', locked: 'Locked Door',
      secret: 'Secret Door', portcullis: 'Portcullis',
    };
    const doorSymbols = {
      open: 'O', door: '▭', locked: '⊡', secret: 'S', portcullis: '≡',
    };

    for (const room of dungeon.rooms) {
      if (room.hidden) continue;
      const iconKey = (room.icon && room.icon !== 'none')
        ? room.icon
        : (Renderer._TYPE_ICONS[room.type] ?? null);
      if (iconKey && ROOM_ICONS[iconKey]?.symbol) {
        usedIcons.set(iconKey, ROOM_ICONS[iconKey]);
      }
    }
    for (const door of dungeon.doors) {
      if (!usedDoors.has(door.type)) {
        usedDoors.set(door.type, { label: doorLabels[door.type] ?? door.type, symbol: doorSymbols[door.type] ?? '?' });
      }
    }

    if (usedIcons.size === 0 && usedDoors.size === 0) return;

    const items = [];
    for (const [, info] of usedIcons) items.push({ symbol: info.symbol, label: info.label });
    for (const [, info] of usedDoors) items.push({ symbol: info.symbol, label: info.label });

    const pad    = 8;
    const lh     = 16;
    const fs     = 11;
    const symW   = 18;
    const boxW   = 130;
    const boxH   = pad * 2 + lh + items.length * lh;
    const bx     = 10;
    const by     = 10;

    // Background
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.fillStyle   = Style.paper;
    ctx.strokeStyle = Style.ink;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, 4);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Title
    ctx.fillStyle    = Style.ink;
    ctx.font         = `bold ${fs}px system-ui, sans-serif`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Legend', bx + pad, by + pad + lh / 2);

    // Divider
    ctx.beginPath();
    ctx.moveTo(bx + pad, by + pad + lh + 2);
    ctx.lineTo(bx + boxW - pad, by + pad + lh + 2);
    ctx.strokeStyle = Style.ink;
    ctx.globalAlpha = 0.3;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Items
    ctx.font = `${fs}px system-ui, sans-serif`;
    items.forEach((item, i) => {
      const iy = by + pad + lh + lh * (i + 0.5) + 4;
      ctx.fillStyle    = Style.ink;
      ctx.textAlign    = 'center';
      ctx.font         = `bold ${fs}px system-ui, sans-serif`;
      ctx.fillText(item.symbol, bx + pad + symW / 2, iy);
      ctx.textAlign    = 'left';
      ctx.font         = `${fs}px system-ui, sans-serif`;
      ctx.fillText(item.label, bx + pad + symW + 2, iy);
    });

    ctx.restore();
  }

  // ── Ghost preview ──────────────────────────────────────────────────────────

  _drawGhost(ctx, room, cs) {
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = Style.floor;
    ctx.strokeStyle = Style.ink;
    ctx.lineWidth = Style.normal;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    this._roomPath(ctx, room, cs);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Ghost door preview ─────────────────────────────────────────────────────

  _drawGhostDoor(ctx, ghost, cs) {
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = '#89b4fa';
    ctx.fillStyle   = Style.floor;
    ctx.lineWidth   = Style.normal;
    ctx.setLineDash([4, 3]);

    const px = ghost.x * cs;
    const py = ghost.y * cs;
    const isH = ghost.dir && ghost.dir.y !== 0;
    const hw  = isH ? cs * 0.55 : cs * 0.22;
    const hh  = isH ? cs * 0.22 : cs * 0.55;

    ctx.beginPath();
    ctx.rect(px - hw, py - hh, hw * 2, hh * 2);
    ctx.fill();
    ctx.stroke();

    // Cross hair
    ctx.setLineDash([]);
    ctx.lineWidth = Style.thin;
    ctx.beginPath();
    ctx.moveTo(px - cs * 0.3, py); ctx.lineTo(px + cs * 0.3, py);
    ctx.moveTo(px, py - cs * 0.3); ctx.lineTo(px, py + cs * 0.3);
    ctx.stroke();

    ctx.restore();
  }

  // ── Selection highlight ────────────────────────────────────────────────────

  _drawSelection(ctx, cs) {
    if (!this.selectedRoom) return;
    const room = this.selectedRoom;
    ctx.save();
    ctx.strokeStyle = '#cba6f7';
    ctx.lineWidth = 2.5 / this.zoom;
    ctx.setLineDash([6, 4]);
    ctx.shadowColor = '#cba6f7';
    ctx.shadowBlur  = 8 / this.zoom;
    ctx.beginPath();
    this._roomPath(ctx, room, cs, 4 / this.zoom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    if (this.showResizeHandles) {
      this._drawResizeHandles(ctx, cs, room, this.hoverResizeHandle);
    }
  }

  _drawResizeHandles(ctx, cs, room, hoverHandle) {
    const handleRadius = Math.max(3, 0.08 * cs);

    const drawDotStyled = (x, y, fill, stroke) => {
      ctx.beginPath();
      ctx.arc(x, y, handleRadius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    };

    ctx.save();
    ctx.fillStyle = '#f8f8ff';
    ctx.strokeStyle = '#4c4c82';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#f8f8ff';
    ctx.strokeStyle = '#4c4c82';
    ctx.lineWidth = 1;

    if (room.points && room.points.length >= 3) {
      room.points.forEach((p, idx) => {
        const isHover = hoverHandle && hoverHandle.type === 'vertex' && hoverHandle.index === idx;
        const color = isHover ? '#ffab00' : '#f8f8ff';
        const stroke = isHover ? '#ff0000' : '#4c4c82';
        drawDotStyled(p.x * cs, p.y * cs, color, stroke);
      });
    } else if (room.round) {
      const cx = room.cx * cs;
      const cy = room.cy * cs;
      const r = (room.w / 2) * cs;
      ['e', 'w', 'n', 's'].forEach((dir, index) => {
        const pos = dir === 'e' ? [cx + r, cy] : dir === 'w' ? [cx - r, cy] : dir === 'n' ? [cx, cy - r] : [cx, cy + r];
        const isHover = hoverHandle && hoverHandle.type === 'circle';
        const color = isHover ? '#ffab00' : '#f8f8ff';
        const stroke = isHover ? '#ff0000' : '#4c4c82';
        drawDotStyled(pos[0], pos[1], color, stroke);
      });
    } else {
      const x0 = room.x * cs;
      const y0 = room.y * cs;
      const x1 = (room.x + room.w) * cs;
      const y1 = (room.y + room.h) * cs;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;

      const corners = [
        {x:x0, y:y0, type:'corners', dir:'nw'},
        {x:x1, y:y0, type:'corners', dir:'ne'},
        {x:x0, y:y1, type:'corners', dir:'sw'},
        {x:x1, y:y1, type:'corners', dir:'se'}
      ];
      const edges = [
        {x:cx, y:y0, type:'edge', dir:'n'},
        {x:cx, y:y1, type:'edge', dir:'s'},
        {x:x0, y:cy, type:'edge', dir:'w'},
        {x:x1, y:cy, type:'edge', dir:'e'}
      ];

      corners.concat(edges).forEach(handle => {
        const isHover = hoverHandle && hoverHandle.type === handle.type && hoverHandle.dir === handle.dir;
        const color = isHover ? '#ffab00' : '#f8f8ff';
        const stroke = isHover ? '#ff0000' : '#4c4c82';
        drawDotStyled(handle.x, handle.y, color, stroke);
      });
    }

    ctx.restore();
  }

  // ── Room path helper ───────────────────────────────────────────────────────

  /** Build a canvas path for a room (round or rect), with optional extra inset. */
  _roomPath(ctx, room, cs, inflate = 0) {
    if (room.points && room.points.length >= 3) {
      const pts = room.points;
      ctx.moveTo(pts[0].x * cs, pts[0].y * cs);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x * cs, pts[i].y * cs);
      }
      ctx.closePath();
      return;
    }

    if (room.round) {
      const cx = room.cx * cs;
      const cy = room.cy * cs;
      const r = (room.w / 2) * cs + inflate;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    } else {
      const x = room.x * cs - inflate;
      const y = room.y * cs - inflate;
      const w = room.w * cs + 2 * inflate;
      const h = room.h * cs + 2 * inflate;
      const r = Math.min(4, w / 4, h / 4);
      ctx.roundRect(x, y, w, h, r);
    }
  }

  // ── Export helpers ─────────────────────────────────────────────────────────

  /** Render to a new offscreen canvas at the given scale, cropped to dungeon bounds. */
  renderExport(dungeon, scale = 2) {
    const b  = dungeon.bounds();
    const cs = this.cellSize * scale;
    const pad = cs * 1.5;
    const w  = b.w * cs + pad * 2;
    const h  = b.h * cs + pad * 2;

    const offscreen = document.createElement('canvas');
    offscreen.width  = w;
    offscreen.height = h;

    const saved = { panX: this.panX, panY: this.panY, zoom: this.zoom, cellSize: this.cellSize, canvas: this.canvas, ctx: this.ctx };

    this.canvas   = offscreen;
    this.ctx      = offscreen.getContext('2d');
    this.cellSize = cs;
    this.panX     = -b.x * cs + pad / cs;
    this.panY     = -b.y * cs + pad / cs;
    this.zoom     = 1;

    this.render(dungeon);

    Object.assign(this, saved);
    return offscreen;
  }
}
