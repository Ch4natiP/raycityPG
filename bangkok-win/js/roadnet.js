// A road network as a graph: junctions (nodes) joined by roads (edges) that can bend.
// Traffic, signals, routing, rivals and the minimap all work on this, so the same game runs on the
// generated grid city and on real streets imported from OpenStreetMap.
//
// Edge: { id, a, b, pts: [{x,z}], len, width, lanes: [left offsets for one direction], oneway, main, name, median }
//   oneway: 0 both ways, 1 only a→b.  Travel direction "fwd" means a→b.
// Node: { id, x, z, edges: [edge ids], signal, stop: Map(edgeId → distance from the node centre to the stop line) }

const CELL = 40;

export class RoadNet {
  constructor() {
    this.nodes = [];
    this.edges = [];
    this.cells = new Map();
  }

  addNode(x, z, extra = {}) {
    const n = { id: this.nodes.length, x, z, edges: [], signal: false, ...extra };
    this.nodes.push(n);
    return n;
  }

  addEdge(a, b, pts, { width = 12, lanes = [3.2], oneway = 0, main = false, name = '', median = 0 } = {}) {
    const e = { id: this.edges.length, a: a.id, b: b.id, pts, width, lanes, oneway, main, name, median };
    this.edges.push(e);
    a.edges.push(e.id);
    b.edges.push(e.id);
    return e;
  }

  // Lengths, junction stop lines and a spatial index. Call once after building.
  finalize() {
    for (const e of this.edges) {
      e.cum = [0];
      for (let k = 1; k < e.pts.length; k++) e.cum.push(e.cum[k - 1] + Math.hypot(e.pts[k].x - e.pts[k - 1].x, e.pts[k].z - e.pts[k - 1].z));
      e.len = e.cum[e.cum.length - 1];
      for (let k = 1; k < e.pts.length; k++) this.indexSeg(e, k - 1);
    }
    for (const n of this.nodes) {
      n.stop = new Map();
      for (const id of n.edges) {
        const e = this.edges[id];
        const dirIn = this.awayDir(n, e);
        // the stop line sits outside the roads that cross this one
        let d = 0;
        for (const id2 of n.edges) {
          if (id2 === id) continue;
          const o = this.awayDir(n, this.edges[id2]);
          const cos = Math.abs(dirIn.x * o.x + dirIn.z * o.z);
          if (cos < 0.75) d = Math.max(d, this.edges[id2].width / 2);
        }
        n.stop.set(id, d || 2);
      }
      n.r = Math.max(2, ...n.stop.values());
    }
  }

  indexSeg(e, k) {
    const p = e.pts[k]; const q = e.pts[k + 1];
    for (let cx = Math.floor(Math.min(p.x, q.x) / CELL); cx <= Math.floor(Math.max(p.x, q.x) / CELL); cx++) {
      for (let cz = Math.floor(Math.min(p.z, q.z) / CELL); cz <= Math.floor(Math.max(p.z, q.z) / CELL); cz++) {
        const key = cx * 100003 + cz;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push([e.id, k]);
      }
    }
  }

  other(e, nodeId) { return e.a === nodeId ? e.b : e.a; }

  // Unit vector leaving node n along edge e.
  awayDir(n, e) {
    const pts = e.pts;
    const [p, q] = e.a === n.id ? [pts[0], pts[Math.min(1, pts.length - 1)]] : [pts[pts.length - 1], pts[Math.max(0, pts.length - 2)]];
    const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    return { x: (q.x - p.x) / l, z: (q.z - p.z) / l };
  }

  // Point and tangent at distance s along e in the given travel direction; s may run past either end.
  at(e, fwd, s) {
    const L = e.len;
    const t = fwd ? s : L - s;
    const pts = e.pts;
    let k = 0;
    if (t <= 0) k = 0;
    else if (t >= L) k = pts.length - 2;
    else { while (k < pts.length - 2 && e.cum[k + 1] < t) k++; }
    const p = pts[k]; const q = pts[k + 1];
    const seg = e.cum[k + 1] - e.cum[k] || 1;
    const f = (t - e.cum[k]) / seg;
    let tx = (q.x - p.x) / seg; let tz = (q.z - p.z) / seg;
    const x = p.x + (q.x - p.x) * f; const z = p.z + (q.z - p.z) * f;
    if (!fwd) { tx = -tx; tz = -tz; }
    return { x, z, tx, tz };
  }

