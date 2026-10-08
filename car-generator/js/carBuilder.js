// Procedural car model builder.
// Units: meters. Y up, the car faces +Z, origin = ground point midway along the body.
// Left side of the car is +X, right side is -X.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Material slots used by the body and cabin meshes (geometry groups).
const SLOT = { PAINT: 0, STRIPE: 1, TRIM: 2, GLASS: 3 };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

// Monotone cubic (Fritsch–Carlson) interpolation: smooth, no overshoot.
function monotone(points) {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// Make the cabin fractions valid regardless of what the sliders say.
function normalizeParams(src) {
  const p = { ...src };
  p.windshieldBase = clamp(p.windshieldBase, 0.1, 0.8);
  p.roofFront = clamp(p.roofFront, p.windshieldBase + 0.04, 0.9);
  p.roofRear = clamp(p.roofRear, p.roofFront + 0.04, 0.94);
  p.rearWindowBase = clamp(p.rearWindowBase, p.roofRear + 0.03, 0.965);
  p.frontOverhang = clamp(p.frontOverhang, p.wheelRadius * 1.3, p.length * 0.4);
  p.rearOverhang = clamp(p.rearOverhang, p.wheelRadius * 1.3, p.length * 0.4);
  p.roofHeight = Math.max(p.roofHeight, p.beltHeight + 0.15);
  return p;
}

// All the shape functions of the body, parameterized by t (0 = nose, 1 = tail).
function makeProfile(p) {
  const L = p.length;
  const W = p.width;
  const tW = p.windshieldBase;
  const tR = p.rearWindowBase;
  const top = monotone([
    [0, p.noseHeight - 0.035],
    [0.025, p.noseHeight],
    [tW, p.hoodHeight],
    [(tW + tR) / 2, p.beltHeight],
    [tR, p.trunkHeight],
    [0.975, p.tailHeight],
    [1, p.tailHeight - 0.035],
  ]);
  const zOf = (t) => L / 2 - t * L;
  const R = p.wheelRadius;
  const axles = [L / 2 - p.frontOverhang, -L / 2 + p.rearOverhang];
  const archR = R * p.archScale + 0.02;
  const fenderR = archR + 0.06;
  const trackHalf = W / 2 - p.wheelInset - p.wheelWidth / 2;
  const innerX = trackHalf - p.wheelWidth / 2 - 0.05;

  const nearestAxleDz = (t) => {
    const z = zOf(t);
    return Math.min(Math.abs(z - axles[0]), Math.abs(z - axles[1]));
  };
  const halfW = (t) => {
    const d = Math.min(t, 1 - t) * L;
    const r = p.cornerRadius;
    let f = 1;
    if (d < r) {
      const u = (r - d) / r;
      f = 1 - p.endTaper + p.endTaper * Math.sqrt(1 - u * u);
    }
    return (W / 2) * f;
  };
  const bottom = (t) => {
    let y = p.clearance;
    const fz = t * L;
    const rz = (1 - t) * L;
    const a = 0.35;
    if (fz < a) y += 0.12 * (1 - fz / a) ** 2;
    if (rz < a) y += 0.1 * (1 - rz / a) ** 2;
    return y;
  };
  const arch = (t) => {
    const dz = nearestAxleDz(t);
    return dz < archR ? R + Math.sqrt(archR * archR - dz * dz) : -Infinity;
  };
  // Fender bulges rise above the hood when the wheels are taller than the body.
  const sideTop = (t) => {
    const dz = nearestAxleDz(t);
    const f = dz < fenderR ? R + Math.sqrt(fenderR * fenderR - dz * dz) + 0.03 : -Infinity;
    return Math.max(top(t), f);
  };
  const centerTop = (t) => top(t) + p.crown;
  const edgeRadius = (t) => Math.max(0.01, Math.min(p.edgeRadius, (sideTop(t) - bottom(t)) * 0.3));
  const shoulderX = (t) => halfW(t) * 0.985 - edgeRadius(t);
  // Height of the body's upper surface at lateral offset x.
  const surfaceY = (t, x) => {
    const cx = shoulderX(t);
    const ys = sideTop(t);
    if (Math.abs(x) >= cx) return ys;
    const yc = centerTop(t);
    return yc + (ys - yc) * (x / cx) ** 2;
  };

  return {
    L, W, R, zOf, top, halfW, bottom, arch, sideTop, centerTop, edgeRadius,
    shoulderX, surfaceY, axles, archR, trackHalf, innerX,
  };
}

// Stripe edges on a top surface whose rounded shoulder starts at |x| = cx.
function stripeEdges(p, cx) {
  if (p.stripeStyle === 'center') {
    const so = Math.min(p.stripeWidth / 2, cx * 0.8);
    return { on: true, so, si: 0 };
  }
  if (p.stripeStyle === 'double') {
    const si = Math.min(0.05, cx * 0.2);
    const so = Math.min(si + p.stripeWidth / 2, cx * 0.8);
    return { on: true, so, si };
  }
  return { on: false, so: cx * 0.5, si: cx * 0.25 };
}

// Builds an indexed loft from rings (each ring = array of [x, y]) at z positions.
function loft({ rings, zs, closed, segMaterial, capFront, capRear, capMaterial }) {
  const n = rings[0].length;
  const pos = [];
  for (let i = 0; i < rings.length; i++) {
    for (const [x, y] of rings[i]) pos.push(x, y, zs[i]);
  }
  const byMat = [[], [], [], []];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < rings.length - 1; i++) {
    const tm = (i + 0.5) / (rings.length - 1);
    for (let k = 0; k < segs; k++) {
      const k2 = (k + 1) % n;
      const a = i * n + k;
      const b = i * n + k2;
      const c = (i + 1) * n + k2;
      const d = (i + 1) * n + k;
      const m = segMaterial(i, k, tm);
      byMat[m].push(a, d, b, b, d, c);
    }
  }
  // End caps get their own vertices so the edge stays crisp.
  const addCap = (ringIndex, front) => {
    const ring = rings[ringIndex];
    const z = zs[ringIndex];
    let cx = 0;
    let cy = 0;
    for (const [x, y] of ring) { cx += x; cy += y; }
    const base = pos.length / 3;
    pos.push(cx / n, cy / n, z);
    for (const [x, y] of ring) pos.push(x, y, z);
    for (let k = 0; k < n; k++) {
      const a = base + 1 + k;
      const b = base + 1 + ((k + 1) % n);
      if (front) byMat[capMaterial].push(base, a, b);
      else byMat[capMaterial].push(base, b, a);
    }
  };
  if (capFront) addCap(0, true);
  if (capRear) addCap(rings.length - 1, false);

  const index = [];
  const geo = new THREE.BufferGeometry();
  for (let m = 0; m < byMat.length; m++) {
    if (!byMat[m].length) continue;
    geo.addGroup(index.length, byMat[m].length, m);
    index.push(...byMat[m]);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  // Simple planar UVs (side projection) so engines get a valid UV set.
  const uv = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i + 2], pos[i + 1]);
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

