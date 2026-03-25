import { Vec2 } from './vec2.js';

/** Build a rectangle polygon centered at (cx, cy) or from top-left (x, y). */
export function rectPoly(x, y, w, h) {
  return [
    new Vec2(x,     y    ),
    new Vec2(x + w, y    ),
    new Vec2(x + w, y + h),
    new Vec2(x,     y + h),
  ];
}

/** Build a regular polygon with n sides. */
export function regularPoly(cx, cy, r, n = 16) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    pts.push(new Vec2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  return pts;
}

/** Translate a polygon by (dx, dy). */
export function translatePoly(pts, dx, dy) {
  return pts.map(p => new Vec2(p.x + dx, p.y + dy));
}

/** Scale a polygon from origin. */
export function scalePoly(pts, sx, sy = sx) {
  return pts.map(p => new Vec2(p.x * sx, p.y * sy));
}

/** Inset/outset a convex polygon by amount. */
export function insetPoly(pts, amount) {
  const n = pts.length;
  const result = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const ab = b.sub(a).normalize().perp();
    const bc = c.sub(b).normalize().perp();
    const bisector = ab.add(bc).normalize();
    const len = amount / Math.max(0.01, bisector.dot(ab));
    result.push(new Vec2(b.x + bisector.x * len, b.y + bisector.y * len));
  }
  return result;
}

/** Point-in-polygon test (ray casting). */
export function pointInPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Signed area (positive = counter-clockwise). */
export function polyArea(pts) {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return area / 2;
}

/** Centroid of a polygon. */
export function polyCentroid(pts) {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  return new Vec2(cx / pts.length, cy / pts.length);
}

/** Axis-aligned bounding box of a polygon. */
export function polyAABB(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Draw a closed polygon path on a canvas context. */
export function drawPolygon(ctx, pts) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

/** Draw an open polyline on a canvas context. */
export function drawPolyline(ctx, pts) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}
