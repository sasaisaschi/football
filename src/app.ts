import * as THREE from 'three';
import type { CrowdAudio } from './audio/crowd-audio';
import { TEAMS } from './engine/rosters';
import type { DecisionMoment, DecisionSource, MatchEvent, MatchSnapshot, PlayerProfile, TeamId, Vec3 } from './engine/types';
import { attackSign } from './physics/pitch-geometry';
import { createBallView } from './render/ball-view';
import { CameraDirector } from './render/camera-director';
import { frameMoment } from './render/framing';
import { lerpBall, lerpPlayer } from './render/interpolate';
import { PlayerFigure } from './render/player-view';
import type { StadiumView } from './render/stadium-view';
import { TacticalOverlay } from './render/tactical-overlay';
import { atStake, CALM_SECONDS } from './render/time-lapse';
import { Playback } from './sim/playback';
import { SimClient } from './sim/sim-client';
import { commentaryFor } from './ui/commentary';
import { ConsequenceCard } from './ui/consequence';
import { DecisionPanel } from './ui/decision-panel';
import { Hud } from './ui/hud';
import { showResult, type SessionMetrics } from './ui/result-screen';
import type { AgentMemory } from './ai/agent-memory';

/** `memory`: what the players remember from earlier matches; `saveMemory` keeps the updated memory after full time. */
export type AppOptions = {
  seed: number; halfMinutes: number; cooldown: number; maxPerHalf: number; timeoutSeconds: number; userTeam: TeamId; condense: boolean;
  memory: AgentMemory | null; saveMemory: (m: AgentMemory) => void;
};

/** Wall seconds a status line stays. */
const STATUS_SECONDS = 6;
/** Events after which classic (uncondensed) play stays at normal pace for a few seconds. */
const CALM_BREAKERS = new Set<MatchEvent['type']>(['foul', 'offside', 'out', 'restart', 'in-play', 'goal', 'catch', 'advantage']);
/** Above this pace individual sounds (kicks, whistles) would only rattle; the crowd bed stays. */
const SOUND_PACE = 2;

/**
 * One session in the browser. The match is computed chronologically in a worker (sim/); this side shows it: the
 * pacing of the picture (live, condensed, held at a moment), figures, ball, camera, tactical markings, the decision
 * panel, the consequence card and the final chronicle. Nothing here changes the match; decisions go to the worker.
 */
export class MatchApp {
  readonly client: SimClient;
  readonly playback = new Playback();
  readonly metrics: SessionMetrics = { wallSeconds: 0, cpuSeconds: 0, simSeconds: 0, moments: 0 };
  private figures: PlayerFigure[] = [];
  private profiles: PlayerProfile[] = [];
  private readonly ball = createBallView();
  private readonly camera: CameraDirector;
  private readonly overlay = new TacticalOverlay();
  private readonly hud: Hud;
  private readonly panel: DecisionPanel;
  private consequence: ConsequenceCard | null = null;
  private cursor = 0;
  private wall = 0;
  private lastDanger = 0;
  private celebrateUntil = 0;
  private celebrateTeam: TeamId = 0;
  private openedMoment = -1;
  private finished = false;
  private shown: MatchSnapshot | null = null;

  private constructor(
    private readonly scene: THREE.Scene,
    private readonly cam: THREE.PerspectiveCamera,
    private readonly stadium: StadiumView,
    private readonly host: HTMLElement,
    private readonly audio: CrowdAudio,
    readonly options: AppOptions,
  ) {
    this.client = new SimClient({ seed: options.seed, halfMinutes: options.halfMinutes, userTeam: options.userTeam, cooldown: options.cooldown, maxPerHalf: options.maxPerHalf, timeoutSeconds: options.timeoutSeconds, memory: options.memory ?? undefined });
    this.camera = new CameraDirector(cam);
    this.hud = new Hud(options.halfMinutes);
    this.panel = new DecisionPanel((id, by) => this.resolve(id, by), i => this.overlay.focus(i));
    host.append(this.hud.el, this.panel.el);
    scene.add(this.ball.mesh, this.overlay.group);
    window.addEventListener('keydown', ev => {
      if ((ev.key === 'l' || ev.key === 'L') && !this.panel.open) {
        this.options.condense = !this.options.condense;
        this.hud.setStatus(this.options.condense ? 'Ruhige Phasen werden verdichtet.' : 'Alles live – keine Verdichtung.', this.wall, STATUS_SECONDS);
      }
    });
  }

