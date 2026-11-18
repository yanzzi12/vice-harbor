// The heads-up display: wanted stars, cash, health bars, weapon and speed readouts, the
// objective banner and toast messages over the DOM, plus the round minimap — a canvas that
// draws the street grid, the harbour, and blips for the player, Valencia, the police, the
// hypercar and the current objective.

import { ROADS, CITY } from './config.js';

export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.objText = document.getElementById('objText');
    this.toastEl = document.getElementById('toast');
    this.starsEl = document.getElementById('stars');
    this.cashEl = document.getElementById('cash');
    this.hpFill = document.getElementById('hpFill');
    this.valFill = document.getElementById('valFill');
    this.carFill = document.getElementById('carFill');
    this.carBar = document.getElementById('carbar');
    this.weaponEl = document.getElementById('weapon');
    this.speedEl = document.getElementById('speed');
    this.promptEl = document.getElementById('prompt');
    this.dmgEl = document.getElementById('dmg');
    this.map = document.getElementById('minimap').getContext('2d');
    this.toastT = 0;
    this.lastStars = -1;
    this.dmgT = 0;
  }

  show() { this.root.classList.add('on'); }
  hide() { this.root.classList.remove('on'); }

  setObjective(text) {
    if (this.objText.textContent !== text) this.objText.textContent = text;
  }

  toast(text, seconds) {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = '1';
    this.toastT = seconds || 2.6;
  }

  prompt(html) {
    if (html) {
      this.promptEl.innerHTML = html;
      this.promptEl.style.display = 'block';
    } else {
      this.promptEl.style.display = 'none';
    }
  }

  damageFlash() { this.dmgT = 0.55; }

  update(dt, s) {
    // s: {stars, heat, cash, hp, valHp, carHp (or null), weapon, ammo, reloading, speedKmh, driving}
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastEl.style.opacity = '0';
    }
    if (this.dmgT > 0) {
      this.dmgT -= dt;
      this.dmgEl.style.opacity = String(Math.max(0, this.dmgT * 1.4));
    }
    const stars = s.stars;
    if (stars !== this.lastStars) {
      this.lastStars = stars;
      let html = '';
      for (let i = 0; i < 6; i++) html += `<span class="${i < stars ? 'lit' : 'dim'}">★</span>`;
      this.starsEl.innerHTML = html;
    }
    this.starsEl.classList.toggle('flash', stars >= 5 && Math.floor(performance.now() / 400) % 2 === 0);
    this.cashEl.textContent = '$' + Math.floor(s.cash).toLocaleString('en-US');
    this.hpFill.style.width = Math.max(0, s.hp) + '%';
    this.valFill.style.width = Math.max(0, s.valHp) + '%';
    if (s.carHp === null || s.carHp === undefined) {
      this.carBar.style.display = 'none';
    } else {
      this.carBar.style.display = 'flex';
      this.carFill.style.width = Math.max(0, s.carHp) + '%';
    }
    const w = s.weapon;
    this.weaponEl.innerHTML = s.reloading
      ? `${w.name} <span class="reload">RELOADING</span>`
      : `${w.name} <span class="ammo">${s.ammo}</span> / ∞`;
    if (s.driving) {
      this.speedEl.style.display = 'block';
      this.speedEl.innerHTML = `${Math.abs(Math.round(s.speedKmh))} <small>KM/H</small>`;
    } else {
      this.speedEl.style.display = 'none';
    }
  }

  /** Draw the minimap. view: {player, valencia, policeCars, officers, hyper, objective, heading} */
  drawMap(v) {
    const g = this.map;
    const S = 196, C = S / 2, RANGE = 150; // metres shown from centre to edge
    const px = v.player.x, pz = v.player.z;
    const toMap = (x, z) => [C + (x - px) * (C / RANGE), C + (z - pz) * (C / RANGE)];
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#232030';
    g.fillRect(0, 0, S, S);
    // Harbour water across the north.
    const [, wy] = toMap(0, CITY.waterZ + 36);
    g.fillStyle = '#1d4e6b';
    g.fillRect(0, 0, S, Math.max(0, wy));
    // Blocks and roads.
    g.strokeStyle = 'rgba(230,220,200,0.28)';
    g.lineWidth = 5;
    g.beginPath();
    for (const r of ROADS) {
      const [x1, y1] = toMap(r, 0);
      g.moveTo(x1, 0); g.lineTo(x1, S);
      const [x2, y2] = toMap(0, r);
      g.moveTo(0, y2); g.lineTo(S, y2);
      void x2; void y1;
    }
    g.stroke();
    const blip = (x, z, color, r) => {
      const [mx, my] = toMap(x, z);
      if (mx < -8 || my < -8 || mx > S + 8 || my > S + 8) return;
      g.fillStyle = color;
      g.beginPath(); g.arc(mx, my, r, 0, Math.PI * 2); g.fill();
    };
    if (v.hyper) blip(v.hyper.x, v.hyper.z, '#ff6a00', 4);
    for (const c of v.policeCars) blip(c.x, c.z, Math.floor(performance.now() / 350) % 2 ? '#ff4040' : '#4080ff', 3.5);
    for (const o of v.officers) blip(o.x, o.z, '#7aa2ff', 2.5);
    if (v.valencia) blip(v.valencia.x, v.valencia.z, '#ff5da2', 3.5);
    if (v.objective) {
      const [mx, my] = toMap(v.objective.x, v.objective.z);
      const cx = Math.max(10, Math.min(S - 10, mx)), cy = Math.max(10, Math.min(S - 10, my));
      g.fillStyle = '#ffd23e';
      g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1c0b2e';
      g.font = 'bold 9px sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('!', cx, cy + 0.5);
    }
    // Player arrow, rotated to the player's heading (map is north-up, -z up).
    g.save();
    g.translate(C, C);
    g.rotate(Math.atan2(Math.sin(v.heading), Math.cos(v.heading)) * -1 + Math.PI);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(0, 3); g.lineTo(-5.5, 6);
    g.closePath(); g.fill();
    g.restore();
  }
}
