import * as THREE from 'three';
import { HALF } from './config.js';

// Bangkok weather: mostly hot and hazy, with tropical downpours that roll in and out.
// `rain` goes 0..1 smoothly; everything else (sky, fog, grip, fares, sound) reads it.
const STREAKS = 2600;
const BOX = { x: 70, y: 32, z: 70 };

export class Weather {
  constructor(scene) {
    this.rain = 0;
    this.target = 0;
    this.mode = 'auto'; // 'auto' | 'clear' | 'rain'
    this.timer = 90 + Math.random() * 120; // real seconds until the sky changes its mind

    // rain: short line streaks in a box that follows the camera
    const pos = new Float32Array(STREAKS * 6);
    this.seed = new Float32Array(STREAKS * 3);
    for (let k = 0; k < STREAKS; k++) {
      this.seed[k * 3] = (Math.random() - 0.5) * BOX.x;
      this.seed[k * 3 + 1] = Math.random() * BOX.y;
      this.seed[k * 3 + 2] = (Math.random() - 0.5) * BOX.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.drops = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0, depthWrite: false }));
    this.drops.frustumCulled = false;
    scene.add(this.drops);
    this.fall = 0;

    // wet road: a glossy film over the asphalt that reflects the sky and the street lights
    const size = HALF * 2 + 900;
    this.wet = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.12, metalness: 0.0, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    this.wet.position.y = 0.015;
    this.wet.receiveShadow = true;
    scene.add(this.wet);
  }

  setMode(m) {
    this.mode = m;
    if (m === 'clear') this.target = 0;
    if (m === 'rain') this.target = 1;
  }

  get label() {
    if (this.rain > 0.6) return '🌧 ฝนตกหนัก';
    if (this.rain > 0.15) return '🌦 ฝนตก';
    if (this.target > 0.5) return '☁️ ฟ้าครึ้ม';
    return '☀️ แดดออก';
  }

  update(dt, camera) {
    if (this.mode === 'auto') {
      this.timer -= dt;
      if (this.timer <= 0) {
        // rainy season: about a third of the time it pours
        this.target = Math.random() < 0.35 ? 0.6 + Math.random() * 0.4 : 0;
        this.timer = this.target > 0 ? 80 + Math.random() * 120 : 150 + Math.random() * 200;
      }
    }
    const rate = this.target > this.rain ? 0.05 : 0.07; // a downpour builds over ~20 s
    this.rain += Math.max(-rate * dt, Math.min(rate * dt, this.target - this.rain));

    const r = this.rain;
    this.drops.visible = r > 0.01;
    this.drops.material.opacity = Math.min(0.55, r * 0.7);
    this.wet.material.opacity = Math.min(0.55, r * 0.9);
    if (this.drops.visible && camera) {
      this.fall += dt * 26;
      const p = this.drops.geometry.attributes.position.array;
      const n = Math.floor(STREAKS * Math.min(1, r * 1.2));
      const cx = camera.position.x; const cy = camera.position.y; const cz = camera.position.z;
      for (let k = 0; k < STREAKS; k++) {
        const o = k * 6;
        if (k >= n) { p[o + 1] = p[o + 4] = -50; continue; }
        const x = cx + this.seed[k * 3];
        const z = cz + this.seed[k * 3 + 2];
        const y = cy - 6 + ((this.seed[k * 3 + 1] - this.fall) % BOX.y + BOX.y) % BOX.y;
        p[o] = x; p[o + 1] = y; p[o + 2] = z;
        p[o + 3] = x + 0.08; p[o + 4] = y - 0.9; p[o + 5] = z + 0.05; // slanted by the wind
      }
      this.drops.geometry.attributes.position.needsUpdate = true;
    }
  }
}