  // Closest point on any road: { e, t (distance from a), x, z, dist, tx, tz (a→b tangent) }
  nearest(x, z, maxR = 200) {
    let best = null;
    for (let r = CELL; r <= maxR + CELL && !best; r += CELL * 2) {
      for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
        for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
          const list = this.cells.get(cx * 100003 + cz);
          if (!list) continue;
          for (const [id, k] of list) {
            const e = this.edges[id];
            const p = e.pts[k]; const q = e.pts[k + 1];
            const dx = q.x - p.x; const dz = q.z - p.z;
            const l2 = dx * dx + dz * dz || 1;
            const f = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / l2));
            const px = p.x + dx * f; const pz = p.z + dz * f;
            const d = Math.hypot(x - px, z - pz);
            if (!best || d < best.dist) { const l = Math.sqrt(l2); best = { e, t: e.cum[k] + f * l, x: px, z: pz, dist: d, tx: dx / l, tz: dz / l }; }
          }
        }
      }
    }
    return best;
  }

  // The junction whose box the point is inside, if any.
  nodeAt(x, z) {
    const near = this.nearest(x, z, 60);
    if (!near) return null;
    for (const id of [near.e.a, near.e.b]) {
      const n = this.nodes[id];
      if (n.edges.length >= 3 && Math.hypot(x - n.x, z - n.z) < n.r) return n;
    }
    return null;
  }

  canTravel(e, fromNodeId) { return !e.oneway || e.a === fromNodeId; }

  // Shortest drive from one point to another along the roads.
  // Returns { pts: [[x,z], ...], len, main: [bool per segment] }.
  route(ax, az, bx, bz) {
    const A = this.nearest(ax, az);
    const B = this.nearest(bx, bz);
    if (!A || !B) return { pts: [[ax, az], [bx, bz]], len: Math.hypot(bx - ax, bz - az), main: [false, false] };
    if (A.e === B.e) {
      const m = A.e.main;
      return this.pack([[ax, az, m], [A.x, A.z, m], ...this.between(A.e, A.t, B.t).map((p) => [...p, m]), [B.x, B.z, m], [bx, bz, m]]);
    }
    // Dijkstra over junctions, seeded from both ends of the start road
    const N = this.nodes.length;
    const dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const via = new Int32Array(N).fill(-1);
    const open = [];
    const push = (id, d, p, e) => { if (d < dist[id]) { dist[id] = d; prev[id] = p; via[id] = e; open.push([d, id]); } };
    push(A.e.a, A.t, -2, A.e.id);
    if (!A.e.oneway) push(A.e.b, A.e.len - A.t, -2, A.e.id);
    else push(A.e.b, A.e.len - A.t, -2, A.e.id); // a rider can always walk the bike: keep both ends reachable
    const targets = [[B.e.a, B.t], [B.e.b, B.e.len - B.t]];
    let best = Infinity; let bestEnd = -1;
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
      const [d, id] = open[bi];
      open[bi] = open[open.length - 1]; open.pop();
      if (d > dist[id] || d > best) continue;
      for (const [tid, extra] of targets) if (tid === id && d + extra < best) { best = d + extra; bestEnd = id; }
      for (const eid of this.nodes[id].edges) {
        const e = this.edges[eid];
        if (!this.canTravel(e, id)) continue;
        push(this.other(e, id), d + e.len, id, eid);
      }
    }
    if (bestEnd < 0) return { pts: [[ax, az], [bx, bz]], len: Math.hypot(bx - ax, bz - az), main: [false, false] };
    // walk back
    const chain = [];
    for (let id = bestEnd; id >= 0 && prev[id] !== -2; id = prev[id]) chain.unshift([via[id], prev[id], id]);
    const startNode = chain.length ? chain[0][1] : bestEnd;
    const pts = [[ax, az, A.e.main], [A.x, A.z, A.e.main]];
    const add = (list, main) => { for (const p of list) pts.push([p[0], p[1], main]); };
    add(this.between(A.e, A.t, startNode === A.e.a ? 0 : A.e.len), A.e.main);
    for (const [eid, from] of chain) {
      const e = this.edges[eid];
      add(this.between(e, from === e.a ? 0 : e.len, from === e.a ? e.len : 0), e.main);
    }
    add(this.between(B.e, bestEnd === B.e.a ? 0 : B.e.len, B.t), B.e.main);
    pts.push([B.x, B.z, B.e.main], [bx, bz, B.e.main]);
    return this.pack(pts);
  }

  // Polyline points of e strictly between distances t0 and t1 (either order), as [x,z].
  between(e, t0, t1) {
    const out = [];
    const lo = Math.min(t0, t1); const hi = Math.max(t0, t1);
    const idx = [];
    for (let k = 0; k < e.pts.length; k++) if (e.cum[k] > lo + 0.01 && e.cum[k] < hi - 0.01) idx.push(k);
    if (t1 < t0) idx.reverse();
    const from = this.at(e, true, t0); const to = this.at(e, true, t1);
    out.push([from.x, from.z]);
    for (const k of idx) out.push([e.pts[k].x, e.pts[k].z]);
    out.push([to.x, to.z]);
    return out;
  }

  // [x, z, main] points → { pts: [[x,z]], len, main: [bool per point: is the road leading to it a main road] }
  pack(pts) {
    const clean = [pts[0]];
    for (const p of pts.slice(1)) { const q = clean[clean.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.5) clean.push(p); else q[2] = q[2] || p[2]; }
    let len = 0;
    for (let k = 1; k < clean.length; k++) len += Math.hypot(clean[k][0] - clean[k - 1][0], clean[k][1] - clean[k - 1][1]);
    return { pts: clean.map((p) => [p[0], p[1]]), len, main: clean.map((p) => !!p[2]) };
  }

  // Name of the road (or junction) at a point.
  placeName(x, z) {
    const n = this.nodeAt(x, z);
    if (n) {
      const names = [...new Set(n.edges.map((id) => this.edges[id].name).filter(Boolean))];
      if (names.length >= 2) return `แยก ${names[0].replace('ถ.', '').replace('ถนน', '')} × ${names[1].replace('ถ.', '').replace('ถนน', '')}`;
    }
    const near = this.nearest(x, z, 40);
    if (!near) return '';
    if (near.dist > near.e.width / 2 + 1) return '';
    return near.e.name || 'ซอย';
  }
}
