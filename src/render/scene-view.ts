import './scene-view.css';
import * as THREE from 'three';
import type { CrowdAudio } from '../audio/crowd-audio';
import { TEAMS } from '../engine/rosters';
import type { DecisionMoment, MatchEvent, MatchSnapshot, PlayerProfile, TeamId, Vec3 } from '../engine/types';
import { tr } from '../i18n';
import { attackSign } from '../physics/pitch-geometry';
import { createBallView } from './ball-view';
import { ATTACK_FOV, CameraDirector, WIDE_FOV } from './camera-director';
import { OffsideLine } from './offside-line';
import { frameAttack, frameMoment } from './framing';
import { lerpBall, lerpPlayer } from './interpolate';
import { NameTag } from './name-tag';
import { Footballer, loadFootballer } from './footballer';
import type { StadiumView } from './stadium-view';
import { TacticalOverlay } from './tactical-overlay';

/** What the scene draws a frame from: the simulation's computed frames. */
export interface FrameSource { frame(tick: number): MatchSnapshot; readonly produced: number }

/** Direction to the key floodlight (main.ts) and half the size of the area its shadows cover in a scene (m). */
const KEY_OFFSET = new THREE.Vector3(-40, 80, 50), SHADOW_HALF = 34;

const CATEGORY = (m: DecisionMoment) => ({ attack: tr('Attack', 'Angriff'), transition: tr('Transition', 'Umschalten'), defence: tr('Defence', 'Abwehr'), 'set-piece': tr('Set piece', 'Standard'), coach: tr('Coach', 'Trainer') })[m.category];

/**
 * The 3D stage of a decisive scene: figures, ball, stadium, camera, tactical markings, a slim score bug, letterbox and
 * the scene's title card. It is drawn only while a scene runs (the manager view has no 3D picture). Everything it
 * shows comes from computed frames; it never changes the match.
 */
export class SceneView {
  readonly el = document.createElement('div');
  readonly overlay = new TacticalOverlay();
  private readonly offside = new OffsideLine();
  /** An open-play scene: offside line for the team in possession, attack camera. */
  private openPlay = false;
  /** A shot was struck in this scene: offside no longer matters, the line goes. */
  private shotTaken = false;
  readonly camera: CameraDirector;
  private readonly figures: Footballer[];
  private readonly ball = createBallView();
  private nameTag: NameTag | null = null;
  private celebrateUntil = 0;
  private celebrateTeam: TeamId = 0;
  private readonly bug: HTMLElement;
  shown: MatchSnapshot | null = null;
  active = false;

