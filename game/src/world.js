// The simulation core: every entity and system that makes Port Azura a game — the player
// and Valencia, the One:1 and the traffic around it, pedestrians, showroom guards, the
// wanted system and the APD response, the three-act heist mission, weapons and pickups,
// collisions and damage. Rendering and the camera live in main.js; this file only thinks.

import { CITY, ROADS, PLAYER, WEAPONS, WANTED, POLICE, TRAFFIC, MISSION } from './config.js';
import { makeRng, range } from './random.js';
import { buildCity } from './city.js';
import { Vehicle, makeTrafficCar, makeHypercar } from './vehicles.js';
import { Person, makePersonMesh, randomPedMesh, playerMesh, valenciaMesh, officerMesh } from './people.js';
import { PoliceManager } from './police.js';
import { Effects } from './effects.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function raySphere(o, d, c, r) {
  const ox = c.x - o.x, oy = c.y - o.y, oz = c.z - o.z;
  const t = ox * d.x + oy * d.y + oz * d.z;
  if (t < 0) return -1;
  const d2 = ox * ox + oy * oy + oz * oz - t * t;
  if (d2 > r * r) return -1;
  return t - Math.sqrt(r * r - d2);
}

export class World {
  constructor(scene, sound, seed) {
    this.scene = scene;
    this.sound = sound;
    this.seed = seed || 7;
    this.rng = makeRng(this.seed);
    this.city = buildCity(scene, this.rng);
    this.effects = new Effects(scene);
    this.group = new THREE.Group();
    scene.add(this.group);
    this.ui = { toast: () => {}, objective: () => {}, gameOver: () => {}, missionComplete: () => {}, prompt: () => {}, damageFlash: () => {} };
    this.reset();
  }

  reset() {
    this.scene.remove(this.group);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    if (this.marker) this.scene.remove(this.marker);
    this.rng = makeRng(this.seed);
    this.time = 0;
    this.heat = 0;
    this.cash = 0;
    this.copsDisabled = 0;
    this.shotsFired = 0;
    this.bustedMeter = 0;
    this.mode = 'title';           // main.js drives screens; world simulates when 'playing'
    this.stage = 'intro';          // intro -> steal -> escape -> done
    this.freeroam = false;
    this.heatLocked = false;
    this.lastDamageT = -99;
    this.weapon = 'pistol';
    this.ammo = { pistol: WEAPONS.pistol.mag, smg: WEAPONS.smg.mag };
    this.hasSmg = false;
    this.reloadT = 0;
    this.coolT = 0;
    this.valShootT = 1.5;
    this.over = null;

    // The player and Valencia.
    this.player = new Person('player', playerMesh(), MISSION.startPos.x, MISSION.startPos.z);
    this.player.setGunVisible(true);
    this.group.add(this.player.mesh);
    this.valencia = new Person('valencia', valenciaMesh(), MISSION.startPos.x + 2.2, MISSION.startPos.z + 1.5);
    this.valencia.setGunVisible(true);
    this.group.add(this.valencia.mesh);
    this.valencia.state = 'follow'; // follow | passenger | down
    this.playerCar = null;

    // The One:1 on its showroom pad.
    const pad = this.city.hypercarPad;
    this.hyper = new Vehicle('hyper', makeHypercar());
    this.hyper.mesh.position.set(pad.x, 0.55, pad.z);
    this.hyper.heading = pad.heading;
    this.hyper.mesh.rotation.y = pad.heading;
    this.group.add(this.hyper.mesh);

    // Traffic and pedestrians.
    this.traffic = [];
    for (let i = 0; i < TRAFFIC.cars; i++) this.spawnTraffic(true);
    this.peds = [];
    for (let i = 0; i < TRAFFIC.peds; i++) this.spawnPed(true);

    // Showroom guards: polite until the car moves.
    this.guards = [];
    for (const [gx, gz] of [[-7, 16], [7, 16]]) {
      const mesh = makePersonMesh({ shirt: 0x14141c, pants: 0x14141c, skin: 0xe8b98d, hair: 0x0c0c0c, female: false, uniform: false });
      const guard = new Person('guard', mesh, MISSION.showroomPos.x + gx, MISSION.showroomPos.z + gz);
      guard.setGunVisible(true);
      guard.aggro = false;
      this.group.add(guard.mesh);
      this.guards.push(guard);
    }

    // SMG pickups: the showroom stores room and the hideout yard.
    this.pickups = [];
    for (const p of [
      { x: MISSION.showroomPos.x + 15, z: MISSION.showroomPos.z - 8 },
      { x: MISSION.hideoutPos.x - 12, z: MISSION.hideoutPos.z + 8 },
    ]) {
      const mesh = makePickupMesh();
      mesh.position.set(p.x, 0.9, p.z);
      this.group.add(mesh);
      this.pickups.push({ mesh, x: p.x, z: p.z, taken: false });
    }

    // The objective marker: a pillar of light the whole city can see.
    this.marker = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.4, 42, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    this.marker.position.set(this.city.showroomDoor.x, 21, this.city.showroomDoor.z);
    this.scene.add(this.marker);

    this.police = new PoliceManager(this.group, this, this.rng);
    this.setStage('intro');
  }

  // ---------- helpers the police manager and HUD use ----------

  get stars() { return Math.min(6, Math.ceil(this.heat - 0.0001)); }

  playerPos() { return this.playerCar ? this.playerCar.pos : this.player.pos; }
  playerVelocity() {
    if (this.playerCar) return { x: this.playerCar.vx, z: this.playerCar.vz };
    return { x: 0, z: 0 };
  }
  playerDriving() { return !!this.playerCar; }
  playerHeading() { return this.playerCar ? this.playerCar.heading : this.player.heading; }
  playerAheadPoint(dist) {
    const p = this.playerPos();
    const v = this.playerVelocity();
    const sp = Math.hypot(v.x, v.z);
    if (sp < 4) return null;
    return { x: p.x + (v.x / sp) * dist, z: p.z + (v.z / sp) * dist };
  }

