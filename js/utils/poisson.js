import { Vec2 } from './vec2.js';

/**
 * Poisson disk sampling in an arbitrary region.
 * Uses the Bridson fast algorithm with a rejection grid.
 *
 * @param {number} width   - region width
 * @param {number} height  - region height
 * @param {number} radius  - minimum distance between samples
 * @param {Function} accept - (x, y) => boolean, filter to region shape
 * @param {Function} rand   - () => float in [0,1)
 * @param {number} k       - candidates per active point (default 30)
 */
export function poissonDisk(width, height, radius, accept, rand, k = 30) {
  const cellSize = radius / Math.SQRT2;
  const cols = Math.ceil(width  / cellSize);
  const rows = Math.ceil(height / cellSize);
  const grid = new Array(cols * rows).fill(null);

  const idx = (x, y) => Math.floor(x / cellSize) + Math.floor(y / cellSize) * cols;

  const samples = [];
  const active  = [];

  // Find a valid starting point
  let startX, startY, attempts = 0;
  do {
    startX = rand() * width;
    startY = rand() * height;
    attempts++;
  } while (!accept(startX, startY) && attempts < 200);

  if (!accept(startX, startY)) return samples;

  const first = new Vec2(startX, startY);
  samples.push(first);
  active.push(first);
  grid[idx(first.x, first.y)] = first;

  while (active.length > 0) {
    const ri = Math.floor(rand() * active.length);
    const point = active[ri];
    let found = false;

    for (let n = 0; n < k; n++) {
      const angle = rand() * 2 * Math.PI;
      const dist  = radius + rand() * radius;
      const nx = point.x + Math.cos(angle) * dist;
      const ny = point.y + Math.sin(angle) * dist;

      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (!accept(nx, ny)) continue;

      const ci = Math.floor(nx / cellSize);
      const ri2 = Math.floor(ny / cellSize);
      let ok = true;

      for (let dx = -2; dx <= 2 && ok; dx++) {
        for (let dy = -2; dy <= 2 && ok; dy++) {
          const nc = ci + dx, nr = ri2 + dy;
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          const neighbour = grid[nc + nr * cols];
          if (neighbour && (neighbour.x - nx) ** 2 + (neighbour.y - ny) ** 2 < radius * radius) {
            ok = false;
          }
        }
      }

      if (ok) {
        const p = new Vec2(nx, ny);
        samples.push(p);
        active.push(p);
        grid[ci + Math.floor(ny / cellSize) * cols] = p;
        found = true;
        break;
      }
    }

    if (!found) active.splice(ri, 1);
  }

  return samples;
}
