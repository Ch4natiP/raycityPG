// Keyboard + on-screen buttons. steer: +1 = left, -1 = right.
export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false, boost: false };
    this.pressed = new Set();
    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    document.querySelectorAll('[data-touch]').forEach((el) => {
      const k = el.dataset.touch;
      const on = (e) => { e.preventDefault(); if (k in this.touch) this.touch[k] = true; else this.pressed.add(k); el.classList.add('on'); };
      const off = (e) => { e.preventDefault(); if (k in this.touch) this.touch[k] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    });
  }

  get throttle() { return this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.touch.gas ? 1 : 0; }
  get brake() { return this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.keys.has('Space') || this.touch.brake ? 1 : 0; }
  get steer() {
    let s = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft') || this.touch.left) s += 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight') || this.touch.right) s -= 1;
    return s;
  }
  get boost() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touch.boost; }

  // One-shot presses (KeyH, KeyR, KeyC, KeyM, KeyG, or touch names like 'horn').
  take(code) {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  endFrame() { this.pressed.clear(); }
}
