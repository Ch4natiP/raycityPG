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

  // Is the point inside any box (taller things only: walls block the camera)?
  inside(x, z) {
    const list = this.cells.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return false;
    for (const b of list) if (b.tag === 'wall' && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return true;
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
          const qx = Math.max(b.x0, Math.min(p.x, b.x1));
          const qz = Math.max(b.z0, Math.min(p.z, b.z1));
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
