import * as THREE from 'three';
import { N, nodeX, roadW, CURB, rng } from './config.js';

// Traffic signals at every intersection. North-south and east-west get green in turn;
// each junction starts at its own point in the cycle so the whole city does not switch at once.
export const CYCLE = { green: 11, yellow: 3, allRed: 1.5 };
const PERIOD = 2 * (CYCLE.green + CYCLE.yellow + CYCLE.allRed);

export class TrafficLights {
  constructor(scene, colliders = null) {
    const R = rng(4242);
    this.t = 0;
    this.offset = [];
    for (let i = 0; i <= N; i++) { this.offset.push([]); for (let j = 0; j <= N; j++) this.offset[i].push(R() * PERIOD); }

    // One signal per approach, on the left kerb just before the junction (Thailand drives on the left),
    // facing the traffic that is coming.
    this.heads = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = nodeX(i); const z = nodeX(j);
      const hx = roadW(i) / 2; const hz = roadW(j) / 2;
      if (j > 0) this.heads.push({ i, j, axis: 'ns', x: x + hx + 0.6, z: z - hz - 1.2, rot: Math.PI });   // coming from the north, heading south
      if (j < N) this.heads.push({ i, j, axis: 'ns', x: x - hx - 0.6, z: z + hz + 1.2, rot: 0 });         // from the south, heading north
      if (i < N) this.heads.push({ i, j, axis: 'ew', x: x + hx + 1.2, z: z + hz + 0.6, rot: Math.PI / 2 }); // from the east, heading west
      if (i > 0) this.heads.push({ i, j, axis: 'ew', x: x - hx - 1.2, z: z - hz - 0.6, rot: -Math.PI / 2 }); // from the west, heading east
    }
    const n = this.heads.length;
    const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6).translate(0, 2.1, 0), new THREE.MeshLambertMaterial({ color: 0x555b60 }), n);
    const box = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 1.15, 0.3).translate(0, 4.3, 0), new THREE.MeshLambertMaterial({ color: 0x1d1f22 }), n);
    const lens = new THREE.SphereGeometry(0.13, 10, 8);
    this.lamps = ['r', 'y', 'g'].map((c, k) => {
      const m = new THREE.InstancedMesh(lens, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n);
      m.userData.dy = 4.68 - k * 0.37;
      return m;
    });
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    this.heads.forEach((h, k) => {
      q.setFromAxisAngle(up, h.rot);
      m4.compose(p.set(h.x, CURB, h.z), q, one); post.setMatrixAt(k, m4); box.setMatrixAt(k, m4);
      for (const l of this.lamps) {
        // lens sits on the face of the box that looks at oncoming traffic
        m4.compose(p.set(h.x + Math.sin(h.rot) * 0.16, CURB + l.userData.dy, h.z + Math.cos(h.rot) * 0.16), q, one);
        l.setMatrixAt(k, m4);
      }
    });
    if (colliders) for (const h of this.heads) colliders.add(h.x - 0.12, h.z - 0.12, h.x + 0.12, h.z + 0.12, 'pole');
    post.castShadow = true;
    scene.add(post, box, ...this.lamps);
    this.colors = { r: [new THREE.Color(0x3a0b0b), new THREE.Color(4, 0.35, 0.25)], y: [new THREE.Color(0x3a2a08), new THREE.Color(4, 2.6, 0.3)], g: [new THREE.Color(0x0b2a12), new THREE.Color(0.3, 3.5, 1.2)] };
    this.refreshTimer = 0;
    this.refresh();
  }

  // 'g' | 'y' | 'r' for traffic moving along `axis` ('ns' or 'ew') through junction (i, j)
  state(i, j, axis) {
    if (i < 0 || j < 0 || i > N || j > N) return 'g';
    const t = (this.t + this.offset[i][j]) % PERIOD;
    const half = PERIOD / 2;
    const local = axis === 'ns' ? t : (t + half) % PERIOD;
    if (local < CYCLE.green) return 'g';
    if (local < CYCLE.green + CYCLE.yellow) return 'y';
    return 'r';
  }

  update(dt) {
    this.t += dt;
    this.refreshTimer -= dt;
    if (this.refreshTimer <= 0) { this.refreshTimer = 0.2; this.refresh(); }
  }

  refresh() {
    const [r, y, g] = this.lamps;
    this.heads.forEach((h, k) => {
      const s = this.state(h.i, h.j, h.axis);
      r.setColorAt(k, this.colors.r[s === 'r' ? 1 : 0]);
      y.setColorAt(k, this.colors.y[s === 'y' ? 1 : 0]);
      g.setColorAt(k, this.colors.g[s === 'g' ? 1 : 0]);
    });
    for (const l of this.lamps) l.instanceColor.needsUpdate = true;
  }
}
