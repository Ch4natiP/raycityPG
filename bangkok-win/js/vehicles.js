import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildCar } from '../../car-generator/js/carBuilder.js';
import { presetParams } from '../../car-generator/js/params.js';
import { labelTexture } from './textures.js';
import { poseCharacter, reach, plant, crowdGeometry } from './character.js';

// Every vehicle is ONE mesh with ONE material: colour, roughness, metalness and glow are stored
// per vertex, so a car with glass, chrome, rubber, paint and lamps is still a single draw call.
// The paint itself is a material uniform (paintA, and paintB for two-tone / the rims), so a
// thousand cars can share a handful of geometries and still each have their own colour.

// ---------- the shared material ----------
const matCache = new Map();
export function vehicleMaterial(a = '#ffffff', b = a, shared = true) {
  const key = `${a}|${b}`;
  if (shared && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, envMapIntensity: 0.9 });
  m.userData.paintA = new THREE.Color(a);
  m.userData.paintB = new THREE.Color(b);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.paintA = { value: m.userData.paintA };
    sh.uniforms.paintB = { value: m.userData.paintB };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 pbr;\nvarying vec4 vPbr;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = pbr;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vPbr;\nuniform vec3 paintA;\nuniform vec3 paintB;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nvec3 baseCol = diffuseColor.rgb;\nif (vPbr.w > 0.5) diffuseColor.rgb *= (vPbr.w > 1.5 ? paintB : paintA);')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += baseCol * vPbr.z;');
  };
  m.customProgramCacheKey = () => 'vehicle-pbr';
  if (shared) matCache.set(key, m);
  return m;
}

// surface presets: c colour, r roughness, m metalness, e glow, p paint slot (1 = paintA, 2 = paintB)
export const S = {
  paint: { c: '#ffffff', r: 0.3, m: 0.45, p: 1 },
  paint2: { c: '#ffffff', r: 0.3, m: 0.45, p: 2 },
  rim: { c: '#ffffff', r: 0.28, m: 0.85, p: 2 },
  black: { c: '#17181a', r: 0.55, m: 0.1 },
  plastic: { c: '#232426', r: 0.7, m: 0.0 },
  grey: { c: '#5d6166', r: 0.6, m: 0.2 },
  rubber: { c: '#141414', r: 0.92, m: 0 },
  tread: { c: '#0e0e0e', r: 0.95, m: 0 },
  chrome: { c: '#eceef0', r: 0.08, m: 1 },
  alu: { c: '#b4b8bd', r: 0.32, m: 0.85 },
  darkMetal: { c: '#3a3d42', r: 0.35, m: 0.8 },
  seat: { c: '#1c1b1a', r: 0.78, m: 0 },
  glass: { c: '#16202b', r: 0.04, m: 0.6 },
  tint: { c: '#0d1218', r: 0.05, m: 0.5 },
  head: { c: '#fff6dc', r: 0.1, m: 0, e: 1.6 },
  lens: { c: '#dfe8f2', r: 0.05, m: 0.4, e: 0.25 },
  tail: { c: '#c00a0a', r: 0.2, m: 0, e: 0.9 },
  amber: { c: '#ff9c1a', r: 0.2, m: 0, e: 0.5 },
  white: { c: '#f2f2f0', r: 0.5, m: 0 },
  wood: { c: '#6b4a2f', r: 0.8, m: 0 },
  vinyl: { c: '#7a1d1d', r: 0.6, m: 0 },
};
const st = (base, over) => ({ ...base, ...over });

// ---------- geometry kit ----------
class Kit {
  constructor() { this.parts = []; }
  add(geo, style) {
    const g = geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    const n = g.attributes.position.count;
    const pbr = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) { pbr[k * 4] = style.r ?? 0.6; pbr[k * 4 + 1] = style.m ?? 0; pbr[k * 4 + 2] = style.e ?? 0; pbr[k * 4 + 3] = style.p ?? 0; }
    g.setAttribute('pbr', new THREE.BufferAttribute(pbr, 4));
    if (!g.attributes.color) {
      const c = new THREE.Color(style.c ?? '#ffffff');
      const col = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) { col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    this.parts.push(g);
    return g;
  }
  // a ready geometry that already carries colour + pbr (a baked car, a baked person)
  raw(g) { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'pbr'].includes(k)) g.deleteAttribute(k); if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]); this.parts.push(g); }
  // weld: join the corners of extruded panels (worth it for shapes built once and shared)
  geometry(weld = false) {
    let g = this.parts.length ? mergeGeometries(this.parts) : new THREE.BufferGeometry();
    if (weld && this.parts.length) g = mergeVertices(g, 1e-4);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
  mesh(material) {
    const m = new THREE.Mesh(this.geometry(), material);
    m.castShadow = true;
    return m;
  }
}

const V2 = (x, y) => new THREE.Vector2(x, y);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// A side profile [[z, y], ...] extruded across the bike/vehicle (x) with rounded edges.
// taper(z, y) narrows the piece (1 = full width); bend curves its sides back (z -= bend * x^2).
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const towards = (z0, z1, min) => (z) => 1 - (1 - min) * clamp01((z - z0) / (z1 - z0));
function prof(pts, w, { bevel = 0.02, smooth = true, seg = 7, x = 0, taper = null, bend = 0 } = {}) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  if (smooth) s.splineThru([...pts.slice(1), pts[0]].map(([a, b]) => V2(a, b)));
  else for (const [a, b] of pts.slice(1)) s.lineTo(a, b);
  const b = Math.min(bevel, w * 0.45);
  const depth = Math.max(0.002, w - 2 * b);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.7, bevelSegments: 2, curveSegments: seg, steps: 1 });
  g.rotateY(-Math.PI / 2);
  g.translate(depth / 2 + x, 0, 0);
  if (taper || bend) {
    const pa = g.attributes.position;
    for (let k = 0; k < pa.count; k++) {
      let px = pa.getX(k) - x; const y = pa.getY(k); let z = pa.getZ(k);
      if (taper) px *= taper(z, y);
      z -= bend * px * px;
      pa.setXYZ(k, px + x, y, z);
    }
    g.computeVertexNormals();
  }
  return g;
}
// rounded box centred at (x, y, z)
function rbox(w, h, d, rad, x = 0, y = 0, z = 0, bevel = 0.02) {
  const r = Math.min(rad, w / 2 - 0.001, h / 2 - 0.001);
  const s = new THREE.Shape();
  const W = w / 2 - bevel; const H = h / 2 - bevel; const R = Math.max(0.001, r - bevel);
  s.moveTo(-W + R, -H);
  s.lineTo(W - R, -H); s.quadraticCurveTo(W, -H, W, -H + R);
  s.lineTo(W, H - R); s.quadraticCurveTo(W, H, W - R, H);
  s.lineTo(-W + R, H); s.quadraticCurveTo(-W, H, -W, H - R);
  s.lineTo(-W, -H + R); s.quadraticCurveTo(-W, -H, -W + R, -H);
  const depth = Math.max(0.002, d - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 4 });
  g.translate(x, y, z - depth / 2);
  return g;
}
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
// cylinder from a to b
function rod(a, b, r1, r2 = r1, seg = 8) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r2, r1, d.length(), seg, 1);
  g.translate(0, d.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}
function tube(pts, r, seg = 14, radial = 6) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => V3(...p))), seg, r, radial, false);
}
const cylX = (r, w, x, y, z, seg = 16) => new THREE.CylinderGeometry(r, r, w, seg).rotateZ(Math.PI / 2).translate(x, y, z);
const cylZ = (r, len, x, y, z, seg = 14) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2).translate(x, y, z);

