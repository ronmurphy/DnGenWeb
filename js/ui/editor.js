/**
 * Editor — handles all canvas mouse/touch interaction.
 * Tools: select, room, round-room, door, erase
 */
import { Room, Door, DOOR_TYPE } from '../dungeon/model.js';

export class Editor {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Renderer} renderer
   * @param {Dungeon}  dungeon
   * @param {Function} onUpdate - called after any mutation, triggers re-render
   */
  constructor(canvas, renderer, dungeon, onUpdate) {
    this.canvas   = canvas;
    this.renderer = renderer;
    this.dungeon  = dungeon;
    this.onUpdate = onUpdate;
    this.tool     = 'select';

    // Called after structural changes (room/door added/removed/moved) — use for undo history
    this.onChanged = null;

    // Draw-in-progress state
    this._dragging   = false;
    this._dragStart  = null;  // { gx, gy } snapped grid
    this._isPanning  = false;
    this._panStart   = null;  // { mx, my, panX, panY }

    // Move-room drag state
    this._movingRoom      = false;
    this._moveRoomStart   = null; // { x, y } original room position before drag
    this._moveRoomPoints  = null; // polygon points snapshot for move
    this._moveDragStart   = null; // { x, y } snapped grid at drag start
    // Polygon tool state
    this._polygonPoints = [];
    this._bindEvents();
  }

  setDungeon(dungeon) {
    this.dungeon = dungeon;
    this.renderer.selectedRoom = null;
    this.renderer.selectedDoor = null;
    this.renderer.ghostRoom    = null;
  }

  setTool(tool) {
    this.tool = tool;
    this.renderer.ghostRoom = null;
    this.renderer.ghostDoor = null;
    this.renderer.ghostPolygon = null;
    this._polygonPoints = [];
    this.canvas.parentElement.className = `tool-${tool}`;
  }

  // ── Event binding ───────────────────────────────────────────────────────────

  _bindEvents() {
    const el = this.canvas;
    el.addEventListener('mousedown',  e => this._onMouseDown(e));
    el.addEventListener('mousemove',  e => this._onMouseMove(e));
    el.addEventListener('mouseup',    e => this._onMouseUp(e));
    el.addEventListener('mouseleave', e => this._onMouseLeave(e));
    el.addEventListener('wheel',      e => this._onWheel(e), { passive: false });

    // Touch support
    el.addEventListener('touchstart', e => this._onTouchStart(e), { passive: false });
    el.addEventListener('touchmove',  e => this._onTouchMove(e),  { passive: false });
    el.addEventListener('touchend',   e => this._onTouchEnd(e));

    // Double-click door type cycle
    el.addEventListener('dblclick', e => this._onDoubleClick(e));

    // Keyboard shortcuts
    window.addEventListener('keydown', e => this._onKey(e));
  }

  // ── Coordinate helpers ──────────────────────────────────────────────────────

  _eventPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { mx: e.clientX - r.left, my: e.clientY - r.top };
  }

  _snapToGrid(mx, my) {
    return this.renderer.snapGrid(mx, my);
  }

  _toGrid(mx, my) {
    return this.renderer.toGrid(mx, my);
  }

  // ── Mouse handlers ──────────────────────────────────────────────────────────

  _onMouseDown(e) {
    const { mx, my } = this._eventPos(e);

    // Middle mouse or alt+left = pan
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this._isPanning = true;
      this._panStart  = { mx, my, panX: this.renderer.panX, panY: this.renderer.panY };
      e.preventDefault();
      return;
    }

    if (e.button !== 0) return;

    if (this.tool === 'polygon') {
      const snap = this._snapToGrid(mx, my);
      if (this._polygonPoints.length >= 3 && this._pointNear(snap, this._polygonPoints[0], 0.5)) {
        this._finishPolygon();
      } else {
        // Avoid duplicated consecutive points
        const last = this._polygonPoints[this._polygonPoints.length - 1];
        if (!last || last.x !== snap.x || last.y !== snap.y) {
          this._polygonPoints.push(snap);
        }
        this.renderer.ghostPolygon = [...this._polygonPoints];
        this.onUpdate();
      }
      return;
    }

    const snap = this._snapToGrid(mx, my);
    this._dragging  = true;
    this._dragStart = snap;

    switch (this.tool) {
      case 'select': {
        // If clicking on the already-selected room, start a move drag
        const g = this._toGrid(mx, my);
        const clicked = this.dungeon.roomAt(g.x, g.y);
        if (clicked && clicked === this.renderer.selectedRoom) {
          this._movingRoom    = true;
          this._moveRoomStart = { x: clicked.x, y: clicked.y };
          this._moveDragStart = snap;
          if (clicked.points && clicked.points.length > 0) {
            this._moveRoomPoints = clicked.points.map(p => ({ x: p.x, y: p.y }));
          } else {
            this._moveRoomPoints = null;
          }
        } else {
          this._selectAt(mx, my);
        }
        break;
      }
      case 'erase':  this._eraseAt(mx, my);  break;
    }
  }

  _onMouseMove(e) {
    const { mx, my } = this._eventPos(e);

    if (this._isPanning) {
      const { panX, panY } = this._panStart;
      const dx = (mx - this._panStart.mx) / this.renderer.zoom;
      const dy = (my - this._panStart.my) / this.renderer.zoom;
      this.renderer.panX = panX + dx;
      this.renderer.panY = panY + dy;
      this.onUpdate();
      return;
    }

    // Move selected room
    if (this._movingRoom && this.renderer.selectedRoom) {
      const snap = this._snapToGrid(mx, my);
      const dx = snap.x - this._moveDragStart.x;
      const dy = snap.y - this._moveDragStart.y;

      const room = this.renderer.selectedRoom;
      if (room.points && this._moveRoomPoints) {
        room.points = this._moveRoomPoints.map(p => ({ x: p.x + dx, y: p.y + dy }));
        // keep bounding values in sync
        room.x = room.bounds.x;
        room.y = room.bounds.y;
        room.w = room.bounds.w;
        room.h = room.bounds.h;
      } else {
        room.x = this._moveRoomStart.x + dx;
        room.y = this._moveRoomStart.y + dy;
      }

      this.onUpdate();
      return;
    }

    if (!this._dragging) {
      if (this.tool === 'polygon') {
        if (this._polygonPoints.length > 0) {
          const g = this._snapToGrid(mx, my);
          this.renderer.ghostPolygon = [...this._polygonPoints, g];
        } else {
          this.renderer.ghostPolygon = null;
        }
        this.renderer.ghostRoom = null;
        this.renderer.ghostDoor = null;
        this.onUpdate();
        return;
      }

      if (this.tool === 'room' || this.tool === 'round-room') {
        const snap = this._snapToGrid(mx, my);
        this.renderer.ghostRoom = new Room({
          x: snap.x - 2, y: snap.y - 2, w: 4, h: 4,
          round: this.tool === 'round-room',
        });
        this.renderer.ghostDoor = null;
        this.onUpdate();
      } else if (this.tool === 'door') {
        const g = this._toGrid(mx, my);
        this.renderer.ghostDoor = this._nearestDoorPosition(g.x, g.y);
        this.renderer.ghostRoom = null;
        this.onUpdate();
      } else {
        this.renderer.ghostRoom = null;
        this.renderer.ghostDoor = null;
      }
      return;
    }

    const snap = this._snapToGrid(mx, my);

    if (this.tool === 'room' || this.tool === 'round-room') {
      const x = Math.min(this._dragStart.x, snap.x);
      const y = Math.min(this._dragStart.y, snap.y);
      const w = Math.max(1, Math.abs(snap.x - this._dragStart.x));
      const h = Math.max(1, Math.abs(snap.y - this._dragStart.y));
      this.renderer.ghostRoom = new Room({
        x, y, w, h, round: this.tool === 'round-room',
      });
      this.onUpdate();
    }
  }

  _onMouseUp(e) {
    if (this._isPanning) { this._isPanning = false; return; }

    // Finalize room move
    if (this._movingRoom) {
      this._movingRoom = false;
      this._dragging   = false;
      this._moveRoomPoints = null;
      this.onChanged?.();
      return;
    }

    if (!this._dragging) return;
    this._dragging = false;

    if (this.tool === 'polygon') {
      // polygon is handled on-mousedown, not drag end
      return;
    }

    const { mx, my } = this._eventPos(e);
    const snap = this._snapToGrid(mx, my);

    switch (this.tool) {
      case 'room':
      case 'round-room':
        this._finishRoom(snap);
        break;
      case 'door':
        this._placeDoor(snap);
        break;
    }
    this.renderer.ghostRoom = null;
  }

  _onDoubleClick(e) {
    // Only allow cycling when in select mode (or adjust as desired)
    if (this.tool !== 'select') return;

    const { mx, my } = this._eventPos(e);
    const clickedDoor = this._doorAtScreenPos(mx, my);
    if (!clickedDoor) return;

    this._cycleDoorType(clickedDoor);
    this.renderer.selectedDoor = clickedDoor;
    this.renderer.selectedRoom = null;
    this.onUpdate();
    this._emitSelection(null, clickedDoor);
    this.onChanged?.();
  }

  _doorAtScreenPos(mx, my) {
    for (const door of this.dungeon.doors) {
      const dpx = this.renderer.gx(door.x);
      const dpy = this.renderer.gy(door.y);
      const dist = Math.hypot(mx - dpx, my - dpy);
      if (dist < 12) return door;
    }
    return null;
  }

  _cycleDoorType(door) {
    const types = Object.values(DOOR_TYPE);
    const current = types.indexOf(door.type);
    const next = (current + 1) % types.length;
    door.type = types[next];
  }

  _onMouseLeave() {
    this._movingRoom = false;
    this.renderer.ghostRoom = null;
    this.renderer.ghostPolygon = null;
    this.onUpdate();
  }

  _onWheel(e) {
    e.preventDefault();
    const { mx, my } = this._eventPos(e);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this._zoomAt(mx, my, factor);
  }

  // ── Touch handlers ─────────────────────────────────────────────────────────

  _onTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const r = this.canvas.getBoundingClientRect();
      this._onMouseDown({ button: 0, clientX: t.clientX, clientY: t.clientY,
                          altKey: false, preventDefault: () => {} });
    } else if (e.touches.length === 2) {
      this._pinchDist = this._touchDist(e.touches);
    }
  }

  _onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      this._onMouseMove({ clientX: t.clientX, clientY: t.clientY });
    } else if (e.touches.length === 2 && this._pinchDist) {
      const d = this._touchDist(e.touches);
      const { mx, my } = this._touchMidpoint(e.touches);
      this._zoomAt(mx, my, d / this._pinchDist);
      this._pinchDist = d;
    }
  }

  _onTouchEnd(e) {
    if (e.touches.length === 0) {
      this._onMouseUp({ clientX: 0, clientY: 0 });
      this._pinchDist = null;
    }
  }

  _touchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _touchMidpoint(touches) {
    const r = this.canvas.getBoundingClientRect();
    return {
      mx: (touches[0].clientX + touches[1].clientX) / 2 - r.left,
      my: (touches[0].clientY + touches[1].clientY) / 2 - r.top,
    };
  }

  // ── Zoom ───────────────────────────────────────────────────────────────────

  _zoomAt(mx, my, factor) {
    const clampedZoom = Math.max(0.2, Math.min(5, this.renderer.zoom * factor));
    const actualFactor = clampedZoom / this.renderer.zoom;

    // Adjust pan so the point under cursor stays fixed
    this.renderer.panX = mx / clampedZoom - mx / this.renderer.zoom + this.renderer.panX;
    this.renderer.panY = my / clampedZoom - my / this.renderer.zoom + this.renderer.panY;
    this.renderer.zoom = clampedZoom;
    this.onUpdate();
  }

  // ── Tool actions ───────────────────────────────────────────────────────────

  _selectAt(mx, my) {
    const g = this._toGrid(mx, my);

    // Check doors first (small hit area)
    for (const door of this.dungeon.doors) {
      const dpx = this.renderer.gx(door.x);
      const dpy = this.renderer.gy(door.y);
      const dist = Math.hypot(mx - dpx, my - dpy);
      if (dist < 12) {
        this.renderer.selectedDoor = door;
        this.renderer.selectedRoom = null;
        this.onUpdate();
        this._emitSelection(null, door);
        return;
      }
    }

    // Check rooms
    const room = this.dungeon.roomAt(g.x, g.y);
    this.renderer.selectedRoom = room;
    this.renderer.selectedDoor = null;
    this.onUpdate();
    this._emitSelection(room, null);
  }

  _eraseAt(mx, my) {
    const g = this._toGrid(mx, my);

    // Check doors first
    for (const door of this.dungeon.doors) {
      const dpx = door.x * this.renderer.cellSize;
      const dpy = door.y * this.renderer.cellSize;
      const dist = Math.hypot(g.x * this.renderer.cellSize - dpx,
                               g.y * this.renderer.cellSize - dpy);
      if (dist < 1) {
        this.dungeon.removeDoor(door);
        if (this.renderer.selectedDoor === door) this.renderer.selectedDoor = null;
        this.onUpdate();
        this.onChanged?.();
        return;
      }
    }

    const room = this.dungeon.roomAt(g.x, g.y);
    if (room) {
      if (this.renderer.selectedRoom === room) this.renderer.selectedRoom = null;
      this.dungeon.removeRoom(room);
      this.onUpdate();
      this.onChanged?.();
    }
  }

  _finishRoom(snap) {
    if (!this.renderer.ghostRoom) return;
    const ghost = this.renderer.ghostRoom;
    if (ghost.w < 1 || ghost.h < 1) return;

    // In merge mode allow overlaps — rooms will be visually merged.
    // Otherwise reject rooms that overlap an existing one.
    if (!this.renderer.mergeRooms) {
      for (const r of this.dungeon.rooms) {
        if (ghost.overlaps(r)) return;
      }
    }

    const room = new Room({ x: ghost.x, y: ghost.y, w: ghost.w, h: ghost.h, round: ghost.round });
    this.dungeon.addRoom(room);
    this.renderer.selectedRoom = room;
    this.renderer.selectedDoor = null;
    this.onUpdate();
    this._emitSelection(room, null);
    this.onChanged?.();
  }

  _placeDoor(snap) {
    const g = this.renderer.toGrid
      ? { x: snap.x, y: snap.y }
      : snap;
    const best = this._nearestDoorPosition(snap.x, snap.y);
    if (!best) return;

    // Check not already a door here
    const existing = this.dungeon.doors.find(
      d => Math.hypot(d.x - best.x, d.y - best.y) < 0.5
    );
    if (existing) return;

    const door = new Door(best.x, best.y, best.from, best.to);
    door.dir  = best.dir;
    door.type = DOOR_TYPE.DOOR;
    this.dungeon.addDoor(door);
    this.renderer.selectedDoor = door;
    this.renderer.selectedRoom = null;
    this.renderer.ghostDoor    = null;
    this.onUpdate();
    this._emitSelection(null, door);
    this.onChanged?.();
  }

  _pointNear(a, b, dist = 0.5) {
    if (!a || !b) return false;
    return Math.hypot(a.x - b.x, a.y - b.y) <= dist;
  }

  _finishPolygon() {
    if (this._polygonPoints.length < 3) return;
    const points = [...this._polygonPoints];

    // Compute bounding box for the room object
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const x1 = Math.max(...xs);
    const y1 = Math.max(...ys);

    const room = new Room({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    room.round = false;
    room.points = points;

    this.dungeon.addRoom(room);
    this.renderer.selectedRoom = room;
    this.renderer.selectedDoor = null;
    this.renderer.ghostPolygon = null;
    this._polygonPoints = [];

    this.onUpdate();
    this._emitSelection(room, null);
    this.onChanged?.();
  }

  // ── Door wall finder ───────────────────────────────────────────────────────

  /**
   * Finds the nearest valid door position (midpoint of a shared wall) to (gx, gy).
   * Returns { x, y, dir } in grid units, or null if nothing nearby.
   */
  _nearestDoorPosition(gx, gy) {
    let best = null, bestDist = 4; // max 4 grid units search radius

    for (const room of this.dungeon.rooms) {
      for (const other of this.dungeon.rooms) {
        if (other === room) continue;
        const dir = room.adjacentDir(other);
        if (!dir) continue;

        let wx, wy;
        if (dir.x !== 0) {
          wx = room.x + (dir.x > 0 ? room.w : 0);
          wy = (Math.max(room.y, other.y) + Math.min(room.y + room.h, other.y + other.h)) / 2;
        } else {
          wx = (Math.max(room.x, other.x) + Math.min(room.x + room.w, other.x + other.w)) / 2;
          wy = room.y + (dir.y > 0 ? room.h : 0);
        }

        const d = Math.hypot(gx - wx, gy - wy);
        if (d < bestDist) {
          bestDist = d;
          best = { x: wx, y: wy, dir, from: room, to: other };
        }
      }
    }
    return best;
  }

  // ── Selection event ────────────────────────────────────────────────────────

  _emitSelection(room, door) {
    window.dispatchEvent(new CustomEvent('dungeon:select', { detail: { room, door } }));
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────

  _onKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key.toLowerCase()) {
      case 'v': this.setTool('select');     break;
      case 'r': this.setTool('room');       break;
      case 'c': this.setTool('round-room'); break;
      case 'p': this.setTool('polygon');    break;
      case 'd': this.setTool('door');       break;
      case 'e': this.setTool('erase');      break;
      case 'delete':
      case 'backspace':
        if (this.renderer.selectedRoom) {
          this.dungeon.removeRoom(this.renderer.selectedRoom);
          this.renderer.selectedRoom = null;
          this.onUpdate();
          this._emitSelection(null, null);
          this.onChanged?.();
        } else if (this.renderer.selectedDoor) {
          this.dungeon.removeDoor(this.renderer.selectedDoor);
          this.renderer.selectedDoor = null;
          this.onUpdate();
          this._emitSelection(null, null);
          this.onChanged?.();
        }
        break;
      case 'escape':
        this.renderer.selectedRoom = null;
        this.renderer.selectedDoor = null;
        this.renderer.ghostRoom    = null;
        this.renderer.ghostPolygon = null;
        this._polygonPoints = [];
        this.onUpdate();
        this._emitSelection(null, null);
        break;
    }
  }
}
