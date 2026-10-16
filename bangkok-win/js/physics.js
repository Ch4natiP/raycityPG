// Static obstacles (buildings, medians, pillars) as axis-aligned boxes in a spatial hash.
const CELL = 20;

export class Colliders {
  constructor() {
    this.cells = new Map();
    this.boxes = [];
  }

  key(cx, cz) { return cx * 100003 + cz; }

  add(x0, z0, x1, z1, tag = 'wall') {
    const b = { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), tag };
    this.boxes.push(b);
    for (let cx = Math.floor(b.x0 / CELL); cx <= Math.floor(b.x1 / CELL); cx++) {
      for (let cz = Math.floor(b.z0 / CELL); cz <= Math.floor(b.z1 / CELL); cz++) {
        const k = this.key(cx, cz);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(b);
      }
    }
    return b;
  }

  // A wall segment (building outlines from real maps are not axis-aligned).
  addSeg(x0, z0, x1, z1, tag = 'wall') {
    const sg = { seg: true, x0, z0, x1, z1, tag };
    for (let cx = Math.floor(Math.min(x0, x1) / CELL); cx <= Math.floor(Math.max(x0, x1) / CELL); cx++) {
      for (let cz = Math.floor(Math.min(z0, z1) / CELL); cz <= Math.floor(Math.max(z0, z1) / CELL); cz++) {
        const k = this.key(cx, cz);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(sg);
      }
    }
    return sg;
  }

  // A closed outline: its edges collide, and the camera treats the inside as solid.
  addPoly(pts, tag = 'wall') {
    for (let k = 0; k < pts.length; k++) { const a = pts[k]; const b = pts[(k + 1) % pts.length]; this.addSeg(a.x, a.z, b.x, b.z, tag); }
    let x0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let z1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
    const poly = { poly: pts, x0, z0, x1, z1, tag };
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const k = this.key(cx, cz);
        if (!this.polys) this.polys = new Map();
        if (!this.polys.has(k)) this.polys.set(k, []);
        this.polys.get(k).push(poly);
      }
    }
  }

  // Is the point inside any box (taller things only: walls block the camera)?
  inside(x, z) {
    const list = this.cells.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return false;
    for (const b of list) if (!b.seg && b.tag === 'wall' && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return true;
    const polys = this.polys?.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (polys) for (const p of polys) if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1 && pointInPoly(x, z, p.poly)) return true;
    return false;
  }

  // Push a circle out of every box it overlaps. Returns the deepest hit normal or null.
  resolve(p, r) {
    let hit = null;
    const seen = new Set();
    for (let cx = Math.floor((p.x - r) / CELL); cx <= Math.floor((p.x + r) / CELL); cx++) {
      for (let cz = Math.floor((p.z - r) / CELL); cz <= Math.floor((p.z + r) / CELL); cz++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (const b of list) {
          if (seen.has(b)) continue;
          seen.add(b);
          let qx; let qz;
          if (b.seg) { // closest point on the segment
            const dx = b.x1 - b.x0; const dz = b.z1 - b.z0;
            const f = Math.max(0, Math.min(1, ((p.x - b.x0) * dx + (p.z - b.z0) * dz) / (dx * dx + dz * dz || 1)));
            qx = b.x0 + dx * f; qz = b.z0 + dz * f;
          } else {
            qx = Math.max(b.x0, Math.min(p.x, b.x1));
            qz = Math.max(b.z0, Math.min(p.z, b.z1));
          }
          let dx = p.x - qx;
          let dz = p.z - qz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          let nx;
          let nz;
          let depth;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            nx = dx / d; nz = dz / d; depth = r - d;
          } else if (b.seg) { // exactly on the line: push out sideways
            const l = Math.hypot(b.x1 - b.x0, b.z1 - b.z0) || 1;
            nx = -(b.z1 - b.z0) / l; nz = (b.x1 - b.x0) / l; depth = r;
          } else {
            // Centre inside the box: leave by the nearest side.
            const opts = [[p.x - b.x0, -1, 0], [b.x1 - p.x, 1, 0], [p.z - b.z0, 0, -1], [b.z1 - p.z, 0, 1]];
            opts.sort((a, c) => a[0] - c[0]);
            [depth, nx, nz] = [opts[0][0] + r, opts[0][1], opts[0][2]];
          }
          p.x += nx * depth;
          p.z += nz * depth;
          if (!hit || depth > hit.depth) hit = { nx, nz, depth, tag: b.tag };
        }
      }
    }
    return hit;
  }
}

export function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]; const b = pts[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