// A wheel around the origin, axle along x: tyre with a rounded crown, a cast rim with spokes, a hub
// and a brake disc. rimStyle 'cast' | 'wire' | 'car'
function wheel(k, r, tw, { rim = 0.66, spokes = 5, disc = true, style = 'cast', side = 1 } = {}) {
  const rr = r * rim;
  const tyre = [V2(rr, -tw * 0.45), V2(r - tw * 0.32, -tw * 0.5), V2(r - tw * 0.08, -tw * 0.38), V2(r, -tw * 0.12), V2(r, tw * 0.12), V2(r - tw * 0.08, tw * 0.38), V2(r - tw * 0.32, tw * 0.5), V2(rr, tw * 0.45)];
  k.add(new THREE.LatheGeometry(tyre, 28).rotateZ(Math.PI / 2), S.rubber);
  // rim: a channel inside the tyre
  k.add(new THREE.LatheGeometry([V2(rr * 0.96, -tw * 0.42), V2(rr, -tw * 0.46), V2(rr * 1.02, -tw * 0.4), V2(rr * 1.02, tw * 0.4), V2(rr, tw * 0.46), V2(rr * 0.96, tw * 0.42)], 24).rotateZ(Math.PI / 2), S.rim);
  const hubR = r * 0.16;
  k.add(cylX(hubR, tw * 0.75, 0, 0, 0, 12), S.alu);
  if (style === 'wire') {
    for (let s = 0; s < 28; s++) {
      const a = (s / 28) * Math.PI * 2;
      const off = (s % 2 ? 1 : -1) * tw * 0.25;
      k.add(rod(V3(off, Math.cos(a + 0.3) * hubR, Math.sin(a + 0.3) * hubR), V3(0, Math.cos(a) * rr * 0.96, Math.sin(a) * rr * 0.96), 0.0035, 0.0035, 3), S.chrome);
    }
  } else {
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * Math.PI * 2;
      for (const d of style === 'car' ? [0] : [-0.13, 0.13]) {
        const g = new THREE.BoxGeometry(tw * 0.18, rr - hubR, r * 0.07);
        g.translate(0, hubR + (rr - hubR) / 2, 0).rotateX(a + d);
        k.add(g, S.rim);
      }
    }
  }
  if (disc) {
    k.add(cylX(r * 0.52, 0.006, side * tw * 0.36, 0, 0, 22), S.alu);
    k.add(cylX(r * 0.3, 0.008, side * tw * 0.36, 0, 0, 14), S.darkMetal);
  }
}

