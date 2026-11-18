// Vice Harbor: The One:1 Heist — bootstrap and frame loop. Owns the renderer, the sunset
// camera (third-person on foot, chase cam in a car, speed-widened FOV), the screens
// (title, pause, game over, victory), the HUD wiring, the saved best result, and the two
// headless modes: ?shot=<scene> stages a deterministic frame for screenshots, and
// ?demo=1 lets the autopilot play the heist hands-free for video capture.

import { World } from './world.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { SoundEngine } from './audio.js';
import { setupShot, finalizeShot, makeAutopilot } from './shots.js';
import { SAVE_KEY } from './config.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const DEMO = params.get('demo') === '1';
const SEED = parseInt(params.get('seed') || '7', 10) || 7;

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2400);
camera.position.set(120, 26, 260);

const sound = new SoundEngine();
const world = new World(scene, sound, SEED);
const hud = new Hud();
const input = new Input(SHOT ? null : canvas);
const demoInput = new Input(null);

const aim = { yaw: Math.PI, pitch: 0.3, dir: new THREE.Vector3(0, 0, 1) };
let camYaw = Math.PI;      // direction from the target to the camera (offset convention)
let camPitch = 0.34;
let camDist = 16;
let lastMouseT = -99;
let paused = false;

// ---------- screens ----------

const screens = {
  title: document.getElementById('titleScreen'),
  pause: document.getElementById('pauseScreen'),
  over: document.getElementById('overScreen'),
  win: document.getElementById('winScreen'),
};
function showScreen(name) {
  for (const key of Object.keys(screens)) screens[key].classList.toggle('on', key === name);
}
function loadBest() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; }
}
function saveBest(stats) {
  const best = loadBest();
  if (!best || stats.cash > best.cash) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ cash: stats.cash, time: Math.round(stats.time) })); } catch { /* private mode */ }
  }
}
function refreshBestLine() {
  const best = loadBest();
  document.getElementById('bestLine').textContent = best
    ? `BEST HEIST — $${best.cash.toLocaleString('en-US')} IN ${Math.floor(best.time / 60)}:${String(best.time % 60).padStart(2, '0')}`
    : 'NO HEIST ON RECORD — THE CITY IS WAITING';
}
refreshBestLine();

function startPlaying(freeroam) {
  sound.start();
  showScreen(null);
  hud.show();
  document.getElementById('help').classList.add('on');
  world.mode = 'playing';
  if (!SHOT && !DEMO) input.requestLock();
}

world.ui.toast = (text, seconds) => hud.toast(text, seconds);
world.ui.objective = (text) => hud.setObjective(text);
world.ui.prompt = (html) => hud.prompt(html);
world.ui.damageFlash = () => hud.damageFlash();
world.ui.gameOver = (kind, detail) => {
  input.exitLock();
  const titles = { wasted: 'WASTED', busted: 'BUSTED', wrecked: 'TOTALLED', valencia: 'VALENCIA DOWN' };
  document.getElementById('overTitle').textContent = titles[kind] || 'BUSTED';
  document.getElementById('overTitle').style.color = kind === 'busted' ? '#7aa2ff' : '#ff5340';
  document.getElementById('overStats').innerHTML =
    `${detail}<br>Cash earned <b>$${world.cash.toLocaleString('en-US')}</b> · Cruisers disabled <b>${world.copsDisabled}</b> · Shots fired <b>${world.shotsFired}</b>`;
  showScreen('over');
  hud.hide();
};
world.ui.missionComplete = (stats) => {
  input.exitLock();
  saveBest(stats);
  document.getElementById('winStats').innerHTML =
    `The One:1 vanishes into the docks and Valencia is already spending the money.<br>` +
    `Paid <b>$${stats.cash.toLocaleString('en-US')}</b> · Cruisers disabled <b>${stats.copsDisabled}</b> · ` +
    `Shots fired <b>${stats.shotsFired}</b> · Time <b>${Math.floor(stats.time / 60)}:${String(Math.floor(stats.time % 60)).padStart(2, '0')}</b>`;
  showScreen('win');
};

document.getElementById('playBtn').addEventListener('click', () => { sound.click(); startPlaying(false); });
document.getElementById('resumeBtn').addEventListener('click', () => { sound.click(); togglePause(false); });
document.getElementById('restartBtn').addEventListener('click', () => { sound.click(); world.reset(); paused = false; startPlaying(false); });
document.getElementById('retryBtn').addEventListener('click', () => { sound.click(); world.reset(); startPlaying(false); });
document.getElementById('roamBtn').addEventListener('click', () => {
  sound.click();
  world.reset();
  world.freeroam = true;
  world.setStage('done');
  startPlaying(true);
});
document.getElementById('winRoamBtn').addEventListener('click', () => {
  sound.click();
  world.freeroam = true;
  world.setStage('done');
  showScreen(null);
  hud.show();
  world.mode = 'playing';
});
document.getElementById('winRetryBtn').addEventListener('click', () => { sound.click(); world.reset(); startPlaying(false); });

function togglePause(force) {
  if (world.mode !== 'playing' && world.mode !== 'paused') return;
  paused = force !== undefined ? force : !paused;
  world.mode = paused ? 'paused' : 'playing';
  showScreen(paused ? 'pause' : null);
  if (paused) input.exitLock();
  else if (!SHOT && !DEMO) input.requestLock();
}

// ---------- camera ----------

const camTargetPos = new THREE.Vector3();
const desiredCamPos = new THREE.Vector3();

