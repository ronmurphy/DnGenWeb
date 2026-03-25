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
import { DOOR_TYPE, ROOM_TYPE } from './model.js';
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
    this.gridMode     = 'dotted';
    this.showShadows  = true;
    this.showProps    = true;
    this.mergeRooms   = false;
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

    const cs = this.cellSize;
    const rng = new RNG(dungeon.seed);

    // 1. Floor fills
    this._drawFloors(ctx, dungeon, cs);

    // 2. Water
    this._drawWater(ctx, dungeon, cs);

    // 3. Wall outlines
    this._drawWalls(ctx, dungeon, cs);

    // 3b. Merge: paint over shared interior walls with floor color
    if (this.mergeRooms) this._eraseInteriorWalls(ctx, dungeon, cs);

    // 4. Shading / hatching
    this._drawShadings(ctx, dungeon, cs, rng);

    // 5. Cracks / floor details
    if (this.showProps) this._drawDetails(ctx, dungeon, cs, rng);

    // 6. Grid lines
    this._drawGridLines(ctx, dungeon, cs);

    // 7. Doors
    this._drawDoors(ctx, dungeon, cs);

    // 8. Shadows (simple drop shadow under rooms)
    if (this.showShadows) this._drawShadows(ctx, dungeon, cs);

    // 9. Room labels
    this._drawLabels(ctx, dungeon, cs);

    // 10. Ghost previews
    if (this.ghostRoom) this._drawGhost(ctx, this.ghostRoom, cs);
    if (this.ghostDoor) this._drawGhostDoor(ctx, this.ghostDoor, cs);

    // 11. Selection
    this._drawSelection(ctx, cs);

    ctx.restore();
  }

  // ── Floor fills ─────────────────────────────────────────────────────────────

  _drawFloors(ctx, dungeon, cs) {
    ctx.fillStyle = Style.floor;
    for (const room of dungeon.rooms) {
      if (room.hidden) continue;
      ctx.beginPath();
      this._roomPath(ctx, room, cs);
      ctx.fillStyle = Style.floor;
      ctx.fill();
    }
  }

  // ── Water ──────────────────────────────────────────────────────────────────

  _drawWater(ctx, dungeon, cs) {
    ctx.fillStyle = Style.water;
    ctx.globalAlpha = 0.55;
    for (const room of dungeon.rooms) {
      if (!room.water || room.hidden) continue;
      ctx.beginPath();
      this._roomPath(ctx, room, cs);
      ctx.fill();
    }
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

  // ── Merge: erase shared interior walls ─────────────────────────────────────

  _eraseInteriorWalls(ctx, dungeon, cs) {
    const wallW = 2 * Style.thick + 1;  // slightly wider than the drawn wall
    ctx.strokeStyle = Style.floor;
    ctx.lineWidth   = wallW;
    ctx.lineCap     = 'butt';

    const rooms = dungeon.rooms.filter(r => !r.hidden && !r.round);
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i], b = rooms[j];
        const dir = a.adjacentDir(b);
        if (!dir) continue;

        // Compute the shared wall segment
        if (dir.x !== 0) {
          // vertical shared wall
          const wallX   = (dir.x > 0 ? a.x + a.w : a.x) * cs;
          const shareY0 = Math.max(a.y, b.y) * cs;
          const shareY1 = Math.min(a.y + a.h, b.y + b.h) * cs;
          if (shareY1 <= shareY0) continue;
          ctx.beginPath();
          ctx.moveTo(wallX, shareY0);
          ctx.lineTo(wallX, shareY1);
          ctx.stroke();
        } else {
          // horizontal shared wall
          const wallY   = (dir.y > 0 ? a.y + a.h : a.y) * cs;
          const shareX0 = Math.max(a.x, b.x) * cs;
          const shareX1 = Math.min(a.x + a.w, b.x + b.w) * cs;
          if (shareX1 <= shareX0) continue;
          ctx.beginPath();
          ctx.moveTo(shareX0, wallY);
          ctx.lineTo(shareX1, wallY);
          ctx.stroke();
        }
      }
    }
    ctx.lineCap = 'round';
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
    ctx.globalAlpha = 0.4;

    for (const room of dungeon.rooms) {
      if (room.hidden || room.w < 4 || room.h < 4) continue;
      const count = Math.floor((room.w + room.h) * rng.next() * 0.3);
      for (let i = 0; i < count; i++) {
        const cx = (room.x + rng.float(0.5, room.w - 0.5)) * cs;
        const cy = (room.y + rng.float(0.5, room.h - 0.5)) * cs;
        const len = cs * rng.float(0.2, 0.7);
        const ang = rng.next() * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ── Grid lines ──────────────────────────────────────────────────────────────

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
    const x0 = room.x * cs, y0 = room.y * cs;
    const x1 = (room.x + room.w) * cs, y1 = (room.y + room.h) * cs;

    if (this.gridMode === 'dotted') {
      ctx.setLineDash([1, cs - 1]);
    } else if (this.gridMode === 'dashed') {
      ctx.setLineDash([cs * 0.4, cs * 0.6]);
    } else {
      ctx.setLineDash([]);
    }

    // Save clip to room bounds
    ctx.save();
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
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Doors ──────────────────────────────────────────────────────────────────

  _drawDoors(ctx, dungeon, cs) {
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

  // ── Shadows ────────────────────────────────────────────────────────────────

  _drawShadows(ctx, dungeon, cs) {
    const sd = Style.shadowDist * cs * 0.06;
    ctx.globalAlpha = 0.2;
    ctx.fillStyle   = '#000000';
    for (const room of dungeon.rooms) {
      if (room.hidden) continue;
      ctx.save();
      ctx.translate(sd, sd);
      ctx.beginPath();
      this._roomPath(ctx, room, cs);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ── Labels ─────────────────────────────────────────────────────────────────

  _drawLabels(ctx, dungeon, cs) {
    ctx.fillStyle   = Style.ink;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha  = 0.75;

    // Room type icons
    const icons = {
      entrance: '▲', boss: '☠', treasure: '✦', trap: '⚠', normal: '',
    };

    for (const room of dungeon.rooms) {
      if (room.hidden) continue;
      const cx = room.cx * cs;
      const cy = room.cy * cs;
      const fs  = Math.min(cs * 0.55, 14);

      ctx.font = `${fs}px system-ui, sans-serif`;

      if (room.label) {
        ctx.fillText(room.label, cx, cy);
      } else if (room.type !== ROOM_TYPE.NORMAL) {
        ctx.font = `${Math.min(cs * 0.7, 18)}px system-ui`;
        ctx.fillText(icons[room.type] ?? '', cx, cy);
      }
    }
    ctx.globalAlpha = 1;
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
  }

  // ── Room path helper ───────────────────────────────────────────────────────

  /** Build a canvas path for a room (round or rect), with optional extra inset. */
  _roomPath(ctx, room, cs, inflate = 0) {
    if (room.round) {
      ctx.arc(room.cx * cs, room.cy * cs, (room.w / 2) * cs + inflate, 0, Math.PI * 2);
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