// ---------- motorcycles ----------
// Thai plates: white for private bikes, yellow for public motorcycle taxis (win).
const plateCache = new Map();
function plateTexture(text, yellow) {
  const key = `${text}|${yellow}`;
  if (plateCache.has(key)) return plateCache.get(key);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = yellow ? '#ffd83a' : '#f6f6f2';
  g.fillRect(0, 0, 256, 160);
  g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(4, 4, 248, 152);
  g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const [a, b] = text.split(' ');
  g.font = 'bold 50px Tahoma, sans-serif'; g.fillText(a, 128, 40);
  g.font = 'bold 26px Tahoma, sans-serif'; g.fillText('กรุงเทพมหานคร', 128, 86);
  g.font = 'bold 46px Tahoma, sans-serif'; g.fillText(b, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  plateCache.set(key, t);
  return t;
}

// Per model: wheel sizes, where the axles and steering head are, where the rider sits.
export const MOTO = {
  wave: { r: 0.29, tf: 0.075, tr: 0.085, front: 0.63, rear: -0.6, head: [0.95, 0.42], rake: 0.46, seat: [0.86, -0.2], pillion: [0.88, -0.55], lean: 0.12, wire: true },
  scoot: { r: 0.26, tf: 0.095, tr: 0.11, front: 0.66, rear: -0.62, head: [1.0, 0.47], rake: 0.48, seat: [0.84, -0.26], pillion: [0.9, -0.6], lean: 0.05 },
  sport: { r: 0.3, tf: 0.1, tr: 0.13, front: 0.7, rear: -0.68, head: [1.0, 0.44], rake: 0.43, seat: [0.88, -0.24], pillion: [0.97, -0.58], lean: 0.42 },
  big: { r: 0.31, tf: 0.11, tr: 0.15, front: 0.74, rear: -0.72, head: [1.05, 0.47], rake: 0.43, seat: [0.88, -0.22], pillion: [0.95, -0.56], lean: 0.2 },
};

function steerHead(D) {
  const [hy, ] = D.head;
  const L = (hy - D.r) / Math.cos(D.rake);
  const hz = D.front - L * Math.sin(D.rake);
  return { hy, hz, L };
}

function bikeBody(kind, k, D) {
  const { hy, hz } = steerHead(D);
  const R = D.r;
  // rear: swingarm, shocks, chain/belt, rear fender, axle hardware
  const piv = V3(0, 0.34, kind === 'scoot' ? -0.12 : -0.08);
  if (kind === 'scoot') {
    k.add(rbox(0.1, 0.17, 0.62, 0.06, 0.14, 0.32, -0.38), S.grey); // engine + CVT case on the left
    k.add(rbox(0.1, 0.13, 0.32, 0.05, 0.155, 0.33, -0.3), S.alu);
    k.add(rod(V3(-0.13, 0.3, D.rear), V3(-0.12, 0.62, D.rear + 0.12), 0.026), S.chrome);
  } else {
    for (const s of [1, -1]) k.add(rod(V3(s * 0.1, piv.y, piv.z), V3(s * 0.11, R, D.rear), 0.028, 0.022), kind === 'wave' ? S.black : S.alu);
    k.add(rod(V3(0.1, piv.y, piv.z), V3(-0.1, piv.y, piv.z), 0.03), S.black);
    if (kind === 'wave') k.add(prof([[piv.z + 0.05, 0.4], [D.rear - 0.02, 0.37], [D.rear - 0.06, 0.24], [piv.z + 0.02, 0.27]], 0.05, { x: 0.11, bevel: 0.012 }), S.black); // chain case
    else k.add(tube([[0.1, R + 0.02, D.rear], [0.105, 0.36, piv.z - 0.02], [0.1, 0.28, piv.z + 0.1]], 0.008, 16, 4), S.darkMetal); // chain
    // twin shocks (big bikes have a hidden monoshock)
    if (kind === 'wave') for (const s of [1, -1]) {
      k.add(rod(V3(s * 0.115, R + 0.03, D.rear + 0.06), V3(s * 0.12, 0.74, D.rear + 0.2), 0.022), S.chrome);
      k.add(rod(V3(s * 0.115, R + 0.12, D.rear + 0.09), V3(s * 0.12, 0.62, D.rear + 0.17), 0.034), st(S.paint2, { c: '#ffffff' }));
    }
  }
  // sprocket / hub cover
  k.add(cylX(R * 0.3, 0.03, 0.08, R, D.rear, 18), kind === 'scoot' ? S.grey : S.darkMetal);
  // rear fender hugging the tyre
  if (kind !== 'big') {
    const arc = [];
    for (let a = 0.2; a <= 1.75; a += 0.18) arc.push([D.rear + Math.cos(a + 0.2) * (R + 0.05), R + Math.sin(a + 0.2) * (R + 0.05)]);
    k.add(tube(arc.map(([z, y]) => [0, y, z]), 0.014, 14, 4).scale(6.5, 1, 1), S.black);
  }

  // engine block
  if (kind === 'wave') {
    k.add(rbox(0.24, 0.2, 0.34, 0.07, 0, 0.32, 0.12), S.alu);           // crankcase
    k.add(rbox(0.18, 0.15, 0.2, 0.05, 0, 0.42, 0.33).rotateX(0), S.alu); // cylinder, lying forward
    for (let f = 0; f < 4; f++) k.add(box(0.2, 0.012, 0.16, 0, 0.36 + f * 0.035, 0.36), S.alu);
    k.add(rbox(0.1, 0.12, 0.12, 0.04, 0.13, 0.33, 0.08), S.grey);        // clutch cover
  } else if (kind === 'sport') {
    k.add(rbox(0.32, 0.36, 0.42, 0.08, 0, 0.42, 0.08), S.black);
    k.add(rbox(0.06, 0.2, 0.26, 0.05, 0.17, 0.38, 0.02), S.alu);
  } else if (kind === 'big') {
    k.add(rbox(0.36, 0.26, 0.46, 0.08, 0, 0.36, 0.1), S.black);
    for (const s of [1, -1]) {
      const cyl = rbox(0.13, 0.28, 0.15, 0.05, s * 0.075, 0.6, 0.25); cyl.rotateX(-0.35);
      k.add(cyl, S.darkMetal);
      for (let f = 0; f < 6; f++) k.add(box(0.15, 0.01, 0.17, s * 0.075, 0.5 + f * 0.035, 0.27 - f * 0.012), S.alu);
    }
    k.add(rbox(0.38, 0.32, 0.05, 0.04, 0, 0.72, 0.38), S.black); // radiator
    k.add(rbox(0.07, 0.17, 0.2, 0.05, 0.19, 0.36, 0.04), S.alu);
  }

  // exhaust on the right (-x)
  if (kind === 'wave') {
    k.add(tube([[-0.03, 0.27, 0.4], [-0.06, 0.18, 0.3], [-0.12, 0.2, 0.0], [-0.15, 0.28, -0.25]], 0.022), S.chrome);
    k.add(rod(V3(-0.15, 0.27, -0.25), V3(-0.17, 0.42, -0.82), 0.045, 0.04, 14), S.black);
    k.add(rod(V3(-0.172, 0.3, -0.35), V3(-0.19, 0.44, -0.8), 0.03, 0.03, 10), S.chrome);
  } else if (kind === 'scoot') {
    k.add(rbox(0.11, 0.13, 0.5, 0.06, -0.17, 0.42, -0.6), S.darkMetal);
    k.add(rbox(0.04, 0.1, 0.38, 0.03, -0.235, 0.43, -0.6), S.chrome);
  } else if (kind === 'sport') {
    k.add(tube([[0, 0.5, 0.35], [-0.04, 0.22, 0.28], [-0.06, 0.16, 0.0], [-0.12, 0.22, -0.3]], 0.025), S.darkMetal);
    k.add(rod(V3(-0.13, 0.24, -0.28), V3(-0.18, 0.46, -0.72), 0.06, 0.055, 14), S.darkMetal);
    k.add(cylZ(0.035, 0.03, -0.18, 0.465, -0.735), S.black);
  } else {
    for (const s of [1, -1]) k.add(tube([[s * 0.075, 0.58, 0.36], [s * 0.06, 0.32, 0.44], [s * 0.03, 0.14, 0.28], [-0.02, 0.13, 0.0]], 0.022), S.chrome);
    k.add(rbox(0.3, 0.13, 0.32, 0.06, -0.02, 0.16, -0.08), S.darkMetal); // under-belly muffler
    k.add(rod(V3(-0.12, 0.17, -0.24), V3(-0.16, 0.24, -0.4), 0.035), S.chrome);
  }

  // frame / body panels (paint), seat, lights
  const paint = S.paint;
  if (kind === 'wave') {
    // underbone tube from the steering head down under the step-through and up to the seat
    k.add(tube([[0, hy - 0.02, hz + 0.02], [0, 0.62, hz - 0.08], [0, 0.42, 0.2], [0, 0.44, -0.1], [0, 0.62, -0.32]], 0.032), S.black);
    // front leg shield + nose around the head tube
    k.add(prof([[hz + 0.1, hy - 0.06], [hz + 0.18, 0.78], [hz + 0.16, 0.5], [hz + 0.06, 0.4], [hz - 0.05, 0.46], [hz - 0.04, 0.8], [hz - 0.02, hy - 0.04]], 0.42, { bevel: 0.03, bend: 1.6, taper: (z, y) => 0.55 + 0.45 * Math.sin(clamp01((y - 0.36) / 0.62) * Math.PI) ** 0.6 }), paint);
    k.add(prof([[hz + 0.18, 0.72], [hz + 0.24, 0.62], [hz + 0.2, 0.52], [hz + 0.14, 0.56]], 0.2, { bevel: 0.02 }), S.black); // front grille
    // floor tunnel cover
    k.add(prof([[hz - 0.03, 0.5], [0.1, 0.42], [-0.06, 0.46], [-0.08, 0.56], [hz - 0.1, 0.62]], 0.2, { bevel: 0.03 }), S.black);
    // rear body: side covers rising under the seat to the tail
    k.add(prof([[-0.05, 0.5], [-0.02, 0.62], [-0.08, 0.78], [-0.5, 0.82], [-0.86, 0.84], [-0.9, 0.74], [-0.7, 0.62], [-0.32, 0.46]], 0.3, { bevel: 0.04, taper: (z) => towards(-0.45, -0.92, 0.55)(z) }), paint);
    k.add(prof([[-0.1, 0.66], [-0.3, 0.7], [-0.5, 0.68], [-0.3, 0.6]], 0.29, { bevel: 0.01 }), st(S.paint2, { c: '#202020', p: 0 })); // side stripe panel
    k.add(prof([[-0.04, 0.8], [-0.14, 0.86], [-0.7, 0.88], [-0.8, 0.85], [-0.78, 0.79], [-0.06, 0.78]], 0.28, { bevel: 0.05, taper: (z) => towards(-0.5, -0.82, 0.7)(z) }), S.seat);
    k.add(tube([[0.13, 0.82, -0.62], [0.12, 0.84, -0.82], [0, 0.85, -0.88], [-0.12, 0.84, -0.82], [-0.13, 0.82, -0.62]], 0.012, 16, 5), S.chrome); // grab rail
    k.add(rbox(0.16, 0.06, 0.06, 0.02, 0, 0.78, -0.9), S.tail);
    for (const s of [1, -1]) k.add(rbox(0.05, 0.035, 0.05, 0.015, s * 0.13, 0.76, -0.88), S.amber);
    for (const s of [1, -1]) k.add(rod(V3(s * 0.12, 0.3, 0.02), V3(s * 0.24, 0.29, 0.0), 0.012), S.black); // footpegs
  } else if (kind === 'scoot') {
    // big front apron with the V headlight, floorboard, fat rear body
    k.add(prof([[hz + 0.16, hy - 0.02], [hz + 0.26, 0.82], [hz + 0.24, 0.5], [hz + 0.08, 0.34], [hz - 0.04, 0.36], [hz - 0.1, 0.62], [hz - 0.06, hy - 0.04]], 0.46, { bevel: 0.05, bend: 1.2, taper: (z, y) => towards(hz, hz + 0.28, 0.55)(z) * (0.75 + 0.25 * clamp01((y - 0.3) / 0.3)) }), paint);
    k.add(prof([[hz + 0.22, 0.93], [hz + 0.28, 0.82], [hz + 0.25, 0.76], [hz + 0.18, 0.86]], 0.3, { bevel: 0.015 }), S.lens);
    for (const s of [1, -1]) k.add(rbox(0.07, 0.03, 0.05, 0.012, s * 0.17, 0.82, hz + 0.24), S.amber);
    k.add(rbox(0.38, 0.06, 0.48, 0.03, 0, 0.36, 0.08), S.black); // floorboard
    k.add(prof([[0.05, 0.36], [-0.02, 0.56], [-0.12, 0.76], [-0.6, 0.8], [-0.9, 0.84], [-0.96, 0.72], [-0.8, 0.56], [-0.5, 0.42], [-0.15, 0.32]], 0.42, { bevel: 0.06, taper: (z) => towards(-0.5, -0.98, 0.55)(z) }), paint);
    k.add(prof([[-0.3, 0.6], [-0.85, 0.7], [-0.9, 0.64], [-0.35, 0.54]], 0.41, { bevel: 0.01 }), S.black);
    k.add(prof([[-0.08, 0.78], [-0.18, 0.86], [-0.78, 0.9], [-0.9, 0.87], [-0.86, 0.8], [-0.1, 0.77]], 0.34, { bevel: 0.06, taper: (z) => towards(-0.55, -0.92, 0.65)(z) }), S.seat);
    k.add(prof([[-0.9, 0.8], [-0.97, 0.76], [-0.95, 0.7], [-0.88, 0.74]], 0.3, { bevel: 0.015 }), S.tail);
    k.add(tube([[0.15, 0.86, -0.6], [0.15, 0.88, -0.85], [-0.15, 0.88, -0.85], [-0.15, 0.86, -0.6]], 0.014, 14, 5), S.darkMetal);
  } else if (kind === 'sport') {
    // twin-spar frame
    for (const s of [1, -1]) k.add(tube([[s * 0.08, hy - 0.04, hz], [s * 0.15, 0.8, 0.1], [s * 0.12, 0.5, -0.12]], 0.03), S.alu);
    // full fairing with a windscreen and twin headlights
    k.add(prof([[hz + 0.3, 0.86], [hz + 0.2, 1.0], [hz - 0.02, 1.02], [hz - 0.12, 0.8], [0.18, 0.5], [0.14, 0.22], [0.42, 0.2], [hz + 0.2, 0.52]], 0.46, { bevel: 0.05, bend: 0.8, taper: (z, y) => towards(hz - 0.05, hz + 0.32, 0.4)(z) * (0.72 + 0.28 * Math.sin(clamp01((y - 0.18) / 0.86) * Math.PI)) }), paint);
    k.add(prof([[0.4, 0.42], [0.18, 0.32], [0.16, 0.24], [0.44, 0.24]], 0.39, { bevel: 0.01 }), S.black); // lower vent
    k.add(prof([[hz + 0.18, 0.99], [hz + 0.02, 1.13], [hz - 0.06, 1.12], [hz - 0.0, 1.0]], 0.24, { bevel: 0.01, bend: 1.5, taper: towards(hz - 0.05, hz + 0.2, 0.6) }), S.tint);
    for (const s of [1, -1]) k.add(prof([[hz + 0.33, 0.85], [hz + 0.27, 0.91], [hz + 0.2, 0.91], [hz + 0.25, 0.85]], 0.08, { bevel: 0.008, x: s * 0.065 }), S.head);
    // tank, seat, tail
    k.add(prof([[hz - 0.06, 0.98], [0.15, 1.06], [-0.15, 0.98], [-0.14, 0.8], [hz - 0.1, 0.84]], 0.36, { bevel: 0.07, taper: (z) => towards(0.15, -0.16, 0.6)(z) * 1 }), paint);
    k.add(prof([[-0.14, 0.86], [-0.5, 0.86], [-0.52, 0.8], [-0.14, 0.8]], 0.27, { bevel: 0.04 }), S.seat);
    k.add(prof([[-0.5, 0.91], [-0.74, 0.96], [-0.76, 0.92], [-0.52, 0.86]], 0.22, { bevel: 0.03 }), S.seat);
    k.add(prof([[-0.12, 0.8], [-0.5, 0.84], [-0.88, 0.98], [-0.92, 0.94], [-0.72, 0.76], [-0.3, 0.66], [-0.12, 0.66]], 0.26, { bevel: 0.04, taper: (z) => towards(-0.4, -0.92, 0.35)(z) }), paint);
    k.add(prof([[-0.88, 0.95], [-0.93, 0.93], [-0.9, 0.89], [-0.84, 0.92]], 0.14, { bevel: 0.01 }), S.tail);
    k.add(tube([[0, 0.74, -0.8], [0, 0.58, -0.92], [0, 0.5, -1.0]], 0.012, 8, 4), S.black); // plate hanger
    for (const s of [1, -1]) k.add(rod(V3(s * 0.12, 0.42, -0.24), V3(s * 0.22, 0.42, -0.26), 0.012), S.alu);
  } else {
    // naked big bike: steel trellis frame, sculpted tank, bare engine, short stubby tail
    for (const s of [1, -1]) {
      k.add(tube([[s * 0.06, hy - 0.04, hz], [s * 0.14, 0.86, 0.15], [s * 0.13, 0.62, -0.18], [s * 0.1, 0.36, -0.1]], 0.024), st(S.paint2, { c: '#2b2b2b', p: 0, m: 0.5, r: 0.3 }));
      k.add(tube([[s * 0.13, 0.85, 0.12], [s * 0.15, 0.5, 0.42]], 0.018, 6, 5), S.darkMetal);
    }
    k.add(prof([[hz - 0.04, 1.0], [0.2, 1.1], [-0.1, 1.04], [-0.18, 0.86], [0.05, 0.78], [hz - 0.1, 0.84]], 0.42, { bevel: 0.08, taper: (z, y) => towards(0.2, -0.2, 0.55)(z) * (0.8 + 0.2 * clamp01((y - 0.78) / 0.2)) }), paint);
    for (const s of [1, -1]) k.add(prof([[hz + 0.02, 0.92], [0.2, 0.86], [0.3, 0.72], [hz + 0.02, 0.76]], 0.04, { bevel: 0.01, x: s * 0.2 }), paint); // tank shrouds
    k.add(prof([[-0.16, 0.88], [-0.52, 0.88], [-0.56, 0.82], [-0.16, 0.82]], 0.3, { bevel: 0.05 }), S.seat);
    k.add(prof([[-0.52, 0.92], [-0.76, 0.98], [-0.78, 0.92], [-0.54, 0.86]], 0.22, { bevel: 0.04 }), S.seat);
    k.add(prof([[-0.18, 0.82], [-0.6, 0.88], [-0.84, 0.98], [-0.86, 0.92], [-0.6, 0.74], [-0.2, 0.7]], 0.24, { bevel: 0.04, taper: (z) => towards(-0.45, -0.86, 0.4)(z) }), paint);
    k.add(prof([[-0.83, 0.96], [-0.88, 0.95], [-0.86, 0.9], [-0.8, 0.92]], 0.12, { bevel: 0.01 }), S.tail);
    k.add(tube([[0, 0.8, -0.78], [0, 0.6, -0.95], [0, 0.48, -1.02]], 0.012, 8, 4), S.black);
    for (const s of [1, -1]) k.add(rod(V3(s * 0.12, 0.4, -0.22), V3(s * 0.24, 0.4, -0.24), 0.013), S.alu);
  }
}

// The front end that turns with the bars: fork legs, wheel hardware, bars, mirrors and (for some) the headlight.
function bikeFront(kind, k, D, L) {
  const R = D.r;
  const rf = { wave: 0.022, scoot: 0.03, sport: 0.03, big: 0.034 }[kind];
  for (const s of [1, -1]) {
    k.add(rod(V3(s * 0.085, -L, 0), V3(s * 0.085, 0.02, 0), rf), kind === 'scoot' ? S.darkMetal : S.chrome);
    k.add(rod(V3(s * 0.085, -L, 0), V3(s * 0.085, -L + 0.25, 0), rf * 1.35), kind === 'wave' ? S.alu : S.darkMetal);
  }
  k.add(box(0.22, 0.04, 0.07, 0, -0.04, 0), S.alu); // triple clamp
  k.add(rbox(0.07, 0.06, 0.09, 0.02, -0.09, -L + 0.06, -0.05), S.darkMetal); // caliper
  // front fender
  const arc = [];
  for (let a = 0.35; a <= 2.0; a += 0.2) arc.push([0, -L + Math.sin(a) * (R + 0.04), Math.cos(a) * (R + 0.04)]);
  k.add(tube(arc, 0.016, 12, 4).scale(5.2, 1, 1), kind === 'sport' || kind === 'big' ? S.paint : kind === 'wave' ? S.paint : S.black);
  // handlebars
  const bars = {
    wave: [[0.33, 0.12, -0.08], [0.18, 0.12, -0.04]],
    scoot: [[0.34, 0.12, -0.08], [0.2, 0.12, -0.04]],
    sport: [[0.32, -0.02, -0.12], [0.12, 0.0, -0.06]],
    big: [[0.38, 0.2, -0.14], [0.16, 0.12, -0.04]],
  }[kind];
  for (const s of [1, -1]) {
    k.add(tube([[s * bars[0][0], bars[0][1], bars[0][2]], [s * bars[1][0], bars[1][1], bars[1][2]], [0, 0.06, 0]], 0.012, 8, 5), S.chrome);
    k.add(rod(V3(s * bars[0][0], bars[0][1], bars[0][2]), V3(s * (bars[0][0] + 0.12), bars[0][1], bars[0][2] - 0.01), 0.02), S.rubber); // grips
    k.add(rod(V3(s * (bars[0][0] - 0.02), bars[0][1], bars[0][2] + 0.02), V3(s * (bars[0][0] + 0.05), bars[0][1] - 0.01, bars[0][2] + 0.12), 0.005), S.black); // levers
    // mirrors on stalks
    const m0 = V3(s * (bars[1][0] + 0.02), bars[1][1] + 0.02, bars[1][2]);
    const m1 = V3(s * (bars[1][0] + 0.17), bars[1][1] + 0.22, bars[1][2] + 0.02);
    if (kind !== 'sport') k.add(rod(m0, m1, 0.007), S.chrome);
    const mir = new THREE.SphereGeometry(0.055, 10, 6); mir.scale(1.3, 0.8, 0.35).translate(m1.x + s * 0.03, m1.y + 0.02, m1.z);
    if (kind !== 'sport') k.add(mir, S.black);
  }
  // headlight + cowl on the bars (wave, big), dash
  if (kind === 'wave') {
    k.add(prof([[0.15, 0.13], [0.03, 0.2], [-0.12, 0.17], [-0.09, 0.06], [0.1, 0.04]], 0.34, { bevel: 0.04, taper: (z) => towards(0.0, 0.16, 0.55)(z) }), S.paint);
    k.add(prof([[0.165, 0.11], [0.14, 0.16], [0.09, 0.16], [0.12, 0.07]], 0.16, { bevel: 0.012 }), S.head);
    k.add(prof([[-0.02, 0.205], [-0.1, 0.19], [-0.1, 0.16], [-0.04, 0.17]], 0.14, { bevel: 0.01 }), S.tint); // speedo
    for (const s of [1, -1]) k.add(rbox(0.06, 0.03, 0.04, 0.01, s * 0.16, 0.1, 0.11), S.amber);
  } else if (kind === 'big') {
    const lamp = new THREE.SphereGeometry(0.09, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2); lamp.rotateX(Math.PI / 2).translate(0, -0.06, 0.16);
    k.add(rbox(0.22, 0.2, 0.16, 0.07, 0, -0.06, 0.1), S.black);
    k.add(lamp, S.head);
    k.add(rbox(0.16, 0.08, 0.06, 0.02, 0, 0.14, 0.0), S.tint);
    for (const s of [1, -1]) k.add(rbox(0.05, 0.03, 0.06, 0.01, s * 0.15, -0.06, 0.12), S.amber);
  } else {
    k.add(rbox(0.14, 0.05, 0.08, 0.02, 0, 0.1, -0.02), S.tint); // dash
  }
}

// the shapes of each model are built once and shared by every bike of that model
const motoCache = new Map();
function motoGeos(kind) {
  if (motoCache.has(kind)) return motoCache.get(kind);
  const D = MOTO[kind] || MOTO.wave;
  const { L } = steerHead(D);
  const w = { style: D.wire ? 'wire' : 'cast', spokes: kind === 'big' ? 3 : 5, side: -1, rim: kind === 'scoot' ? 0.6 : 0.66 };
  const body = new Kit(); bikeBody(kind, body, D);
  const rear = new Kit(); wheel(rear, D.r, D.tr, w);
  const front = new Kit(); wheel(front, D.r, D.tf, w);
  const fork = new Kit(); bikeFront(kind, fork, D, L);
  const G = { body: body.geometry(true), rear: rear.geometry(true), front: front.geometry(true), fork: fork.geometry(true) };
  motoCache.set(kind, G);
  return G;
}

const plateGeo = new THREE.PlaneGeometry(0.19, 0.12);
const plateMats = new Map();
function plateMaterial(text, yellow) {
  const k = `${text}|${yellow}`;
  if (!plateMats.has(k)) plateMats.set(k, new THREE.MeshStandardMaterial({ map: plateTexture(text, yellow), roughness: 0.5 }));
  return plateMats.get(k);
}

function moto(kind, { paint = '#c81e1e', rim = '#9aa0a6', plate = 'กท 1234', yellow = false, shared = false } = {}) {
  const D = MOTO[kind] || MOTO.wave;
  const { hy, hz, L } = steerHead(D);
  const mat = vehicleMaterial(paint, rim, shared);
  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);

  const G = motoGeos(kind);
  const mk = (geo) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m; };
  lean.add(mk(G.body));

  const rearW = new THREE.Group();
  rearW.position.set(0, D.r, D.rear);
  rearW.add(mk(G.rear));
  lean.add(rearW);

  const fork = new THREE.Group();
  fork.position.set(0, hy, hz);
  fork.rotation.x = -D.rake;
  fork.add(mk(G.fork));
  const front = new THREE.Group();
  front.position.set(0, -L, 0);
  front.add(mk(G.front));
  fork.add(front);
  lean.add(fork);

  // rear plate
  const pl = new THREE.Mesh(plateGeo, plateMaterial(plate, yellow));
  const tailZ = kind === 'sport' || kind === 'big' ? -1.0 : -0.93;
  pl.position.set(0, kind === 'sport' || kind === 'big' ? 0.47 : 0.6, tailZ);
  pl.rotation.set(-0.15, Math.PI, 0);
  lean.add(pl);

  const paintRef = { color: mat.userData.paintA };
  const rimRef = { color: mat.userData.paintB };
  root.userData = { lean, front, rear: rearW, fork, body: paintRef, rimMat: rimRef, kind, D, material: mat };
  return root;
}

