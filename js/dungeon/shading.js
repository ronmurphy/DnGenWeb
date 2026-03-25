/**
 * Shading / hatching for dungeon walls.
 *
 * KEY RULE: hatching is drawn ONLY in the "wall band" —
 * the region outside the room floor but inside the inflated boundary.
 * This is enforced by clipping each draw call with:
 *   outer path  = inflated area
 *   inner holes = ALL original room areas  (evenodd rule punches them out)
 *
 * Modes:
 *   default    – Poisson-disk cluster hatching
 *   stonework  – stone block rectangles along wall perimeter
 *   bricks     – concentric inset brick lines
 *   dots       – distance-field dot shading
 *   none       – no hatching
 */
import { Vec2 } from '../utils/vec2.js';
import { poissonDisk } from '../utils/poisson.js';

// ── Shared style / config ─────────────────────────────────────────────────────
export const Style = {
  ink:       '#1a1a2e',
  paper:     '#f5f0e8',
  floor:     '#e8e0d0',
  shading:   '#c8b89a',
  water:     '#a8c8e8',
  thin:      0.5,
  stroke:    1.0,
  normal:    1.5,
  thick:     3.0,
  shadowColor: '#00000033',
  shadowDist:  2,
};

export const ShadingConfig = {
  mode:        'default',
  nStrokes:    3,
  clusterSize: 10,
  distance:    15,
};

// ── Public entry point ────────────────────────────────────────────────────────
/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Area[]} areas   – original room areas in px  { type:'rect'|'circle', ... }
 * @param {RNG}    rng
 */
export function drawShading(ctx, areas, rng) {
  if (ShadingConfig.mode === 'none' || areas.length === 0) return;

  const inflated = areas.map(a => inflateArea(a, ShadingConfig.distance));

  if      (ShadingConfig.mode === 'stonework') drawStonework(ctx, inflated, areas, rng);
  else if (ShadingConfig.mode === 'bricks')    drawBricks   (ctx, inflated, areas, rng);
  else if (ShadingConfig.mode === 'dots')      drawDots     (ctx, areas,    inflated);
  else                                         drawDefault  (ctx, areas, inflated, rng);
}

// ── Clip helper ───────────────────────────────────────────────────────────────
/**
 * Sets an evenodd clip that draws ONLY in:
 *   inflated[i]  (outer boundary of wall band)
 *   minus ALL original room areas (floor — punch holes through all of them).
 *
 * Caller must wrap in ctx.save() / ctx.restore().
 */
function applyWallClip(ctx, inflatedArea, allOriginalAreas) {
  ctx.beginPath();
  buildAreaPath(ctx, inflatedArea);          // outer ring
  for (const a of allOriginalAreas) {
    buildAreaPath(ctx, a);                   // hole: every room floor
  }
  ctx.clip('evenodd');
}

/** Add a closed subpath for an area without calling beginPath(). */
function buildAreaPath(ctx, a) {
  if (a.type === 'circle') {
    ctx.moveTo(a.cx + a.r, a.cy);
    ctx.arc(a.cx, a.cy, a.r, 0, Math.PI * 2);
  } else {
    const r = Math.min(3, a.w / 4, a.h / 4);
    if (r < 1) {
      ctx.rect(a.x, a.y, a.w, a.h);
    } else {
      ctx.roundRect(a.x, a.y, a.w, a.h, r);
    }
  }
}

// ── Default mode ──────────────────────────────────────────────────────────────
function drawDefault(ctx, areas, inflated, rng) {
  // 1. Soft shading fill
  ctx.save();
  applyWallClip(ctx, inflated[0], areas);    // rough early clip for fill
  ctx.restore();

  for (let i = 0; i < areas.length; i++) {
    ctx.save();
    applyWallClip(ctx, inflated[i], areas);
    _shadingFill(ctx, inflated[i]);
    ctx.restore();
  }

  // 2. Poisson cluster hatching
  for (let i = 0; i < areas.length; i++) {
    ctx.save();
    applyWallClip(ctx, inflated[i], areas);
    _hatchArea(ctx, inflated[i], rng);
    ctx.restore();
  }
}

