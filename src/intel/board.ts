import { TEAMS } from '../engine/rosters';
import type { DecisionMoment, MatchEvent, MatchSnapshot, PlayerProfile, TeamId } from '../engine/types';
import { lang, setLang, type Lang } from '../i18n';
import { narrate } from './narrator';
import { PatternDetector } from './patterns';
import { MatchStatsBoard } from './stats';
import type { Insight, Mode } from './types';

/** Version of the exported intelligence feed; consumers check it before reading. */
export const INTEL_SCHEMA = 'the12thman.intel/v1';
/** Frames are looked at this often (simulated s): enough for possession, pressure and running, cheap on the main thread. */
const OBSERVE_EVERY = 0.25;

/**
 * Stage 1 – ingest, and the shared state of the pipeline. The app (or a headless run) hands in every match event in
 * order together with the frame of its tick, and displayed frames a few times per second; the board passes them to
 * the interpreting stage (stats), then to the explaining stage (patterns), and tells listeners about new insights.
 */
export class IntelBoard {
  readonly stats: MatchStatsBoard;
  readonly patterns: PatternDetector;
  private readonly listeners: ((i: Insight) => void)[] = [];
  private lastObserved = -Infinity;
  readonly ingested: { events: number; frames: number } = { events: 0, frames: 0 };

  constructor(readonly profiles: readonly PlayerProfile[], readonly halfMinutes: number) {
    this.stats = new MatchStatsBoard(profiles);
    this.patterns = new PatternDetector(this.stats, f => this.clock(f));
  }

  /** Match clock as minutes:seconds, counting on through the second half (as on the score bug). */
  clock(f: Pick<MatchSnapshot, 'clockSeconds' | 'half'>): string {
    const total = Math.min(this.halfMinutes * 60, f.clockSeconds) + (f.half === 2 ? this.halfMinutes * 60 : 0);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(Math.floor(total % 60)).padStart(2, '0')}`;
  }

  onInsight(listener: (i: Insight) => void): void {
    this.listeners.push(listener);
  }

  ingest(e: MatchEvent, frame: MatchSnapshot): void {
    this.ingested.events++;
    this.stats.ingest(e, frame);
    for (const i of this.patterns.onEvent(e, frame)) for (const l of this.listeners) l(i);
  }

  observe(frame: MatchSnapshot): void {
    if (frame.time - this.lastObserved < OBSERVE_EVERY) return;
    this.lastObserved = frame.time;
    this.ingested.frames++;
    this.stats.observe(frame);
    for (const i of this.patterns.look(frame)) for (const l of this.listeners) l(i);
  }

  /** A decision moment as it opens, so its outcome can be followed once it is settled. */
  noteMoment(m: DecisionMoment): void {
    this.patterns.noteMoment(m);
  }

  get insights(): readonly Insight[] {
    return this.patterns.insights;
  }

  /**
   * The whole intelligence as one machine-readable, timed document: team and player statistics, every shot, and every
   * insight with its data, the events it rests on and its words for both audiences in both languages – ready to be
   * rendered as synchronised overlays or recaps by another system.
   */
  export(meta: { seed: number; userTeam: TeamId; score: readonly [number, number] }) {
    const words = (i: Insight, mode: Mode, l: Lang) => {
      const before = lang();
      setLang(l);
      try { return narrate(i, mode, { profiles: this.profiles, favouriteTeam: meta.userTeam }); } finally { setLang(before); }
    };
    const s = this.stats;
    const total = s.teams[0].possession + s.teams[1].possession || 1;
    return {
      schema: INTEL_SCHEMA,
      generatedFrom: 'synthetic match events of THE 12TH MAN simulation (no real match data)',
      match: { seed: meta.seed, halfMinutes: this.halfMinutes, teams: TEAMS.map(t => t.name), userTeam: meta.userTeam, score: [...meta.score] },
      ingested: { ...this.ingested },
      teams: s.teams.map((t, k) => ({
        name: TEAMS[k].name, possessionPct: Math.round((t.possession / total) * 100), ...t,
        passAccuracyPct: t.passes ? Math.round((t.passesCompleted / t.passes) * 100) : null,
        avgPassDistance: t.passes ? +(t.passDistance / t.passes).toFixed(1) : null, avgPassDifficulty: t.passes ? +(t.passDifficulty / t.passes).toFixed(2) : null,
        xg: +t.xg.toFixed(2), maxShotKmh: Math.round(t.maxShotSpeed * 3.6),
      })),
      players: s.players.map((p, id) => ({ id, name: this.profiles[id].name, number: this.profiles[id].number, team: this.profiles[id].team, ...p, distance: Math.round(p.distance), topSpeedKmh: +(p.topSpeed * 3.6).toFixed(1), xg: +p.xg.toFixed(2) })).filter(p => p.touches > 0 || p.distance > 0),
      shots: s.shots.map(x => ({ ...x, xg: +x.xg.toFixed(3), kmh: Math.round(x.speed * 3.6) })),
      insights: this.insights.map(i => ({
        ...i,
        text: { fan: { en: words(i, 'fan', 'en'), de: words(i, 'fan', 'de') }, analyst: { en: words(i, 'analyst', 'en'), de: words(i, 'analyst', 'de') } },
      })),
    };
  }
}
