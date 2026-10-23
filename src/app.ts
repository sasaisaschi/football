import type * as THREE from 'three';
import type { CrowdAudio } from './audio/crowd-audio';
import type { AgentMemory } from './ai/agent-memory';
import type { LineupSwap } from './engine/rosters';
import type { DecisionMoment, DecisionSource, MatchEvent, MatchSnapshot, PlayerProfile, TeamId, TeamInstruction } from './engine/types';
import { lang, tr } from './i18n';
import { IntelBoard } from './intel/board';
import { NarrationClient } from './intel/foundry/narration-client';
import { briefMoment } from './intel/moment-brief';
import type { Personalization } from './intel/types';
import { CoachDialog, IntervalScreen } from './manager/coach-screens';
import { ManagerView } from './manager/manager-view';
import { SceneView } from './render/scene-view';
import type { Capture } from './render/scene-pictures';
import { loadFootballer } from './render/footballer';
import type { StadiumView } from './render/stadium-view';
import { SessionDriver } from './session/driver';
import { HZ, SLOW_MO_PACE, SLOW_MO_SECONDS } from './session/pacing';
import { SimClient } from './sim/sim-client';
import { commentaryFor } from './ui/commentary';
import { ConsequenceCard } from './ui/consequence';
import { DecisionPanel } from './ui/decision-panel';
import { IntelPanel } from './ui/intel-panel';
import { showResult, type SessionMetrics } from './ui/result-screen';

/** `memory`: what the players remember from earlier matches; `saveMemory` keeps the updated memory after full time. */
export type AppOptions = {
  seed: number; halfMinutes: number; cooldown: number; maxPerHalf: number; timeoutSeconds: number; userTeam: TeamId;
  memory: AgentMemory | null; saveMemory: (m: AgentMemory) => void;
  /** How the match intelligence reaches this viewer; `savePrefs` remembers a change made during the match. */
  prefs: Personalization; savePrefs: (p: Personalization) => void;
  /** The coach's preparation: tactics and team sheet from kick-off. */
  instruction: TeamInstruction; lineup: LineupSwap[];
};

/** Phases in which the 3D picture is drawn. */
const SCENE_PHASES = new Set(['build-up', 'decide', 'consequence']);

/**
 * One manager session in the browser. The match is computed chronologically in a worker; the session driver
 * (session/) moves the shown match time and hands over between the manager view (no 3D) and the decisive scenes
 * (3D). Nothing here changes the match: decisions go to the worker exactly once.
 */
export class MatchApp {
  readonly client: SimClient;
  readonly driver: SessionDriver;
  readonly metrics: SessionMetrics;
  private profiles: PlayerProfile[] = [];
  private intel!: IntelBoard;
  private intelPanel!: IntelPanel;
  private manager!: ManagerView;
  private stage!: SceneView;
  private readonly panel: DecisionPanel;
  private consequence!: ConsequenceCard;
  private interval: IntervalScreen | null = null;
  private dialog: CoachDialog | null = null;
  private wall = 0;
  private finished = false;
  private chronicled = 0;
  private paused = false;
  private shownFrame: MatchSnapshot | null = null;

  private constructor(
    private readonly cam: THREE.PerspectiveCamera,
    private readonly host: HTMLElement,
    private readonly audio: CrowdAudio,
    readonly options: AppOptions,
  ) {
    this.client = new SimClient({
      seed: options.seed, halfMinutes: options.halfMinutes, userTeam: options.userTeam, cooldown: options.cooldown, maxPerHalf: options.maxPerHalf,
      timeoutSeconds: options.timeoutSeconds, memory: options.memory ?? undefined, lang: lang(), instruction: options.instruction, lineup: options.lineup,
    });
    this.metrics = { wallSeconds: 0, cpuSeconds: 0, simSeconds: 0, moments: 0, halfMinutes: options.halfMinutes };
    this.panel = new DecisionPanel((id, by) => this.decideScene(id, by), i => this.stage.overlay.focus(i));
    this.driver = new SessionDriver(this.client, {
      event: e => this.onEvent(e),
      observe: t => this.intel.observe(this.client.frame(t)),
      sceneBegins: (m, from) => this.sceneBegins(m, from),
      frozen: m => this.frozen(m),
      coach: m => this.coach(m),
      interval: () => this.openInterval(),
      sceneEnds: () => this.sceneEnds(),
      final: () => this.showFullTime(),
      consequenceSettled: () => !this.consequence.following,
    });
  }

