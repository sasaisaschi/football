import * as THREE from 'three';
import { CrowdAudio } from './audio/crowd-audio';
import { MomentDirector, DEFAULT_DIRECTOR } from './director/moment-director';
import { MatchEngine } from './engine/match-engine';
import { TEAMS } from './engine/rosters';
import type { DecisionSource, MatchEvent, MatchSnapshot, PlayerView, TeamId } from './engine/types';
import { PHYSICS_DT } from './physics/world';
import { createBallView } from './render/ball-view';
import { CameraDirector } from './render/camera-director';
import { PlayerFigure } from './render/player-view';
import type { StadiumView } from './render/stadium-view';
import { commentaryFor } from './ui/commentary';
import { DecisionPanel } from './ui/decision-panel';
import { Hud } from './ui/hud';

export type AppOptions = { seed: number; halfMinutes: number; directorCooldown: number; userTeam: TeamId };

/**
 * Runs one match in the browser: fixed-step simulation, interpolated rendering, broadcast camera, sound,
 * ticker and the decision panel. Quiet midfield phases play in time-lapse; nothing is skipped or invented.
 */
export class MatchApp {
  readonly engine: MatchEngine;
  private readonly director: MomentDirector;
  private readonly figures: PlayerFigure[];
  private readonly ball = createBallView();
  private readonly camera: CameraDirector;
  private readonly hud: Hud;
  private readonly panel: DecisionPanel;
  private prev: MatchSnapshot;
  private curr: MatchSnapshot;
  private accumulator = 0;
  private wall = 0;
  private timeScale = 1;
  private lastDanger = 0;
  private celebrateUntil = 0;
  private celebrateTeam: TeamId = 0;
  private pendingOutcome: string | null = null;
  private finished = false;

  constructor(
    private readonly scene: THREE.Scene,
    cam: THREE.PerspectiveCamera,
    private readonly stadium: StadiumView,
    private readonly overlay: HTMLElement,
    private readonly audio: CrowdAudio,
    private readonly options: AppOptions,
  ) {
    this.engine = new MatchEngine({ seed: options.seed, halfMinutes: options.halfMinutes });
    this.director = new MomentDirector({ ...DEFAULT_DIRECTOR, userTeam: options.userTeam, cooldown: options.directorCooldown });
    this.engine.director = this.director.attach();
    this.figures = this.engine.profiles.map(p => {
      const f = new PlayerFigure(p, TEAMS[p.team]);
      scene.add(f.root);
      return f;
    });
    scene.add(this.ball.mesh);
    this.camera = new CameraDirector(cam);
    this.hud = new Hud(options.halfMinutes);
    this.panel = new DecisionPanel((id, by) => this.resolve(id, by));
    overlay.append(this.hud.el, this.panel.el);
    this.prev = this.curr = this.engine.snapshot();
    this.engine.onEvent(e => this.onEvent(e));
    this.hud.setStatus(`${TEAMS[0].name} gegen ${TEAMS[1].name} – du entscheidest für ${TEAMS[options.userTeam].name}.`);
  }

  private resolve(optionId: string, by: DecisionSource): void {
    const m = this.engine.moment;
    if (!m) return;
    const option = m.options.find(o => o.id === optionId)!;
    this.engine.resolveMoment(optionId, by);
    this.pendingOutcome = option.label;
    this.hud.setStatus(by === 'user' ? `Deine Entscheidung: ${option.label} – jetzt müssen die Spieler es umsetzen.` : by === 'delegated' ? `Du überlässt es den Spielern (${option.label}).` : `Zeit abgelaufen – die Spieler entscheiden selbst (${option.label}).`);
  }

  private onEvent(e: MatchEvent): void {
    this.camera.onEvent(e, this.wall);
    this.audio.onEvent(e, this.options.userTeam);
    const line = commentaryFor(e, this.engine);
    if (line) this.hud.log(line, this.hud.clockText(this.engine.snapshot()));
    if (e.type === 'moment' && this.engine.moment) this.panel.show(this.engine.moment, this.wall);
    if (e.type === 'goal') { this.celebrateUntil = this.wall + 6; this.celebrateTeam = e.team; }
    if (this.pendingOutcome && (e.type === 'goal' || e.type === 'catch' || e.type === 'out' || e.type === 'foul' || e.type === 'offside' || (e.type === 'touch' && this.engine.profiles[e.player].team !== this.options.userTeam))) {
      const result = e.type === 'goal' ? (e.team === this.options.userTeam ? 'Tor!' : 'Gegentor.') : e.type === 'catch' ? 'Der Torwart hält.' : e.type === 'out' ? 'Der Ball ist im Aus.' : e.type === 'foul' ? 'Der Schiedsrichter pfeift.' : e.type === 'offside' ? 'Abseits.' : 'Der Gegner ist am Ball.';
      this.hud.setStatus(`Nach „${this.pendingOutcome}“: ${result}`);
      this.pendingOutcome = null;
    }
    if (e.type === 'full-time') this.showFullTime();
  }

