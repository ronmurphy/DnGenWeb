export class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }

  clone()               { return new Vec2(this.x, this.y); }
  add(v)                { return new Vec2(this.x + v.x, this.y + v.y); }
  sub(v)                { return new Vec2(this.x - v.x, this.y - v.y); }
  scale(s)              { return new Vec2(this.x * s, this.y * s); }
  dot(v)                { return this.x * v.x + this.y * v.y; }
  cross(v)              { return this.x * v.y - this.y * v.x; }
  lengthSq()            { return this.x * this.x + this.y * this.y; }
  length()              { return Math.sqrt(this.lengthSq()); }
  normalize()           { const l = this.length(); return l > 0 ? this.scale(1 / l) : new Vec2(); }
  perp()                { return new Vec2(-this.y, this.x); }
  distTo(v)             { return this.sub(v).length(); }
  distToSq(v)           { return this.sub(v).lengthSq(); }
  lerp(v, t)            { return new Vec2(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t); }
  equals(v)             { return this.x === v.x && this.y === v.y; }
  toString()            { return `Vec2(${this.x.toFixed(2)}, ${this.y.toFixed(2)})`; }

  static polar(r, angle) { return new Vec2(r * Math.cos(angle), r * Math.sin(angle)); }
  static lerp(a, b, t)   { return a.lerp(b, t); }
  static midpoint(a, b)  { return new Vec2((a.x + b.x) / 2, (a.y + b.y) / 2); }
  static fromAngle(a)    { return new Vec2(Math.cos(a), Math.sin(a)); }

  static UP    = new Vec2( 0, -1);
  static DOWN  = new Vec2( 0,  1);
  static LEFT  = new Vec2(-1,  0);
  static RIGHT = new Vec2( 1,  0);
}

/** Segment–segment intersection. Returns t along segment AB, or null. */
export function segmentIntersect(ax, ay, adx, ady, bx, by, bdx, bdy) {
  const denom = adx * bdy - ady * bdx;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((bx - ax) * bdy - (by - ay) * bdx) / denom;
  const u = ((bx - ax) * ady - (by - ay) * adx) / denom;
  if (t >= 0 && u >= 0 && u <= 1) return t;
  return null;
}

/** Intersect a ray (ox, oy, dx, dy) against a polygon. Returns all t values. */
export function raycastPolygon(pts, ox, oy, dx, dy) {
  const hits = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const t = segmentIntersect(ox, oy, dx, dy, a.x, a.y, b.x - a.x, b.y - a.y);
    if (t !== null) hits.push(t);
  }
  return hits.sort((a, b) => a - b);
}