export function makeMoto(kind = 'wave', opts) { return moto(kind, opts); }
// Handlebar grips of a model, in the bike's own space (before steering), for the rider's hands.
const BARS = { wave: [0.37, 0.12, -0.085], scoot: [0.38, 0.12, -0.085], sport: [0.36, -0.02, -0.125], big: [0.42, 0.2, -0.145] };
// where the ankles go: footpegs, or the scooter's floorboard
const FEET = { wave: [0.17, 0.36, -0.02], scoot: [0.13, 0.47, 0.16], sport: [0.17, 0.5, -0.2], big: [0.18, 0.47, -0.15] };
export function gripsOf(kind) {
  const D = MOTO[kind] || MOTO.wave;
  const { hy, hz } = steerHead(D);
  const [x, y, z] = BARS[kind] || BARS.wave;
  const c = Math.cos(-D.rake); const s = Math.sin(-D.rake);
  const wy = hy + y * c - z * s; const wz = hz + y * s + z * c;
  return [new THREE.Vector3(x, wy, wz), new THREE.Vector3(-x, wy, wz)];
}
// Sit a rider on a model with both hands on the grips. `lean` is the bike's lean group (or any parent).
export function seatRider(rider, kind, parent) {
  const s = seatOf(kind);
  poseCharacter(rider, 'ride');
  rider.position.set(0, s.y, s.z);
  rider.rotation.set(s.lean, 0, 0);
  parent.add(rider);
  parent.updateMatrixWorld(true);
  const [l, r] = gripsOf(kind);
  const [fx, fy, fz] = FEET[kind] || FEET.wave;
  plant(rider, 'L', parent.localToWorld(new THREE.Vector3(fx, fy, fz)), s.lean);
  plant(rider, 'R', parent.localToWorld(new THREE.Vector3(-fx, fy, fz)), s.lean);
  reach(rider, 'L', parent.localToWorld(l.clone()));
  reach(rider, 'R', parent.localToWorld(r.clone()));
}
export function paintMoto(bike, color, rim = null) {
  bike.userData.material.userData.paintA.set(color);
  if (rim !== null) bike.userData.material.userData.paintB.set(rim);
}
// rider placement on a given model
export function seatOf(kind) {
  const D = MOTO[kind] || MOTO.wave;
  return { y: D.seat[0] - 0.04, z: D.seat[1] + 0.08, lean: D.lean, py: D.pillion[0] - 0.02, pz: D.pillion[1] + 0.03 };
}

