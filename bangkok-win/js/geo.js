import * as THREE from 'three';

// Collects many boxes / quads into one BufferGeometry (one draw call per material).
export class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }

  // Quad from 4 corners (counter-clockwise seen from the front), uv as [u0,v0,u1,v1].
  quad(a, b, c, d, color, uv = [0, 0, 1, 1]) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const base = this.pos.length / 3;
    const col = color instanceof THREE.Color ? color : new THREE.Color(color);
    const uvs = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
    [a, b, c, d].forEach((p, k) => {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(uvs[k][0], uvs[k][1]);
      this.col.push(col.r, col.g, col.b);
    });
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // Axis-aligned box. tile = [metres per u, metres per v] for walls; roof/bottom get a flat uv.
  // skip: set of faces to leave out ('top','bottom','n','s','e','w').
  box(x0, y0, z0, x1, y1, z1, color, { tile = null, skip = null, topColor = null, vOffset = 0, uOffset = 0 } = {}) {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const s = skip || {};
    const u0 = tile ? uOffset : 0;
    const wu = (len) => (tile ? uOffset + len / tile[0] : 1);
    const wv0 = tile ? vOffset : 0;
    const wv = (h) => (tile ? vOffset + h / tile[1] : 1);
    const h = y1 - y0;
    const flat = [0.02, 0.02, 0.03, 0.03];
    // south (+z)
    if (!s.s) this.quad(V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1), color, [u0, wv0, wu(x1 - x0), wv(h)]);
    // north (-z)
    if (!s.n) this.quad(V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0), color, [u0, wv0, wu(x1 - x0), wv(h)]);
    // east (+x)
    if (!s.e) this.quad(V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), color, [u0, wv0, wu(z1 - z0), wv(h)]);
    // west (-x)
    if (!s.w) this.quad(V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0), color, [u0, wv0, wu(z1 - z0), wv(h)]);
    if (!s.top) this.quad(V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0), topColor ?? color, tile ? flat : [0, 0, 1, 1]);
    if (s.bottom === false) this.quad(V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1), color, flat);
  }

  // Box rotated about Y around its centre (for things not on the grid).
  rotBox(cx, cy, cz, w, h, d, rotY, color) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(rotY);
    g.translate(cx, cy, cz);
    this.addGeometry(g, color);
  }

  addGeometry(g, color) {
    const geo = g.index ? g.toNonIndexed() : g;
    const p = geo.attributes.position;
    const n = geo.attributes.normal;
    const u = geo.attributes.uv;
    const col = color instanceof THREE.Color ? color : new THREE.Color(color);
    const base = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.uv.push(u ? u.getX(i) * 0.01 : 0, u ? u.getY(i) * 0.01 : 0);
      this.col.push(col.r, col.g, col.b);
      this.idx.push(base + i);
    }
  }

  get empty() { return this.pos.length === 0; }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }

  mesh(material, { cast = true, receive = true } = {}) {
    const m = new THREE.Mesh(this.build(), material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}