// Closed ring = half ring (bottom center → top center at +x) plus its mirror.
function mirrorClosed(half) {
  const ring = half.slice();
  for (let i = half.length - 2; i >= 1; i--) ring.push([-half[i][0], half[i][1]]);
  return ring;
}
// Open ring = half ring (side bottom → top center at +x) plus its mirror, ends open.
function mirrorOpen(half) {
  const ring = half.slice();
  for (let i = half.length - 2; i >= 0; i--) ring.push([-half[i][0], half[i][1]]);
  return ring;
}

function sampleT(p, prof, n) {
  const ts = [];
  for (let i = 0; i <= n; i++) ts.push(i / n);
  for (const e of [0.004, 0.01, 0.018]) ts.push(e, 1 - e);
  for (const z of prof.axles) {
    const tc = (prof.L / 2 - z) / prof.L;
    for (const f of [-1.002, -0.998, -0.95, -0.85, -0.7, -0.5, -0.25, 0, 0.25, 0.5, 0.7, 0.85, 0.95, 0.998, 1.002]) {
      ts.push(tc + (f * prof.archR) / prof.L);
    }
    const fr = (prof.archR + 0.06) / prof.L;
    ts.push(tc - fr * 0.999, tc - fr * 1.001, tc + fr * 0.999, tc + fr * 1.001);
  }
  ts.sort((a, b) => a - b);
  const out = [];
  for (const t of ts) {
    if (t < 0 || t > 1) continue;
    if (!out.length || t - out[out.length - 1] > 1e-4) out.push(t);
  }
  return out;
}