// ---------- cars (procedural bodies from the RayCity car generator) ----------
// Material slots of the generator -> per-vertex surface. null = leave it out (hidden behind the glass).
const CAR_SURF = {
  paint: S.paint, stripe: S.paint2, trim: st(S.black, { c: '#151617' }), glass: S.glass,
  chromeDark: S.darkMetal, chrome: S.chrome, lens: st(S.lens, { e: 0.6 }), headlight: st(S.head, { e: 1.2 }),
  indicator: S.amber, taillight: st(S.tail, { c: '#9a0606', e: 0.7 }), reverse: st(S.white, { e: 0.1 }), fog: st(S.head, { e: 0.4 }),
  seam: st(S.black, { c: '#060606', r: 0.9 }), interior: null, rim: st(S.alu, { c: '#c9ccd1' }), rimDark: st(S.black, { c: '#121314', r: 0.8 }),
  tire: S.rubber, brake: null, caliper: null, plate: S.white, glow: null,
};
const slotMats = new Proxy({}, { get: (t, k) => (t[k] ??= Object.assign(new THREE.MeshBasicMaterial(), { name: k })) });

// Bake a generator car into one indexed geometry with colour + pbr per vertex.
// split: y above which paint is paintB (two-tone).
function bakeCar(group, split = Infinity) {
  group.updateMatrixWorld(true);
  const out = [];
  const v = new THREE.Vector3(); const nv = new THREE.Vector3(); const c = new THREE.Color();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.geometry;
    const pos = src.attributes.position; const nor = src.attributes.normal;
    const groups = src.groups.length ? src.groups : [{ start: 0, count: src.index ? src.index.count : pos.count, materialIndex: 0 }];
    const surfOf = (gr) => CAR_SURF[(Array.isArray(o.material) ? o.material[gr.materialIndex] : o.material)?.name];
    if (!groups.some(surfOf)) return;
    const n = pos.count;
    const P = new Float32Array(n * 3); const N = new Float32Array(n * 3); const C = new Float32Array(n * 3); const B = new Float32Array(n * 4);
    const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
    for (let k = 0; k < n; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
      nv.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize();
      P[k * 3] = v.x; P[k * 3 + 1] = v.y; P[k * 3 + 2] = v.z;
      N[k * 3] = nv.x; N[k * 3 + 1] = nv.y; N[k * 3 + 2] = nv.z;
    }
    const idx = [];
    const vi = (gr, k) => (src.index ? src.index.getX(gr.start + k) : gr.start + k);
    for (const gr of groups) {
      const surf = surfOf(gr);
      if (!surf) continue;
      c.set(surf.c);
      for (let k = 0; k < gr.count; k++) {
        const i = vi(gr, k);
        idx.push(i);
        C[i * 3] = c.r; C[i * 3 + 1] = c.g; C[i * 3 + 2] = c.b;
        B[i * 4] = surf.r ?? 0.6; B[i * 4 + 1] = surf.m ?? 0; B[i * 4 + 2] = surf.e ?? 0;
        B[i * 4 + 3] = surf.p === 1 && P[i * 3 + 1] > split ? 2 : (surf.p ?? 0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setAttribute('pbr', new THREE.BufferAttribute(B, 4));
    g.setIndex(idx);
    out.push(g);
  });
  return mergeGeometries(out);
}

// Thai street cars, as generator parameters on top of its presets.
const CARS = {
  altis: ['sedan', { length: 4.62, width: 1.78, roofHeight: 1.46, wheelRadius: 0.31, rimStyle: 'multi', spokeCount: 10 }],      // the everyday sedan (and the taxi)
  city: ['sedan', { length: 4.4, width: 1.72, roofHeight: 1.47, wheelRadius: 0.3, noseHeight: 0.64, cornerRadius: 0.5 }],
  yaris: ['hatchback', { length: 4.1, wheelRadius: 0.3 }],
  march: ['kei', {}],
  fortuner: ['suv', { roofRack: false }],
  crv: ['luxsuv', { grille: 'wide', length: 4.6 }],
  hilux: ['pickup', { bedCover: false, length: 5.3 }],
  camry: ['sedan', { length: 4.88, width: 1.84, roofHeight: 1.45, metalness: 0.7, headlightStyle: 'slim', taillightStyle: 'bar' }],
  sport: ['sports', {}],
};
const carCache = new Map();
function carGeometry(model, split) {
  const key = `${model}|${split}`;
  if (carCache.has(key)) return carCache.get(key);
  const [preset, over] = CARS[model];
  const p = { ...presetParams(preset), ...over, detail: 'low', interior: false, panelLines: false, plates: true, driveSide: 'right' };
  const car = buildCar(p, slotMats);
  const geo = bakeCar(car, split === 'belt' ? p.beltHeight + 0.02 : Infinity);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const out = { geo, p };
  carCache.set(key, out);
  return out;
}

const CAR_PAINTS = ['#f2f2f0', '#f2f2f0', '#e9e9e6', '#1a1b1d', '#1a1b1d', '#a9adb2', '#a9adb2', '#6e7378', '#4a4e54', '#7d1418', '#1d2f5c', '#5c4a3a', '#d8d2c4', '#29473a'];
// Bangkok taxi colours: [lower body, roof/upper]
const TAXI = [['#f3c218', '#1f8c3a'], ['#ff5fa6', '#ff5fa6'], ['#f07a1a', '#f07a1a'], ['#2a7fd4', '#2a7fd4'], ['#f3c218', '#f3c218'], ['#c83c3c', '#1d5fbf']];

function carVehicle(model, a, b, split = null) {
  const { geo, p } = carGeometry(model, split);
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(geo, vehicleMaterial(a, b));
  mesh.castShadow = true;
  g.add(mesh);
  const bb = geo.boundingBox;
  return { group: g, len: bb.max.z - bb.min.z, wid: bb.max.x - bb.min.x, p };
}

// ---------- buses, tuk-tuks, songthaews ----------
function busGeometry(aircon) {
  const k = new Kit();
  const L = 11.2; const W = 2.5;
  k.add(rbox(W, 1.3, L, 0.12, 0, 1.0, 0, 0.05), S.paint);           // lower body
  k.add(rbox(W - 0.02, 1.62, L - 0.04, 0.28, 0, 2.38, 0, 0.06), S.paint2); // upper body
  // window band with pillars, both sides; doors on the left (+x)
  for (const s of [1, -1]) {
    k.add(box(0.03, 0.98, L - 1.6, s * (W / 2 + 0.005), 2.3, -0.4), S.glass);
    for (let z = -L / 2 + 0.9; z < L / 2 - 1.1; z += 1.2) k.add(box(0.05, 1.0, 0.1, s * (W / 2 + 0.02), 2.3, z), S.paint2);
    k.add(box(0.04, 0.06, L - 0.3, s * (W / 2 + 0.01), 1.72, 0), S.chrome); // rub strip
    k.add(box(0.03, 0.1, L - 0.4, s * (W / 2 + 0.01), 0.55, 0), S.black);
  }
  for (const z of [4.1, -0.6]) k.add(box(0.04, 2.15, 1.05, W / 2 + 0.01, 1.55, z), S.tint); // doors
  k.add(rbox(W - 0.2, 1.45, 0.05, 0.12, 0, 2.15, L / 2 + 0.01, 0.01), S.glass); // windscreen
  k.add(box(W - 0.3, 0.06, 0.05, 0, 1.42, L / 2 + 0.02), S.black);
  k.add(rbox(W - 0.6, 0.7, 0.05, 0.08, 0, 2.5, -L / 2 - 0.01, 0.01), S.glass); // rear window
  // bumpers, lights, grille
  for (const z of [L / 2 + 0.06, -L / 2 - 0.06]) k.add(rbox(W + 0.04, 0.32, 0.18, 0.06, 0, 0.52, z, 0.02), S.plastic);
  for (const s of [1, -1]) {
    k.add(rbox(0.32, 0.18, 0.05, 0.05, s * 0.9, 0.92, L / 2 + 0.03, 0.01), S.head);
    k.add(rbox(0.12, 0.12, 0.05, 0.03, s * 0.62, 0.92, L / 2 + 0.03, 0.01), S.amber);
    k.add(rbox(0.22, 0.42, 0.05, 0.05, s * 1.05, 1.2, -L / 2 - 0.03, 0.01), S.tail);
    // "rabbit ear" mirrors reaching forward
    k.add(tube([[s * 1.15, 2.9, L / 2 - 0.2], [s * 1.35, 3.0, L / 2 + 0.3], [s * 1.25, 2.6, L / 2 + 0.55]], 0.022, 10, 5), S.black);
    k.add(rbox(0.12, 0.34, 0.06, 0.03, s * 1.22, 2.45, L / 2 + 0.58), S.black);
  }
  k.add(box(1.2, 0.3, 0.04, 0, 0.98, L / 2 + 0.035), S.darkMetal);
  if (aircon) k.add(rbox(1.6, 0.25, 2.4, 0.08, 0, 3.27, 0.5, 0.03), S.white);
  // wheels: front single, rear twin
  for (const [z, twin] of [[3.55, false], [-3.2, true]]) for (const s of [1, -1]) {
    const wk = new Kit();
    wheel(wk, 0.5, twin ? 0.5 : 0.3, { style: 'car', spokes: 8, rim: 0.56, disc: false });
    const g = wk.geometry().translate(s * (W / 2 - 0.25), 0.5, z);
    k.raw(g);
    k.add(cylX(0.62, 0.03, s * (W / 2 - 0.0), 0.62, z, 20).scale(1, 1, 1), S.black);
  }
  return k.geometry(true);
}

function tuktukGeometry() {
  const k = new Kit();
  // chassis + floor
  k.add(rbox(1.3, 0.22, 2.0, 0.06, 0, 0.42, -0.35, 0.03), S.paint);
  // front cowl with the single headlight, like a scooter nose
  k.add(prof([[1.28, 1.0], [1.36, 0.78], [1.3, 0.5], [1.12, 0.38], [0.85, 0.42], [0.82, 0.9], [1.05, 1.08]], 0.78, { bevel: 0.05 }), S.paint);
  const lamp = new THREE.SphereGeometry(0.085, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2); lamp.rotateX(Math.PI / 2).translate(0, 0.88, 1.38);
  k.add(lamp, S.head);
  for (const s of [1, -1]) k.add(rbox(0.07, 0.06, 0.05, 0.02, s * 0.3, 0.92, 1.33), S.amber);
  k.add(box(0.7, 0.04, 0.08, 0, 0.6, 1.32), S.chrome);
  k.add(rbox(0.7, 0.42, 0.03, 0.04, 0, 1.3, 0.98, 0.01), S.glass); // windscreen
  k.add(tube([[0.38, 1.12, 0.92], [0.2, 1.08, 0.95], [-0.2, 1.08, 0.95], [-0.38, 1.12, 0.92]], 0.014, 10, 5), S.chrome); // bars
  // driver bench + passenger bench with backrest
  k.add(rbox(0.6, 0.12, 0.42, 0.04, 0, 0.72, 0.45), S.vinyl);
  k.add(rbox(1.15, 0.14, 0.55, 0.05, 0, 0.72, -0.75), S.vinyl);
  k.add(rbox(1.15, 0.5, 0.1, 0.05, 0, 1.02, -1.08), S.vinyl);
  // sides of the passenger compartment, with chrome trim
  for (const s of [1, -1]) {
    k.add(prof([[0.2, 0.55], [0.1, 0.92], [-1.25, 0.95], [-1.32, 0.5]], 0.05, { bevel: 0.015, x: s * 0.64 }), S.paint);
    k.add(box(0.02, 0.03, 1.5, s * 0.67, 0.92, -0.55), S.chrome);
    k.add(box(0.02, 0.03, 1.5, s * 0.67, 0.68, -0.55), S.chrome);
  }
  k.add(rbox(1.3, 0.45, 0.06, 0.05, 0, 0.78, -1.32), S.paint);
  for (const s of [1, -1]) k.add(rbox(0.16, 0.1, 0.04, 0.02, s * 0.5, 0.8, -1.36), S.tail);
  // the classic swooping roof, with posts
  k.add(prof([[0.98, 1.56], [0.62, 1.82], [-1.36, 1.84], [-1.4, 1.76], [-1.3, 1.78], [0.58, 1.76], [0.92, 1.5]], 1.48, { bevel: 0.02, smooth: false }), S.paint2);
  k.add(box(1.5, 0.05, 2.1, 0, 1.86, -0.38), S.paint2);
  k.add(box(1.52, 0.04, 0.04, 0, 1.79, -1.38), S.chrome);
  for (const [x, z] of [[0.66, 0.15], [-0.66, 0.15], [0.66, -1.3], [-0.66, -1.3]]) k.add(rod(V3(x, 0.9, z), V3(x, 1.8, z), 0.02), S.chrome);
  for (const s of [1, -1]) k.add(rod(V3(s * 0.4, 1.0, 0.9), V3(s * 0.66, 1.6, 0.85), 0.018), S.chrome);
  // wheels
  const add = (x, z) => { const wk = new Kit(); wheel(wk, 0.24, 0.14, { style: 'car', spokes: 5, rim: 0.6, disc: false }); k.raw(wk.geometry().translate(x, 0.24, z)); };
  add(0, 1.12); add(0.6, -0.95); add(-0.6, -0.95);
  k.add(tube([[0, 0.42, 1.32], [0, 0.55, 1.12], [0, 0.42, 0.88]], 0.02, 8, 4).scale(5, 1, 1), S.black);
  for (const s of [1, -1]) k.add(prof([[-0.6, 0.6], [-0.95, 0.66], [-1.25, 0.58], [-1.2, 0.45], [-0.7, 0.45]], 0.24, { bevel: 0.02, x: s * 0.6 }), S.paint);
  return k.geometry(true);
}

function songthaewGeometry() {
  const { geo, p } = carGeometry('hilux', null);
  const k = new Kit();
  k.raw(geo.clone());
  const L = p.length;
  const zCab = L / 2 - L * 0.56; const zEnd = -L / 2 + 0.05;
  const len = zCab - zEnd;
  const zc = (zCab + zEnd) / 2;
  k.add(rbox(1.94, 0.08, len + 0.15, 0.03, 0, 2.25, zc - 0.05), S.paint);       // roof
  k.add(box(1.96, 0.04, 0.04, 0, 2.2, zEnd - 0.1), S.chrome);
  for (const s of [1, -1]) {
    for (const z of [zCab - 0.05, zc, zEnd + 0.05]) k.add(rod(V3(s * 0.92, 1.05, z), V3(s * 0.92, 2.22, z), 0.022), S.chrome);
    k.add(box(0.04, 0.05, len, s * 0.93, 1.55, zc), S.chrome); // grab rails
    k.add(rbox(0.36, 0.1, len - 0.2, 0.03, s * 0.68, 1.15, zc), S.vinyl); // benches along the sides
    k.add(rbox(0.06, 0.36, len - 0.2, 0.03, s * 0.88, 1.38, zc), S.vinyl);
  }
  k.add(rbox(0.9, 0.06, 0.32, 0.02, 0, 0.42, zEnd - 0.22), S.darkMetal); // rear step
  return { geo: k.geometry(), p };
}

const special = new Map();
function cachedGeo(key, fn) { if (!special.has(key)) special.set(key, fn()); return special.get(key); }

const pick = (r, a) => a[Math.floor(r() * a.length)];
const busSign = new Map();
function signMesh(text, w, h, opts) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: labelTexture(text, opts) }));
  return m;
}