  static async create(scene: THREE.Scene, cam: THREE.PerspectiveCamera, stadium: StadiumView, host: HTMLElement, audio: CrowdAudio, key: THREE.DirectionalLight, capture: Capture, options: AppOptions): Promise<MatchApp> {
    const app = new MatchApp(cam, host, audio, options);
    await app.client.ready;
    app.profiles = app.client.profiles;
    app.intel = new IntelBoard(app.profiles, options.halfMinutes);
    // Optional AI narration through the project's own Foundry endpoint; without VITE_NARRATION_URL it stays off.
    app.intelPanel = new IntelPanel(app.intel, app.profiles, options.prefs, options.savePrefs, new NarrationClient(import.meta.env.VITE_NARRATION_URL || undefined));
    app.intel.onInsight(i => app.intelPanel.push(i));
    app.consequence = new ConsequenceCard(app.profiles);
    // The figure model (public/models/footballer.glb); without it there is no scene to show, so a failure stops here.
    const model = await loadFootballer(`${import.meta.env.BASE_URL}models/footballer.glb`);
    app.stage = new SceneView(scene, cam, stadium, audio, app.profiles, {
      userTeam: options.userTeam, halfMinutes: options.halfMinutes, focusPlayer: options.prefs.focusPlayer, clock: s => app.intel.clock(s), key, capture,
      info: { stats: () => app.sceneStats(), player: () => app.panel.brief },
      onPictures: (portrait, thumbs) => app.panel.setPictures(portrait, thumbs),
    }, model);
    app.manager = new ManagerView({
      halfMinutes: options.halfMinutes, userTeam: options.userTeam, profiles: app.profiles, instruction: options.instruction, intel: app.intel, intelPanel: app.intelPanel.el,
      pace: app.driver.pace, onPace: p => { app.driver.pace = p; }, onPause: p => { app.paused = p; app.driver.paused = p; app.client.pause(p); },
    });
    host.append(app.manager.el, app.stage.el, app.panel.el, app.consequence.el);
    app.driver.kickOff();
    return app;
  }

  /** The scene toolbar's statistics: the match so far, as the match intelligence counted it. */
  private sceneStats(): [string, number | string, number | string][] {
    const t = this.intel.stats.teams, total = t[0].possession + t[1].possession || 1;
    const pct = (k: 0 | 1) => `${Math.round((t[k].possession / total) * 100)} %`;
    return [
      [tr('Possession', 'Ballbesitz'), pct(0), pct(1)],
      [tr('Shots', 'Schüsse'), t[0].shots, t[1].shots],
      [tr('On target', 'Aufs Tor'), t[0].shotsOnTarget, t[1].shotsOnTarget],
      [tr('xG', 'xG'), t[0].xg.toFixed(2), t[1].xg.toFixed(2)],
      [tr('Passes completed', 'Angekommene Pässe'), `${t[0].passesCompleted}/${t[0].passes}`, `${t[1].passesCompleted}/${t[1].passes}`],
      [tr('Corners', 'Ecken'), t[0].corners, t[1].corners],
      [tr('Fouls', 'Fouls'), t[0].fouls, t[1].fouls],
    ];
  }

  /** Is the 3D picture drawn now? Only in a decisive scene. */
  get rendering(): boolean {
    return SCENE_PHASES.has(this.driver.flow.phase);
  }


  /** Read-only view for the browser check. */
  get debug() {
    return {
      phase: this.driver.flow.phase, flow: this.driver.flow.log, events: this.client.events, dispatched: this.driver.timeline.dispatched,
      produced: this.client.produced, shownTick: this.driver.tick, moment: this.client.moment, deciding: this.panel.open, finished: this.finished,
      metrics: this.metrics, cpuMs: this.client.cpuMs, keptFrames: this.client.keptFrames, decisions: this.driver.flow.decisions,
      chronicle: this.consequence?.chronicle ?? [], snapshot: this.stage?.shown ?? this.shownFrame, camera: this.cam, director: this.stage?.camera,
      intel: this.intel ? { insights: this.intel.insights, ingested: this.intel.ingested, mode: this.options.prefs.mode, export: () => this.intelExport() } : null,
      canStartSecondHalf: () => this.driver.canStartSecondHalf(),
    };
  }

  frame(dt: number): void {
    this.wall += dt;
    if (this.client.error) { this.fail(`${tr('Simulation error', 'Simulationsfehler')}: ${this.client.error}`); return; }
    if (this.client.produced < 0 || this.finished) return;
    this.driver.update(dt);
    const t = this.driver.tick;
    if (this.rendering) {
      const slow = this.driver.flow.phase === 'build-up' && this.client.momentTick !== null && this.client.momentTick - t <= SLOW_MO_SECONDS * HZ;
      this.stage.draw(this.client, t, dt, this.wall, slow ? SLOW_MO_PACE : this.driver.flow.phase === 'decide' ? 0 : 1);
    } else if (!this.finished) {
      const s = this.client.frame(t);
      this.shownFrame = s;
      this.manager.update(s, {
        paused: this.paused, waiting: this.client.moment !== null, done: this.client.done,
        aheadSeconds: Math.max(0, (this.client.produced - t) / HZ), cpuSeconds: this.client.cpuMs / 1000,
      }, this.intel.clock(s), this.wall);
      this.intelPanel.update(s, this.wall);
      this.interval?.ready(this.driver.canStartSecondHalf());
    }
    this.panel.tick(this.wall);
    this.consequence.tick(this.wall);
    this.chronicle();
    this.client.displayed(t, this.wall);
  }

