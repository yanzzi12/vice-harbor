// Vehicles: low-poly car meshes built from boxes and cylinders (a traffic sedan, a taxi,
// a police interceptor with a light bar, and the one-off NORDWIND One:1 hypercar with its
// tall rear wing and dihedral-door sills) plus the arcade driving model every car shares —
// throttle, drift with the handbrake, and health that ends in smoke and a dead engine.
// Cars are built facing +Z; heading 0 therefore faces +Z and forward is (sin h, cos h).

import { range } from './random.js';

export const CAR_COLORS = [0xe84a5f, 0x39c2ff, 0xffd23e, 0x7dff9a, 0xf0f0f0, 0x8a6ff0, 0xff8c52, 0x2ec4b6, 0xd9d9d9, 0x35507a];

const glassMat = new THREE.MeshPhongMaterial({ color: 0x18222e, shininess: 160, specular: 0xbfe8ff });
const tyreMat = new THREE.MeshLambertMaterial({ color: 0x14151a });
const rimMat = new THREE.MeshLambertMaterial({ color: 0xb9c0c8 });

function wheel(r) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 12), tyreMat);
  tyre.rotation.z = Math.PI / 2;
  g.add(tyre);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.32, 8), rimMat);
  rim.rotation.z = Math.PI / 2;
  g.add(rim);
  return g;
}

function baseCar(color, opts) {
  const { length, width, bodyH, cabinLen, cabinBack } = opts;
  const car = new THREE.Group();
  const paint = new THREE.MeshPhongMaterial({ color, shininess: 90, specular: 0x888888 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, bodyH, length), paint);
  body.position.y = 0.38 + bodyH / 2;
  body.castShadow = true;
  car.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(width * 0.86, bodyH * 0.82, cabinLen), glassMat);
  cabin.position.set(0, 0.38 + bodyH + bodyH * 0.36, cabinBack);
  cabin.castShadow = true;
  car.add(cabin);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), lightMat);
    hl.position.set(sx * width * 0.32, 0.72, length / 2 + 0.02);
    car.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.13, 0.08), new THREE.MeshBasicMaterial({ color: 0xff2a30 }));
    tl.position.set(sx * width * 0.32, 0.78, -length / 2 - 0.02);
    car.add(tl);
  }
  const wheels = [];
  const wr = opts.wheelR || 0.34;
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = wheel(wr);
    w.position.set(sx * (width / 2 - 0.05), wr, sz * (length / 2 - 0.85));
    car.add(w);
    wheels.push(w);
  }
  car.userData.wheels = wheels;
  car.userData.paint = paint;
  return car;
}

export function makeTrafficCar(rng) {
  const taxi = rng() < 0.22;
  const color = taxi ? 0xffc21c : CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)];
  const car = baseCar(color, { length: range(rng, 4.1, 4.6), width: 1.9, bodyH: 0.55, cabinLen: 2.0, cabinBack: -0.2 });
  if (taxi) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.34), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
    sign.position.set(0, 1.62, -0.2);
    car.add(sign);
  }
  return car;
}

export function makePoliceCar() {
  const car = baseCar(0xf2f4f6, { length: 4.6, width: 1.95, bodyH: 0.58, cabinLen: 2.1, cabinBack: -0.2 });
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.97, 0.3, 4.62), new THREE.MeshLambertMaterial({ color: 0x1b2a6b }));
  stripe.position.y = 0.62;
  car.add(stripe);
  const barRed = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  const barBlue = new THREE.MeshBasicMaterial({ color: 0x2255ff });
  const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.4), new THREE.MeshLambertMaterial({ color: 0x222222 }));
  barBase.position.set(0, 1.66, -0.2);
  car.add(barBase);
  const rl = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.36), barRed);
  rl.position.set(-0.31, 1.8, -0.2);
  car.add(rl);
  const bl = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.36), barBlue);
  bl.position.set(0.31, 1.8, -0.2);
  car.add(bl);
  car.userData.lightMats = [barRed, barBlue];
  return car;
}