// ---------- far-away stand-ins (LOD) ----------
// A few hundred vertices that read the same from 60 m: body, glasshouse, wheels, lamps.
const lowCache = new Map();
function lowGeometry(key, fn) { if (!lowCache.has(key)) lowCache.set(key, fn()); return lowCache.get(key); }
function lowCar({ length: L, width: W, clearance: cl, beltHeight: belt, roofHeight: roof, wheelRadius: wr, roofFront = 0.47, roofRear = 0.7 }, split, cage = false) {
  const k = new Kit();
  k.add(box(W, belt - cl - 0.05, L * 0.97, 0, (belt + cl) / 2 + 0.03, 0), S.paint);
  const z0 = L / 2 - L * (roofFront - 0.08); const z1 = L / 2 - L * Math.min(0.97, roofRear + 0.1);
  if (!cage) {
    k.add(box(W * 0.84, roof - belt, z0 - z1, 0, (roof + belt) / 2, (z0 + z1) / 2), S.glass);
    k.add(box(W * 0.8, 0.05, (z0 - z1) * 0.8, 0, roof, (z0 + z1) / 2), split ? S.paint2 : S.paint);
  } else {
    const zc = L / 2 - L * 0.4;
    k.add(box(W * 0.84, roof - belt, L * 0.22, 0, (roof + belt) / 2, zc), S.glass);
    k.add(box(W, 0.08, L * 0.5, 0, 2.25, -L * 0.2), S.paint);
  }
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) k.add(cylX(wr, 0.22, x * (W / 2 - 0.12), wr, z * (L / 2 - wr * 2.6), 8), S.rubber);
  for (const x of [1, -1]) { k.add(box(0.3, 0.1, 0.04, x * W * 0.34, belt - 0.15, L / 2), S.head); k.add(box(0.3, 0.1, 0.04, x * W * 0.34, belt - 0.12, -L / 2), S.tail); }
  return k.geometry(true);
}
function lowMoto() {
  const k = new Kit();
  for (const z of [0.66, -0.64]) k.add(cylX(0.29, 0.09, 0, 0.29, z, 8), S.rubber);
  k.add(box(0.26, 0.32, 1.2, 0, 0.62, -0.05), S.paint);
  k.add(box(0.28, 0.08, 0.6, 0, 0.84, -0.35), S.seat);
  k.add(box(0.36, 0.55, 0.26, 0, 1.25, -0.15), S.grey);   // rider
  k.add(box(0.2, 0.2, 0.22, 0, 1.62, -0.08), S.black);
  k.add(box(0.3, 0.42, 0.4, 0, 0.82, 0.1), st(S.grey, { c: '#2b3340' }));
  k.add(box(0.1, 0.08, 0.04, 0, 0.92, 0.75), S.head);
  k.add(box(0.12, 0.06, 0.04, 0, 0.8, -0.86), S.tail);
  return k.geometry();
}
function lowTuktuk() {
  const k = new Kit();
  k.add(box(1.3, 0.55, 2.4, 0, 0.7, -0.35), S.paint);
  k.add(box(0.8, 0.6, 0.5, 0, 0.75, 1.1), S.paint);
  k.add(box(1.48, 0.06, 2.6, 0, 1.84, -0.3), S.paint2);
  k.add(box(0.4, 0.6, 0.3, 0, 1.15, 0.45), S.grey);
  for (const [x, z] of [[0, 1.12], [0.6, -0.95], [-0.6, -0.95]]) k.add(cylX(0.24, 0.14, x, 0.24, z, 8), S.rubber);
  k.add(box(0.14, 0.1, 0.04, 0, 0.88, 1.36), S.head);
  return k.geometry();
}
function lowBus() {
  const k = new Kit();
  k.add(box(2.5, 1.3, 11.2, 0, 1.0, 0), S.paint);
  k.add(box(2.48, 1.6, 11.16, 0, 2.4, 0), S.paint2);
  for (const x of [1, -1]) k.add(box(0.03, 0.95, 9.6, x * 1.26, 2.3, -0.4), S.glass);
  k.add(box(2.3, 1.4, 0.04, 0, 2.15, 5.61), S.glass);
  for (const [x, z] of [[1, 3.55], [-1, 3.55], [1, -3.2], [-1, -3.2]]) k.add(cylX(0.5, 0.35, x * 1.0, 0.5, z, 8), S.rubber);
  for (const x of [1, -1]) { k.add(box(0.32, 0.18, 0.04, x * 0.9, 0.92, 5.62), S.head); k.add(box(0.22, 0.42, 0.04, x * 1.05, 1.2, -5.62), S.tail); }
  return k.geometry();
}
// Put a stand-in next to the detailed model; Traffic swaps them by distance.
function withLod(v, low, parent = v.group) {
  const hi = [...parent.children];
  const mat = hi.find((o) => o.isMesh && o.material?.userData?.paintA)?.material;
  const lo = new THREE.Mesh(low, mat);
  lo.castShadow = true;
  lo.visible = false;
  parent.add(lo);
  v.lod = { hi, lo, far: false };
  return v;
}
export function setLodFar(v, far) {
  if (!v.lod || v.lod.far === far) return;
  v.lod.far = far;
  for (const o of v.lod.hi) o.visible = !far;
  v.lod.lo.visible = far;
}

