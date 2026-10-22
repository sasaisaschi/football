import type { BallAction, MatchEvent, PlayerProfile, RestartKind } from './types';
import { PITCH } from '../physics/pitch-geometry';

/**
 * Match statistics from the event stream, shared by `npm run sim` (one full match) and `npm run probe`
 * (several seeds). Possession changes are counted along the sequence of ball touches: a touch by the other
 * team than the previous touch, reset at every stoppage (a restart is not a turnover).
 */
export type MatchStats = {
  score: [number, number];
  ownGoals: number;
  /** How each goal went in: the scorer's last swing (touch within 1 s of it), a ball off the body, or an own goal. */
  goalsFrom: Record<BallAction['kind'] | 'head' | 'body' | 'hands' | 'none' | 'own', number>;
  shots: [number, number];
  /** Shots at the end of a move with at least three completed passes since the team won the ball. */
  shotsAfterBuildUp: number;
  /** Passes struck (swing followed by the boot's contact); completed when a team-mate touches the ball next. */
  passes: number;
  passesCompleted: number;
  possessionChanges: number;
  /** How the losing team's last touch came about: its swing (touch within 1 s of it), a ball off the body or hands, or a boot touch without a swing. */
  lossesAfter: Record<BallAction['kind'] | 'head' | 'body' | 'hands' | 'none', number>;
  /** Changes won back by the losing team within 1 s: contested balls rather than real turnovers. */
  pingPong: number;
  /** Mean length of a spell of possession that ended in a turnover, in seconds. */
  meanSpell: number;
  fouls: number;
  yellow: number;
  red: number;
  penalties: number;
  offsides: number;
  corners: number;
  throwIns: number;
  goalKicks: number;
  keeperCatches: number;
  /** Where a goal's move began: open play, or a restart with no change of possession and at most 20 s before the goal. */
  goalOrigin: Record<'open' | RestartKind, number>;
  /** Distance to goal of the scorer's last touch (m). */
  goalDistance: { under11: number; from11to18: number; from18to25: number; over25: number };
  /** What happened to each struck shot next: goal, the keeper (caught or parried), a defender's block, a team-mate, or out. */
  shotOutcome: { goal: number; caught: number; parried: number; blocked: number; mate: number; out: number };
};

/** Longest time from a pass swing to the boot's contact for the touch to be that pass (s), as for a deliberate touch. */
const PASS_CONTACT = 0.7;

