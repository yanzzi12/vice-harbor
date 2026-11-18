// Tuning and world layout constants for Vice Harbor: The One:1 Heist.
// Everything the other modules need to agree on lives here: the street grid of Port Azura,
// the palette of its golden-hour sky, and the balance numbers for people, cars and police.

export const CITY = {
  half: 300,            // the city spans -300..300 on both axes
  roadEvery: 64,        // an avenue every 64 m
  roadWidth: 20,        // asphalt width; the rest of each block cell is sidewalk
  waterZ: -352,         // the harbour lies beyond the north edge (-z is north here)
};

export const ROADS = [-256, -192, -128, -64, 0, 64, 128, 192, 256];

export const PALETTE = {
  skyTop: 0x2a1650,
  skyHorizon: 0xff8c52,
  skyLow: 0x4a1e52,
  fog: 0xcf7350,
  sun: 0xffb37a,
  hemiSky: 0xffc9a3,
  hemiGround: 0x3a2358,
  asphalt: 0x2e2a38,
  sidewalk: 0x8a6f63,
  sand: 0xd9a066,
  water: 0x1d4e6b,
};

export const PLAYER = {
  walkSpeed: 6.2,
  sprintSpeed: 10.4,
  radius: 0.55,
  maxHealth: 100,
};

export const WEAPONS = {
  pistol: { name: 'PISTOL', damage: 34, interval: 0.27, mag: 12, reload: 0.9, spread: 0.012, auto: false, range: 130 },
  smg: { name: 'SMG', damage: 15, interval: 0.085, mag: 32, reload: 1.3, spread: 0.032, auto: true, range: 110 },
};

export const WANTED = {
  // Heat is a float; the stars shown are ceil(heat). Crimes add heat, hiding drains it.
  crimeHitCar: 0.55,
  crimeHitPed: 1.2,
  crimeShot: 0.22,
  crimeSteal: 0.8,
  crimeCopCar: 1.0,
  decayPerSecond: 0.05,    // only while no police unit can see the player
  missionHeat: 6,          // the heist finale pins the heat at six stars
};

export const POLICE = {
  carsByStars: [0, 1, 2, 3, 4, 6, 8], // active pursuit cars by star level
  spawnDistance: 135,
  despawnDistance: 250,
  carHealth: 110,
  officerHealth: 60,
  officerDamage: 7,
  ramDamage: 10,
};

export const TRAFFIC = { cars: 14, peds: 16 };

export const MISSION = {
  reward: 25000,
  showroomPos: { x: 160, z: 160 },   // Azure Palms showroom block (south-east)
  hideoutPos: { x: -192, z: -256 },  // the north docks warehouse
  startPos: { x: 126, z: 208 },      // where the player and Valencia begin
};

export const SAVE_KEY = 'vice-harbor-best-v1';