function buildBody(p, prof) {
  const detail = { low: 26, medium: 56, high: 110 }[p.detail] || 56;
  const ts = sampleT(p, prof, detail);
  const rings = [];
  const zs = [];
  let stripeSeg = -1;
  for (const t of ts) {
    const hb = prof.halfW(t);
    const yb = prof.bottom(t);
    const ys = prof.sideTop(t);
    const yc = prof.centerTop(t);
    const rad = prof.edgeRadius(t);
    let ya = Math.max(yb, prof.arch(t));
    ya = Math.max(yb, Math.min(ya, ys - rad - 0.04));
    const ix = Math.min(prof.innerX, hb * 0.85);
    const xs = hb * 0.985;
    const cx = prof.shoulderX(t);
    const sideH = ys - rad - ya;
    const half = [
      [0, yb], [ix, yb], [ix, ya], [hb * 0.97, ya],
      [hb * 0.995, ya + sideH * 0.4], [hb, ya + sideH * 0.75], [xs, ys - rad],
    ];
    for (const a of [Math.PI / 6, Math.PI / 3, Math.PI / 2]) {
      half.push([cx + rad * Math.cos(a), ys - rad + rad * Math.sin(a)]);
    }
    const st = stripeEdges(p, cx);
    const topY = (x) => yc + (ys - yc) * (x / cx) ** 2;
    for (const x of [cx - (cx - st.so) / 3, cx - (2 * (cx - st.so)) / 3, st.so, st.si, 0]) {
      half.push([x, topY(x)]);
    }
    stripeSeg = st.on ? half.length - 3 : -1;
    rings.push(mirrorClosed(half));
    zs.push(prof.zOf(t));
  }
  const H = rings[0].length / 2 + 1;
  const N = rings[0].length;
  const halfMat = (s) => {
    if (s <= 2) return SLOT.TRIM; // underbody, wheel well wall and ceiling
    if (s === stripeSeg) return SLOT.STRIPE;
    return SLOT.PAINT;
  };
  return loft({
    rings, zs, closed: true,
    segMaterial: (i, k) => halfMat(k < H - 1 ? k : N - 1 - k),
    capFront: true, capRear: true, capMaterial: SLOT.PAINT,
  });
}