  allVehicles() {
    const list = [this.hyper, ...this.traffic];
    for (const c of this.police.cars) list.push(c.vehicle);
    return list;
  }

  addHeat(amount) {
    if (this.heatLocked) { this.heat = WANTED.missionHeat; return; }
    this.heat = Math.max(0, Math.min(6, this.heat + amount));
  }

  setStage(stage) {
    this.stage = stage;
    if (stage === 'intro') {
      this.ui.objective('Meet Valencia at the Azure Palms showroom');
      this.marker.position.set(this.city.showroomDoor.x, 21, this.city.showroomDoor.z);
    } else if (stage === 'steal') {
      this.ui.objective('Steal the NORDWIND One:1 — get in (E)');
      this.marker.position.set(this.hyper.pos.x, 21, this.hyper.pos.z);
    } else if (stage === 'escape') {
      this.ui.objective('ESCAPE — reach the hideout at the north docks');
      this.marker.position.set(this.city.hideoutMarker.x, 21, this.city.hideoutMarker.z);
    } else if (stage === 'done') {
      this.ui.objective(this.freeroam ? 'Free roam — the city is yours. Cause trouble, dodge the APD.' : 'Heist complete!');
      this.marker.position.set(-9999, -100, -9999);
    }
  }

  // ---------- main step ----------

  update(dt, input, aim) {
    if (this.mode !== 'playing') return;
    this.time += dt;
    this.effects.update(dt);
    this.marker.material.opacity = 0.13 + Math.sin(this.time * 3) * 0.045;

    this.updatePlayer(dt, input, aim);
    this.updateValencia(dt);
    this.updateTraffic(dt);
    this.updatePeds(dt);
    this.updateGuards(dt);
    this.police.update(dt, this.stars, this.playerPos());
    this.updateCollisions(dt);
    this.updateWanted(dt);
    this.updateMission(dt);
    this.updatePickups(dt);
    this.updateSmoke(dt);

    // Sun shadow frustum follows the action.
    const p = this.playerPos();
    this.city.sun.position.set(p.x - 180, 190, p.z + 100);
    this.city.sun.target.position.set(p.x, 0, p.z);
    this.city.sun.target.updateMatrixWorld();

    // Audio beds.
    let nearestCop = 999;
    for (const c of this.police.cars) {
      const d = Math.hypot(c.vehicle.pos.x - p.x, c.vehicle.pos.z - p.z);
      if (d < nearestCop) nearestCop = d;
    }
    this.sound.update(dt, {
      driving: !!this.playerCar,
      engineSpeed: this.playerCar ? Math.abs(this.playerCar.speed) : 0,
      throttle: input && input.down('KeyW'),
      policeNear: this.police.cars.length > 0 && nearestCop < 160,
      policeDist: nearestCop,
      skidding: !!this.playerCar && input && input.down('Space') && Math.abs(this.playerCar.speed) > 8,
    });
  }

  // ---------- the player ----------

  updatePlayer(dt, input, aim) {
    const pl = this.player;
    if (pl.dead) return;
    this.coolT -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.ammo[this.weapon] = WEAPONS[this.weapon].mag;
    }
    if (input.hit('Digit1')) this.weapon = 'pistol';
    if (input.hit('Digit2') && this.hasSmg) this.weapon = 'smg';
    if (input.hit('KeyR')) this.startReload();

    if (this.playerCar) {
      const car = this.playerCar;
      this.ui.prompt(null);
      const driveInput = {
        throttle: (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) + (input.down('KeyS') || input.down('ArrowDown') ? -1 : 0),
        steer: (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0) + (input.down('KeyD') || input.down('ArrowRight') ? -1 : 0),
        handbrake: input.down('Space'),
      };
      car.drive(dt, driveInput);
      pl.mesh.visible = false;
      if (input.hit('KeyE')) this.exitCar();
      if ((input.firing || input.firePressed) && this.reloadT <= 0) this.tryShoot(aim, true);
      return;
    }

    pl.mesh.visible = true;
    // On foot: move relative to the camera yaw the main loop passes in aim.
    const camYaw = aim ? aim.yaw : pl.heading;
    let mx = 0, mz = 0;
    if (input.down('KeyW') || input.down('ArrowUp')) mz += 1;
    if (input.down('KeyS') || input.down('ArrowDown')) mz -= 1;
    if (input.down('KeyA') || input.down('ArrowLeft')) mx -= 1;
    if (input.down('KeyD') || input.down('ArrowRight')) mx += 1;
    const moving = (mx !== 0 || mz !== 0);
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const speed = sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    if (moving) {
      const len = Math.hypot(mx, mz);
      const wx = (Math.sin(camYaw) * mz + Math.cos(camYaw) * mx) / len;
      const wz = (Math.cos(camYaw) * mz - Math.sin(camYaw) * mx) / len;
      pl.pos.x += wx * speed * dt;
      pl.pos.z += wz * speed * dt;
      if (!input.firing) pl.faceToward(pl.pos.x + wx, pl.pos.z + wz, dt, 14);
    }
    if (input.firing) {
      pl.faceToward(pl.pos.x + Math.sin(camYaw), pl.pos.z + Math.cos(camYaw), dt, 20);
      pl.aiming = true;
      if (this.reloadT <= 0) this.tryShoot(aim, false);
    } else {
      pl.aiming = input.firing;
    }
    pl.pose(dt, moving ? speed : 0);
    this.collidePerson(pl);
    pl.pos.x = Math.max(-CITY.half - 14, Math.min(CITY.half + 14, pl.pos.x));
    pl.pos.z = Math.max(-CITY.half - 14, Math.min(CITY.half + 14, pl.pos.z));

