import type { MatchEvent, MatchSnapshot, PlayerProfile, RestartKind, TeamId, Vec2 } from '../engine/types';
import { attackSign, PITCH } from '../physics/pitch-geometry';
import { goalDistance, shotXg } from './shot-model';
import type { PlayerStats, TeamStats } from './types';

/** A defender this close to the ball carrier puts him under pressure (m); a ball won this soon after counts for the press (s). */
export const PRESSURE_DISTANCE = 2, PRESSURE_WIN = 3;
/** Running faster than this is a sprint (m/s, ≈ 25 km/h; players reach 8.0–9.9 m/s). */
export const SPRINT_SPEED = 7;
/** Longest time from a swing to the boot's contact for that contact to be the swing's kick (s), as in match-stats.ts. */
const KICK_CONTACT = 0.7;

export type PassRecord = {
  time: number; team: TeamId; passer: number; nextToucher: number; completed: boolean;
  distance: number; difficulty: number; progressive: boolean; speed: number; pressure: number; eventIds: number[];
};
export type ShotRecord = {
  time: number; team: TeamId; player: number; xg: number; speed: number; distance: number;
  outcome: 'open' | 'goal' | 'saved' | 'blocked' | 'off-target' | 'deflected'; eventIds: number[];
};
/** `zone`: where the losing team lost it, seen from its own goal. */
export type TurnoverRecord = { time: number; winner: TeamId; player: number; zone: 'own-third' | 'middle' | 'final-third'; eventId: number };
/** `high`: in the pressing team's attacking half (a press up the pitch rather than defending deep). */
export type PressureRecord = { time: number; team: TeamId; presser: number; carrier: number; won: boolean; high: boolean };
/** A team's spell with the ball: how it began and the passes in it, for the story of a goal. */
export type Move = { team: TeamId; time: number; origin: 'turnover' | RestartKind; zone: TurnoverRecord['zone'] | null; passes: number; eventIds: number[] };

const emptyTeam = (): TeamStats => ({
  possession: 0, territory: 0, passes: 0, passesCompleted: 0, passDistance: 0, passDifficulty: 0, progressivePasses: 0, shots: 0, shotsOnTarget: 0,
  xg: 0, goals: 0, pressures: 0, pressureWins: 0, ballsWon: 0, ballsLost: 0, lostOwnThird: 0, fouls: 0, corners: 0, maxShotSpeed: 0,
});
const emptyPlayer = (): PlayerStats => ({ touches: 0, passes: 0, passesCompleted: 0, shots: 0, goals: 0, xg: 0, distance: 0, topSpeed: 0, sprints: 0, ballsWon: 0 });

/**
 * Difficulty of a pass on a 1–5 scale from what made it hard: length, an opponent close to the passer, and playing it
 * forward into the opponents' half of the pitch. Shown with its parts, so the rating can be followed.
 */
export function passDifficulty(distance: number, pressure: number, gain: number): number {
  const rating = 1 + distance / 15 + (pressure < PRESSURE_DISTANCE ? 1.2 : pressure < 4 ? 0.6 : 0) + (gain >= 10 ? 0.8 : 0);
  return Math.max(1, Math.min(5, Math.round(rating)));
}

/** Stage 2 – interpret: statistics of both teams and every player, from events and the frames they happened in. */
export class MatchStatsBoard {
  readonly teams: [TeamStats, TeamStats] = [emptyTeam(), emptyTeam()];
  readonly players: PlayerStats[];
  readonly passes: PassRecord[] = [];
  readonly shots: ShotRecord[] = [];
  readonly turnovers: TurnoverRecord[] = [];
  readonly pressures: PressureRecord[] = [];
  /** Ball changing teams between touches (a restart is not a change). */
  possessionChanges = 0;
  move: Move | null = null;
  half: 1 | 2 = 1;
  private readonly swings = new Map<number, { kind: string; time: number; id: number; from: Vec2; pressure: number }>();
  private openPass: { passer: number; team: TeamId; time: number; from: Vec2; pressure: number; speed: number; eventIds: number[] } | null = null;
  private openShot: ShotRecord | null = null;
  private prevToucher: number | null = null;
  private lastFrame: MatchSnapshot | null = null;
  private pressing: PressureRecord | null = null;
  private readonly sprinting = new Set<number>();