  constructor(
    private readonly scene: THREE.Scene,
    readonly cam: THREE.PerspectiveCamera,
    private readonly stadium: StadiumView,
    private readonly audio: CrowdAudio,
    private readonly profiles: PlayerProfile[],
    private readonly o: { userTeam: TeamId; halfMinutes: number; focusPlayer: number | null; clock: (s: MatchSnapshot) => string; key: THREE.DirectionalLight },
    model: Awaited<ReturnType<typeof loadFootballer>>,
  ) {
    this.camera = new CameraDirector(cam);
    this.figures = profiles.map(p => { const f = new Footballer(p, TEAMS[p.team], model); scene.add(f.root); return f; });
    scene.add(this.ball.mesh, this.overlay.group, this.offside.group);
    if (o.focusPlayer !== null) { this.nameTag = new NameTag(profiles[o.focusPlayer], TEAMS[profiles[o.focusPlayer].team].kit); scene.add(this.nameTag.sprite); }
    this.el.className = 'scene';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="scene-bar top"></div><div class="scene-bar bottom"></div>
      <div class="scene-bug"><span class="home">${TEAMS[0].short}</span><b data-score>0 : 0</b><span class="away">${TEAMS[1].short}</span><i data-clock>00:00</i><em data-label></em></div>
      <div class="scene-title" data-title><small></small><strong></strong></div>`;
    this.bug = this.el.querySelector('.scene-bug')!;
  }

  /** A decisive scene starts: letterbox in, title card, the camera picks up play where the build-up begins. */
  begin(m: DecisionMoment, s: MatchSnapshot): void {
    this.active = true;
    this.el.hidden = false;
    this.el.dataset.phase = 'build-up';
    const title = this.el.querySelector<HTMLElement>('[data-title]')!;
    title.querySelector('small')!.textContent = `${CATEGORY(m)} · ${this.o.clock(s)}`;
    title.querySelector('strong')!.textContent = tr('Decisive moment', 'Entscheidende Szene');
    title.classList.remove('show');
    void title.offsetWidth;
    title.classList.add('show');
    this.label(tr('LIVE · BUILD-UP', 'LIVE · VORGESCHICHTE'));
    this.camera.scene = true;
    // A set piece about to be taken is shown from behind the ball (or the corner flag) towards goal.
    const r = s.restart;
    const setPiece = m.category === 'set-piece' && r && ['corner', 'free-kick', 'penalty'].includes(r.kind);
    this.camera.setPiece = setPiece ? { spot: r.position, goalX: attackSign(r.team, s.half) * 52.5, kind: r.kind } : null;
    // Open play: the camera stands behind the attack of the team that has the ball and looks at the goal it attacks.
    this.openPlay = m.category !== 'set-piece' && m.category !== 'coach';
    this.shotTaken = false;
    const attackers = s.possession ?? m.team;
    this.camera.attackGoalX = this.openPlay ? attackSign(attackers, s.half) * 52.5 : null;
    this.camera.cutTo(setPiece ? 'set-piece' : 'follow', s);
  }

  private label(text: string): void {
    this.el.querySelector('[data-label]')!.textContent = text;
  }

  /** The frozen moment: markings on the pitch, the framing that shows every option beside the panel. */
  frozen(m: DecisionMoment, s: MatchSnapshot, panel: { right: number; bottom: number }, host: HTMLElement): void {
    this.el.dataset.phase = 'decide';
    this.label(tr('FROZEN · YOUR CALL', 'EINGEFROREN · DEINE WAHL'));
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
      if (v?.line) for (const x of [v.line.from, v.line.to]) points.push({ x, y: 0, z: s.players[m.focusPlayer].position.z });
    }
    const w = host.clientWidth, h = host.clientHeight;
    const safe = { left: -0.92, right: 1 - (2 * (panel.right + 64)) / w, bottom: -1 + (2 * (panel.bottom + 70)) / h, top: 1 - (2 * 120) / h };
    const goalX = this.camera.attackGoalX;
    this.camera.decisionFrame = goalX !== null ? frameAttack(points, s.ball.position, goalX, this.cam.aspect, ATTACK_FOV, safe) : frameMoment(points, attackSign(m.team, s.half), this.cam.aspect, WIDE_FOV, safe);
    this.camera.cutTo('decision', s);
  }

  /** The choice is made: markings go, the camera follows what really happens. */
  decided(): void {
    this.el.dataset.phase = 'consequence';
    this.label(tr('LIVE · CONSEQUENCE', 'LIVE · KONSEQUENZ'));
    this.overlay.hide();
    this.camera.decisionFrame = null;
    // A set piece still to be taken is watched from behind the ball again; open play is followed.
    this.camera.cutTo(this.camera.setPiece && this.shown?.restart ? 'set-piece' : 'follow', null);
  }

  end(): void {
    this.active = false;
    this.camera.setPiece = null;
    this.camera.attackGoalX = null;
    this.offside.group.visible = false;
    this.el.hidden = true;
    this.overlay.hide();
    this.camera.scene = false;
  }

  /** Camera cuts and sounds for an event reached in the scene. */
  onEvent(e: MatchEvent, wall: number): void {
    this.camera.onEvent(e, wall);
    if (e.type === 'swing' && e.action === 'shot') this.shotTaken = true;
    if (e.type === 'restart' || e.type === 'kickoff') this.shotTaken = false;
    this.audio.onEvent(e, this.o.userTeam);
    if (e.type === 'goal') { this.celebrateUntil = wall + 6; this.celebrateTeam = e.team; }
  }

  /** Poses everything for the shown (fractional) tick. */
  draw(src: FrameSource, tick: number, dt: number, wall: number, pace: number): void {
    const i = Math.floor(tick);
    const a = src.frame(i), b = src.frame(Math.min(i + 1, src.produced));
    const alpha = Math.min(1, tick - i);
    const s = alpha > 0.5 ? b : a;
    this.shown = s;
    const ball = lerpBall(a.ball, b.ball, alpha);
    this.ball.update(ball, s.ball.rotation);
    // The decorative running cycle follows the shown time (slower in slow motion).
    const gaitDt = dt * pace;
    // Positions over the whole interval a → b (taking the nearer snapshot as the end made figures stand still for half
    // an interval and then jump; issue #39 / PR #38). Discrete state (score, clock) comes from the nearer snapshot.
    a.players.forEach((p, k) => this.figures[k].update(lerpPlayer(p, b.players[k], alpha), gaitDt, ball));
    this.camera.update({ ...s, ball: { ...s.ball, position: ball } }, wall, dt);
    this.followShadows(ball);
    this.overlay.update(wall, this.cam);
    this.offside.update(s, this.profiles, this.openPlay && !this.shotTaken ? s.possession : null, this.cam);
    const excitement = Math.min(1, Math.max(0, (Math.abs(ball.x) - 20) / 30));
    const celebrate = wall < this.celebrateUntil ? (this.celebrateTeam === 0 ? 1 : -1) : 0;
    this.stadium.update(wall, excitement, celebrate);
    this.audio.update(s, this.o.userTeam);
    this.nameTag?.update(s, this.cam);
    this.bug.querySelector('[data-score]')!.textContent = `${s.score[0]} : ${s.score[1]}`;
    this.bug.querySelector('[data-clock]')!.textContent = this.o.clock(s);
  }

  /**
   * The floodlight's shadows are drawn for the part of the pitch the scene shows, not for the whole pitch: the same
   * shadow map then has about ten times the resolution where the players are, and their shadows get crisp edges.
   */
  private followShadows(ball: Vec3): void {
    const key = this.o.key, cam = key.shadow.camera;
    const at = new THREE.Vector3(ball.x, 0, ball.z).lerp(new THREE.Vector3(this.cam.position.x, 0, this.cam.position.z), 0.15);
    key.target.position.copy(at);
    key.position.copy(at).add(KEY_OFFSET);
    key.target.updateMatrixWorld();
    if (cam.right !== SHADOW_HALF) { Object.assign(cam, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF }); cam.updateProjectionMatrix(); }
  }

  dispose(): void {
    for (const f of this.figures) { this.scene.remove(f.root); f.dispose(); }
    this.scene.remove(this.ball.mesh, this.overlay.group, this.offside.group);
    if (this.nameTag) { this.scene.remove(this.nameTag.sprite); this.nameTag.dispose(); }
  }
}