    // Enter a car.
    const near = this.nearestEnterableCar();
    if (near) {
      this.ui.prompt(`<b>E</b> — ${near === this.hyper ? 'Steal the NORDWIND One:1' : 'Enter car'}`);
      if (input.hit('KeyE')) this.enterCar(near);
    } else {
      this.ui.prompt(null);
    }

    // Health regen after a quiet spell.
    if (this.time - this.lastDamageT > 6 && pl.health > 0 && pl.health < PLAYER.maxHealth) {
      pl.health = Math.min(PLAYER.maxHealth, pl.health + 6 * dt);
    }
  }

  nearestEnterableCar() {
    let best = null, bestD = 3.4;
    for (const v of this.allVehicles()) {
      if (v.dead) continue;
      const d = Math.hypot(v.pos.x - this.player.pos.x, v.pos.z - this.player.pos.z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  enterCar(vehicle) {
    const wasHyper = vehicle === this.hyper;
    if (vehicle.driver === 'traffic') {
      // The owner bails out and runs.
      vehicle.driver = null;
      this.spawnFleeingDriver(vehicle);
    }
    vehicle.driver = 'player';
    this.playerCar = vehicle;
    this.player.mesh.visible = false;
    this.sound.enterCar();
    if (wasHyper && this.stage === 'steal') this.beginEscape();
    else if (!wasHyper && vehicle.kind === 'traffic') this.addHeat(WANTED.crimeSteal);
    // Valencia piles in if she is close.
    if (!this.valencia.dead && Math.hypot(this.valencia.pos.x - vehicle.pos.x, this.valencia.pos.z - vehicle.pos.z) < 26) {
      this.valencia.state = 'toCar';
    }
  }

  exitCar() {
    const car = this.playerCar;
    if (!car) return;
    car.driver = null;
    this.playerCar = null;
    const side = { x: -Math.cos(car.heading), z: Math.sin(car.heading) };
    this.player.pos.set(car.pos.x + side.x * 2.2, 0, car.pos.z + side.z * 2.2);
    this.player.mesh.visible = true;
    this.player.heading = car.heading;
    if (this.valencia.state === 'passenger') {
      this.valencia.state = 'follow';
      this.valencia.pos.set(car.pos.x - side.x * 2.2, 0, car.pos.z - side.z * 2.2);
      this.valencia.mesh.visible = true;
    }
    this.sound.enterCar();
  }

  beginEscape() {
    this.setStage('escape');
    this.heatLocked = true;
    this.heat = WANTED.missionHeat;
    for (const g of this.guards) g.aggro = true;
    this.sound.alarm();
    this.ui.toast('★ SIX STARS — THE WHOLE APD IS COMING ★', 3.4);
  }

  // ---------- shooting ----------

  startReload() {
    const w = WEAPONS[this.weapon];
    if (this.reloadT > 0 || this.ammo[this.weapon] >= w.mag) return;
    this.reloadT = w.reload;
    this.sound.reload();
  }

  tryShoot(aim, fromCar) {
    const w = WEAPONS[this.weapon];
    if (this.coolT > 0) return;
    if (this.ammo[this.weapon] <= 0) { this.startReload(); return; }
    if (!w.auto && !this._fireEdge) { /* semi-auto handled by main via firePressed */ }
    this.coolT = w.interval;
    this.ammo[this.weapon]--;
    this.shotsFired++;
    this.addHeat(WANTED.crimeShot);
    const origin = fromCar
      ? V3(this.playerCar.pos.x, 1.25, this.playerCar.pos.z)
      : V3(this.player.pos.x, 1.45, this.player.pos.z);
    const dir = aim ? aim.dir : V3(Math.sin(this.player.heading), 0, Math.cos(this.player.heading));
    const spread = w.spread;
    const d = V3(
      dir.x + (Math.random() - 0.5) * spread * 2,
      dir.y + (Math.random() - 0.5) * spread,
      dir.z + (Math.random() - 0.5) * spread * 2).normalize();
    this.sound.gunshot(false);
    const muzzleAt = V3(origin.x + d.x * 0.7, origin.y + d.y * 0.7, origin.z + d.z * 0.7);
    this.effects.muzzle(muzzleAt);
    this.resolveShot(origin, d, w, 'player');
    if (this.ammo[this.weapon] === 0) this.startReload();
  }

  /** Shared hitscan: persons, vehicles, buildings, ground. Returns the hit point. */
  resolveShot(origin, dir, weapon, shooter) {
    let bestT = weapon.range;
    let hit = null;
    const testPerson = (p, kind) => {
      if (p.dead) return;
      const t = raySphere(origin, dir, V3(p.pos.x, 1.05, p.pos.z), 0.85);
      if (t > 0 && t < bestT) { bestT = t; hit = { kind, ref: p }; }
    };
    const testVehicle = (v) => {
      if (v.dead) return;
      const t = raySphere(origin, dir, V3(v.pos.x, 0.75, v.pos.z), 2.35);
      if (t > 0 && t < bestT) { bestT = t; hit = { kind: 'vehicle', ref: v }; }
    };
    if (shooter !== 'player') testPerson(this.player, 'player');
    if (shooter !== 'valencia') testPerson(this.valencia, 'valencia');
    for (const p of this.peds) testPerson(p, 'ped');
    for (const g of this.guards) testPerson(g, 'guard');
    for (const o of this.police.officers) testPerson(o, 'officer');
    for (const v of this.allVehicles()) testVehicle(v);
    // Buildings: step the ray until it enters a box or runs out.
    let endT = bestT;
    if (!hit) {
      for (let t = 2; t < bestT; t += 1.5) {
        const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
        if (y < 0) { endT = t; break; }
        let inside = false;
        for (const b of this.city.colliders) {
          if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y < 110) { inside = true; break; }
        }
        if (inside) { endT = t; break; }
        endT = t;
      }
    }
    const end = V3(origin.x + dir.x * endT, origin.y + dir.y * endT, origin.z + dir.z * endT);
    this.effects.tracer(origin.clone().add(V3(dir.x * 0.6, dir.y * 0.6, dir.z * 0.6)), end, shooter === 'player' ? 0xffd9a0 : 0xff9a7a);
    if (!hit) return end;
    const dmg = weapon.damage;
    if (hit.kind === 'vehicle') {
      const v = hit.ref;
      const wasAlive = !v.dead;
      v.damage(dmg);
      this.effects.emitSparks(end.x, end.y, end.z, 4);
      if (wasAlive && v.dead) this.onVehicleDisabled(v, shooter);
    } else {
      const p = hit.ref;
      const died = p.damage(dmg);
      if (died) this.onPersonDown(p, shooter);
      if (hit.kind === 'ped' && shooter === 'player') this.addHeat(WANTED.crimeHitPed);
    }
    return end;
  }

  onVehicleDisabled(v, shooter) {
    if (v._disabledCounted) return; // a wreck is only counted once, however it is prodded
    v._disabledCounted = true;
    this.effects.emitSparks(v.pos.x, 1.2, v.pos.z, 22);
    this.effects.emitSmoke(v.pos.x, 1.4, v.pos.z, 10, 1);
    if (v.kind === 'police') {
      this.copsDisabled++;
      if (shooter === 'player') {
        this.addHeat(WANTED.crimeCopCar);
        if (this.freeroam || this.stage === 'done') { this.cash += 150; this.ui.toast('Cruiser disabled  +$150'); }
      }
    }
    if (v === this.hyper && (this.stage === 'escape' || this.stage === 'steal')) {
      this.gameOver('wrecked', 'The One:1 is a write-off. Valencia is not impressed.');
    }
    if (v === this.playerCar) {
      this.damagePlayer(12);
      this.exitCar();
    }
  }

  onPersonDown(p, shooter) {
    if (p === this.valencia) {
      this.ui.toast('Valencia is down!', 3);
      if (this.stage !== 'done') this.gameOver('valencia', 'Valencia went down covering you.');
    }
    if (p.role === 'officer' && shooter === 'player') this.addHeat(0.7);
    if (p.role === 'guard' && shooter === 'player') {
      for (const g of this.guards) g.aggro = true;
      this.addHeat(0.8);
    }
  }

  /** Enemy fire, called by the police manager and the guards. */
  onOfficerShoot(officer, target) {
    const from = V3(officer.pos.x, 1.45, officer.pos.z);
    let point, dist;
    if (target.kind === 'car') {
      point = V3(target.ref.pos.x, 0.8, target.ref.pos.z);
      dist = Math.hypot(point.x - from.x, point.z - from.z);
    } else {
      point = V3(target.ref.pos.x, 1.1, target.ref.pos.z);
      dist = Math.hypot(point.x - from.x, point.z - from.z);
    }
    this.sound.gunshot(true);
    this.effects.muzzle(from);
    const hitChance = Math.max(0.12, 0.62 - dist * 0.008);
    if (Math.random() < hitChance) {
      if (target.kind === 'car') {
        target.ref.damage(4);
        this.effects.emitSparks(point.x, point.y, point.z, 3);
        if (target.ref.dead) this.onVehicleDisabled(target.ref, 'police');
      } else if (target.ref === this.player) {
        this.damagePlayer(POLICE.officerDamage);
      } else {
        target.ref.damage(9);
        if (target.ref.dead) this.onPersonDown(target.ref, 'police');
      }
      this.effects.tracer(from, point, 0xff9a7a);
    } else {
      const miss = V3(point.x + (Math.random() - 0.5) * 3, point.y + (Math.random() - 0.5) * 1.5, point.z + (Math.random() - 0.5) * 3);
      this.effects.tracer(from, miss, 0xff9a7a);
    }
  }

  officerTarget(officer) {
    if (this.playerCar) return { kind: 'car', ref: this.playerCar };
    if (!this.valencia.dead && this.valencia.state !== 'passenger' &&
        Math.hypot(this.valencia.pos.x - officer.pos.x, this.valencia.pos.z - officer.pos.z) <
        Math.hypot(this.player.pos.x - officer.pos.x, this.player.pos.z - officer.pos.z) - 14) {
      return { kind: 'person', ref: this.valencia };
    }
    return { kind: 'person', ref: this.player };
  }

  damagePlayer(amount) {
    if (this.player.dead || this.mode !== 'playing') return;
    this.player.health -= amount;
    this.lastDamageT = this.time;
    this.ui.damageFlash();
    if (this.player.health <= 0) {
      this.player.health = 0;
      this.player.dead = true;
      this.gameOver('wasted', 'Port Azura claims another legend.');
    }
  }

  gameOver(kind, detail) {
    if (this.mode !== 'playing') return;
    this.mode = 'over';
    this.over = { kind, detail };
    this.sound.sting(false);
    this.ui.gameOver(kind, detail);
  }

  // ---------- Valencia ----------

  updateValencia(dt) {
    const v = this.valencia;
    if (v.dead) { v.pose(dt, 0); return; }
    if (this.time - this.lastDamageT > 8 && v.health < 100) v.health = Math.min(100, v.health + 5 * dt);

    if (v.state === 'passenger' && this.playerCar) {
      const car = this.playerCar;
      const rx = -Math.cos(car.heading), rz = Math.sin(car.heading); // right vector
      v.mesh.visible = true;
      v.pos.set(car.pos.x + rx * 0.55, 0.62, car.pos.z + rz * 0.55);
      v.mesh.rotation.y = car.heading;
      const parts = v.mesh.userData.parts;
      parts.legL.rotation.x = -1.35; parts.legR.rotation.x = -1.35;
      // She leans out and works the pistol whenever the law is close.
      this.valShootT -= dt;
      const target = this.nearestPoliceThreat(car.pos, 48);
      v.aiming = !!target;
      parts.armR.rotation.x = target ? -Math.PI / 2 : -0.2;
      if (target && this.valShootT <= 0) {
        this.valShootT = 0.55 + Math.random() * 0.5;
        const from = V3(v.pos.x + rx * 0.5, 1.35, v.pos.z + rz * 0.5);
        this.sound.gunshot(false);
        this.effects.muzzle(from);
        const to = target.isCar
          ? V3(target.ref.pos.x, 0.8, target.ref.pos.z)
          : V3(target.ref.pos.x, 1.05, target.ref.pos.z);
        this.effects.tracer(from, to, 0xffb3d9);
        if (target.isCar) {
          const wasAlive = !target.ref.dead;
          target.ref.damage(11);
          if (wasAlive && target.ref.dead) this.onVehicleDisabled(target.ref, 'valencia');
        } else {
          if (target.ref.damage(13)) this.onPersonDown(target.ref, 'valencia');
        }
      }
      return;
    }

    if (v.state === 'toCar' && this.playerCar) {
      const car = this.playerCar;
      const d = Math.hypot(v.pos.x - car.pos.x, v.pos.z - car.pos.z);
      if (d < 2.6 && Math.abs(car.speed) < 3) {
        v.state = 'passenger';
        return;
      }
      if (d > 60 || !this.playerCar) { v.state = 'follow'; return; }
      v.faceToward(car.pos.x, car.pos.z, dt, 12);
      const sp = 8.6;
      v.pos.x += Math.sin(v.heading) * sp * dt;
      v.pos.z += Math.cos(v.heading) * sp * dt;
      this.collidePerson(v);
      v.pose(dt, sp);
      return;
    }

    // Follow the player on foot, a couple of metres back.
    v.state = 'follow';
    const anchor = this.playerCar ? this.playerCar.pos : this.player.pos;
    const dx = v.pos.x - anchor.x, dz = v.pos.z - anchor.z;
    const d = Math.hypot(dx, dz);
    if (d > 90) { // never lose her
      v.pos.set(anchor.x + 3, 0, anchor.z + 3);
    } else if (d > 3.2) {
      const sp = d > 14 ? 9.4 : PLAYER.walkSpeed + 0.7;
      v.faceToward(anchor.x, anchor.z, dt, 12);
      v.pos.x += Math.sin(v.heading) * sp * dt;
      v.pos.z += Math.cos(v.heading) * sp * dt;
      this.collidePerson(v);
      v.pose(dt, sp);
    } else {
      v.faceToward(anchor.x + Math.sin(this.player.heading) * 4, anchor.z + Math.cos(this.player.heading) * 4, dt, 6);
      v.pose(dt, 0);
    }
    v.aiming = false;
  }

  nearestPoliceThreat(pos, dist) {
    let best = null, bestD = dist;
    for (const c of this.police.cars) {
      if (c.vehicle.dead) continue;
      const d = Math.hypot(c.vehicle.pos.x - pos.x, c.vehicle.pos.z - pos.z);
      if (d < bestD) { bestD = d; best = { isCar: true, ref: c.vehicle }; }
    }
    for (const o of this.police.officers) {
      if (o.dead) continue;
      const d = Math.hypot(o.pos.x - pos.x, o.pos.z - pos.z);
      if (d < bestD) { bestD = d; best = { isCar: false, ref: o }; }
    }
    return best;
  }

  // ---------- traffic & pedestrians ----------

  spawnTraffic(anywhere) {
    const rng = this.rng;
    const mesh = makeTrafficCar(rng);
    const vehicle = new Vehicle('traffic', mesh);
    const road = ROADS[Math.floor(rng() * ROADS.length)];
    const along = range(rng, -280, 280);
    const horizontal = rng() < 0.5;
    const dirSign = rng() < 0.5 ? 1 : -1;
    vehicle.heading = horizontal ? (dirSign > 0 ? Math.PI / 2 : -Math.PI / 2) : (dirSign > 0 ? 0 : Math.PI);
    if (anywhere) {
      vehicle.pos.set(horizontal ? along : road, 0, horizontal ? road : along);
    } else {
      // Respawn near the action but out of sight, snapped onto an avenue.
      const p = this.playerPos();
      const a = rng() * Math.PI * 2;
      const tx = p.x + Math.sin(a) * 150, tz = p.z + Math.cos(a) * 150;
      const snap = (val) => ROADS.reduce((b, r) => (Math.abs(r - val) < Math.abs(b - val) ? r : b), ROADS[0]);
      if (horizontal) vehicle.pos.set(tx, 0, snap(tz));
      else vehicle.pos.set(snap(tx), 0, tz);
    }
    // Offset into the correct lane for the direction of travel (right-hand traffic).
    const lane = 4.8;
    vehicle.pos.x += -Math.cos(vehicle.heading) * lane;
    vehicle.pos.z += Math.sin(vehicle.heading) * lane;
    vehicle.driver = 'traffic';
    vehicle.userData = { cruise: range(rng, 9, 13.5), turnCd: range(rng, 1, 4), dirH: vehicle.heading };
    this.group.add(mesh);
    this.traffic.push(vehicle);
    return vehicle;
  }

  spawnFleeingDriver(vehicle) {
    const ped = new Person('ped', randomPedMesh(this.rng), vehicle.pos.x + 2, vehicle.pos.z + 1);
    ped.fleeing = 3;
    ped.fleeFrom = { x: vehicle.pos.x, z: vehicle.pos.z };
    this.group.add(ped.mesh);
    this.peds.push(ped);
  }

  updateTraffic(dt) {
    const pp = this.playerPos();
    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const v = this.traffic[i];
      const d = Math.hypot(v.pos.x - pp.x, v.pos.z - pp.z);
      if (d > 260) {
        this.group.remove(v.mesh);
        this.traffic.splice(i, 1);
        this.spawnTraffic(false);
        continue;
      }
      if (v.driver !== 'traffic') continue; // the player is driving this one
      const u = v.userData;
      u.turnCd -= dt;
      // At an intersection, sometimes turn onto the crossing avenue.
      const nearRoadX = ROADS.some((r) => Math.abs(v.pos.x - r) < 4);
      const nearRoadZ = ROADS.some((r) => Math.abs(v.pos.z - r) < 4);
      if (nearRoadX && nearRoadZ && u.turnCd <= 0) {
        u.turnCd = 3.5;
        const r = this.rng();
        if (r < 0.3) u.dirH += Math.PI / 2;
        else if (r < 0.45) u.dirH -= Math.PI / 2;
      }
      // Seek a point ahead, pulled toward the lane line for the current direction.
      const f = { x: Math.sin(u.dirH), z: Math.cos(u.dirH) };
      let sx = v.pos.x + f.x * 16, sz = v.pos.z + f.z * 16;
      const snapRoad = (val) => ROADS.reduce((b, r) => (Math.abs(r - val) < Math.abs(b - val) ? r : b), ROADS[0]);
      const laneOff = 4.8;
      // Right-hand traffic: eastbound rides the south lane, southbound the west lane.
      if (Math.abs(f.x) > 0.7) sz = snapRoad(v.pos.z) + (f.x > 0 ? laneOff : -laneOff);
      if (Math.abs(f.z) > 0.7) sx = snapRoad(v.pos.x) + (f.z > 0 ? -laneOff : laneOff);
      const want = Math.atan2(sx - v.pos.x, sz - v.pos.z);
      const diff = angleDiff(want, v.heading);
      // Brake for anything ahead: cars, the player, pedestrians.
      let blocked = false;
      const aheadX = v.pos.x + Math.sin(v.heading) * 7, aheadZ = v.pos.z + Math.cos(v.heading) * 7;
      for (const o of this.allVehicles()) {
        if (o === v) continue;
        if (Math.hypot(o.pos.x - aheadX, o.pos.z - aheadZ) < 3.4) { blocked = true; break; }
      }
      if (!blocked && !this.playerCar && Math.hypot(this.player.pos.x - aheadX, this.player.pos.z - aheadZ) < 3) blocked = true;
      const targetSpeed = blocked ? 0 : u.cruise;
      const throttle = v.speed < targetSpeed ? 0.75 : (blocked ? -0.8 : 0);
      v.drive(dt, { throttle, steer: Math.max(-1, Math.min(1, diff * 1.8)), handbrake: false });
      if (v.dead) v.drive(dt, { throttle: 0, steer: 0 });
    }
  }

  spawnPed(anywhere) {
    const rng = this.rng;
    const cellX = ROADS[Math.floor(rng() * (ROADS.length - 1))] + 32;
    const cellZ = ROADS[Math.floor(rng() * (ROADS.length - 1))] + 32;
    const ped = new Person('ped', randomPedMesh(rng), 0, 0);
    ped.userData = {
      cx: anywhere ? cellX : this.playerPos().x + range(rng, -60, 60),
      cz: anywhere ? cellZ : this.playerPos().z + range(rng, -60, 60),
      corner: Math.floor(rng() * 4),
    };
    const c = pedCorner(ped.userData, ped.userData.corner);
    ped.pos.set(c.x, 0, c.z);
    ped.setGunVisible(false);
    this.group.add(ped.mesh);
    this.peds.push(ped);
    return ped;
  }

  updatePeds(dt) {
    const pp = this.playerPos();
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const ped = this.peds[i];
      const d = Math.hypot(ped.pos.x - pp.x, ped.pos.z - pp.z);
      if (d > 240 && !ped.dead) {
        this.group.remove(ped.mesh);
        this.peds.splice(i, 1);
        this.spawnPed(false);
        continue;
      }
      if (ped.dead) { ped.pose(dt, 0); continue; }
      if (ped.fleeing > 0) {
        ped.fleeing -= dt;
        const from = ped.fleeFrom || pp;
        ped.faceToward(ped.pos.x + (ped.pos.x - from.x), ped.pos.z + (ped.pos.z - from.z), dt, 10);
        ped.pos.x += Math.sin(ped.heading) * 4.6 * dt;
        ped.pos.z += Math.cos(ped.heading) * 4.6 * dt;
        ped.pose(dt, 4.6);
        continue;
      }
      // Stroll the block perimeter, corner to corner.
      const u = ped.userData;
      const target = pedCorner(u, u.corner);
      const dist = Math.hypot(target.x - ped.pos.x, target.z - ped.pos.z);
      if (dist < 0.8) {
        u.corner = (u.corner + (this.rng() < 0.75 ? 1 : 3)) % 4;
      } else {
        ped.faceToward(target.x, target.z, dt, 8);
        ped.pos.x += Math.sin(ped.heading) * 1.6 * dt;
        ped.pos.z += Math.cos(ped.heading) * 1.6 * dt;
        ped.pose(dt, 1.6);
      }
      // Panic near gunfire-speed cars.
      if (this.playerCar && Math.abs(this.playerCar.speed) > 16 && d < 9) {
        ped.fleeing = 1.6;
        ped.fleeFrom = { x: pp.x, z: pp.z };
      }
    }
  }

  // ---------- guards ----------

  updateGuards(dt) {
    for (const g of this.guards) {
      if (g.dead) { g.pose(dt, 0); continue; }
      const anchor = this.stage === 'escape' || this.stage === 'done' ? this.playerPos() : null;
      if (g.aggro && anchor) {
        const d = Math.hypot(g.pos.x - anchor.x, g.pos.z - anchor.z);
        g.faceToward(anchor.x, anchor.z, dt, 8);
        if (d > 20) {
          g.pos.x += Math.sin(g.heading) * 3.8 * dt;
          g.pos.z += Math.cos(g.heading) * 3.8 * dt;
          this.collidePerson(g);
          g.aiming = false;
          g.pose(dt, 3.8);
        } else {
          g.aiming = true;
          g.pose(dt, 0);
          g.shootT -= dt;
          if (g.shootT <= 0) {
            g.shootT = 1.1 + Math.random() * 0.9;
            this.onOfficerShoot(g, this.officerTarget(g));
          }
        }
      } else {
        g.pose(dt, 0);
      }
    }
  }

  // ---------- collisions ----------

  collidePerson(p) {
    for (const b of this.city.colliders) {
      const nx = Math.max(b.minX, Math.min(b.maxX, p.pos.x));
      const nz = Math.max(b.minZ, Math.min(b.maxZ, p.pos.z));
      const dx = p.pos.x - nx, dz = p.pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < p.radius * p.radius && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        p.pos.x = nx + (dx / d) * p.radius;
        p.pos.z = nz + (dz / d) * p.radius;
      } else if (d2 <= 0.0001) {
        p.pos.x = nx + p.radius;
      }
    }
  }

  updateCollisions(dt) {
    const vehicles = this.allVehicles();
    // Cars vs buildings.
    for (const v of vehicles) {
      for (const b of this.city.colliders) {
        if (Math.abs(v.pos.x - (b.minX + b.maxX) / 2) > 30 || Math.abs(v.pos.z - (b.minZ + b.maxZ) / 2) > 30) continue;
        const impact = v.collideBox(b);
        if (impact > 7) {
          v.damage((impact - 6) * 1.1);
          this.effects.emitSparks(v.pos.x, 0.8, v.pos.z, 6);
          if (v === this.playerCar) {
            this.sound.impact(impact);
            this.damagePlayer((impact - 7) * 0.8);
          } else if (v.kind === 'police' && impact > 13 && v.dead === false && v.health <= 0) {
            this.onVehicleDisabled(v, 'crash');
          }
          if (v.dead && v.kind === 'police') this.onVehicleDisabled(v, 'crash');
        }
      }
    }
    // Cars vs cars.
    for (let i = 0; i < vehicles.length; i++) {
      for (let j = i + 1; j < vehicles.length; j++) {
        const a = vehicles[i], b = vehicles[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const dist = Math.hypot(dx, dz);
        const min = a.radius + b.radius - 0.6;
        if (dist > min || dist < 0.001) continue;
        const push = (min - dist) / 2;
        const nx = dx / dist, nz = dz / dist;
        a.pos.x -= nx * push; a.pos.z -= nz * push;
        b.pos.x += nx * push; b.pos.z += nz * push;
        const relVx = b.vx - a.vx, relVz = b.vz - a.vz;
        const rel = Math.abs(relVx * nx + relVz * nz);
        if (rel > 3.5) {
          const dmg = (rel - 3) * 1.5;
          a.damage(dmg); b.damage(dmg);
          const mx = (a.pos.x + b.pos.x) / 2, mz = (a.pos.z + b.pos.z) / 2;
          this.effects.emitSparks(mx, 0.8, mz, 8);
          if (a === this.playerCar || b === this.playerCar) {
            this.sound.impact(rel);
            this.damagePlayer((rel - 3) * 0.55);
            const other = a === this.playerCar ? b : a;
            if (other.kind === 'traffic') this.addHeat(WANTED.crimeHitCar);
            if (other.kind === 'police') this.addHeat(0.35);
          }
          if (a.dead && a.kind === 'police') this.onVehicleDisabled(a, 'crash');
          if (b.dead && b.kind === 'police') this.onVehicleDisabled(b, 'crash');
          // Exchange a little momentum so wrecks shove each other.
          const imp = (relVx * nx + relVz * nz) * 0.4;
          a.vx += nx * imp; a.vz += nz * imp;
          b.vx -= nx * imp; b.vz -= nz * imp;
        }
      }
    }
    // Cars vs people.
    const people = [this.player, this.valencia, ...this.peds, ...this.guards, ...this.police.officers];
    for (const v of vehicles) {
      const sp = Math.hypot(v.vx, v.vz);
      if (sp < 0.5) continue;
      for (const p of people) {
        if (p.dead) continue;
        if (p === this.player && this.playerCar) continue;
        if (p === this.valencia && this.valencia.state === 'passenger') continue;
        const d = Math.hypot(p.pos.x - v.pos.x, p.pos.z - v.pos.z);
        if (d < v.radius + 0.4) {
          if (sp > 4) {
            const died = p.damage(sp * 2.2);
            if (p === this.player) { this.damagePlayer(sp * 1.6); this.lastDamageT = this.time; }
            else if (died) this.onPersonDown(p, 'crash');
            if (p.role === 'ped' && v === this.playerCar) this.addHeat(WANTED.crimeHitPed);
            p.pos.x += (v.vx / sp) * 2.4;
            p.pos.z += (v.vz / sp) * 2.4;
            this.effects.emitSparks(p.pos.x, 0.8, p.pos.z, 5);
          } else {
            // Gentle push out of the way.
            const ddx = p.pos.x - v.pos.x, ddz = p.pos.z - v.pos.z;
            const dd = Math.max(0.3, Math.hypot(ddx, ddz));
            p.pos.x = v.pos.x + (ddx / dd) * (v.radius + 0.5);
            p.pos.z = v.pos.z + (ddz / dd) * (v.radius + 0.5);
          }
        }
      }
    }
  }

  // ---------- wanted, mission, pickups ----------

  updateWanted(dt) {
    if (!this.heatLocked && this.heat > 0) {
      const seen = this.police.anyNear(this.playerPos(), 65);
      if (!seen) this.heat = Math.max(0, this.heat - WANTED.decayPerSecond * dt);
    }
    // Busted: standing still in arm's reach of the law.
    if (!this.playerCar && !this.player.dead) {
      const near = this.police.anyNear(this.player.pos, 3.6);
      if (near && this.heat >= 1) {
        this.bustedMeter += dt;
        if (this.bustedMeter > 2.2) this.gameOver('busted', 'The APD finally got cuffs on you.');
      } else {
        this.bustedMeter = Math.max(0, this.bustedMeter - dt * 1.5);
      }
    }
  }

  updateMission(dt) {
    const p = this.playerPos();
    if (this.stage === 'intro') {
      const d = Math.hypot(p.x - this.city.showroomDoor.x, p.z - this.city.showroomDoor.z);
      if (d < 9) {
        this.setStage('steal');
        this.ui.toast('Valencia: "There she is. One of one. Get in, I\'ll cover you."', 3.6);
      }
    } else if (this.stage === 'escape') {
      const hm = this.city.hideoutMarker;
      const d = Math.hypot(this.hyper.pos.x - hm.x, this.hyper.pos.z - hm.z);
      if (this.playerCar === this.hyper && d < 10) {
        this.heatLocked = false;
        this.cash += MISSION.reward;
        this.setStage('done');
        this.mode = 'win';
        this.sound.cash();
        this.sound.sting(true);
        this.ui.missionComplete({
          cash: this.cash, copsDisabled: this.copsDisabled, shotsFired: this.shotsFired, time: this.time,
        });
      }
      if (this.valencia.dead) this.gameOver('valencia', 'Valencia went down covering you.');
    }
  }

  updatePickups(dt) {
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      pk.mesh.rotation.y += dt * 1.8;
      pk.mesh.position.y = 0.9 + Math.sin(this.time * 2.4) * 0.15;
      const anchor = this.playerCar ? null : this.player.pos;
      if (anchor && Math.hypot(anchor.x - pk.x, anchor.z - pk.z) < 1.9) {
        pk.taken = true;
        pk.mesh.visible = false;
        this.hasSmg = true;
        this.ammo.smg = WEAPONS.smg.mag;
        this.weapon = 'smg';
        this.sound.cash();
        this.ui.toast('SMG acquired — press 2', 2.6);
      }
    }
  }

  updateSmoke(dt) {
    this._smokeT = (this._smokeT || 0) - dt;
    if (this._smokeT > 0) return;
    this._smokeT = 0.12;
    for (const v of this.allVehicles()) {
      if (v.dead) this.effects.emitSmoke(v.pos.x, 1.3, v.pos.z, 2, 0.8);
      else if (v.health < v.maxHealth * 0.4) this.effects.emitSmoke(v.pos.x, 1.1, v.pos.z, 1, 0.5);
    }
  }

  /** HUD snapshot for main.js. */
  hudState() {
    return {
      stars: this.stars,
      cash: this.cash,
      hp: Math.max(0, Math.round(this.player.health)),
      valHp: Math.max(0, Math.round(this.valencia.health)),
      carHp: this.playerCar ? Math.round((this.playerCar.health / this.playerCar.maxHealth) * 100) : null,
      weapon: WEAPONS[this.weapon],
      ammo: this.ammo[this.weapon],
      reloading: this.reloadT > 0,
      driving: !!this.playerCar,
      speedKmh: this.playerCar ? this.playerCar.speed * 3.6 : 0,
      busted: this.bustedMeter / 2.2,
    };
  }

  mapState() {
    return {
      player: this.playerPos(),
      heading: this.playerHeading(),
      valencia: this.valencia.state === 'passenger' ? null : this.valencia.pos,
      policeCars: this.police.cars.map((c) => c.vehicle.pos),
      officers: this.police.officers.filter((o) => !o.dead).map((o) => o.pos),
      hyper: this.playerCar === this.hyper ? null : this.hyper.pos,
      objective: this.stage === 'intro' ? this.city.showroomDoor
        : this.stage === 'steal' ? this.hyper.pos
        : this.stage === 'escape' ? this.city.hideoutMarker : null,
    };
  }
}

function pedCorner(u, corner) {
  const off = 20;
  const xs = [u.cx - off, u.cx + off, u.cx + off, u.cx - off];
  const zs = [u.cz - off, u.cz - off, u.cz + off, u.cz + off];
  return { x: xs[corner], z: zs[corner] };
}

function makePickupMesh() {
  const g = new THREE.Group();
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.85), new THREE.MeshLambertMaterial({ color: 0x22222a }));
  g.add(gun);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.07, 8, 24), new THREE.MeshBasicMaterial({ color: 0xffd23e }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.35;
  g.add(ring);
  return g;
}
