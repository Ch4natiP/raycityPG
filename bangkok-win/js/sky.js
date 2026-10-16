import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { glowTexture } from './textures.js';

// Time of day for Bangkok (13.7° N): a physically based sky, sun / moon light, haze and city glow.
// One game hour lasts HOUR_SECONDS real seconds.
export const HOUR_SECONDS = 60;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerpC = (a, b, t) => a.clone().lerp(b, t);

const SKY_DAY = new THREE.Color(0.78, 0.86, 1.0);
const SKY_DUSK = new THREE.Color(1.0, 0.68, 0.48);
const SKY_NIGHT = new THREE.Color(0.22, 0.26, 0.42);
const GROUND_DAY = new THREE.Color(0x6b6155);
const GROUND_NIGHT = new THREE.Color(0x2a2622); // warm bounce from street lights
const SUN_LOW = new THREE.Color(1.0, 0.55, 0.3);
const SUN_HIGH = new THREE.Color(1.0, 0.96, 0.9);
const MOON = new THREE.Color(0.62, 0.72, 1.0);
const HAZE = new THREE.Color(0.7, 0.75, 0.8);          // Bangkok smog, grey-blue
const CITY_GLOW = new THREE.Color(0.11, 0.085, 0.07);  // light pollution on the night haze

export class Atmosphere {
  constructor(scene, renderer, { mobile = false, hour = 17 } = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.mobile = mobile;
    this.hour = hour;
    this.night = 0;
    this.sunDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.6;

    this.sky = makeSky();
    scene.add(this.sky);

    // the glow of the city lights on the haze near the horizon (night only)
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(850, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: { color: { value: CITY_GLOW.clone() }, strength: { value: 0 } },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 color; uniform float strength; varying vec3 vDir; void main(){ float h = clamp(vDir.y, 0.0, 1.0); float a = strength * (1.0 - smoothstep(0.0, 0.45, h)); gl_FragColor = vec4(color * 6.0 * a, 1.0); }',
        side: THREE.BackSide, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending, fog: false,
      }),
    );
    scene.add(this.dome);

    // stars and moon
    const sp = [];
    for (let k = 0; k < 1400; k++) {
      const u = Math.random() * Math.PI * 2;
      const y = 0.08 + Math.random() * 0.92;
      const r = Math.sqrt(1 - y * y);
      sp.push(Math.cos(u) * r * 800, y * 800, Math.sin(u) * r * 800);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    scene.add(this.stars);
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,255,255,1)'), color: 0xe8eeff, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.moon.scale.setScalar(46);
    scene.add(this.moon);

    // lights
    this.hemi = new THREE.HemisphereLight(0xe8f2ff, 0x77685a, 1.4);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = !mobile;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.4;
    scene.add(this.sun, this.sun.target);

    scene.fog = new THREE.FogExp2(0xc9d8df, 0.0026);
    scene.background = new THREE.Color(0x000000);

    // reflections for the glass towers + sky colour readback for the fog
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = makeSky();
    this.envScene.add(this.envSky);
    this.envTimer = 0;
    this.envRT = null;
    this.probe = new THREE.WebGLRenderTarget(8, 8, { type: THREE.FloatType });
    this.probeCam = new THREE.PerspectiveCamera(40, 1, 1, 2000);
    this.probePx = new Float32Array(8 * 8 * 4);
    this.horizon = HAZE.clone();
    this.update(0, new THREE.Vector3(), null, true);
  }

  get clock() {
    const h = Math.floor(this.hour) % 24;
    const m = Math.floor((this.hour % 1) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  skip(hours) { this.hour = (this.hour + hours) % 24; this.envTimer = 0; }

  update(dt, focus, camera, force = false) {
    this.hour = (this.hour + dt / HOUR_SECONDS) % 24;
    // sun path: rises in the east (+x) at 06:00, high in the sky at noon (a little to the south), sets at 18:00
    const th = ((this.hour - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(th), Math.sin(th) * 0.97, 0.24).normalize();
    const e = this.sunDir.y;
    this.night = 1 - smooth(-0.22, 0.04, e); // blue hour lasts until ~18:45
    const day = smooth(-0.04, 0.3, e);
    const dusk = (1 - Math.abs(smooth(-0.1, 0.35, e) * 2 - 1)) * (e > -0.15 ? 1 : 0); // peaks around sunset / sunrise

    for (const s of [this.sky, this.envSky]) {
      const u = s.material.uniforms;
      u.sunPosition.value.copy(this.sunDir);
      u.turbidity.value = 6 + dusk * 5;     // hazy city air, thicker at sunset
      u.rayleigh.value = 2.0 + dusk * 1.2;
      u.mieCoefficient.value = 0.009;
      u.mieDirectionalG.value = 0.86;
    }

    // directional light: the sun by day, the moon by night
    if (e > -0.03) {
      this.lightDir.copy(this.sunDir);
      if (this.lightDir.y < 0.05) this.lightDir.y = 0.05;
      this.sun.color.copy(lerpC(SUN_LOW, SUN_HIGH, smooth(0.0, 0.45, e)));
      this.sun.intensity = 3.4 * smooth(-0.03, 0.16, e);
    } else {
      this.lightDir.set(-this.sunDir.x, Math.max(0.35, -this.sunDir.y), -this.sunDir.z * 0.5).normalize();
      this.sun.color.copy(MOON);
      this.sun.intensity = 0.38 * smooth(-0.03, -0.2, e);
    }
    const sky = lerpC(lerpC(SKY_NIGHT, SKY_DUSK, smooth(-0.15, 0.0, e)), SKY_DAY, smooth(0.05, 0.4, e));
    this.hemi.color.copy(sky);
    this.hemi.groundColor.copy(lerpC(GROUND_NIGHT, GROUND_DAY, day));
    this.hemi.intensity = 0.85 + 0.8 * day + 0.8 * dusk; // the sky still lights the shade at dusk and at night

    // eyes adapt: open up the exposure at night
    this.renderer.toneMappingExposure = 0.78 + 0.22 * this.night + 0.2 * dusk;

    // sky-coloured haze; at night the haze glows with the city's lights
    this.envTimer -= dt;
    if (force || this.envTimer <= 0) {
      this.envTimer = 4;
      this.refreshEnvironment();
    }
    const fog = lerpC(this.horizon.clone().lerp(HAZE, 0.25 * day), CITY_GLOW, smooth(0.3, 1, this.night));
    this.scene.fog.color.copy(fog);
    this.scene.fog.density = 0.0017 + 0.0012 * this.night + 0.0006 * dusk;
    this.dome.material.uniforms.strength.value = this.night;

    this.stars.material.opacity = smooth(0.75, 1, this.night) * 0.85;
    this.moon.material.opacity = this.night;
    if (camera) {
      for (const o of [this.sky, this.dome, this.stars]) o.position.copy(camera.position);
      const md = new THREE.Vector3(-this.sunDir.x, -this.sunDir.y, -this.sunDir.z * 0.5).normalize();
      if (md.y < 0.15) md.y = 0.15;
      this.moon.position.copy(camera.position).addScaledVector(md.normalize(), 780);
    }
    // the shadow box follows the player
    this.sun.position.copy(focus).addScaledVector(this.lightDir, 150);
    this.sun.target.position.copy(focus);
  }

  // Re-render the sky into an environment map (glass reflections) and read its horizon colour for the fog.
  refreshEnvironment() {
    if (!this.mobile) {
      const rt = this.pmrem.fromScene(this.envScene, 0, 1, 3000);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
    }
    try {
      const az = Math.atan2(this.sunDir.z, this.sunDir.x) + Math.PI / 2; // look across the sun, not into it
      this.probeCam.position.set(0, 0, 0);
      this.probeCam.lookAt(Math.cos(az), 0.04, Math.sin(az));
      const r = this.renderer;
      const prevTM = r.toneMapping;
      r.toneMapping = THREE.NoToneMapping;
      r.setRenderTarget(this.probe);
      r.render(this.envScene, this.probeCam);
      r.setRenderTarget(null);
      r.toneMapping = prevTM;
      const read = () => {
        let cr = 0; let cg = 0; let cb = 0;
        for (let y = 2; y < 5; y++) for (let x = 0; x < 8; x++) { const i = (y * 8 + x) * 4; cr += this.probePx[i]; cg += this.probePx[i + 1]; cb += this.probePx[i + 2]; }
        if (Number.isFinite(cr)) this.horizon.setRGB(cr / 24, cg / 24, cb / 24);
      };
      // read back without stalling the GPU where the browser allows it
      if (r.readRenderTargetPixelsAsync && !this.reading) {
        this.reading = true;
        r.readRenderTargetPixelsAsync(this.probe, 0, 0, 8, 8, this.probePx).then(read, () => {}).finally(() => { this.reading = false; });
      } else if (!this.reading) {
        r.readRenderTargetPixels(this.probe, 0, 0, 8, 8, this.probePx);
        read();
      }
    } catch { /* float targets unsupported: keep the last colour */ }
  }
}

function makeSky() {
  const s = new Sky();
  s.scale.setScalar(900);
  s.material.fog = false;
  return s;
}