function updateCamera(dt) {
  const driving = !!world.playerCar;
  const focus = driving ? world.playerCar.pos : world.player.pos;
  camTargetPos.set(focus.x, (driving ? 1.6 : 1.7), focus.z);

  if (!SHOT) {
    if (input.mouseDX || input.mouseDY) {
      camYaw -= input.mouseDX * 0.0031;
      camPitch = Math.max(0.04, Math.min(1.05, camPitch + input.mouseDY * 0.0026));
      lastMouseT = world.time;
    }
    // Drift back behind the action when the mouse is quiet.
    const anchorHeading = driving ? world.playerCar.heading : world.player.heading;
    const behind = anchorHeading + Math.PI;
    let diff = behind - camYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const settle = driving ? 2.6 : (world.player.moving ? 0.9 : 0);
    if (world.time - lastMouseT > 1.6 && settle > 0) camYaw += diff * Math.min(1, dt * settle);
  }

  const speed = driving ? Math.abs(world.playerCar.speed) : 0;
  const wantDist = world.mode === 'title' ? 17 : driving ? 10.5 + speed * 0.1 : 7.6;
  camDist += (wantDist - camDist) * Math.min(1, dt * 4);
  const wantPitch = driving ? 0.3 : camPitch;
  const cp = Math.cos(wantPitch), sp = Math.sin(wantPitch);
  let dist = camDist;
  for (let tries = 0; tries < 3; tries++) {
    desiredCamPos.set(
      camTargetPos.x + Math.sin(camYaw) * cp * dist,
      camTargetPos.y + sp * dist + 0.7,
      camTargetPos.z + Math.cos(camYaw) * cp * dist);
    let inside = false;
    for (const b of world.city.colliders) {
      if (desiredCamPos.x > b.minX && desiredCamPos.x < b.maxX && desiredCamPos.z > b.minZ && desiredCamPos.z < b.maxZ && desiredCamPos.y < 40) { inside = true; break; }
    }
    if (!inside) break;
    dist *= 0.55;
  }
  const snap = world.mode === 'title' || SHOT ? 1 : Math.min(1, dt * 14);
  camera.position.lerp(desiredCamPos, snap);
  if (camera.position.y < 0.7) camera.position.y = 0.7;
  camera.lookAt(camTargetPos.x, camTargetPos.y + 0.4, camTargetPos.z);
  camera.fov += (((driving ? 62 + Math.min(11, speed * 0.22) : 62)) - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();
  camera.getWorldDirection(aim.dir);
  aim.yaw = camYaw + Math.PI;
  aim.pitch = wantPitch;
}

// ---------- headless modes ----------

let shotPlan = null;
if (SHOT) {
  world.mode = 'playing';
  hud.show();
  showScreen(null);
  shotPlan = setupShot(SHOT, world);
  if (SHOT === 'cover') { showScreen('title'); hud.hide(); }
  camera.position.set(...shotPlan.camera.pos);
  camera.lookAt(...shotPlan.camera.look);
}
let autopilot = null;
if (DEMO) {
  world.mode = 'playing';
  hud.show();
  showScreen(null);
  autopilot = makeAutopilot(world, aim);
}

// Exposed for screenshot/video tooling: the whole game, drivable from outside.
window.__viceHarbor = { world, scene, camera, renderer, setupShot, makeAutopilot, THREE };

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- frame loop ----------

const clock = new THREE.Clock();
let shotStepsDone = 0;

function frame() {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, clock.getDelta());

  if (SHOT && shotPlan) {
    // Settle the staged scene with fixed steps and held keys, then freeze on the frame.
    if (shotStepsDone < shotPlan.steps) {
      const fake = demoInput;
      fake.keys.clear();
      for (const code of shotPlan.holdKeys) fake.keys.add(code);
      const stepsThisFrame = Math.min(4, shotPlan.steps - shotStepsDone);
      for (let i = 0; i < stepsThisFrame; i++) {
        world.update(1 / 30, fake, aim);
        shotStepsDone++;
      }
      fake.endFrame();
      if (shotStepsDone >= shotPlan.steps) {
        finalizeShot(SHOT, world, shotPlan);
        camera.position.set(...shotPlan.camera.pos);
        camera.lookAt(...shotPlan.camera.look);
        camera.getWorldDirection(aim.dir);
        window.__shotReady = true;
        document.title = 'SHOT-READY ' + SHOT;
      }
    }
    hud.update(0, world.hudState());
    hud.drawMap(world.mapState());
    renderer.render(scene, camera);
    return;
  }

  const activeInput = DEMO ? demoInput : input;
  if (DEMO && autopilot && world.mode === 'playing') {
    demoInput.keys.clear();
    demoInput.firing = false;
    autopilot(dt, demoInput);
  }
  if (!SHOT) {
    if (activeInput.hit('KeyP') || activeInput.hit('Escape')) togglePause();
    if (activeInput.hit('KeyM')) {
      const muted = sound.toggleMute();
      hud.toast(muted ? 'Sound off' : 'Sound on', 1.2);
    }
    if (activeInput.hit('KeyH')) document.getElementById('help').classList.toggle('on');
  }

  if (world.mode === 'playing') {
    world.update(dt, activeInput, aim);
  }
  updateCamera(dt);
  if (world.mode !== 'title') {
    hud.update(dt, world.hudState());
    hud.drawMap(world.mapState());
  }
  activeInput.endFrame();
  renderer.render(scene, camera);
}
frame();