  static async create(scene: THREE.Scene, cam: THREE.PerspectiveCamera, stadium: StadiumView, host: HTMLElement, audio: CrowdAudio, options: AppOptions): Promise<MatchApp> {
    const app = new MatchApp(scene, cam, stadium, host, audio, options);
    await app.client.ready;
    app.profiles = app.client.profiles;
    app.figures = app.profiles.map(p => { const f = new PlayerFigure(p, TEAMS[p.team]); scene.add(f.root); return f; });
    app.consequence = new ConsequenceCard(app.profiles);
    host.append(app.consequence.el);
    app.hud.setStatus(`${TEAMS[0].name} gegen ${TEAMS[1].name} – du entscheidest für ${TEAMS[options.userTeam].name}.`, 0, STATUS_SECONDS);
    return app;
  }

  /** May the picture be drawn at a reduced rate? Only while condensed play waits for the simulation. */
  relaxedRendering(): boolean {
    return this.playback.mode === 'condensed' && !this.panel.open && !this.finished;
  }

  /** Read-only view for the browser check. */
  get debug() {
    return {
      events: this.client.events, produced: this.client.produced, shownTick: this.playback.tick, mode: this.playback.mode, speed: this.playback.speed,
      moment: this.client.moment, deciding: this.panel.open, finished: this.finished, metrics: this.metrics, cpuMs: this.client.cpuMs,
      chronicle: this.consequence?.chronicle ?? [], snapshot: this.shown, camera: this.cam, director: this.camera,
    };
  }

  /** One animation frame; `draw` false: advance the pacing and events only, without posing the picture. */
  frame(dt: number, draw = true): void {
    this.wall += dt;
    if (this.client.error) { this.hud.setStatus(`Simulationsfehler: ${this.client.error}`, this.wall, 3600); return; }
    if (this.client.produced < 0 || !this.consequence) return;
    if (!this.panel.open && !this.finished) {
      this.playback.update(dt, {
        produced: this.client.produced, momentTick: this.client.momentTick, done: this.client.done,
        keys: this.client.keys, condense: this.options.condense, classicPace: this.classicPace(),
      });
    }
    this.dispatchUpTo(this.playback.tick);
    const m = this.client.moment;
    if (this.playback.mode === 'held' && m && m.id !== this.openedMoment) this.openMoment(m);
    if (draw) this.draw(dt);
    this.panel.tick(this.wall);
    this.consequence.tick(this.wall);
    this.client.displayed(this.playback.tick, this.wall);
    if (this.client.done && this.playback.tick >= this.client.produced && !this.finished) this.showFullTime();
  }

  private draw(dt: number): void {
    const t = this.playback.tick, i = Math.floor(t);
    const a = this.client.frame(i), b = this.client.frame(Math.min(i + 1, this.client.produced));
    const alpha = Math.min(1, t - i);
    const s = alpha > 0.5 ? b : a;
    this.shown = s;
    const ball = lerpBall(a.ball, b.ball, alpha);
    this.ball.update(ball, s.ball.rotation);
    // The decorative running cycle follows simulated time, but not faster than a sprint's cadence.
    const gaitDt = dt * Math.min(this.playback.speed, 3);
    s.players.forEach((p, k) => this.figures[k].update(lerpPlayer(a.players[k], p, alpha), gaitDt, ball));
    this.camera.condensed = this.playback.mode === 'condensed';
    this.camera.update({ ...s, ball: { ...s.ball, position: ball } }, this.wall, dt);
    this.overlay.update(this.wall);
    const excitement = Math.min(1, Math.max(0, (Math.abs(ball.x) - 20) / 30));
    const celebrate = this.wall < this.celebrateUntil ? (this.celebrateTeam === 0 ? 1 : -1) : 0;
    this.stadium.update(this.wall, excitement, celebrate);
    this.audio.update(s, this.options.userTeam);
    this.hud.update(s, this.playback.mode, this.playback.speed, this.panel.open, this.wall);
  }

  /** Classic pace when the user switched condensing off: time-lapse ×3 only in really quiet play (Phase A guards). */
  private classicPace(): number {
    const s = this.shown;
    if (!s || atStake(s, this.profiles) || this.wall < this.celebrateUntil) this.lastDanger = this.wall;
    return this.wall - this.lastDanger > CALM_SECONDS ? 3 : 1;
  }

  private dispatchUpTo(tick: number): void {
    const events = this.client.events;
    while (this.cursor < events.length && events[this.cursor].tick <= tick) this.onEvent(events[this.cursor++]);
  }