function buildCabin(p, prof) {
  const tW = p.windshieldBase;
  const tRF = p.roofFront;
  const tRR = p.roofRear;
  const tR = p.rearWindowBase;
  const tB = lerp(tRF, tRR, 0.45);
  const bW = 0.06 / prof.L; // half width of the B pillar in t
  const detail = { low: 14, medium: 30, high: 56 }[p.detail] || 30;
  const ts = [];
  for (let i = 0; i <= detail; i++) ts.push(lerp(tW, tR, i / detail));
  ts.push(tRF, tRR, tB - bW, tB + bW);
  ts.sort((a, b) => a - b);
  const tl = [];
  for (const t of ts) if (!tl.length || t - tl[tl.length - 1] > 1e-4) tl.push(t);

  const rings = [];
  const zs = [];
  let stripeSeg = -1;
  for (const t of tl) {
    const hb = prof.halfW(t);
    const wb = Math.min(hb * 0.9, prof.shoulderX(t));
    const wt = Math.min(hb * p.cabinTopWidth, wb);
    const base = prof.surfaceY(t, wb) - 0.015;
    let roofY;
    if (t <= tRF) {
      const s = (t - tW) / (tRF - tW);
      roofY = base + (p.roofHeight - base) * Math.sin((s * Math.PI) / 2);
    } else if (t <= tRR) {
      const s = (t - tRF) / (tRR - tRF);
      roofY = p.roofHeight + 0.025 * Math.sin(Math.PI * s);
    } else {
      const s = (t - tRR) / (tR - tRR);
      roofY = base + (p.roofHeight - base) * Math.cos((s * Math.PI) / 2);
    }
    roofY = Math.max(roofY, base);
    const h = roofY - base;
    const radc = Math.min(0.09, h * 0.45, wt * 0.5);
    const half = [];
    const sideTopY = roofY - radc;
    for (const s of [0, 1 / 3, 2 / 3, 1]) {
      half.push([lerp(wb, wt, s) + 0.02 * Math.sin(Math.PI * s), lerp(base, sideTopY, s)]);
    }
    const ccx = wt - radc;
    for (const a of [Math.PI / 4, Math.PI / 2]) {
      half.push([ccx + radc * Math.cos(a), sideTopY + radc * Math.sin(a)]);
    }
    const st = stripeEdges(p, ccx);
    for (const x of [(ccx + st.so) / 2, st.so, st.si, 0]) {
      half.push([x, roofY + 0.015 * (1 - (x / Math.max(ccx, 1e-3)) ** 2)]);
    }
    stripeSeg = st.on ? half.length - 3 : -1;
    rings.push(mirrorOpen(half));
    zs.push(prof.zOf(t));
  }
  const H = (rings[0].length + 1) / 2;
  const N = rings[0].length;
  return loft({
    rings, zs, closed: false,
    segMaterial: (i, k) => {
      const s = k < H - 1 ? k : N - 2 - k;
      const tm = (tl[i] + tl[i + 1]) / 2;
      const region = tm < tRF ? 'front' : tm < tRR ? 'roof' : 'rear';
      if (s <= 2) {
        if (region === 'roof' && Math.abs(tm - tB) < bW) return SLOT.TRIM;
        return SLOT.GLASS;
      }
      if (s <= 4) return SLOT.PAINT; // A / C pillars and roof edges
      if (region !== 'roof') return SLOT.GLASS;
      return s === stripeSeg ? SLOT.STRIPE : SLOT.PAINT;
    },
  });
}

// --- Wheels ------------------------------------------------------------------

function toXAxis(geo) {
  // Built-in geometries spin around Y; turn them so the axle is the X axis.
  return geo.rotateZ(-Math.PI / 2);
}

