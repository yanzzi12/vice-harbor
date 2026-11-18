// Port Azura itself: the street grid, sun-bleached towers with lit windows, palms, street
// lights, the Azure Palms showroom where the One:1 waits, the north-docks hideout, the
// harbour water and the gradient sunset sky. Returns the collision boxes and landmarks
// the world simulation needs. All geometry is procedural; textures are painted on
// canvases at run time, so the game loads no image files.

import { CITY, PALETTE, ROADS, MISSION } from './config.js';
import { pick, range, chance } from './random.js';

const BUILDING_TONES = [0xd9c1a8, 0xb8c4cc, 0xe8b48f, 0x9fb4c7, 0xd98f7a, 0xcbb7e0, 0xf0e0c0, 0xa8d0c8];

/** Paint a tower facade: floors of windows, some lit warm by the evening inside. */
function facadeTexture(rng, base) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, 0, 128, 10);
  const cols = 6, rows = 12;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = rng() < 0.42;
      g.fillStyle = lit ? `rgba(255,${190 + Math.floor(rng() * 40)},110,0.95)` : 'rgba(38,44,66,0.9)';
      g.fillRect(8 + x * 20, 16 + y * 20, 12, 12);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Asphalt with a dashed centre line and worn edges, tiled along the road's length. */
function roadTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#2e2a38'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  g.fillStyle = '#e8e4da';
  g.fillRect(61, 8, 6, 44); // one dash per tile
  g.fillStyle = 'rgba(255,205,90,0.85)';
  g.fillRect(4, 0, 3, 128); g.fillRect(121, 0, 3, 128); // edge lines
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function makeSky() {
  const geo = new THREE.SphereGeometry(1500, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
      low: { value: new THREE.Color(PALETTE.skyLow) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 low; varying vec3 vP;' +
      'void main(){ float h = normalize(vP).y; vec3 c = h > 0.12 ? mix(horizon, top, smoothstep(0.12, 0.65, h)) : mix(low, horizon, smoothstep(-0.08, 0.12, h)); gl_FragColor = vec4(c, 1.0); }',
  });
  return new THREE.Mesh(geo, mat);
}

