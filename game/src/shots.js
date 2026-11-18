// Staged scenes behind ?shot=cover|heist|chase|roam, and the demo autopilot behind
// ?demo=1. Both drive the real game through its real controls: a shot arranges the cast,
// then the main loop settles it with fixed steps and held keys, so every screenshot is a
// frame the game itself produced. The autopilot plays the whole heist hands-free —
// walk to the showroom, steal the One:1, run the six-star escape to the docks — which
// is also how the gameplay video is captured: load game/?demo=1 and record the window.

import { MISSION } from './config.js';

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Place the player in the hypercar with Valencia riding shotgun, mid-escape. */
function stageEscape(world, x, z, heading) {
  const hyper = world.hyper;
  hyper.mesh.position.set(x, 0, z);
  hyper.heading = heading;
  hyper.mesh.rotation.y = heading;
  hyper.vx = Math.sin(heading) * 14;
  hyper.vz = Math.cos(heading) * 14;
  world.enterCar(hyper);
  world.valencia.state = 'passenger';
  world.heatLocked = true;
  world.heat = 6;
  world.setStage('escape');
  world.valShootT = 0.25;
}

/**
 * Arrange the named scene. Returns { camera: {pos, look}, holdKeys: [...], steps } —
 * the main loop then runs `steps` fixed updates with those keys held before framing.
 */
export function setupShot(name, world) {
  const pad = world.city.hypercarPad;
  if (name === 'heist') {
    world.setStage('steal');
    world.player.pos.set(pad.x - 3.4, 0, pad.z + 1.5);
    world.player.heading = Math.PI / 2;
    world.player.mesh.rotation.y = world.player.heading;
    world.valencia.pos.set(pad.x + 2.6, 0, pad.z + 3.4);
    world.valencia.heading = -Math.PI / 3;
    world.valencia.mesh.rotation.y = world.valencia.heading;
    return {
      steps: 40, holdKeys: [],
      camera: { pos: [pad.x - 9, 2.6, pad.z + 10], look: [pad.x + 1, 1.2, pad.z - 1] },
    };
  }
  if (name === 'chase') {
    stageEscape(world, 68, 30, Math.PI);
    const P = world.police;
    P.spawnCar(52, 52, Math.PI * 0.9, false);
    P.spawnCar(86, 46, Math.PI * 1.1, false);
    P.spawnCar(60, 84, Math.PI, false);
    P.spawnCar(44, 8, Math.PI * 0.8, false);
    P.spawnOfficer(74, 44);
    return {
      steps: 62, holdKeys: ['KeyW'],
      camera: { pos: [86, 7.5, 70], look: [62, 1, 2] },
    };
  }
  if (name === 'roam') {
    world.freeroam = true;
    world.setStage('done');
    world.player.pos.set(8, 0, 100);
    world.player.heading = Math.PI;
    world.valencia.pos.set(5.5, 0, 103);
    return {
      steps: 50, holdKeys: [],
      camera: { pos: [16, 3.2, 88], look: [4, 1.4, 104] },
    };
  }
  // cover: the title screen over the showroom at golden hour.
  world.setStage('steal');
  world.player.pos.set(pad.x - 4.4, 0, pad.z + 3.2);
  world.player.heading = Math.PI / 2.4;
  world.player.mesh.rotation.y = world.player.heading;
  world.valencia.pos.set(pad.x + 3.4, 0, pad.z + 4.2);
  world.valencia.heading = -Math.PI / 2.6;
  world.valencia.mesh.rotation.y = world.valencia.heading;
  return {
    steps: 30, holdKeys: [],
    camera: { pos: [pad.x - 13, 3.4, pad.z + 15], look: [pad.x + 2, 1.4, pad.z - 2] },
  };
}

