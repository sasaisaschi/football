import type { MatchEvent, MatchSnapshot, TeamId } from '../engine/types';

/**
 * Stadium sound synthesised with Web Audio (no third-party recordings, no licensing issues):
 * a crowd bed whose intensity follows real danger, reactions to real shots, saves and goals,
 * the referee's whistle and the thud of boot contacts. Starts only after a user gesture (autoplay rules).
 */
export class CrowdAudio {
  private ctx: AudioContext | null = null;
  private bed: GainNode | null = null;
  private bedFilter: BiquadFilterNode | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = false;

  start(): void {
    if (this.ctx) { void this.ctx.resume(); this.enabled = true; return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 4;
    this.noise = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = this.noise.getChannelData(ch);
      let brown = 0;
      for (let i = 0; i < len; i++) { brown = (brown + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = brown * 3.2 + (Math.random() * 2 - 1) * 0.05; }
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    this.bedFilter = ctx.createBiquadFilter();
    this.bedFilter.type = 'bandpass'; this.bedFilter.frequency.value = 520; this.bedFilter.Q.value = 0.6;
    this.bed = ctx.createGain(); this.bed.gain.value = 0.18;
    src.connect(this.bedFilter).connect(this.bed).connect(this.master);
    src.start();
    this.enabled = true;
  }

  stop(): void {
    this.enabled = false;
    void this.ctx?.suspend();
  }

  /** Crowd intensity from the real state: ball speed and how close it is to either goal. */
  update(s: MatchSnapshot, userTeam: TeamId): void {
    if (!this.ctx || !this.bed || !this.bedFilter || !this.enabled) return;
    const danger = Math.max(0, (Math.abs(s.ball.position.x) - 25) / 27);
    const homeAttack = s.possession === userTeam ? 1 : 0.8;
    const level = 0.14 + danger * 0.22 * homeAttack + (s.phase === 'decision' ? 0.08 : 0);
    this.bed.gain.setTargetAtTime(level, this.ctx.currentTime, 0.4);
    this.bedFilter.frequency.setTargetAtTime(480 + danger * 420, this.ctx.currentTime, 0.5);
  }

  onEvent(e: MatchEvent, userTeam: TeamId): void {
    if (!this.ctx || !this.enabled) return;
    switch (e.type) {
      case 'goal': this.swell(e.team === userTeam ? 1 : 0.55, 4.5, 700); this.whistle(1, 0.35); break;
      case 'catch': this.swell(0.35, 1.2, 380); break;
      case 'swing': if (e.action === 'shot') this.swell(0.45, 1.4, 620); break;
      case 'foul': case 'offside': this.whistle(1, 0.28); break;
      case 'half-time': case 'full-time': this.whistle(3, 0.5); break;
      case 'kickoff': this.whistle(1, 0.45); break;
      case 'touch': if (e.part === 'boot' && e.ballSpeed > 12) this.thud(Math.min(1, e.ballSpeed / 30)); break;
    }
  }

  private swell(amount: number, seconds: number, freq: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.9;
    const g = ctx.createGain(); g.gain.value = 0;
    const t = ctx.currentTime;
    g.gain.linearRampToValueAtTime(amount, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t); src.stop(t + seconds + 0.1);
  }

  private whistle(blasts: number, length: number): void {
    const ctx = this.ctx!;
    for (let i = 0; i < blasts; i++) {
      const t = ctx.currentTime + i * (length + 0.15);
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 2900; o2.frequency.value = 2950;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.08, t + 0.02);
      g.gain.setValueAtTime(0.08, t + length);
      g.gain.linearRampToValueAtTime(0, t + length + 0.05);
      o.connect(g); o2.connect(g); g.connect(this.master!);
      o.start(t); o2.start(t); o.stop(t + length + 0.1); o2.stop(t + length + 0.1);
    }
  }

  private thud(strength: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), g = ctx.createGain();
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    g.gain.setValueAtTime(0.25 * strength, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(this.master!);
    o.start(t); o.stop(t + 0.2);
  }
}
