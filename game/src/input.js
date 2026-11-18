// Keyboard and mouse state: held keys, one-frame presses, mouse deltas (pointer lock when
// available, drag-aim otherwise) and the firing button. The world reads this object; the
// demo autopilot writes the same shape, so staged scenes drive the real controls.

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.firing = false;
    this.firePressed = false;
    this.locked = false;
    this.canvas = canvas || null;

    if (canvas) {
      addEventListener('keydown', (e) => {
        if (e.repeat) return;
        this.keys.add(e.code);
        this.pressed.add(e.code);
        if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
      });
      addEventListener('keyup', (e) => this.keys.delete(e.code));
      addEventListener('blur', () => { this.keys.clear(); this.firing = false; });
      canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) { this.firing = true; this.firePressed = true; }
      });
      addEventListener('mouseup', (e) => { if (e.button === 0) this.firing = false; });
      addEventListener('mousemove', (e) => {
        if (this.locked || (this.firing && e.buttons === 1)) {
          this.mouseDX += e.movementX || 0;
          this.mouseDY += e.movementY || 0;
        }
      });
      document.addEventListener('pointerlockchange', () => {
        this.locked = document.pointerLockElement === canvas;
      });
    }
  }

  /** Ask for pointer lock (called on a user gesture while playing). */
  requestLock() {
    if (!this.locked && this.canvas && this.canvas.requestPointerLock) {
      try { this.canvas.requestPointerLock(); } catch { /* denied: drag aim still works */ }
    }
  }

  exitLock() {
    if (this.locked && document.exitPointerLock) document.exitPointerLock();
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }

  /** Virtual press used by the demo autopilot: held this frame and registered as a tap. */
  tap(code) { this.keys.add(code); this.pressed.add(code); }

  /** Consume per-frame deltas and one-frame presses; call once at the end of a frame. */
  endFrame() {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.firePressed = false;
    this.pressed.clear();
  }
}
