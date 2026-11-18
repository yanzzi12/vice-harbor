// People: simple articulated low-poly figures (legs and arms that swing as they walk, an
// arm that rises to aim a pistol) and the Person record the simulation moves around —
// the player, Valencia the accomplice, pedestrians, showroom guards and police officers.
// Figures face +Z, like the cars.

const SKIN_TONES = [0xf2c79b, 0xc98d5f, 0x8a5a34, 0x6e4226, 0xffdbb8];
const SHIRTS = [0xe84a5f, 0x39c2ff, 0xffd23e, 0x7dff9a, 0xf0f0f0, 0x8a6ff0, 0xff8c52, 0x2ec4b6];
const PANTS = [0x2c3550, 0x4a3b2c, 0x22242c, 0x5a6e46, 0x704214];

function limb(w, h, d, mat) {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.y = -h / 2;
  mesh.castShadow = true;
  g.add(mesh);
  return g;
}

export function makePersonMesh(opts) {
  const { shirt, pants, skin, hair, female, uniform } = opts;
  const g = new THREE.Group();
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const hairMat = new THREE.MeshLambertMaterial({ color: hair });

  const legL = limb(0.21, 0.92, 0.24, pantsMat); legL.position.set(-0.13, 0.92, 0);
  const legR = limb(0.21, 0.92, 0.24, pantsMat); legR.position.set(0.13, 0.92, 0);
  g.add(legL); g.add(legR);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.62, 0.3), shirtMat);
  torso.position.y = 1.24;
  torso.castShadow = true;
  g.add(torso);
  if (female) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.34), hairMat);
    skirt.position.y = 0.98;
    g.add(skirt);
  }
  if (uniform) {
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.02), new THREE.MeshBasicMaterial({ color: 0xffd23e }));
    badge.position.set(0.15, 1.36, 0.17);
    g.add(badge);
  }

  const armL = limb(0.15, 0.78, 0.17, shirtMat); armL.position.set(-0.36, 1.5, 0);
  const armR = limb(0.15, 0.78, 0.17, shirtMat); armR.position.set(0.36, 1.5, 0);
  // Bare forearms: a skin tip at the end of each arm.
  for (const arm of [armL, armR]) {
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.15), skinMat);
    hand.position.y = -0.82;
    arm.add(hand);
  }
  g.add(armL); g.add(armR);

  const head = new THREE.Group();
  head.position.y = 1.62;
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.34), skinMat);
  skull.position.y = 0.18;
  skull.castShadow = true;
  head.add(skull);
  const hairMesh = new THREE.Mesh(new THREE.BoxGeometry(0.38, female ? 0.16 : 0.12, 0.38), hairMat);
  hairMesh.position.y = 0.4;
  head.add(hairMesh);
  if (female) {
    const locks = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.62, 0.1), hairMat);
    locks.position.set(0, 0.08, -0.16);
    head.add(locks);
  }
  if (uniform) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.4), new THREE.MeshLambertMaterial({ color: 0x1b2a6b }));
    cap.position.y = 0.42;
    head.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.22), new THREE.MeshLambertMaterial({ color: 0x11142a }));
    brim.position.set(0, 0.36, 0.26);
    head.add(brim);
  }
  g.add(head);

  // A pistol prop for whoever is armed; the world toggles its visibility.
  const gun = new THREE.Group();
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.3), new THREE.MeshLambertMaterial({ color: 0x1a1a20 }));
  gunBody.position.set(0, -0.05, 0.1);
  gun.add(gunBody);
  gun.position.set(0, -0.86, 0.05);
  armR.add(gun);

  g.userData.parts = { legL, legR, armL, armR, head, gun };
  return g;
}

export class Person {
  constructor(role, mesh, x, z) {
    this.role = role;
    this.mesh = mesh;
    this.mesh.position.set(x, 0, z);
    this.heading = 0;
    this.health = role === 'officer' || role === 'guard' ? 60 : 100;
    this.maxHealth = this.health;
    this.dead = false;
    this.walkPhase = 0;
    this.moving = false;
    this.aiming = false;
    this.fleeing = 0;
    this.wanderAngle = Math.random() * Math.PI * 2;
    this.stateT = 0;
    this.shootT = 1 + Math.random();
    this.radius = 0.55;
  }

  get pos() { return this.mesh.position; }

  /** Face a world point smoothly. */
  faceToward(x, z, dt, rate) {
    const want = Math.atan2(x - this.pos.x, z - this.pos.z);
    let diff = want - this.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = (rate || 10) * dt;
    this.heading += Math.max(-turn, Math.min(turn, diff));
    this.mesh.rotation.y = this.heading;
  }

  /** Advance the walk-cycle pose. Call every frame after moving. */
  pose(dt, speed) {
    const parts = this.mesh.userData.parts;
    this.moving = speed > 0.3;
    if (this.moving) this.walkPhase += dt * speed * 1.6;
    const swing = this.moving ? Math.sin(this.walkPhase) * 0.6 : 0;
    parts.legL.rotation.x = swing;
    parts.legR.rotation.x = -swing;
    if (this.aiming) {
      parts.armR.rotation.x = -Math.PI / 2 + 0.06;
      parts.armL.rotation.x = swing * 0.4;
    } else {
      parts.armR.rotation.x = -swing * 0.8;
      parts.armL.rotation.x = swing * 0.8;
    }
    if (this.dead) this.mesh.rotation.x = -Math.PI / 2;
  }

  setGunVisible(v) {
    this.mesh.userData.parts.gun.visible = v;
  }

  damage(amount) {
    if (this.dead) return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.setGunVisible(false);
      return true;
    }
    return false;
  }
}

export function randomPedMesh(rng) {
  return makePersonMesh({
    shirt: SHIRTS[Math.floor(rng() * SHIRTS.length)],
    pants: PANTS[Math.floor(rng() * PANTS.length)],
    skin: SKIN_TONES[Math.floor(rng() * SKIN_TONES.length)],
    hair: [0x241a12, 0x4a2e16, 0x777777, 0xb58a4a][Math.floor(rng() * 4)],
    female: rng() < 0.45,
    uniform: false,
  });
}

export function officerMesh() {
  return makePersonMesh({ shirt: 0x27356e, pants: 0x1c2440, skin: 0xe8b98d, hair: 0x241a12, female: false, uniform: true });
}

export function playerMesh() {
  return makePersonMesh({ shirt: 0x12b5a5, pants: 0x2c3550, skin: 0xc98d5f, hair: 0x18100a, female: false, uniform: false });
}

export function valenciaMesh() {
  return makePersonMesh({ shirt: 0xff2e88, pants: 0x1d1d26, skin: 0xa06838, hair: 0x120c08, female: true, uniform: false });
}
