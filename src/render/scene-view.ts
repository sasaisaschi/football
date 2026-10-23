import './scene-view.css';
import * as THREE from 'three';
import type { CrowdAudio } from '../audio/crowd-audio';
import { TEAMS } from '../engine/rosters';
import type { DecisionMoment, MatchEvent, MatchSnapshot, PlayerProfile, TeamId, Vec3 } from '../engine/types';
import { attackSign } from '../physics/pitch-geometry';
import { createBallView } from './ball-view';
import { CameraDirector, WIDE_FOV } from './camera-director';
import { OffsideLine } from './offside-line';
import { frameMoment } from './framing';
import { lerpBall, lerpPlayer } from './interpolate';
import { NameTag } from './name-tag';
import { Footballer, loadFootballer } from './footballer';
import { frameReference } from './reference-camera';
import { SceneHud, type HudInfo } from './scene-hud';
import { scenePictures, type Capture } from './scene-pictures';
import type { StadiumView } from './stadium-view';
import { TacticalOverlay } from './tactical-overlay';

/** What the scene draws a frame from: the simulation's computed frames. */
export interface FrameSource { frame(tick: number): MatchSnapshot; readonly produced: number }

/**
 * Direction to the sun (daylight.ts) and half the size of the area its shadows cover in a scene (m). The sun stands
 * behind the far side as seen from the reference camera, so its shadows fall towards the camera as in the reference.
 */
const SUN = { back: 45, up: 70, side: 40 }, SHADOW_HALF = 34;

/**
 * The 3D stage of a decisive scene in the style of the client's reference picture: figures, ball, stadium, the
 * reference camera, the options' markings, the broadcast graphics (score strip, toolbar, minimap). It is drawn only
 * while a scene runs (the manager view has no 3D picture). Everything it shows comes from computed frames; it never
 * changes the match.
 */
export class SceneView {
  readonly el = document.createElement('div');
  readonly overlay = new TacticalOverlay();
  private readonly offside = new OffsideLine();
  readonly hud: SceneHud;
  /** An open-play scene: offside line for the team in possession, the reference camera. */
  private openPlay = false;
  /** A shot was struck in this scene: offside no longer matters, the line goes. */
  private shotTaken = false;
  private frozenNow = false;
  readonly camera: CameraDirector;
  private readonly figures: Footballer[];
  private readonly ball = createBallView();
  private nameTag: NameTag | null = null;
  private celebrateUntil = 0;
  private celebrateTeam: TeamId = 0;
  /** The side the camera stands on (the attackers' right); the sun is placed opposite. */
  private sunSide: 1 | -1 = 1;
  /** Renders of the frozen moment still to be taken (once the figures are posed at the frozen tick). */
  private pictures: { m: DecisionMoment; s: MatchSnapshot; wait: number } | null = null;
  shown: MatchSnapshot | null = null;
  active = false;

  constructor(
    private readonly scene: THREE.Scene,
    readonly cam: THREE.PerspectiveCamera,
    private readonly stadium: StadiumView,
    private readonly audio: CrowdAudio,
    private readonly profiles: PlayerProfile[],
    private readonly o: {
      userTeam: TeamId; halfMinutes: number; focusPlayer: number | null; clock: (s: MatchSnapshot) => string; key: THREE.DirectionalLight;
      info: HudInfo; capture: Capture; onPictures: (portrait: HTMLCanvasElement | null, thumbs: Map<string, HTMLCanvasElement>) => void;
    },
    model: Awaited<ReturnType<typeof loadFootballer>>,
  ) {
    this.camera = new CameraDirector(cam);
    this.figures = profiles.map(p => { const f = new Footballer(p, TEAMS[p.team], model); scene.add(f.root); return f; });
    scene.add(this.ball.mesh, this.overlay.group, this.offside.group);
    if (o.focusPlayer !== null) { this.nameTag = new NameTag(profiles[o.focusPlayer], TEAMS[profiles[o.focusPlayer].team].kit); scene.add(this.nameTag.sprite); }
    this.el.className = 'scene';
    this.el.hidden = true;
    this.hud = new SceneHud(profiles, o.userTeam, o.info, on => this.overlay.setEnabled(on));
    this.el.append(this.hud.el);
  }