  constructor(readonly profiles: readonly PlayerProfile[]) {
    this.players = profiles.map(emptyPlayer);
  }

  private team(id: number): TeamId {
    return this.profiles[id].team;
  }

  private sign(team: TeamId): 1 | -1 {
    return attackSign(team, this.half);
  }

  /** Nearest opponent of `player` in a frame (m). */
  private pressureOn(player: number, frame: MatchSnapshot): number {
    const me = frame.players[player].position;
    let best = Infinity;
    for (const p of frame.players) {
      if (p.sentOff || this.team(p.id) === this.team(player)) continue;
      best = Math.min(best, Math.hypot(p.position.x - me.x, p.position.z - me.z));
    }
    return best;
  }

  /** Where a team lost the ball, seen from its own goal. */
  private zoneFor(loser: TeamId, at: Vec2): TurnoverRecord['zone'] {
    const fromOwnGoal = (at.x * this.sign(loser) + PITCH.halfLength);
    return fromOwnGoal < PITCH.length / 3 ? 'own-third' : fromOwnGoal < (2 * PITCH.length) / 3 ? 'middle' : 'final-third';
  }

  ingest(e: MatchEvent, frame: MatchSnapshot): void {
    this.half = frame.half;
    switch (e.type) {
      case 'swing': {
        const at = frame.ball.position;
        this.swings.set(e.player, { kind: e.action, time: e.time, id: e.id, from: { x: at.x, z: at.z }, pressure: this.pressureOn(e.player, frame) });
        return;
      }
      case 'touch': case 'catch': return this.onTouch(e);
      case 'goal': {
        this.teams[e.team].goals++;
        if (!e.ownGoal && e.scorer !== null) this.players[e.scorer].goals++;
        if (this.openShot) { this.openShot.outcome = 'goal'; this.openShot.eventIds.push(e.id); this.teams[this.openShot.team].shotsOnTarget++; this.openShot = null; }
        return this.stoppage();
      }
      case 'out':
        if (this.openShot) { this.openShot.outcome = 'off-target'; this.openShot.eventIds.push(e.id); this.openShot = null; }
        if (e.restart === 'corner') this.teams[e.team].corners++;
        return this.stoppage();
      case 'offside': return this.stoppage();
      case 'foul': this.teams[this.team(e.offender)].fouls++; return;
      case 'in-play': {
        const team = this.team(e.taker);
        this.move = { team, time: e.time, origin: e.restart, zone: null, passes: 0, eventIds: [e.id] };
        return;
      }
      default:
    }
  }

  private stoppage(): void {
    this.openPass = null;
    this.prevToucher = null;
  }

  private onTouch(e: Extract<MatchEvent, { type: 'touch' | 'catch' }>): void {
    const player = e.player, team = this.team(player);
    this.players[player].touches++;
    // A pass or shot in flight is settled by the next player to touch the ball.
    if (this.openShot && player !== this.openShot.player) {
      const s = this.openShot;
      const keeper = this.profiles[player].role === 'GK' && team !== s.team;
      s.outcome = keeper ? 'saved' : team === s.team ? 'deflected' : 'blocked';
      if (keeper) this.teams[s.team].shotsOnTarget++;
      s.eventIds.push(e.id);
      this.openShot = null;
    }
    if (this.openPass && player !== this.openPass.passer) {
      const p = this.openPass;
      const to = { x: e.position.x, z: e.position.z };
      const distance = Math.hypot(to.x - p.from.x, to.z - p.from.z);
      const gain = (to.x - p.from.x) * this.sign(p.team);
      const completed = team === p.team;
      const difficulty = passDifficulty(distance, p.pressure, gain);
      this.passes.push({ time: p.time, team: p.team, passer: p.passer, nextToucher: player, completed, distance, difficulty, progressive: gain >= 10, speed: p.speed, pressure: p.pressure, eventIds: [...p.eventIds, e.id] });
      const t = this.teams[p.team];
      t.passes++; t.passDistance += distance; t.passDifficulty += difficulty;
      this.players[p.passer].passes++;
      if (completed) {
        t.passesCompleted++; this.players[p.passer].passesCompleted++;
        if (gain >= 10) t.progressivePasses++;
        if (this.move?.team === p.team) { this.move.passes++; this.move.eventIds.push(e.id); }
      }
      this.openPass = null;
    }
    // Possession changes along the sequence of touches.
    if (this.prevToucher !== null && this.team(this.prevToucher) !== team) {
      const loser = this.team(this.prevToucher);
      const zone = this.zoneFor(loser, e.position);
      this.possessionChanges++;
      this.turnovers.push({ time: e.time, winner: team, player, zone, eventId: e.id });
      this.teams[team].ballsWon++; this.teams[loser].ballsLost++;
      if (zone === 'own-third') this.teams[loser].lostOwnThird++;
      this.players[player].ballsWon++;
      this.move = { team, time: e.time, origin: 'turnover', zone, passes: 0, eventIds: [e.id] };
    }
    this.prevToucher = player;
    // The toucher's own kick: a struck pass or shot opens.
    const sw = this.swings.get(player);
    if (e.type !== 'touch' || e.part !== 'boot' || !sw || e.time - sw.time > KICK_CONTACT) return;
    this.swings.delete(player);
    if (sw.kind === 'pass') {
      this.openPass = { passer: player, team, time: e.time, from: sw.from, pressure: sw.pressure, speed: e.ballSpeed, eventIds: [sw.id, e.id] };
    } else if (sw.kind === 'shot') {
      const from = { x: e.position.x, z: e.position.z };
      const xg = shotXg(from, this.sign(team));
      const shot: ShotRecord = { time: e.time, team, player, xg, speed: e.ballSpeed, distance: goalDistance(from, this.sign(team)), outcome: 'open', eventIds: [sw.id, e.id] };
      this.shots.push(shot);
      this.openShot = shot;
      const t = this.teams[team];
      t.shots++; t.xg += xg; t.maxShotSpeed = Math.max(t.maxShotSpeed, e.ballSpeed);
      this.players[player].shots++; this.players[player].xg += xg;
    }
  }