function buildWheelGeometries(p) {
  const seg = { low: 14, medium: 28, high: 48 }[p.detail] || 28;
  const R = p.wheelRadius;
  const w = p.wheelWidth;
  const rimR = R * p.rimRatio;
  const b = Math.min(0.04, w * 0.2, (R - rimR) * 0.4);
  const tireProfile = [
    [rimR, -w / 2 + 0.01], [R - b, -w / 2], [R - b * 0.3, -w / 2 + b * 0.3],
    [R, -w / 2 + b], [R, w / 2 - b], [R - b * 0.3, w / 2 - b * 0.3], [R - b, w / 2], [rimR, w / 2 - 0.01],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tire = toXAxis(new THREE.LatheGeometry(tireProfile, seg));

  const face = w / 2 - 0.02; // x of the rim face
  const rimParts = [];
  const lip = new THREE.LatheGeometry([
    new THREE.Vector2(rimR * 0.9, face - 0.01), new THREE.Vector2(rimR * 0.97, face + 0.012),
    new THREE.Vector2(rimR * 1.01, face),
  ], seg);
  rimParts.push(toXAxis(lip));
  const hubR = rimR * 0.22;
  rimParts.push(toXAxis(new THREE.CylinderGeometry(hubR, hubR * 1.1, 0.05, 12)).translate(face - 0.01, 0, 0));
  const spokeLen = rimR * 0.92 - hubR * 0.8;
  const addSpoke = (angle, width, offset = 0) => {
    const g = new THREE.BoxGeometry(0.03, spokeLen, width);
    g.translate(face - 0.015, hubR * 0.8 + spokeLen / 2, offset);
    g.rotateX(angle);
    rimParts.push(g);
  };
  const n = Math.round(p.spokeCount);
  const sw = Math.max(0.015, (rimR * 1.6) / n * 0.45);
  if (p.rimStyle === 'disc') {
    rimParts.push(toXAxis(new THREE.CylinderGeometry(rimR * 0.92, rimR * 0.92, 0.02, seg)).translate(face - 0.02, 0, 0));
  } else if (p.rimStyle === 'split') {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      addSpoke(a, sw * 0.45, sw * 0.4);
      addSpoke(a, sw * 0.45, -sw * 0.4);
    }
  } else if (p.rimStyle === 'multi') {
    for (let i = 0; i < n * 2; i++) addSpoke((i / (n * 2)) * Math.PI * 2, sw * 0.4);
  } else {
    for (let i = 0; i < n; i++) addSpoke((i / n) * Math.PI * 2, sw);
  }
  const rim = mergeGeometries(rimParts, false);

  const dark = toXAxis(new THREE.CylinderGeometry(rimR, rimR, 0.02, seg)).translate(-w * 0.15, 0, 0);
  const brake = toXAxis(new THREE.CylinderGeometry(rimR * 0.78, rimR * 0.78, 0.025, seg)).translate(face - 0.09, 0, 0);
  const caliper = new THREE.BoxGeometry(0.05, rimR * 0.45, rimR * 0.3)
    .translate(face - 0.075, 0, -rimR * 0.62);
  return { tire, rim, dark, brake, caliper };
}

function buildWheel(name, geos, mats, mirrored) {
  const g = (geo) => (mirrored ? geo.clone().rotateY(Math.PI) : geo);
  const wheel = new THREE.Group();
  wheel.name = name;
  const spin = new THREE.Group();
  spin.name = `${name}_Spin`;
  wheel.add(spin);
  const mk = (geo, mat, partName, parent) => {
    const m = new THREE.Mesh(g(geo), mat);
    m.name = `${name}_${partName}`;
    m.castShadow = true;
    parent.add(m);
  };
  mk(geos.tire, mats.tire, 'Tire', spin);
  mk(geos.rim, mats.rim, 'Rim', spin);
  mk(geos.dark, mats.rimDark, 'RimInner', spin);
  mk(geos.brake, mats.brake, 'BrakeDisc', spin);
  mk(geos.caliper, mats.caliper, 'Caliper', wheel); // does not spin
  return wheel;
}

// --- Details -----------------------------------------------------------------

// First z (searching from one end) at which a point (x, y) is inside the body.
function surfaceZ(prof, x, y, front) {
  for (let s = 0; s <= 0.3; s += 0.002) {
    const t = front ? s : 1 - s;
    if (Math.abs(x) <= prof.halfW(t) * 0.97 && y >= prof.bottom(t) && y <= prof.sideTop(t)) {
      return prof.zOf(t);
    }
  }
  return prof.zOf(front ? 0 : 1);
}

function box(w, h, d, mat, name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.name = name;
  m.castShadow = true;
  return m;
}

function cylZ(r, len, mat, name, seg = 16) {
  const g = new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  m.castShadow = true;
  return m;
}