  /**
   * A decisive scene starts: the camera picks up play where the build-up begins (`s`). The side it watches from is
   * that of the team with the ball at the frozen moment (`atMoment`): six seconds earlier the other team may still
   * have had it.
   */
  begin(m: DecisionMoment, s: MatchSnapshot, atMoment: MatchSnapshot): void {
    this.active = true;
    this.el.hidden = false;
    this.el.dataset.phase = 'build-up';
    this.frozenNow = false;
    this.hud.setMoment(null);
    this.camera.scene = true;
    // A set piece about to be taken is shown from behind the ball (or the corner flag) towards goal.
    const r = s.restart;
    const setPiece = m.category === 'set-piece' && r && ['corner', 'free-kick', 'penalty'].includes(r.kind);
    this.camera.setPiece = setPiece ? { spot: r.position, goalX: attackSign(r.team, s.half) * 52.5, kind: r.kind } : null;
    // Open play: the reference camera on the right of the team that has the ball, looking at the goal it attacks.
    this.openPlay = m.category !== 'set-piece' && m.category !== 'coach';
    this.shotTaken = false;
    const attackers = atMoment.possession ?? (m.category === 'defence' ? (1 - m.team) as TeamId : m.team);
    this.sunSide = attackSign(attackers, s.half);
    this.camera.attackGoalX = this.openPlay ? attackSign(attackers, s.half) * 52.5 : null;
    this.camera.cutTo(setPiece ? 'set-piece' : 'follow', s);
  }

  /** The frozen moment: the framing that shows every option above the decision bar, the markings, the live renders. */
  frozen(m: DecisionMoment, s: MatchSnapshot, panel: { right: number; bottom: number }, host: HTMLElement): void {
    this.el.dataset.phase = 'decide';
    this.frozenNow = true;
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
    const h = host.clientHeight;
    // The free part of the picture: above the decision bar, below the score strip, right of the toolbar.
    const safe = { left: -0.85, right: 0.97, bottom: -1 + (2 * (panel.bottom + 0.02 * h)) / h, top: 0.8 };
    const goalX = this.camera.attackGoalX;
    const frame = goalX !== null ? frameReference(points, s.ball.position, goalX > 0 ? 1 : -1, this.cam.aspect, safe) : frameMoment(points, attackSign(m.team, s.half), this.cam.aspect, WIDE_FOV, safe);
    this.camera.decisionFrame = frame;
    this.camera.cutTo('decision', s);
    this.overlay.show(m, s, id => this.profiles[id].team, frame.position);
    this.overlay.focus(Math.max(0, m.options.findIndex(o => o.id === m.defaultOptionId)));
    this.hud.setMoment(m);
    this.pictures = { m, s, wait: 2 };
  }

  /** The choice is made: markings go, the camera follows what really happens. */
  decided(): void {
    this.el.dataset.phase = 'consequence';
    this.frozenNow = false;
    this.overlay.hide();
    this.hud.setMoment(null);
    this.pictures = null;
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
    this.hud.setMoment(null);
    this.pictures = null;
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
    // The running cycle follows the shown time (slower in slow motion, still while frozen).
    const gaitDt = dt * pace;
    // Positions over the whole interval a → b; discrete state (score, clock) comes from the nearer snapshot.
    a.players.forEach((p, k) => this.figures[k].update(lerpPlayer(p, b.players[k], alpha), gaitDt, ball));
    this.camera.update({ ...s, ball: { ...s.ball, position: ball } }, wall, dt);
    this.followShadows(ball);
    this.overlay.update(wall);
    // The offside line belongs to live play; the frozen decision shows only the options, as the reference does.
    this.offside.update(s, this.profiles, this.openPlay && !this.shotTaken && !this.frozenNow ? s.possession : null, this.cam);
    if (this.pictures && --this.pictures.wait <= 0) {
      const { m, s: at } = this.pictures;
      this.pictures = null;
      void scenePictures(m, at, this.o.capture).then(p => this.o.onPictures(p.portrait, p.thumbs));
    }
    const excitement = Math.min(1, Math.max(0, (Math.abs(ball.x) - 20) / 30));
    const celebrate = wall < this.celebrateUntil ? (this.celebrateTeam === 0 ? 1 : -1) : 0;
    this.stadium.update(wall, excitement, celebrate);
    this.audio.update(s, this.o.userTeam);
    this.nameTag?.update(s, this.cam);
    this.hud.update(s, this.o.clock(s));
  }

  /**
   * The sun's shadows are drawn for the part of the pitch the scene shows, not for the whole pitch: the same shadow
   * map then has about ten times the resolution where the players are, and their shadows get crisp edges.
   */
  private followShadows(ball: Vec3): void {
    const key = this.o.key, cam = key.shadow.camera;
    const at = new THREE.Vector3(ball.x, 0, ball.z).lerp(new THREE.Vector3(this.cam.position.x, 0, this.cam.position.z), 0.15);
    key.target.position.copy(at);
    key.position.copy(at).add(new THREE.Vector3(-SUN.back * this.sunSide, SUN.up, -SUN.side * this.sunSide));
    key.target.updateMatrixWorld();
    if (cam.right !== SHADOW_HALF) { Object.assign(cam, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF }); cam.updateProjectionMatrix(); }
  }

  dispose(): void {
    for (const f of this.figures) { this.scene.remove(f.root); f.dispose(); }
    this.scene.remove(this.ball.mesh, this.overlay.group, this.offside.group);
    if (this.nameTag) { this.scene.remove(this.nameTag.sprite); this.nameTag.dispose(); }
  }
}