  private fail(message: string): void {
    if (this.host.querySelector('.app-error')) return;
    const el = document.createElement('div');
    el.className = 'app-error';
    el.textContent = message;
    this.host.append(el);
  }

  private onEvent(e: MatchEvent): void {
    const s = this.client.frame(e.tick);
    const clock = this.intel.clock(s);
    const line = commentaryFor(e, { profiles: this.profiles, score: s.score });
    this.manager.event(e, clock, line, s);
    this.consequence.onEvent(e);
    // The event with the frame of its own tick: positions and pressure exactly as they were when it happened.
    this.intel.ingest(e, s);
    if (this.rendering) this.stage.onEvent(e, this.wall);
    else if (e.type === 'goal') this.audio.onEvent(e, this.options.userTeam);
    if (e.type === 'moment') this.metrics.moments++;
    // The substitute takes over the replaced player's position; the shared profiles follow the worker's.
    if (e.type === 'substitution') this.profiles[e.on].role = e.role;
  }

  /** New entries of the decision chronicle become key developments in the manager view. */
  private chronicle(): void {
    const c = this.consequence.chronicle;
    while (this.chronicled < c.length) {
      const x = c[this.chronicled++];
      this.manager.development(x.clock, `${x.title} – ${x.choice}`, 'decision', x.result);
    }
  }

  private sceneBegins(m: DecisionMoment, from: number): void {
    this.dialog?.close();
    this.consequence.hide();
    this.manager.show(false);
    this.stage.begin(m, this.client.frame(from), this.client.frame(this.client.momentTick ?? from));
  }

  private frozen(m: DecisionMoment): void {
    const s = this.client.frame(this.client.momentTick!);
    s.moment = m;
    this.intel.noteMoment(m);
    const brief = briefMoment(m, s, this.profiles, this.intel.stats, this.options.prefs.mode);
    this.panel.show(m, this.wall, s, this.profiles, brief);
    this.stage.frozen(m, s, this.panel.footprint(), this.host);
  }

  private decideScene(optionId: string, by: DecisionSource): void {
    const m = this.driver.flow.open, s = this.client.frame(this.driver.tick);
    if (!m) return;
    this.consequence.start(m, optionId, by, this.intel.clock(s), s.time, s.possession);
    this.driver.decide(optionId, by);
    this.noteInstruction(m, optionId, s.time);
    this.stage.decided();
  }

  private coach(m: DecisionMoment): void {
    this.intel.noteMoment(m);
    const decide = (optionId: string, by: DecisionSource) => {
      const s = this.client.frame(this.driver.tick);
      this.consequence.start(m, optionId, by, this.intel.clock(s), s.time, s.possession);
      this.driver.decide(optionId, by);
      this.noteInstruction(m, optionId, s.time);
      // A coach decision is told in the manager's key developments, not on the scene's card.
      this.consequence.hide();
      this.dialog = null;
    };
    if (this.interval) { this.interval.talk(m, decide); return; }
    this.dialog = new CoachDialog(m, decide);
    this.host.append(this.dialog.el);
  }

  /** A decision that changes the user's team instruction shows on the manager's tactics, with its duration. */
  private noteInstruction(m: DecisionMoment, optionId: string, time: number): void {
    const fx = m.options.find(o => o.id === optionId)?.effect;
    if (fx?.type === 'team' && fx.team === this.options.userTeam) this.manager.setInstruction(fx.instruction, fx.seconds > 0 ? time + fx.seconds : null);
  }

  private openInterval(): void {
    this.interval = new IntervalScreen(this.client.frame(this.driver.tick), this.options.userTeam, this.intel, this.options.prefs, () => {
      this.driver.secondHalf();
      this.interval?.close();
      this.interval = null;
    });
    this.host.append(this.interval.el);
  }

  private sceneEnds(): void {
    this.consequence.hide();
    this.stage.end();
    this.manager.show(true);
  }

  private intelExport() {
    const s = this.client.frame(this.driver.tick);
    return this.intel.export({ seed: this.options.seed, userTeam: this.options.userTeam, score: s.score });
  }

  private showFullTime(): void {
    this.finished = true;
    const s = this.client.frame(this.client.produced);
    this.metrics.wallSeconds = this.wall;
    this.metrics.cpuSeconds = this.client.cpuMs / 1000;
    this.metrics.simSeconds = s.time;
    let saved: string | null = null;
    if (this.client.memory) {
      try { this.options.saveMemory(this.client.memory); } catch (err) { saved = `${tr('Player memory not saved', 'Spielergedächtnis nicht gespeichert')}: ${err instanceof Error ? err.message : String(err)}`; }
    }
    this.manager.show(false);
    showResult(this.host, s.score, this.consequence.chronicle, this.metrics, { before: this.options.memory, after: this.client.memory, profiles: this.profiles, team: this.options.userTeam, error: saved },
      { insights: this.intel.insights, prefs: this.options.prefs, feed: () => this.intelExport() });
  }

  dispose(): void {
    this.stage.dispose();
    this.client.dispose();
  }
}
