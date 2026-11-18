// The Port Azura PD: pursuit cars that chase and ram, roadblocks thrown across avenues at
// three stars and up, and officers on foot who pour out when the player is on foot. The
// manager keeps the active fleet matched to the wanted level, spawning on roads a block
// away and retiring units that fall too far behind. It talks to the world through a small
// interface: playerState(), onOfficerShoot(officer), onRam(vehicle, impact).

import { POLICE, ROADS } from './config.js';
import { Vehicle, makePoliceCar } from './vehicles.js';
import { Person, officerMesh } from './people.js';

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** A point on a road near (x, z), snapped to the grid so spawns land on asphalt. */
function roadPointNear(x, z, dist, rng) {
  const angle = rng() * Math.PI * 2;
  const tx = x + Math.sin(angle) * dist;
  const tz = z + Math.cos(angle) * dist;
  const snap = (v) => ROADS.reduce((best, r) => (Math.abs(r - v) < Math.abs(best - v) ? r : best), ROADS[0]);
  // Snap one axis to a road, keep the other: the point sits on an avenue either way.
  if (rng() < 0.5) return { x: snap(tx), z: Math.max(-290, Math.min(290, tz)) };
  return { x: Math.max(-290, Math.min(290, tx)), z: snap(tz) };
}

export class PoliceManager {
  constructor(scene, world, rng) {
    this.scene = scene;
    this.world = world;
    this.rng = rng;
    this.cars = [];       // { vehicle, stuckT, reverseT, block: bool }
    this.officers = [];   // Person
    this.blockCooldown = 0;
    this.flashT = 0;
  }

  clear() {
    for (const c of this.cars) this.scene.remove(c.vehicle.mesh);
    for (const o of this.officers) this.scene.remove(o.mesh);
    this.cars = [];
    this.officers = [];
  }

  spawnCar(x, z, heading, block) {
    const mesh = makePoliceCar();
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    const vehicle = new Vehicle('police', mesh);
    vehicle.heading = heading;
    vehicle.driver = block ? null : 'police';
    this.cars.push({ vehicle, stuckT: 0, reverseT: 0, block: !!block });
    return vehicle;
  }

  spawnOfficer(x, z) {
    const person = new Person('officer', officerMesh(), x, z);
    person.setGunVisible(true);
    this.scene.add(person.mesh);
    this.officers.push(person);
    return person;
  }

  /** The fleet the wanted level calls for; also drives the light-bar flash. */
  update(dt, stars, playerPos) {
    this.flashT += dt;
    const phase = Math.floor(this.flashT * 2.4) % 2;
    for (const c of this.cars) {
      const mats = c.vehicle.mesh.userData.lightMats;
      if (mats) {
        mats[0].color.setHex(phase === 0 ? 0xff2222 : 0x551111);
        mats[1].color.setHex(phase === 1 ? 0x3366ff : 0x111a55);
      }
    }
    this.blockCooldown -= dt;

    const want = POLICE.carsByStars[Math.min(6, stars)] || 0;
    const active = this.cars.filter((c) => !c.block && !c.vehicle.dead);
    // Retire units that fell too far behind or burned out long ago.
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      const d = Math.hypot(c.vehicle.pos.x - playerPos.x, c.vehicle.pos.z - playerPos.z);
      if (d > POLICE.despawnDistance || (c.vehicle.dead && d > 90)) {
        this.scene.remove(c.vehicle.mesh);
        this.cars.splice(i, 1);
      }
    }
    const aliveCount = this.cars.filter((c) => !c.block && !c.vehicle.dead).length;
    if (stars > 0 && aliveCount < want) {
      const p = roadPointNear(playerPos.x, playerPos.z, POLICE.spawnDistance, this.rng);
      this.spawnCar(p.x, p.z, Math.atan2(playerPos.x - p.x, playerPos.z - p.z), false);
    }
    void active;

