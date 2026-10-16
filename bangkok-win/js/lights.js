import * as THREE from 'three';
import { CURB, rng } from './config.js';

// Traffic signals at every signalised junction of the road graph. Roads into a junction are split
// into two phases by direction (the "north-south" and the "east-west" of that junction) that get
// green in turn; each junction starts at its own point in the cycle.
export const CYCLE = { green: 11, yellow: 3, allRed: 1.5 };
const PERIOD = 2 * (CYCLE.green + CYCLE.yellow + CYCLE.allRed);

export class TrafficLights {
  constructor(scene, net, colliders = null, { kerb = CURB } = {}) {
    const R = rng(4242);
    this.net = net;
    this.t = 0;
    this.heads = [];
    for (const n of net.nodes) {
      if (!n.signal || n.edges.length < 3) { n.signal = false; continue; }
      n.offset = R() * PERIOD;
      n.phase = new Map();
      const axis = net.awayDir(n, net.edges[n.edges[0]]);
      for (const id of n.edges) {
        const e = net.edges[id];
        const d = net.awayDir(n, e);
        n.phase.set(id, Math.abs(d.x * axis.x + d.z * axis.z) > 0.707 ? 0 : 1);
        // Only roads that bring traffic into the junction get a signal: on the left kerb
        // (Thailand drives on the left) just before the stop line, facing the oncoming traffic.
        if (e.oneway && e.a === n.id) continue;
        const stop = n.stop.get(id);
        const lx = -d.z; const lz = d.x; // left of a car arriving along -d
        this.heads.push({ node: n, edge: id, x: n.x + d.x * (stop + 1.2) + lx * (e.width / 2 + 0.6), z: n.z + d.z * (stop + 1.2) + lz * (e.width / 2 + 0.6), rot: Math.atan2(d.x, d.z) });
      }
    }

    const count = Math.max(1, this.heads.length);
    const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6).translate(0, 2.1, 0), new THREE.MeshLambertMaterial({ color: 0x555b60 }), count);
    const box = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 1.15, 0.3).translate(0, 4.3, 0), new THREE.MeshLambertMaterial({ color: 0x1d1f22 }), count);
    const lens = new THREE.SphereGeometry(0.13, 10, 8);
    this.lamps = ['r', 'y', 'g'].map((c, k) => {
      const m = new THREE.InstancedMesh(lens, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), count);
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
      m4.compose(p.set(h.x, kerb, h.z), q, one); post.setMatrixAt(k, m4); box.setMatrixAt(k, m4);
      for (const l of this.lamps) {
        // lens sits on the face of the box that looks at oncoming traffic
        m4.compose(p.set(h.x + Math.sin(h.rot) * 0.16, kerb + l.userData.dy, h.z + Math.cos(h.rot) * 0.16), q, one);
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

  // 'g' | 'y' | 'r' for phase 0 / 1 of a junction
  state(node, phase) {
    if (!node.signal) return 'g';
    const t = (this.t + node.offset) % PERIOD;
    const local = phase === 0 ? t : (t + PERIOD / 2) % PERIOD;
    if (local < CYCLE.green) return 'g';
    if (local < CYCLE.green + CYCLE.yellow) return 'y';
    return 'r';
  }

  // for traffic arriving at `node` along edge `edgeId`
  stateFor(node, edgeId) { return node.signal ? this.state(node, node.phase.get(edgeId)) : 'g'; }

  update(dt) {
    this.t += dt;
    this.refreshTimer -= dt;
    if (this.refreshTimer <= 0) { this.refreshTimer = 0.2; this.refresh(); }
  }

  refresh() {
    const [r, y, g] = this.lamps;
    this.heads.forEach((h, k) => {
      const s = this.stateFor(h.node, h.edge);
      r.setColorAt(k, this.colors.r[s === 'r' ? 1 : 0]);
      y.setColorAt(k, this.colors.y[s === 'y' ? 1 : 0]);
      g.setColorAt(k, this.colors.g[s === 'g' ? 1 : 0]);
    });
    for (const l of this.lamps) if (l.instanceColor) l.instanceColor.needsUpdate = true;
  }
}