export function buildCity(scene, rng) {
  const colliders = [];
  const palmSpots = [];
  const group = new THREE.Group();
  scene.add(group);

  scene.background = null;
  group.add(makeSky());
  scene.fog = new THREE.Fog(PALETTE.fog, 200, 780);

  const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 1.9);
  sun.position.set(-260, 190, 140);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -170; sun.shadow.camera.right = 170;
  sun.shadow.camera.top = 170; sun.shadow.camera.bottom = -170;
  sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0006;
  scene.add(sun); scene.add(sun.target);

  // Ground: warm pavement everywhere, then asphalt strips on top of it.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1500, 1500),
    new THREE.MeshLambertMaterial({ color: PALETTE.sidewalk }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const roadTex = roadTexture();
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
  const span = CITY.half * 2 + 60;
  for (const r of ROADS) {
    for (const alongX of [true, false]) {
      const tex = roadTex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(span / 16, 1);
      const mat = new THREE.MeshLambertMaterial({ map: tex });
      const road = new THREE.Mesh(new THREE.PlaneGeometry(span, CITY.roadWidth), mat);
      road.rotation.x = -Math.PI / 2;
      if (!alongX) road.rotation.z = Math.PI / 2;
      road.position.set(alongX ? 0 : r, 0.02, alongX ? r : 0);
      road.receiveShadow = true;
      group.add(road);
    }
  }

  // Sand and harbour water along the north edge.
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(1500, 60), new THREE.MeshLambertMaterial({ color: PALETTE.sand }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.03, -330);
  group.add(sand);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 700),
    new THREE.MeshPhongMaterial({ color: PALETTE.water, shininess: 120, specular: 0xff9d5c }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.5, -700);
  group.add(water);

  // Facade materials (a handful of window patterns, tinted per building).
  const facades = [];
  for (let i = 0; i < 3; i++) {
    const tone = ['#cfc4bb', '#bfc8ce', '#d8c2ae'][i];
    facades.push(new THREE.MeshLambertMaterial({ map: facadeTexture(rng, tone) }));
  }
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x4c4258 });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  const showroomBlock = { x: MISSION.showroomPos.x, z: MISSION.showroomPos.z };
  const hideoutBlock = { x: MISSION.hideoutPos.x, z: MISSION.hideoutPos.z };

  // Buildings in every block cell, except the showroom / hideout / two park blocks.
  for (let ix = 0; ix < ROADS.length - 1; ix++) {
    for (let iz = 0; iz < ROADS.length - 1; iz++) {
      const cx = (ROADS[ix] + ROADS[ix + 1]) / 2;
      const cz = (ROADS[iz] + ROADS[iz + 1]) / 2;
      const isShowroom = Math.abs(cx - showroomBlock.x) < 40 && Math.abs(cz - showroomBlock.z) < 40;
      const isHideout = Math.abs(cx - hideoutBlock.x) < 40 && Math.abs(cz - hideoutBlock.z) < 40;
      const isPark = (ix === 2 && iz === 5) || (ix === 5 && iz === 2);
      if (isShowroom || isHideout) continue;
      if (isPark) {
        const lawn = new THREE.Mesh(new THREE.BoxGeometry(40, 0.3, 40), new THREE.MeshLambertMaterial({ color: 0x3f7a4a }));
        lawn.position.set(cx, 0.15, cz);
        lawn.receiveShadow = true;
        group.add(lawn);
        for (let p = 0; p < 7; p++) palmSpots.push({ x: cx + range(rng, -16, 16), z: cz + range(rng, -16, 16) });
        continue;
      }
      const count = chance(rng, 0.4) ? 2 : 1;
      for (let b = 0; b < count; b++) {
        const w = range(rng, 16, count === 1 ? 34 : 20);
        const d = range(rng, 16, count === 1 ? 34 : 20);
        const h = range(rng, 14, 58) * (chance(rng, 0.18) ? 1.7 : 1);
        const bx = cx + (count === 1 ? range(rng, -3, 3) : (b === 0 ? -11 : 11));
        const bz = cz + (count === 1 ? range(rng, -3, 3) : (b === 0 ? -11 : 11));
        const mat = pick(rng, facades).clone();
        mat.color = new THREE.Color(pick(rng, BUILDING_TONES));
        const mesh = new THREE.Mesh(boxGeo, [mat, mat, roofMat, roofMat, mat, mat]);
        mesh.scale.set(w, h, d);
        mesh.position.set(bx, h / 2, bz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        colliders.push({ minX: bx - w / 2, maxX: bx + w / 2, minZ: bz - d / 2, maxZ: bz + d / 2 });
        // Neon sign strip on some towers: the Port Azura glow.
        if (chance(rng, 0.4)) {
          const sign = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 1.6, 0.4),
            new THREE.MeshBasicMaterial({ color: pick(rng, [0xff5da2, 0x39c2ff, 0xffd23e, 0x7dff9a]) }));
          sign.position.set(bx, h - 2.5, bz + d / 2 + 0.25);
          group.add(sign);
        }
      }
      // Sidewalk palms around the block.
      const palms = Math.floor(range(rng, 2, 5));
      for (let p = 0; p < palms; p++) {
        const side = Math.floor(rng() * 4);
        const t = range(rng, -19, 19);
        const off = 21.5;
        palmSpots.push({
          x: cx + (side === 0 ? t : side === 1 ? t : side === 2 ? -off : off),
          z: cz + (side === 0 ? -off : side === 1 ? off : t),
        });
      }
    }
  }

  buildShowroom(group, colliders);
  buildHideout(group, colliders);
  buildBoats(group);

  // Palms: instanced trunks and fronds keep the draw calls low.
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 5.6, 6);
  const frondGeo = new THREE.ConeGeometry(2.6, 0.5, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6748 });
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x2f9e57 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
  const fronds = new THREE.InstancedMesh(frondGeo, frondMat, palmSpots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1);
  palmSpots.forEach((p, i) => {
    const tilt = range(rng, -0.07, 0.07);
    e.set(tilt, rng() * Math.PI, tilt); q.setFromEuler(e);
    m4.compose(new THREE.Vector3(p.x, 2.8, p.z), q, s);
    trunks.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(p.x + tilt * 8, 5.9, p.z), q, new THREE.Vector3(1, 1, 1));
    fronds.setMatrixAt(i, m4);
  });
  trunks.castShadow = true;
  group.add(trunks); group.add(fronds);
  for (const p of palmSpots) colliders.push({ minX: p.x - 0.4, maxX: p.x + 0.4, minZ: p.z - 0.4, maxZ: p.z + 0.4, palm: true });

  // Street lights along every avenue.
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.4, 5);
  const headGeo = new THREE.BoxGeometry(0.5, 0.22, 1.1);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3c4048 });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  const lightSpots = [];
  for (const r of ROADS) {
    for (let t = -288; t <= 288; t += 48) {
      lightSpots.push({ x: t, z: r - 11 }); lightSpots.push({ x: r - 11, z: t });
    }
  }
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lightSpots.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, lightSpots.length);
  lightSpots.forEach((p, i) => {
    m4.compose(new THREE.Vector3(p.x, 2.7, p.z), new THREE.Quaternion(), s);
    poles.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(p.x, 5.45, p.z), new THREE.Quaternion(), s);
    heads.setMatrixAt(i, m4);
  });
  group.add(poles); group.add(heads);

  return {
    group, colliders, sun,
    hypercarPad: { x: MISSION.showroomPos.x, z: MISSION.showroomPos.z + 21, heading: Math.PI },
    hideoutMarker: { x: MISSION.hideoutPos.x, z: MISSION.hideoutPos.z + 24 },
    showroomDoor: { x: MISSION.showroomPos.x, z: MISSION.showroomPos.z + 12 },
  };
}