// A traffic vehicle: { group, len, wid, type, lod }. 'moto' groups carry userData.lean for the lean.
export function makeTrafficVehicle(type, r = Math.random) {
  const v = buildTraffic(type, r);
  if (v.type === 'moto') return withLod(v, lowGeometry('moto', lowMoto), v.group.userData.lean);
  if (v.type === 'bus') return withLod(v, lowGeometry('bus', lowBus));
  if (v.type === 'tuktuk') return withLod(v, lowGeometry('tuktuk', lowTuktuk));
  return withLod(v, lowGeometry(`${v.model}|${v.split}`, () => lowCar(v.p, v.split, v.type === 'songthaew')));
}

function buildTraffic(type, r) {
  if (type === 'taxi') {
    const [a, b] = pick(r, TAXI);
    const v = carVehicle('altis', a, b, a === b ? null : 'belt');
    v.model = 'altis'; v.split = a !== b;
    const sign = signMesh('TAXI-METER', 0.72, 0.2, { bg: '#ffeb3b', fg: '#111', w: 256, h: 72, font: 40 });
    const top = v.p.roofHeight + 0.12;
    const box3 = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.2, 0.28), new THREE.MeshStandardMaterial({ color: 0xffeb3b, emissive: 0x332a00, roughness: 0.4 }));
    box3.position.set(0, top, -0.15);
    sign.position.set(0, top, -0.15 + 0.145);
    v.group.add(box3, sign);
    return { ...v, type };
  }
  if (type === 'pickup') return { ...carVehicle('hilux', pick(r, CAR_PAINTS), '#222'), type, model: 'hilux' };
  if (type === 'bus') {
    const aircon = r() < 0.6;
    const [a, b] = aircon ? pick(r, [['#1f5fbf', '#f5f5f5'], ['#f08a1a', '#f6f1e6'], ['#f2c40f', '#f6f6f6'], ['#2f6fd0', '#2f6fd0']]) : pick(r, [['#c0392b', '#f3e5c0'], ['#c0392b', '#f3e5c0'], ['#2a5fb0', '#f1f1f1']]);
    const geo = cachedGeo(`bus${aircon}`, () => busGeometry(aircon));
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, vehicleMaterial(a, b)); m.castShadow = true; g.add(m);
    const route = String(pick(r, [2, 8, 25, 29, 40, 77, 113, 501, 511, 15, 47]));
    if (!busSign.has(route)) busSign.set(route, labelTexture(route, { bg: '#111', fg: '#ffb000', w: 256, h: 64, font: 48 }));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.34), new THREE.MeshBasicMaterial({ map: busSign.get(route) }));
    sign.position.set(0, 3.0, 5.62);
    g.add(sign);
    return { group: g, len: 11.2, wid: 2.5, type };
  }
  if (type === 'tuktuk') {
    const geo = cachedGeo('tuktuk', tuktukGeometry);
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, vehicleMaterial(pick(r, ['#1e5aa8', '#0a8a4a', '#d4202a', '#f2b705', '#1d6b94']), pick(r, ['#1e5aa8', '#d4202a', '#111111', '#0a8a4a']))); m.castShadow = true; g.add(m);
    g.add(driverMesh(r, null, {}, [0, 0.72, 0.42, 0.05]));
    return { group: g, len: 2.9, wid: 1.48, type };
  }
  if (type === 'songthaew') {
    const s = cachedGeo('songthaew', songthaewGeometry);
    const g = new THREE.Group();
    const m = new THREE.Mesh(s.geo, vehicleMaterial(pick(r, ['#2471a3', '#1e8449', '#e8e8e8', '#c0392b']), '#222')); m.castShadow = true; g.add(m);
    return { group: g, len: s.p.length, wid: 1.96, type, p: s.p, model: 'songthaew' };
  }
  if (type === 'moto') {
    const kind = pick(r, ['wave', 'wave', 'wave', 'scoot', 'scoot', 'sport', 'big']);
    const g = moto(kind, { paint: pick(r, ['#111111', '#c81e1e', '#1f4fbf', '#dddddd', '#2b2b2b', '#7a7f86', '#e5e0d5']), rim: pick(r, ['#1b1b1b', '#9aa0a6', '#c9ccd1']), plate: pick(r, ['1กข 245', '2กม 881', '7ขพ 302', '9กท 516', '3ฒก 774', '1ฆบ 129']), shared: true });
    g.userData.lean.add(driverMesh(r, kind, { helmet: pick(r, [0xf5f5f5, 0x222222, 0xc0392b, 0x1f4fbf, true]) }));
    return { group: g, len: 1.95, wid: 0.8, type };
  }
  const model = pick(r, ['altis', 'altis', 'city', 'city', 'yaris', 'march', 'fortuner', 'crv', 'camry', 'hilux', 'sport']);
  return { ...carVehicle(model, pick(r, CAR_PAINTS), '#222'), type: model === 'hilux' ? 'pickup' : 'car', model };
}