function _shadingFill(ctx, area) {
  ctx.fillStyle   = Style.shading;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  buildAreaPath(ctx, area);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function _hatchArea(ctx, area, rng) {
  const { x, y, w, h } = areaAABB(area);
  const cs = ShadingConfig.clusterSize;

  const points = poissonDisk(w, h, cs,
    (px, py) => pointInArea(area, px + x, py + y),
    () => rng.next()
  ).map(p => new Vec2(p.x + x, p.y + y));

  if (points.length === 0) return;

  ctx.strokeStyle = Style.ink;
  ctx.lineWidth   = Style.stroke;

  const d    = ShadingConfig.nStrokes;
  const half = (d - 1) / 2;
  const sp   = (d + 0.5) / (d + 1);

  for (const pt of points) {
    const angle   = rng.next() * Math.PI;
    const cos     = Math.cos(angle);
    const sin     = Math.sin(angle);
    const perpLen = cs * 0.45;
    const strokeL = cs * (0.3 + 0.5 * rng.next());

    for (let s = 0; s < d; s++) {
      const t  = d > 1 ? sp * (s - half) / half : 0;
      const ox = pt.x + (-sin) * perpLen * t;
      const oy = pt.y +   cos  * perpLen * t;
      ctx.beginPath();
      ctx.moveTo(ox - cos * strokeL, oy - sin * strokeL);
      ctx.lineTo(ox + cos * strokeL, oy + sin * strokeL);
      ctx.stroke();
    }
  }
}

// ── Stonework ─────────────────────────────────────────────────────────────────
function drawStonework(ctx, inflated, areas, rng) {
  const cs = ShadingConfig.clusterSize;
  const ds = ShadingConfig.distance;

  for (let i = 0; i < inflated.length; i++) {
    ctx.save();
    applyWallClip(ctx, inflated[i], areas);

    const area = inflated[i];
    ctx.fillStyle   = Style.shading;
    ctx.strokeStyle = Style.ink;
    ctx.lineWidth   = Style.normal;

    if (area.type === 'circle') {
      _stoneworkCircle(ctx, area, cs, ds, rng);
    } else {
      _stoneworkRect(ctx, area, cs, ds, rng);
    }

    ctx.restore();
  }
}

function _stoneworkRect(ctx, area, cs, ds, rng) {
  const { x, y, w, h } = area;
  const stones = [];

  // collect seed points along each edge of the inflated area
  const colsH = Math.max(1, Math.ceil(w / cs));
  const colsV = Math.max(1, Math.ceil(h / cs));

  for (let t = 0; t < colsH; t++) {
    stones.push({ bx: x + w * (t + 0.5) / colsH, by: y,     hor: false });
    stones.push({ bx: x + w * (t + 0.5) / colsH, by: y + h, hor: false });
  }
  for (let t = 0; t < colsV; t++) {
    stones.push({ bx: x,     by: y + h * (t + 0.5) / colsV, hor: true });
    stones.push({ bx: x + w, by: y + h * (t + 0.5) / colsV, hor: true });
  }

  rng.shuffle(stones);
  for (const s of stones) {
    const len   = cs * (0.7 + rng.next() * 0.6);
    const depth = ds * (rng.next() * 0.5 + 0.25);
    const sw = s.hor ? depth : len;
    const sh = s.hor ? len   : depth;
    ctx.beginPath();
    ctx.rect(s.bx - sw / 2, s.by - sh / 2, sw, sh);
    ctx.fill();
    ctx.stroke();
  }
}

function _stoneworkCircle(ctx, area, cs, ds, rng) {
  const { cx, cy, r } = area;
  const perim = 2 * Math.PI * r;
  const count = Math.max(4, Math.ceil(perim / cs));
  const step  = 2 * Math.PI / count;
  const angles = Array.from({ length: count }, (_, i) => i * step);
  rng.shuffle(angles);
  for (const ang of angles) {
    const halfArc = step * (0.5 + rng.next() * 0.3);
    const depth   = ds * (0.25 + rng.next() * 0.4);
    ctx.beginPath();
    ctx.arc(cx, cy, r, ang - halfArc, ang + halfArc);
    ctx.lineWidth = depth;
    ctx.strokeStyle = Style.shading;
    ctx.stroke();
    ctx.lineWidth = Style.normal;
    ctx.strokeStyle = Style.ink;
    ctx.stroke();
  }
}

// ── Bricks ────────────────────────────────────────────────────────────────────
function drawBricks(ctx, inflated, areas, rng) {
  const cs = ShadingConfig.clusterSize;
  const ds = ShadingConfig.distance;
  const n  = ShadingConfig.nStrokes;

  for (let i = 0; i < inflated.length; i++) {
    ctx.save();
    applyWallClip(ctx, inflated[i], areas);

    ctx.strokeStyle = Style.ink;
    const area = inflated[i];
    const { x, y, w, h } = areaAABB(area);

    // Draw concentric brick "rings" from the edge inward
    for (let s = 0; s < n; s++) {
      const inset   = (ds / n) * s;
      const ox = x + inset, oy = y + inset;
      const ow = w - 2 * inset, oh = h - 2 * inset;
      if (ow <= 2 || oh <= 2) continue;

      ctx.lineWidth = Style.stroke * (1 - s * 0.15);

      const brickW = cs * (0.8 + rng.next() * 0.4);
      const cols   = Math.max(2, Math.round(ow / brickW));
      const rows   = Math.max(2, Math.round(oh / brickW));

      // Horizontal mortar lines
      for (let r = 1; r < rows; r++) {
        const py = oy + (oh * r) / rows;
        ctx.beginPath();
        ctx.moveTo(ox, py);
        ctx.lineTo(ox + ow, py);
        ctx.stroke();
      }
      // Vertical mortar lines (alternating offset per row)
      for (let r = 0; r < rows; r++) {
        const py0   = oy + (oh * r) / rows;
        const py1   = oy + (oh * (r + 1)) / rows;
        const offset = (r % 2 === 0) ? 0 : 0.5;
        for (let c = 1; c < cols; c++) {
          const px = ox + (ow * (c + offset)) / cols;
          if (px < ox || px > ox + ow) continue;
          ctx.beginPath();
          ctx.moveTo(px, py0);
          ctx.lineTo(px, py1);
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }
}

// ── Dots ──────────────────────────────────────────────────────────────────────
function drawDots(ctx, areas, inflated) {
  const ds = ShadingConfig.distance;
  const cs = ShadingConfig.clusterSize;

  for (let i = 0; i < areas.length; i++) {
    ctx.save();
    applyWallClip(ctx, inflated[i], areas);

    ctx.fillStyle = Style.ink;
    const inf = inflated[i];
    const orig = areas[i];
    const { x, y, w, h } = areaAABB(inf);
    const spacing = cs * 0.5;
    const cols = Math.ceil(w / spacing);
    const rows = Math.ceil(h / spacing);

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const px = x + c * spacing + (r % 2 === 0 ? 0 : spacing / 2);
        const py = y + r * spacing;
        if (!pointInArea(inf, px, py)) continue;

        const dist = distToAreaEdge(orig, px, py);
        // dist > 0  means inside room, dist < 0 means outside room edge
        // We want dots that are close to the room edge (from outside)
        const wallDist = -dist;   // positive when outside room
        if (wallDist < 0 || wallDist > ds) continue;

        const t    = 1 - wallDist / ds;
        const dotR = (Style.thick * 0.4) * t;
        if (dotR < 0.25) continue;

        ctx.beginPath();
        ctx.arc(px, py, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }
}

// ── Area helpers ──────────────────────────────────────────────────────────────

function inflateArea(a, amount) {
  if (a.type === 'circle') return { ...a, r: Math.max(0, a.r + amount) };
  return { ...a,
    x: a.x - amount, y: a.y - amount,
    w: Math.max(0, a.w + 2 * amount),
    h: Math.max(0, a.h + 2 * amount),
  };
}

function areaAABB(a) {
  if (a.type === 'circle') return { x: a.cx - a.r, y: a.cy - a.r, w: 2 * a.r, h: 2 * a.r };
  return { x: a.x, y: a.y, w: a.w, h: a.h };
}

function pointInArea(a, px, py) {
  if (!a) return false;
  if (a.type === 'circle') return (px - a.cx) ** 2 + (py - a.cy) ** 2 <= a.r * a.r;
  return px >= a.x && px <= a.x + a.w && py >= a.y && py <= a.y + a.h;
}

/**
 * Signed distance to the room edge.
 * Positive = inside room, negative = outside room.
 */
function distToAreaEdge(a, px, py) {
  if (a.type === 'circle') {
    return a.r - Math.sqrt((px - a.cx) ** 2 + (py - a.cy) ** 2);
  }
  const dx = Math.min(px - a.x, a.x + a.w - px);
  const dy = Math.min(py - a.y, a.y + a.h - py);
  return Math.min(dx, dy);
}
