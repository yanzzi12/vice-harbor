// Transient visual effects, all pooled so nothing allocates in the frame loop: bullet
// tracers (short-lived additive lines), muzzle flashes, grey smoke that pours from dying
// engines, and orange impact sparks. Two point clouds with ring-buffer particles do the
// smoke and spark work.

const SMOKE_MAX = 260;
const SPARK_MAX = 200;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    for (let i = 0; i < 40; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.tracerIdx = 0;

    this.flashes = [];
    const flashTex = makeFlashTexture();
    for (let i = 0; i < 12; i++) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flashTex, color: 0xffc46b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      spr.scale.set(0.9, 0.9, 1);
      spr.visible = false;
      scene.add(spr);
      this.flashes.push({ spr, life: 0 });
    }
    this.flashIdx = 0;

    this.smoke = makePoints(scene, SMOKE_MAX, 0x555560, 3.4, 0.5);
    this.sparks = makePoints(scene, SPARK_MAX, 0xffa63e, 0.55, 0.95);
  }

  tracer(from, to, color) {
    const t = this.tracers[this.tracerIdx++ % this.tracers.length];
    const p = t.line.geometry.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z;
    p[3] = to.x; p[4] = to.y; p[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color || 0xffd9a0);
    t.line.material.opacity = 0.9;
    t.line.visible = true;
    t.life = 0.07;
  }

  muzzle(at) {
    const f = this.flashes[this.flashIdx++ % this.flashes.length];
    f.spr.position.copy(at);
    f.spr.material.opacity = 0.95;
    f.spr.material.rotation = Math.random() * Math.PI;
    f.spr.visible = true;
    f.life = 0.05;
  }

  emitSmoke(x, y, z, n, spread) {
    emit(this.smoke, x, y, z, n, spread || 0.6, 1.6, 2.6);
  }

  emitSparks(x, y, z, n) {
    emit(this.sparks, x, y, z, n, 2.6, -3.5, 0.7);
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
        if (t.life <= 0) t.line.visible = false;
      }
    }
    for (const f of this.flashes) {
      if (f.life > 0) {
        f.life -= dt;
        f.spr.material.opacity = Math.max(0, f.life / 0.05);
        if (f.life <= 0) f.spr.visible = false;
      }
    }
    stepPoints(this.smoke, dt);
    stepPoints(this.sparks, dt);
  }
}

function makeFlashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.4, 'rgba(255,180,80,0.75)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function makePoints(scene, max, color, size, opacity) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3).fill(-9999);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color, size, transparent: true, opacity, depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  return {
    points, pos, max, idx: 0,
    vel: new Float32Array(max * 3),
    life: new Float32Array(max),
    maxLife: new Float32Array(max),
  };
}

function emit(sys, x, y, z, n, spread, up, life) {
  for (let k = 0; k < n; k++) {
    const i = sys.idx++ % sys.max;
    sys.pos[i * 3] = x + (Math.random() - 0.5) * 0.5;
    sys.pos[i * 3 + 1] = y + Math.random() * 0.3;
    sys.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.5;
    sys.vel[i * 3] = (Math.random() - 0.5) * spread;
    sys.vel[i * 3 + 1] = up * (0.5 + Math.random() * 0.8);
    sys.vel[i * 3 + 2] = (Math.random() - 0.5) * spread;
    sys.life[i] = sys.maxLife[i] = life * (0.6 + Math.random() * 0.7);
  }
}

function stepPoints(sys, dt) {
  let any = false;
  for (let i = 0; i < sys.max; i++) {
    if (sys.life[i] <= 0) continue;
    any = true;
    sys.life[i] -= dt;
    if (sys.life[i] <= 0) { sys.pos[i * 3 + 1] = -9999; continue; }
    sys.pos[i * 3] += sys.vel[i * 3] * dt;
    sys.pos[i * 3 + 1] += sys.vel[i * 3 + 1] * dt;
    sys.pos[i * 3 + 2] += sys.vel[i * 3 + 2] * dt;
  }
  if (any) sys.points.geometry.attributes.position.needsUpdate = true;
}