/** Small pose touch-ups applied after the settle steps, before the frame is taken. */
export function finalizeShot(name, world, plan) {
  if (name === 'chase' && plan) {
    // The car outruns the static staging camera — reframe as a chase cam behind it.
    const hyper = world.hyper;
    const fx = Math.sin(hyper.heading), fz = Math.cos(hyper.heading);
    plan.camera = {
      pos: [hyper.pos.x - fx * 11.5, 4.6, hyper.pos.z - fz * 11.5],
      look: [hyper.pos.x + fx * 9, 1.0, hyper.pos.z + fz * 9],
    };
  }
  if (name === 'heist' || name === 'cover') {
    const parts = world.player.mesh.userData.parts;
    parts.armR.rotation.x = -Math.PI / 2 + 0.05;
    const vParts = world.valencia.mesh.userData.parts;
    vParts.armR.rotation.x = -Math.PI / 2 + 0.05;
  }
}

/**
 * The demo autopilot: returns tick(dt, input, aim) which fills a blank Input with the
 * keys a player would press. It walks to the showroom, steals the One:1 when the world
 * offers it, then drives a road route to the hideout; after the heist it loops the
 * waterfront avenues. aim is the shared {yaw, pitch} the camera reads.
 */
export function makeAutopilot(world, aim) {
  const route = [
    { x: 192, z: 120 }, { x: 192, z: 0 }, { x: 192, z: -128 }, { x: 192, z: -240 },
    { x: 120, z: -256 }, { x: 0, z: -256 }, { x: -128, z: -256 }, { x: -186, z: -250 },
  ];
  const loop = [
    { x: -64, z: -256 }, { x: 64, z: -256 }, { x: 192, z: -256 }, { x: 192, z: -128 },
    { x: 192, z: 0 }, { x: 64, z: 0 }, { x: -64, z: 0 }, { x: -192, z: 0 },
    { x: -192, z: -128 }, { x: -192, z: -256 },
  ];
  let wpIndex = 0;
  let loopIndex = 0;

  function steerToward(input, from, heading, tx, tz, drive) {
    const want = Math.atan2(tx - from.x, tz - from.z);
    const diff = angleDiff(want, heading);
    if (drive) {
      // In a car, positive steer turns the heading down (see Vehicle.drive).
      if (diff > 0.06) input.keys.add('KeyD');
      else if (diff < -0.06) input.keys.add('KeyA');
      input.keys.add('KeyW');
      if (Math.abs(diff) > 1.15) input.keys.add('Space');
    } else {
      aim.yaw += Math.max(-0.09, Math.min(0.09, diff));
      input.keys.add('KeyW');
      if (Math.abs(diff) > 0.5) input.keys.delete('KeyW');
    }
    return Math.hypot(tx - from.x, tz - from.z);
  }

  return function tick(dt, input) {
    const stage = world.stage;
    if (world.playerCar) {
      const car = world.playerCar;
      const list = stage === 'escape' ? route : loop;
      if (stage !== 'escape') wpIndex = 0;
      const idx = stage === 'escape' ? wpIndex : loopIndex;
      const wp = list[Math.min(idx, list.length - 1)];
      const d = steerToward(input, car.pos, car.heading, wp.x, wp.z, true);
      if (d < 16) {
        if (stage === 'escape') wpIndex = Math.min(wpIndex + 1, list.length - 1);
        else loopIndex = (loopIndex + 1) % list.length;
      }
      // Lean on the horn of war: fire at the law when it closes in.
      if (world.police.anyNear(car.pos, 34)) input.firing = true;
      aim.yaw = car.heading; // aim uses the forward convention; main puts the camera behind it
      return;
    }
    if (stage === 'intro') {
      const door = world.city.showroomDoor;
      steerToward(input, world.player.pos, aim.yaw, door.x, door.z, false);
    } else if (stage === 'steal') {
      const hp = world.hyper.pos;
      const d = steerToward(input, world.player.pos, aim.yaw, hp.x - 2.4, hp.z + 0.5, false);
      if (d < 2.6) input.tap('KeyE');
    } else {
      // On foot in free roam: stroll toward Valencia's side of the street.
      steerToward(input, world.player.pos, aim.yaw, world.valencia.pos.x + 6, world.valencia.pos.z + 6, false);
    }
  };
}