function buildDetails(p, prof, mats) {
  const group = new THREE.Group();
  group.name = 'Details';
  const lights = new THREE.Group();
  lights.name = 'Lights';
  const { L, W } = prof;

  // Headlights
  const yF = lerp(prof.bottom(0.02), p.noseHeight, 0.72);
  const hlX = prof.halfW(0.02) * 0.62;
  for (const side of [1, -1]) {
    const x = hlX * side;
    const name = side > 0 ? 'Headlight_L' : 'Headlight_R';
    let m;
    if (p.headlightStyle === 'round') {
      m = cylZ(0.085, 0.12, mats.headlight, name, 20);
    } else if (p.headlightStyle === 'slim') {
      m = box(W * 0.24, 0.05, 0.12, mats.headlight, name);
    } else {
      m = box(W * 0.18, 0.1, 0.12, mats.headlight, name);
    }
    const z = surfaceZ(prof, x + side * W * 0.06, yF, true);
    m.position.set(x, yF, z - 0.035);
    lights.add(m);
  }

  // Taillights
  const tailT = 0.98;
  const yT = lerp(prof.bottom(tailT), p.tailHeight, 0.7);
  if (p.taillightStyle === 'bar') {
    const z = surfaceZ(prof, prof.halfW(1) * 0.75, yT, false);
    const m = box(prof.halfW(1) * 1.8, 0.07, 0.1, mats.taillight, 'Taillight_Bar');
    m.position.set(0, yT, z + 0.03);
    lights.add(m);
  } else {
    for (const side of [1, -1]) {
      const x = prof.halfW(1) * 0.66 * side;
      const name = side > 0 ? 'Taillight_L' : 'Taillight_R';
      const m = p.taillightStyle === 'round'
        ? cylZ(0.075, 0.12, mats.taillight, name, 20)
        : box(W * 0.2, 0.09, 0.12, mats.taillight, name);
      const z = surfaceZ(prof, x + side * W * 0.07, yT, false);
      m.position.set(x, yT, z + 0.035);
      lights.add(m);
    }
  }
  group.add(lights);

  // Grille
  if (p.grille !== 'none') {
    const gw = p.grille === 'wide' ? W * 0.62 : W * 0.34;
    const gh = Math.max(0.06, (p.noseHeight - prof.bottom(0)) * 0.35);
    const gy = lerp(prof.bottom(0.01), p.noseHeight, 0.42);
    const m = box(gw, gh, 0.08, mats.trim, 'Grille');
    m.position.set(0, gy, surfaceZ(prof, gw / 2, gy, true) - 0.03);
    group.add(m);
  }

  // License plates
  if (p.plates) {
    const yp = lerp(prof.bottom(0.01), p.noseHeight, 0.18) + 0.06;
    const f = box(0.52, 0.12, 0.02, mats.plate, 'Plate_Front');
    f.position.set(0, yp, surfaceZ(prof, 0.26, yp, true) + 0.005);
    group.add(f);
    const yr = lerp(prof.bottom(0.99), p.tailHeight, 0.4);
    const r = box(0.52, 0.12, 0.02, mats.plate, 'Plate_Rear');
    r.position.set(0, yr, surfaceZ(prof, 0.26, yr, false) - 0.005);
    group.add(r);
  }

  // Mirrors
  if (p.mirrors) {
    const t = p.windshieldBase + 0.025;
    const hb = prof.halfW(t);
    const wb = Math.min(hb * 0.9, prof.shoulderX(t));
    const y = prof.surfaceY(t, wb) + 0.09;
    for (const side of [1, -1]) {
      const x = (hb + 0.07) * side;
      const m = box(0.13, 0.09, 0.07, mats.paint, side > 0 ? 'Mirror_L' : 'Mirror_R');
      m.position.set(x, y, prof.zOf(t));
      const glass = box(0.11, 0.07, 0.005, mats.chrome, 'MirrorGlass');
      glass.position.set(0, 0, -0.036);
      m.add(glass);
      const reach = hb + 0.07 - wb;
      const stalk = box(reach, 0.025, 0.04, mats.trim, 'MirrorStalk');
      stalk.position.set((-side * reach) / 2, -0.03, 0.01);
      m.add(stalk);
      group.add(m);
    }
  }

  // Side skirts
  if (p.sideSkirts) {
    const z0 = prof.axles[0] - prof.archR * 1.05;
    const z1 = prof.axles[1] + prof.archR * 1.05;
    const len = z0 - z1;
    if (len > 0.2) {
      for (const side of [1, -1]) {
        const tm = (L / 2 - (z0 + z1) / 2) / L;
        const m = box(0.05, 0.09, len, mats.trim, side > 0 ? 'SideSkirt_L' : 'SideSkirt_R');
        m.position.set((prof.halfW(tm) * 0.97 + 0.015) * side, prof.bottom(tm) + 0.035, (z0 + z1) / 2);
        group.add(m);
      }
    }
  }

  // Front splitter
  if (p.splitter) {
    const yb = prof.bottom(0.01);
    const m = box(prof.halfW(0.02) * 1.9, 0.025, 0.14, mats.trim, 'Splitter');
    m.position.set(0, yb + 0.01, surfaceZ(prof, 0, yb + 0.02, true) - 0.03);
    group.add(m);
  }

  // Rear diffuser
  if (p.diffuser) {
    const yb = prof.bottom(0.99);
    const z = surfaceZ(prof, 0, yb + 0.05, false);
    const d = box(prof.halfW(1) * 1.4, 0.1, 0.2, mats.trim, 'Diffuser');
    d.position.set(0, yb + 0.04, z + 0.06);
    for (let i = -2; i <= 2; i++) {
      const fin = box(0.015, 0.12, 0.22, mats.trim, 'DiffuserFin');
      fin.position.set(i * prof.halfW(1) * 0.28, -0.02, -0.02);
      d.add(fin);
    }
    group.add(d);
  }

  // Exhaust tips
  const ex = Math.round(p.exhaust);
  if (ex > 0) {
    const y = prof.bottom(0.99) + 0.07;
    const xs = ex === 1 ? [-W * 0.3] : ex === 2 ? [-W * 0.3, W * 0.3]
      : ex === 3 ? [-0.1, 0, 0.1] : [-W * 0.33, -W * 0.25, W * 0.25, W * 0.33];
    for (const x of xs) {
      const m = cylZ(0.045, 0.2, mats.chrome, 'Exhaust');
      m.position.set(x, y, surfaceZ(prof, x, y, false) - 0.02);
      group.add(m);
    }
  }

  // Hood scoop
  if (p.hoodScoop) {
    const t = p.windshieldBase * 0.5;
    const y = prof.centerTop(t);
    const s = box(0.5, 0.09, 0.45, mats.paint, 'HoodScoop');
    s.position.set(0, y + 0.02, prof.zOf(t));
    const mouth = box(0.42, 0.055, 0.02, mats.trim, 'HoodScoopIntake');
    mouth.position.set(0, 0.005, 0.22);
    s.add(mouth);
    group.add(s);
  }

  // Roof rack
  if (p.roofRack) {
    const y = p.roofHeight + 0.06;
    const t0 = p.roofFront + 0.03;
    const t1 = p.roofRear - 0.03;
    const halfT = prof.halfW((t0 + t1) / 2) * p.cabinTopWidth - 0.1;
    for (const side of [1, -1]) {
      const rail = box(0.04, 0.04, (t1 - t0) * L, mats.trim, 'RoofRail');
      rail.position.set(halfT * side, y, prof.zOf((t0 + t1) / 2));
      group.add(rail);
    }
    for (const t of [t0 + 0.02, t1 - 0.02]) {
      const bar = box(halfT * 2 + 0.1, 0.03, 0.05, mats.trim, 'RoofBar');
      bar.position.set(0, y + 0.03, prof.zOf(t));
      group.add(bar);
    }
  }

  // Bed cover (pickups)
  if (p.bedCover && p.rearWindowBase < 0.8) {
    const t0 = p.rearWindowBase + 0.02;
    const t1 = 0.97;
    const tm = (t0 + t1) / 2;
    const y = prof.centerTop(tm);
    const c = box(prof.halfW(tm) * 1.75, 0.03, (t1 - t0) * L, mats.trim, 'BedCover');
    c.position.set(0, y + 0.005, prof.zOf(tm));
    group.add(c);
  }

  // Spoiler
  if (p.spoiler !== 'none') {
    const t = 0.95;
    const z = prof.zOf(t);
    const yTop = prof.centerTop(t);
    if (p.spoiler === 'ducktail') {
      const d = box(prof.halfW(t) * 1.7, 0.04, 0.16, mats.paint, 'Spoiler_Ducktail');
      d.position.set(0, yTop + 0.02, z - 0.02);
      d.rotation.x = -0.35;
      group.add(d);
    } else {
      const gt = p.spoiler === 'gt';
      const height = gt ? 0.32 : 0.18;
      const chord = gt ? 0.3 : 0.22;
      const span = W * (gt ? 0.96 : 0.82);
      const wing = new THREE.Group();
      wing.name = gt ? 'Spoiler_GT' : 'Spoiler_Wing';
      const blade = box(span, 0.03, chord, gt ? mats.trim : mats.paint, 'WingBlade');
      blade.position.set(0, yTop + height, z);
      blade.rotation.x = -0.12;
      wing.add(blade);
      for (const side of [1, -1]) {
        const post = box(0.03, height, 0.08, mats.trim, 'WingPost');
        post.position.set(span * 0.32 * side, yTop + height / 2, z);
        wing.add(post);
        const plate = box(0.015, 0.12, chord * 1.1, mats.trim, 'WingEndplate');
        plate.position.set((span / 2) * side, yTop + height + 0.02, z);
        wing.add(plate);
      }
      group.add(wing);
    }
  }

  // Underglow
  if (p.underglow) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.85, L * 0.8).rotateX(-Math.PI / 2), mats.glow);
    g.name = 'Underglow';
    g.position.y = 0.015;
    group.add(g);
  }
  return group;
}