// A posed person frozen into the vehicle's own material (one draw call with the vehicle).
// Riders come from a shared set, so a hundred bikes share a dozen rider shapes.
const personMat = vehicleMaterial('#ffffff', '#ffffff');
const HELMETS = [0xf5f5f5, 0x222222, 0xc0392b, 0x1f4fbf, true, 0xf1c40f];
const riderGeo = new Map();
function driverMesh(r, kind, opts = {}, place = null) {
  const arch = Math.floor(r() * 12);
  const key = `${arch}|${kind}|${place ? place.join(',') : ''}`;
  if (!riderGeo.has(key)) {
    const g = crowdGeometry(arch, 'ride', {
      opts: kind ? { helmet: HELMETS[arch % HELMETS.length] } : {},
      key: `veh-${kind}-${place ? place.join(',') : ''}`,
      setup: (p) => {
        if (kind) seatRider(p, kind, new THREE.Group());
        else { poseCharacter(p, 'ride', 0); p.position.set(place[0], place[1], place[2]); p.rotation.x = place[3]; }
      },
    }).clone();
    const n = g.attributes.position.count;
    const pbr = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) pbr[k * 4] = 0.8;
    g.setAttribute('pbr', new THREE.BufferAttribute(pbr, 4));
    riderGeo.set(key, g);
  }
  const m = new THREE.Mesh(riderGeo.get(key), personMat);
  m.castShadow = true;
  return m;
}