export function matchStats(events: readonly MatchEvent[], profiles: readonly PlayerProfile[]): MatchStats {
  const team = (player: number) => profiles[player].team;
  const s: MatchStats = {
    score: [0, 0], ownGoals: 0,
    goalsFrom: { pass: 0, shot: 0, dribble: 0, clear: 0, tackle: 0, control: 0, header: 0, throw: 0, head: 0, body: 0, hands: 0, none: 0, own: 0 },
    shots: [0, 0], shotsAfterBuildUp: 0, passes: 0, passesCompleted: 0, possessionChanges: 0,
    lossesAfter: { pass: 0, shot: 0, dribble: 0, clear: 0, tackle: 0, control: 0, header: 0, throw: 0, head: 0, body: 0, hands: 0, none: 0 },
    pingPong: 0, meanSpell: 0, fouls: 0, yellow: 0, red: 0, penalties: 0, offsides: 0, corners: 0, throwIns: 0, goalKicks: 0, keeperCatches: 0,
    goalOrigin: { open: 0, kickoff: 0, 'throw-in': 0, corner: 0, 'goal-kick': 0, 'free-kick': 0, penalty: 0, 'drop-ball': 0 },
    goalDistance: { under11: 0, from11to18: 0, from18to25: 0, over25: 0 },
    shotOutcome: { goal: 0, caught: 0, parried: 0, blocked: 0, mate: 0, out: 0 },
  };
  // The restart the current move began with (cleared by a change of possession) and the shot still travelling.
  let origin: { kind: RestartKind; time: number } | null = null;
  let openShot: { player: number } | null = null;
  let lastTouchAt: { x: number; z: number } | null = null;
  const lastSwing = new Map<number, { kind: BallAction['kind']; time: number }>();
  let prev: { player: number; time: number; part: 'boot' | 'head' | 'body' | 'hands' } | null = null;
  let spellStart = 0, spellSum = 0;
  let lastChange: { from: 0 | 1; time: number } | null = null;
  let openPass: { player: number } | null = null;
  const kickedSwing = new Map<number, number>();
  let movePasses = 0;
  for (const ev of events) {
    switch (ev.type) {
      case 'swing':
        lastSwing.set(ev.player, { kind: ev.action, time: ev.time });
        if (ev.action === 'shot') { s.shots[team(ev.player)]++; if (movePasses >= 3) s.shotsAfterBuildUp++; }
        break;
      case 'touch': case 'catch': {
        if (openShot && ev.player !== openShot.player) {
          const keeper = profiles[ev.player].role === 'GK' && team(ev.player) !== team(openShot.player);
          if (keeper) s.shotOutcome[ev.type === 'catch' ? 'caught' : 'parried']++;
          else s.shotOutcome[team(ev.player) === team(openShot.player) ? 'mate' : 'blocked']++;
          openShot = null;
        }
        if (openPass && ev.player !== openPass.player) {
          if (team(ev.player) === team(openPass.player)) { s.passesCompleted++; movePasses++; }
          openPass = null;
        }
        // A pass counts once the boot has struck the ball: an air swing is no pass, and a receiver's first-time pass
        // swings before his touch, which first completes the pass he received.
        const own = lastSwing.get(ev.player);
        if (ev.type === 'touch' && ev.part === 'boot' && own?.kind === 'pass' && ev.time - own.time < PASS_CONTACT && kickedSwing.get(ev.player) !== own.time) {
          kickedSwing.set(ev.player, own.time);
          s.passes++;
          openPass = { player: ev.player };
        }
        if (ev.type === 'touch' && ev.part === 'boot' && own?.kind === 'shot' && ev.time - own.time < PASS_CONTACT && kickedSwing.get(ev.player) !== own.time) {
          kickedSwing.set(ev.player, own.time);
          openShot = { player: ev.player };
        }
        lastTouchAt = { x: ev.position.x, z: ev.position.z };
        if (prev && team(prev.player) !== team(ev.player)) {
          s.possessionChanges++;
          movePasses = 0;
          origin = null;
          const sw = lastSwing.get(prev.player);
          s.lossesAfter[prev.part !== 'boot' ? prev.part : sw && prev.time - sw.time < 1 ? sw.kind : 'none']++;
          if (lastChange && lastChange.from === team(ev.player) && ev.time - lastChange.time < 1) s.pingPong++;
          spellSum += ev.time - spellStart;
          spellStart = ev.time;
          lastChange = { from: team(prev.player), time: ev.time };
        }
        if (!prev) spellStart = ev.time;
        prev = { player: ev.player, time: ev.time, part: ev.type === 'catch' ? 'hands' : ev.part };
        if (ev.type === 'catch') s.keeperCatches++;
        break;
      }
      case 'goal': {
        s.score[ev.team]++;
        if (openShot) s.shotOutcome.goal++;
        s.goalOrigin[origin && ev.time - origin.time <= 20 ? origin.kind : 'open']++;
        if (lastTouchAt) {
          const d = Math.hypot(Math.sign(ev.position.x) * PITCH.halfLength - lastTouchAt.x, lastTouchAt.z);
          s.goalDistance[d < 11 ? 'under11' : d < 18 ? 'from11to18' : d < 25 ? 'from18to25' : 'over25']++;
        }
        if (ev.ownGoal) s.ownGoals++;
        if (ev.ownGoal || !prev) s.goalsFrom.own++;
        else if (team(prev.player) !== ev.team && ev.scorer !== null) {
          // Deflected in by the defending side: credited to the attacker's last swing.
          const sw = lastSwing.get(ev.scorer);
          s.goalsFrom[sw && ev.time - sw.time < 3 ? sw.kind : 'none']++;
        } else {
          const sw = lastSwing.get(prev.player);
          s.goalsFrom[prev.part !== 'boot' ? prev.part : sw && prev.time - sw.time < 1 ? sw.kind : 'none']++;
        }
        break;
      }
      case 'in-play':
        origin = { kind: ev.restart, time: ev.time };
        break;
      case 'out':
        if (openShot) s.shotOutcome.out++;
        if (ev.restart === 'corner') s.corners++;
        if (ev.restart === 'throw-in') s.throwIns++;
        if (ev.restart === 'goal-kick') s.goalKicks++;
        break;
      case 'foul':
        s.fouls++;
        if (ev.card === 'yellow') s.yellow++;
        if (ev.card === 'red') s.red++;
        if (ev.penalty) s.penalties++;
        break;
      case 'offside':
        s.offsides++;
        break;
    }
    // A stoppage ends the sequence of touches and any pass still travelling (advantage plays on).
    if (ev.type === 'out' || ev.type === 'goal' || ev.type === 'offside' || ev.type === 'restart') {
      prev = null;
      lastChange = null;
      openPass = null;
      openShot = null;
      lastTouchAt = null;
    }
  }
  s.meanSpell = +(spellSum / Math.max(1, s.possessionChanges)).toFixed(1);
  return s;
}