/** The NORDWIND One:1 — low, wide, huge wing, orange on pearl white. One exists. */
export function makeHypercar() {
  const car = new THREE.Group();
  const pearl = new THREE.MeshPhongMaterial({ color: 0xf4f1ea, shininess: 160, specular: 0xffffff });
  const orange = new THREE.MeshPhongMaterial({ color: 0xff6a00, shininess: 120 });
  const carbon = new THREE.MeshLambertMaterial({ color: 0x17181d });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.42, 4.7), pearl);
  body.position.y = 0.52;
  body.castShadow = true;
  car.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.24, 1.1), pearl);
  nose.position.set(0, 0.42, 2.55);
  nose.rotation.x = 0.1;
  car.add(nose);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 4.72), orange);
  stripe.position.y = 0.75;
  car.add(stripe);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.4, 2.2), glassMat);
  canopy.position.set(0, 0.85, 0.25);
  canopy.castShadow = true;
  car.add(canopy);
  for (const sx of [-1, 1]) {
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 1.3), carbon);
    intake.position.set(sx * 1.08, 0.55, -0.7);
    car.add(intake);
    // Dihedral door sill line — the One:1's signature slash.
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 1.7), orange);
    sill.position.set(sx * 1.09, 0.38, 0.75);
    sill.rotation.x = -0.25;
    car.add(sill);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.42, 0.3), carbon);
    strut.position.set(sx * 0.55, 1.0, -2.05);
    car.add(strut);
  }
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.09, 0.55), carbon);
  wing.position.set(0, 1.24, -2.1);
  wing.castShadow = true;
  car.add(wing);
  const wingTip = new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.16, 0.2), orange);
  wingTip.position.set(0, 1.24, -2.32);
  car.add(wingTip);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.22, 0.4), carbon);
  diffuser.position.set(0, 0.3, -2.4);
  car.add(diffuser);
  const wheels = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = wheel(0.37);
    w.position.set(sx * 1.02, 0.37, sz * 1.55);
    car.add(w);
    wheels.push(w);
  }
  car.userData.wheels = wheels;
  // Neon underglow so the price of the city reads at a glance.
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 5.6),
    new THREE.MeshBasicMaterial({ color: 0xff6a00, transparent: true, opacity: 0.3, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.06;
  car.add(glow);
  return car;
}

const SPECS = {
  traffic: { accel: 15, maxSpeed: 33, grip: 9, health: 90 },
  police: { accel: 23, maxSpeed: 47, grip: 9.5, health: 110 },
  hyper: { accel: 30, maxSpeed: 63, grip: 10, health: 160 },
  player: { accel: 19, maxSpeed: 40, grip: 9.5, health: 120 },
};

export class Vehicle {
  constructor(kind, mesh) {
    this.kind = kind;
    this.mesh = mesh;
    this.spec = SPECS[kind === 'hyper' ? 'hyper' : kind] || SPECS.player;
    this.heading = 0;
    this.vx = 0; this.vz = 0;
    this.speed = 0;         // signed forward speed, for the HUD and AI
    this.steer = 0;
    this.health = this.spec.health;
    this.maxHealth = this.spec.health;
    this.dead = false;
    this.driver = null;     // 'player' | 'traffic' | 'police' | 'valencia' | null
    this.radius = kind === 'hyper' ? 2.5 : 2.3;
    this.wheelSpin = 0;
    this.crashCooldown = 0;
  }

  get pos() { return this.mesh.position; }

  forward() { return { x: Math.sin(this.heading), z: Math.cos(this.heading) }; }

  /** Arcade drive step. input: {throttle -1..1, steer -1..1, handbrake bool}. */
  drive(dt, input) {
    if (this.dead) { this.vx *= 0.9; this.vz *= 0.9; this.applyMove(dt); return; }
    const f = this.forward();
    const rx = -f.z, rz = f.x; // left vector; right is its negation
    let vf = this.vx * f.x + this.vz * f.z;
    let vl = this.vx * rx + this.vz * rz;
    const throttle = input.throttle || 0;
    if (throttle > 0) {
      vf += this.spec.accel * throttle * dt * (vf < 0 ? 2.4 : 1); // strong brakes bite first
    } else if (throttle < 0) {
      if (vf > 0.5) vf -= 30 * -throttle * dt;                    // brake lights on
      else vf = Math.max(vf + 10 * throttle * dt, -11);           // then reverse
    }
    // Drag and rolling resistance.
    vf -= vf * 0.55 * dt;
    if (throttle === 0) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 2.2 * dt);
    vf = Math.max(-11, Math.min(this.spec.maxSpeed, vf));
    // Steering: more at low speed, drifty with the handbrake.
    const steerTarget = (input.steer || 0) * 0.55;
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 8);
    const speedFactor = Math.max(-1, Math.min(1, vf / 9));
    this.heading -= this.steer * speedFactor * dt * (input.handbrake ? 2.6 : 1.9);
    const grip = input.handbrake ? 2.0 : this.spec.grip;
    vl *= Math.exp(-grip * dt);
    const nf = this.forward();
    const nrx = -nf.z, nrz = nf.x;
    this.vx = nf.x * vf + nrx * vl;
    this.vz = nf.z * vf + nrz * vl;
    this.speed = vf;
    this.applyMove(dt);
    // Wheel visuals.
    this.wheelSpin += vf * dt / 0.35;
    const wheels = this.mesh.userData.wheels || [];
    for (const w of wheels) w.rotation.x = this.wheelSpin;
    if (wheels[0]) { wheels[0].rotation.y = -this.steer * 0.7; wheels[1].rotation.y = -this.steer * 0.7; }
    this.crashCooldown = Math.max(0, this.crashCooldown - dt);
  }

  applyMove(dt) {
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    this.pos.x = Math.max(-318, Math.min(318, this.pos.x));
    this.pos.z = Math.max(-318, Math.min(318, this.pos.z));
    this.mesh.rotation.y = this.heading;
  }

  /** Push the car out of a building box; returns impact speed if it hit hard. */
  collideBox(box) {
    const r = this.radius * 0.78;
    const nx = Math.max(box.minX, Math.min(box.maxX, this.pos.x));
    const nz = Math.max(box.minZ, Math.min(box.maxZ, this.pos.z));
    const dx = this.pos.x - nx, dz = this.pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 > r * r) return 0;
    const impact = Math.hypot(this.vx, this.vz);
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      this.pos.x = nx + (dx / d) * r;
      this.pos.z = nz + (dz / d) * r;
      const dot = this.vx * (dx / d) + this.vz * (dz / d);
      if (dot < 0) { this.vx -= dot * (dx / d) * 1.4; this.vz -= dot * (dz / d) * 1.4; }
    } else {
      // Centre inside the box: push out along the smallest penetration axis.
      const pl = this.pos.x - box.minX, pr = box.maxX - this.pos.x;
      const pt = this.pos.z - box.minZ, pb = box.maxZ - this.pos.z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) this.pos.x = box.minX - r; else if (m === pr) this.pos.x = box.maxX + r;
      else if (m === pt) this.pos.z = box.minZ - r; else this.pos.z = box.maxZ + r;
      this.vx *= -0.25; this.vz *= -0.25;
    }
    return impact;
  }

  damage(amount) {
    if (this.dead) return;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
    }
  }
}