  /** Time-lapse only when nothing is at stake: ball in the middle third, no danger in the last seconds. */
  private chooseTimeScale(s: MatchSnapshot): number {
    const danger = Math.abs(s.ball.position.x) > 22 || s.phase === 'decision' || this.wall < this.celebrateUntil;
    if (danger) this.lastDanger = this.wall;
    if (s.phase === 'stopped' && this.wall - this.lastDanger > 2) return 3;
    return this.wall - this.lastDanger > 3 && s.phase === 'in-play' ? 3 : 1;
  }

  frame(dt: number): void {
    this.wall += dt;
    if (!this.finished && !this.panel.open) {
      this.timeScale = this.chooseTimeScale(this.curr);
      this.accumulator += Math.min(dt, 0.1) * this.timeScale;
      let steps = 0;
      while (this.accumulator >= PHYSICS_DT && steps < 12) {
        this.prev = this.curr;
        this.engine.step();
        this.curr = this.engine.snapshot();
        this.accumulator -= PHYSICS_DT;
        steps++;
        if (this.engine.phase === 'decision') { this.accumulator = 0; break; }
      }
      if (steps === 12) this.accumulator = 0;
    }
    this.panel.tick(this.wall);
    const alpha = Math.min(1, this.accumulator / PHYSICS_DT);
    const s = this.curr;
    const b = lerp3(this.prev.ball.position, s.ball.position, alpha);
    this.ball.update(b, s.ball.rotation);
    s.players.forEach((p, i) => this.figures[i].update(lerpPlayer(this.prev.players[i], p, alpha), dt * this.timeScale));
    this.camera.update({ ...s, ball: { ...s.ball, position: b } }, this.wall, dt);
    const excitement = Math.min(1, Math.max(0, (Math.abs(b.x) - 20) / 30));
    const celebrate = this.wall < this.celebrateUntil ? (this.celebrateTeam === 0 ? 1 : -1) : 0;
    this.stadium.update(this.wall, excitement, celebrate);
    this.audio.update(s, this.options.userTeam);
    this.hud.update(s, this.panel.open ? 1 : this.timeScale);
  }

  private showFullTime(): void {
    this.finished = true;
    const el = document.createElement('div');
    el.className = 'fulltime';
    const card = document.createElement('div');
    card.className = 'fulltime-card';
    const title = document.createElement('h2');
    title.textContent = 'ABPFIFF';
    const score = document.createElement('div');
    score.className = 'fulltime-score';
    score.textContent = `${TEAMS[0].short} ${this.engine.score[0]} : ${this.engine.score[1]} ${TEAMS[1].short}`;
    const again = document.createElement('button');
    again.textContent = 'Neues Spiel';
    again.addEventListener('click', () => location.reload());
    card.append(title, score, again);
    el.append(card);
    this.overlay.append(el);
  }

  dispose(): void {
    for (const f of this.figures) this.scene.remove(f.root);
    this.scene.remove(this.ball.mesh);
  }
}

function lerp3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function lerpPlayer(a: PlayerView, b: PlayerView, t: number): PlayerView {
  if (Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) > 3) return b; // placed while the ball was dead
  const dh = Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading));
  return {
    ...b,
    position: lerp3(a.position, b.position, t),
    heading: a.heading + dh * t,
    boots: [lerp3(a.boots[0], b.boots[0], t), lerp3(a.boots[1], b.boots[1], t)],
    hands: a.hands && b.hands ? lerp3(a.hands, b.hands, t) : b.hands,
    lying: a.lying + (b.lying - a.lying) * t,
    upperBody: a.upperBody && b.upperBody && a.upperBody.part === b.upperBody.part ? { part: b.upperBody.part, position: lerp3(a.upperBody.position, b.upperBody.position, t) } : b.upperBody,
  };
}