/** The Azure Palms showroom: a glass pavilion on a plinth, the hypercar pad in front. */
function buildShowroom(group, colliders) {
  const { x, z } = MISSION.showroomPos;
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(46, 1, 40), new THREE.MeshLambertMaterial({ color: 0x6b5a6e }));
  plinth.position.set(x, 0.5, z);
  plinth.receiveShadow = true;
  group.add(plinth);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(40, 9, 30),
    new THREE.MeshPhongMaterial({ color: 0x9fd8e8, transparent: true, opacity: 0.4, shininess: 140, specular: 0xffffff }));
  glass.position.set(x, 5.5, z - 3);
  group.add(glass);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(44, 1.2, 34), new THREE.MeshLambertMaterial({ color: 0x2c2438 }));
  roof.position.set(x, 10.6, z - 3);
  roof.castShadow = true;
  group.add(roof);
  const signMat = new THREE.MeshBasicMaterial({ color: 0x39c2ff });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(30, 2, 0.5), signMat);
  sign.position.set(x, 8.6, z + 12.4);
  group.add(sign);
  const pillarMat = new THREE.MeshLambertMaterial({ color: 0xe8e0d0 });
  for (const dx of [-19, 19]) for (const dz of [-16, 10]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 10, 1.4), pillarMat);
    pillar.position.set(x + dx, 5, z + dz);
    group.add(pillar);
  }
  colliders.push({ minX: x - 20, maxX: x + 20, minZ: z - 18, maxZ: z + 12 });
  // The display pad the One:1 sits on, out front under the sign.
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.4, 0.5, 24), new THREE.MeshLambertMaterial({ color: 0x241d33 }));
  pad.position.set(x, 0.25, z + 21);
  pad.receiveShadow = true;
  group.add(pad);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(6.4, 0.16, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffd23e }));
  rim.rotation.x = Math.PI / 2;
  rim.position.set(x, 0.55, z + 21);
  group.add(rim);
}

/** The north-docks hideout: a corrugated warehouse by the water with a lit yard. */
function buildHideout(group, colliders) {
  const { x, z } = MISSION.hideoutPos;
  const hall = new THREE.Mesh(new THREE.BoxGeometry(38, 12, 22), new THREE.MeshLambertMaterial({ color: 0x707a72 }));
  hall.position.set(x, 6, z - 14);
  hall.castShadow = true;
  group.add(hall);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(40, 1, 24), new THREE.MeshLambertMaterial({ color: 0x474f52 }));
  roof.position.set(x, 12.5, z - 14);
  group.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 0.4), new THREE.MeshBasicMaterial({ color: 0xffb37a }));
  door.position.set(x, 4, z - 2.8);
  group.add(door);
  const crateMat = new THREE.MeshLambertMaterial({ color: 0x9a7a4a });
  for (const [dx, dz, s] of [[-14, 4, 3], [-10, 6, 2.2], [13, 5, 2.6], [16, 2, 1.8]]) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
    crate.position.set(x + dx, s / 2, z + dz);
    crate.castShadow = true;
    group.add(crate);
    colliders.push({ minX: x + dx - s / 2, maxX: x + dx + s / 2, minZ: z + dz - s / 2, maxZ: z + dz + s / 2 });
  }
  colliders.push({ minX: x - 19, maxX: x + 19, minZ: z - 25, maxZ: z - 3 });
}

/** A few pleasure boats bobbing in the harbour (static dressing). */
function buildBoats(group) {
  const hullMat = new THREE.MeshLambertMaterial({ color: 0xf0ead8 });
  const cabMat = new THREE.MeshLambertMaterial({ color: 0x39c2ff });
  for (const [x, z, ry] of [[-120, -372, 0.4], [40, -388, -0.3], [190, -366, 0.9], [-260, -380, 0.1]]) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(4, 1.6, 11), hullMat);
    hull.position.y = 0.4;
    boat.add(hull);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 1.8, 4), cabMat);
    cab.position.set(0, 1.8, -1);
    boat.add(cab);
    boat.position.set(x, -0.4, z);
    boat.rotation.y = ry;
    group.add(boat);
  }
}
