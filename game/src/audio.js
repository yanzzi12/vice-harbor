// All sound is synthesized with WebAudio: a two-oscillator engine voice tied to speed, a
// two-tone police siren whose volume follows the nearest cruiser, noise-burst gunshots and
// impacts, a tyre-skid hiss, UI clicks, mission stingers and a quiet synthwave chord loop.
// No audio files exist; everything is generated. Starts on the first user gesture.

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.engineOsc = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.skidGain = null;
    this.musicTimer = null;
    this.chordStep = 0;
  }

  /** Create the context and the standing voices. Safe to call more than once. */
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(ctx.destination);

    // Engine: detuned saw + square through a lowpass, gain/freq driven per frame.
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass'; engineFilter.frequency.value = 700; engineFilter.Q.value = 2;
    this.engineOsc = ctx.createOscillator(); this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 60;
    this.engineOsc2 = ctx.createOscillator(); this.engineOsc2.type = 'square'; this.engineOsc2.frequency.value = 31;
    this.engineOsc.connect(engineFilter); this.engineOsc2.connect(engineFilter);
    engineFilter.connect(this.engineGain); this.engineGain.connect(this.master);
    this.engineOsc.start(); this.engineOsc2.start();
    this.engineFilter = engineFilter;

    // Siren: a triangle whose frequency an LFO swings between two tones.
    this.sirenGain = ctx.createGain(); this.sirenGain.gain.value = 0;
    this.sirenOsc = ctx.createOscillator(); this.sirenOsc.type = 'triangle'; this.sirenOsc.frequency.value = 800;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 0.55;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 140;
    lfo.connect(lfoGain); lfoGain.connect(this.sirenOsc.frequency);
    this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
    this.sirenOsc.start(); lfo.start();

    // Skid: looped filtered noise, gain driven per frame.
    const noise = this.makeNoiseSource();
    const skidFilter = ctx.createBiquadFilter(); skidFilter.type = 'bandpass'; skidFilter.frequency.value = 900;
    this.skidGain = ctx.createGain(); this.skidGain.gain.value = 0;
    noise.connect(skidFilter); skidFilter.connect(this.skidGain); this.skidGain.connect(this.master);
    noise.start();

    this.startMusic();
  }

  makeNoiseSource() {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true;
    return src;
  }

  /** Per-frame drive of the standing voices. dist = metres to the nearest police car. */
  update(dt, opts) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const speed = Math.abs(opts.engineSpeed || 0);
    if (opts.driving) {
      const rpm = 55 + speed * 6.5 + (opts.throttle ? 14 : 0);
      this.engineOsc.frequency.setTargetAtTime(rpm, t, 0.06);
      this.engineOsc2.frequency.setTargetAtTime(rpm * 0.5 + 2, t, 0.06);
      this.engineFilter.frequency.setTargetAtTime(500 + speed * 38, t, 0.08);
      this.engineGain.gain.setTargetAtTime(0.05 + Math.min(0.1, speed * 0.003), t, 0.09);
    } else {
      this.engineGain.gain.setTargetAtTime(0, t, 0.1);
    }
    const sirenLevel = opts.policeNear ? Math.max(0, 0.16 - (opts.policeDist || 200) * 0.00055) : 0;
    this.sirenGain.gain.setTargetAtTime(sirenLevel, t, 0.2);
    this.skidGain.gain.setTargetAtTime(opts.skidding ? 0.05 : 0, t, 0.05);
  }

  burst(freq, dur, gain, type) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this.makeNoiseSource(); src.loop = false;
    const filter = ctx.createBiquadFilter(); filter.type = type || 'lowpass'; filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  tone(freq, dur, gain, type, slideTo) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = type || 'sine'; osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  gunshot(heavy) {
    this.burst(heavy ? 900 : 1600, heavy ? 0.16 : 0.11, heavy ? 0.5 : 0.34, 'lowpass');
    this.tone(heavy ? 120 : 170, 0.07, 0.2, 'square', 45);
  }

  impact(strength) {
    this.burst(300, 0.22, Math.min(0.6, 0.2 + strength * 0.05), 'lowpass');
    this.tone(70, 0.18, 0.25, 'sine', 38);
  }

  reload() { this.tone(500, 0.05, 0.12, 'square'); setTimeout(() => this.tone(760, 0.05, 0.12, 'square'), 90); }
  enterCar() { this.tone(220, 0.09, 0.15, 'sine', 160); this.burst(500, 0.06, 0.1); }
  alarm() { for (let i = 0; i < 3; i++) setTimeout(() => this.tone(1180, 0.14, 0.16, 'square', 880), i * 190); }
  cash() { this.tone(880, 0.1, 0.14, 'sine'); setTimeout(() => this.tone(1320, 0.16, 0.14, 'sine'), 90); }
  sting(win) {
    const notes = win ? [523, 659, 784, 1046] : [392, 330, 262, 196];
    notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.34, 0.16, 'triangle'), i * 130));
  }
  click() { this.tone(660, 0.05, 0.1, 'sine'); }

  /** A slow synthwave loop: Am7 – Fmaj7 – Cmaj7 – G6 pads with a soft bass pulse. */
  startMusic() {
    const chords = [
      [110.0, 220.0, 261.6, 329.6],  // Am7
      [87.3, 174.6, 220.0, 261.6],   // Fmaj7
      [130.8, 196.0, 261.6, 329.6],  // Cmaj7
      [98.0, 196.0, 246.9, 293.7],   // G6
    ];
    const playChord = () => {
      if (!this.ctx) return;
      const notes = chords[this.chordStep % chords.length];
      this.chordStep++;
      const ctx = this.ctx, t = ctx.currentTime;
      notes.forEach((f, i) => {
        const osc = ctx.createOscillator();
        osc.type = i === 0 ? 'triangle' : 'sine';
        osc.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(i === 0 ? 0.05 : 0.02, t + 0.4);
        g.gain.linearRampToValueAtTime(0, t + 3.9);
        osc.connect(g); g.connect(this.master);
        osc.start(t); osc.stop(t + 4);
      });
    };
    playChord();
    this.musicTimer = setInterval(playChord, 4000);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.03);
    return this.muted;
  }
}