    // Roadblocks at three stars: two cruisers parked across the road ahead of the player.
    if (stars >= 3 && this.blockCooldown <= 0 && this.cars.filter((c) => c.block).length < 2) {
      const ahead = this.world.playerAheadPoint(70);
      if (ahead) {
        const horizontal = Math.abs(Math.sin(this.world.playerHeading())) < 0.5;
        for (const off of [-5, 5]) {
          const bx = horizontal ? ahead.x + off : ahead.x;
          const bz = horizontal ? ahead.z : ahead.z + off;
          this.spawnCar(bx, bz, horizontal ? Math.PI / 2 : 0, true);
        }
        this.blockCooldown = 26;
      }
    }

    this.driveCars(dt, playerPos);
    this.updateOfficers(dt, stars, playerPos);
  }

  driveCars(dt, playerPos) {
    const w = this.world;
    const pv = w.playerVelocity();
    for (const c of this.cars) {
      const v = c.vehicle;
      if (c.block || v.dead) { v.drive(dt, { throttle: 0, steer: 0 }); continue; }
      // Aim at where the player will be in half a second: ramming speed.
      const tx = playerPos.x + pv.x * 0.45;
      const tz = playerPos.z + pv.z * 0.45;
      const want = Math.atan2(tx - v.pos.x, tz - v.pos.z);
      const diff = angleDiff(want, v.heading);
      const dist = Math.hypot(tx - v.pos.x, tz - v.pos.z);
      let throttle = 1;
      let steer = Math.max(-1, Math.min(1, diff * 1.7));
      if (Math.abs(diff) > 2.2) throttle = -0.6; // facing away: swing around
      if (dist < 7 && !w.playerDriving()) throttle = 0.25; // crowd a suspect on foot
      if (c.reverseT > 0) {
        c.reverseT -= dt;
        throttle = -1;
        steer = -steer;
      } else if (Math.abs(v.speed) < 0.7 && throttle > 0) {
        c.stuckT += dt;
        if (c.stuckT > 1.6) { c.reverseT = 0.8; c.stuckT = 0; }
      } else {
        c.stuckT = 0;
      }
      v.drive(dt, { throttle, steer, handbrake: Math.abs(diff) > 1.1 && v.speed > 14 });
    }
  }

  updateOfficers(dt, stars, playerPos) {
    const w = this.world;
    // Officers appear when the player is on foot: they climb out of the nearest cruisers.
    const wantOfficers = (!w.playerDriving() && stars >= 2) ? Math.min(4, stars) : 0;
    if (this.officers.filter((o) => !o.dead).length < wantOfficers) {
      const src = this.cars.find((c) => !c.vehicle.dead);
      if (src) {
        const p = src.vehicle.pos;
        this.spawnOfficer(p.x + 2.5, p.z + 1.5);
      } else if (stars >= 2) {
        const p = roadPointNear(playerPos.x, playerPos.z, 60, this.rng);
        this.spawnOfficer(p.x, p.z);
      }
    }
    for (let i = this.officers.length - 1; i >= 0; i--) {
      const o = this.officers[i];
      const d = Math.hypot(o.pos.x - playerPos.x, o.pos.z - playerPos.z);
      if (d > 170) {
        this.scene.remove(o.mesh);
        this.officers.splice(i, 1);
        continue;
      }
      if (o.dead) { o.pose(dt, 0); continue; }
      o.faceToward(playerPos.x, playerPos.z, dt, 8);
      const target = w.officerTarget(o);
      if (d > 26) {
        // Advance on the player, strafing for a firing position.
        const sp = 3.6;
        o.pos.x += Math.sin(o.heading) * sp * dt;
        o.pos.z += Math.cos(o.heading) * sp * dt;
        o.aiming = false;
        o.pose(dt, sp);
      } else {
        o.aiming = true;
        o.pose(dt, 0);
        o.shootT -= dt;
        if (o.shootT <= 0 && target) {
          o.shootT = 0.9 + this.rng() * 1.1;
          w.onOfficerShoot(o, target);
        }
      }
    }
  }

  /** True when any unit is close enough to see the player (drives wanted decay + busted). */
  anyNear(pos, dist) {
    for (const c of this.cars) {
      if (Math.hypot(c.vehicle.pos.x - pos.x, c.vehicle.pos.z - pos.z) < dist) return true;
    }
    for (const o of this.officers) {
      if (!o.dead && Math.hypot(o.pos.x - pos.x, o.pos.z - pos.z) < dist) return true;
    }
    return false;
  }
}
