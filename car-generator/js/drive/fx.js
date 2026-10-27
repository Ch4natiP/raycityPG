// The game's boost flame and drift smoke for RayCity Drive (effect/boostfire_blue.dds and driftsmoke.dds, 8 × 8
// frame sheets, pulled into js/drive/rc-ui.js): two flames at the exhausts while the boost runs, and smoke puffs off
// the rear wheels in a drift that grow, rise and fade. Sprites, each with its own frame of the shared picture.
import * as THREE from 'three';

const N = 8; // frames per row / column
function framed(img) {
  const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(1 / N, 1 / N); t.needsUpdate = true; return t;
}
const setFrame = (t, i) => t.offset.set((i % N) / N, 1 - (Math.floor(i / N) + 1) / N);

export function createFx(scene, img) {
  const ok = (k) => img[k] && img[k].complete && img[k].naturalWidth > 0;
  // smoke: a pool of puffs in the world (in a group of their own: whatever shows / hides the scene's top level
  // leaves each puff's own visibility alone)
  const puffs = []; let next = 0; let made = false; const group = new THREE.Group(); scene.add(group);
  function makePuffs() {
    if (made || !ok('fx_smoke')) return; made = true;
    for (let i = 0; i < 36; i++) {
      const tex = framed(img.fx_smoke);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.6 }));
      s.visible = false; s.renderOrder = 2; group.add(s); puffs.push({ s, tex, age: 0, life: 1 });
    }
  }
  // flames: children of the car, at its exhausts
  let flames = [];
  function setCar(car, rear) {
    flames = [];
    if (!ok('fx_boost')) return;
    for (const x of [-0.3, 0.3]) {
      const tex = framed(img.fx_boost);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.position.set(x, 0.42, rear - 0.3); s.scale.set(0.9, 0.9, 1); s.visible = false; s.renderOrder = 3; car.add(s); flames.push({ s, tex });
    }
  }
  let t = 0; let emit = 0;
  return {
    setCar,
    // boost: flames on; smoke: puffs from the given world points (the rear wheels), at a rate
    update(dt, boost, smoke, at) {
      t += dt;
      for (const [k, f] of flames.entries()) {
        f.s.visible = boost;
        if (boost) { setFrame(f.tex, Math.floor(t * 40 + k * 5) % 24); const w = 0.8 + 0.25 * Math.sin(t * 50 + k); f.s.scale.set(w, w, 1); }
      }
      makePuffs();
      if (smoke && puffs.length) {
        emit += dt * 16;
        while (emit >= 1) {
          emit -= 1;
          for (const p of at) {
            const q = puffs[next]; next = (next + 1) % puffs.length;
            q.s.position.set(p.x + (Math.random() - 0.5) * 0.3, p.y + 0.2, p.z + (Math.random() - 0.5) * 0.3); q.age = 0; q.life = 0.9 + Math.random() * 0.5; q.s.visible = true;
          }
        }
      } else emit = 0;
      for (const q of puffs) {
        if (!q.s.visible) continue;
        q.age += dt; const f = q.age / q.life;
        if (f >= 1) { q.s.visible = false; continue; }
        setFrame(q.tex, Math.min(N * N - 1, Math.floor(f * N * N))); const w = 0.9 + f * 2.6; q.s.scale.set(w, w, 1); q.s.position.y += dt * 0.5; q.s.material.opacity = 0.6 * (1 - f);
      }
    },
  };
}