  private onEvent(e: MatchEvent): void {
    const s = this.shown;
    this.camera.onEvent(e, this.wall);
    if (this.playback.speed < SOUND_PACE || e.type === 'goal') this.audio.onEvent(e, this.options.userTeam);
    const line = commentaryFor(e, { profiles: this.profiles, score: s?.score ?? [0, 0] });
    if (line) this.hud.log(line, s ? this.hud.clockText(s) : '00:00');
    this.consequence!.onEvent(e);
    if (CALM_BREAKERS.has(e.type) || (e.type === 'swing' && e.action !== 'pass' && e.action !== 'dribble' && e.action !== 'control')) this.lastDanger = this.wall;
    if (e.type === 'goal') {
      this.celebrateUntil = this.wall + 6;
      this.celebrateTeam = e.team;
      if (s) this.hud.mark('goal', this.hud.elapsed(s), e.team, `Tor ${TEAMS[e.team].short}`);
    }
    if (e.type === 'moment' && s) { this.hud.mark('moment', this.hud.elapsed(s), e.team, 'Entscheidung'); this.metrics.moments++; }
    // The substitute takes over the replaced player's position; the shared profiles follow the worker's.
    if (e.type === 'substitution') this.profiles[e.on].role = e.role;
  }

  /** The picture has reached the frozen moment: panel, tactical markings and a camera that shows everything relevant. */
  private openMoment(m: DecisionMoment): void {
    this.openedMoment = m.id;
    const s = this.client.frame(this.client.momentTick ?? this.playback.tick);
    s.moment = m;
    this.hud.clearStatus();
    this.panel.show(m, this.wall, s, this.profiles);
    this.overlay.show(m, s, id => this.profiles[id].team);
    this.overlay.focus(Math.max(0, m.options.findIndex(o => o.id === m.defaultOptionId)));
    const points: Vec3[] = [s.ball.position];
    for (const id of m.participants) {
      const p = s.players[id];
      if (p.sentOff) continue;
      points.push({ x: p.position.x, y: 0, z: p.position.z }, { x: p.position.x, y: 2.1, z: p.position.z });
    }
    for (const o of m.options) {
      const v = o.visual;
      if (v?.ball) points.push({ x: v.ball.to.x, y: v.ball.kind === 'shot' ? 1.2 : 0, z: v.ball.to.z });
      for (const r of v?.runs ?? []) points.push({ x: r.to.x, y: 0, z: r.to.z });
      if (v?.zone) points.push({ x: v.zone.x + v.zone.r, y: 0, z: v.zone.z }, { x: v.zone.x - v.zone.r, y: 0, z: v.zone.z });
      // A line shift is shown where it crosses the actor's channel.
      if (v?.line) for (const x of [v.line.from, v.line.to]) points.push({ x, y: 0, z: s.players[m.focusPlayer].position.z });
    }
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const fp = this.panel.footprint();
    // A margin beside the panel and below the score bar, so markings around the outermost players stay clear too.
    const safe = { left: -0.92, right: 1 - (2 * (fp.right + 64)) / w, bottom: -1 + (2 * (fp.bottom + 40)) / h, top: 1 - (2 * 110) / h };
    this.camera.decisionFrame = frameMoment(points, attackSign(m.team, s.half), this.cam.aspect, this.cam.fov, safe);
  }

  private resolve(optionId: string, by: DecisionSource): void {
    const m = this.client.moment;
    const s = this.shown;
    if (!m || !s) return;
    const option = m.options.find(o => o.id === optionId)!;
    this.overlay.hide();
    this.consequence!.start(m, optionId, by, this.hud.clockText(s), s.time, s.possession);
    this.client.resolve(optionId, by);
    if (by !== 'user') this.hud.setStatus(by === 'delegated' ? `Du überlässt es den Spielern: ${option.label}.` : `Zeit abgelaufen – die Spieler entscheiden selbst: ${option.label}.`, this.wall, STATUS_SECONDS);
  }

  private showFullTime(): void {
    this.finished = true;
    const s = this.shown!;
    this.metrics.wallSeconds = this.wall;
    this.metrics.cpuSeconds = this.client.cpuMs / 1000;
    this.metrics.simSeconds = s.time;
    let saved: string | null = null;
    if (this.client.memory) {
      try { this.options.saveMemory(this.client.memory); } catch (err) { saved = `Spielergedächtnis nicht gespeichert: ${err instanceof Error ? err.message : String(err)}`; }
    }
    showResult(this.host, s.score, this.consequence!.chronicle, this.metrics, { before: this.options.memory, after: this.client.memory, profiles: this.profiles, team: this.options.userTeam, error: saved });
  }

  dispose(): void {
    for (const f of this.figures) this.scene.remove(f.root);
    this.scene.remove(this.ball.mesh, this.overlay.group);
    this.client.dispose();
  }
}