// --- Public API --------------------------------------------------------------

/**
 * Builds a complete car as a THREE.Group.
 * Hierarchy: Car > Body, Cabin, Details (> Lights), Wheel_FL/FR/RL/RR (> *_Spin).
 * Each wheel group sits at the wheel center so engines can attach wheel colliders.
 */
export function buildCar(rawParams, mats) {
  const p = normalizeParams(rawParams);
  const prof = makeProfile(p);
  const car = new THREE.Group();
  car.name = p.name || 'Car';

  const slotMats = [mats.paint, mats.stripe, mats.trim, mats.glass];
  const prep = (geo) => {
    if (!p.flatShading) return geo;
    const flat = geo.toNonIndexed();
    flat.computeVertexNormals();
    geo.dispose();
    return flat;
  };

  const body = new THREE.Mesh(prep(buildBody(p, prof)), slotMats);
  body.name = 'Body';
  body.castShadow = true;
  body.receiveShadow = true;
  car.add(body);

  const cabin = new THREE.Mesh(prep(buildCabin(p, prof)), slotMats);
  cabin.name = 'Cabin';
  cabin.castShadow = true;
  car.add(cabin);

  car.add(buildDetails(p, prof, mats));

  const geos = buildWheelGeometries(p);
  const x = prof.trackHalf;
  const wheels = [
    ['Wheel_FL', x, prof.axles[0], false],
    ['Wheel_FR', -x, prof.axles[0], true],
    ['Wheel_RL', x, prof.axles[1], false],
    ['Wheel_RR', -x, prof.axles[1], true],
  ];
  for (const [name, wx, wz, mirrored] of wheels) {
    const w = buildWheel(name, geos, mats, mirrored);
    w.position.set(wx, p.wheelRadius, wz);
    car.add(w);
  }

  car.userData = {
    generator: 'RayCity Car Generator',
    wheelbase: prof.axles[0] - prof.axles[1],
    track: x * 2,
    wheelRadius: p.wheelRadius,
    params: rawParams,
  };
  return car;
}

export function disposeObject(obj) {
  obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
}