  /**
   * A displayed frame, a few times per simulated second: time in possession and in the opponents' half, pressure on
   * the ball carrier, distance and speed of every player. Only while the ball is in play.
   */
  observe(frame: MatchSnapshot): void {
    const prev = this.lastFrame;
    this.lastFrame = frame;
    this.half = frame.half;
    if (!prev || frame.phase !== 'in-play') return;
    const dt = frame.time - prev.time;
    if (dt <= 0 || dt > 1) return;
    if (frame.possession !== null) {
      const t = this.teams[frame.possession];
      t.possession += dt;
      if (frame.ball.position.x * this.sign(frame.possession) > 0) t.territory += dt;
    }
    for (const p of frame.players) {
      if (p.sentOff) continue;
      const q = prev.players[p.id];
      const s = this.players[p.id];
      s.distance += Math.hypot(p.position.x - q.position.x, p.position.z - q.position.z);
      const speed = Math.hypot(p.velocity.x, p.velocity.z);
      s.topSpeed = Math.max(s.topSpeed, speed);
      if (speed > SPRINT_SPEED && !this.sprinting.has(p.id)) { this.sprinting.add(p.id); s.sprints++; }
      else if (speed < SPRINT_SPEED - 1) this.sprinting.delete(p.id);
    }
    this.trackPressure(frame);
  }

  private trackPressure(frame: MatchSnapshot): void {
    const open = this.pressing;
    if (open && !open.won && frame.time - open.time <= PRESSURE_WIN && frame.possession === open.team) {
      open.won = true;
      this.teams[open.team].pressureWins++;
    }
    const carrier = frame.lastTouch;
    if (carrier === null || frame.ball.heldBy !== null) return;
    const c = frame.players[carrier].position, b = frame.ball.position;
    if (Math.hypot(c.x - b.x, c.z - b.z) > 1.5) return;
    let presser = -1, best = PRESSURE_DISTANCE;
    for (const p of frame.players) {
      if (p.sentOff || this.team(p.id) === this.team(carrier)) continue;
      const d = Math.hypot(p.position.x - c.x, p.position.z - c.z);
      if (d < best) { best = d; presser = p.id; }
    }
    // One pressure per carrier and spell: a new one only when the carrier changed or the last one has run out.
    if (presser < 0 || (open && open.carrier === carrier && frame.time - open.time < PRESSURE_WIN)) return;
    const team = this.team(presser);
    this.pressing = { time: frame.time, team, presser, carrier, won: false, high: b.x * this.sign(team) > 0 };
    this.pressures.push(this.pressing);
    this.teams[team].pressures++;
  }
}
