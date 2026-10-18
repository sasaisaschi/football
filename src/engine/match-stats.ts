import type { BallAction, MatchEvent, PlayerProfile } from './types';

/**
 * Match statistics from the event stream, shared by `npm run sim` (one full match) and `npm run probe`
 * (several seeds). Possession changes are counted along the sequence of ball touches: a touch by the other
 * team than the previous touch, reset at every stoppage (a restart is not a turnover).
 */
export type MatchStats = {
  score: [number, number];
  ownGoals: number;
  /** How each goal went in: the scorer's last swing (touch within 1 s of it), a ball off the body, or an own goal. */
  goalsFrom: Record<BallAction['kind'] | 'body' | 'hands' | 'none' | 'own', number>;
  shots: [number, number];
  /** Shots at the end of a move with at least three completed passes since the team won the ball. */
  shotsAfterBuildUp: number;
  passes: number;
  passesCompleted: number;
  possessionChanges: number;
  /** How the losing team's last touch came about: its swing (touch within 1 s of it), a ball off the body or hands, or a boot touch without a swing. */
  lossesAfter: Record<BallAction['kind'] | 'body' | 'hands' | 'none', number>;
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
};

export function matchStats(events: readonly MatchEvent[], profiles: readonly PlayerProfile[]): MatchStats {
  const team = (player: number) => profiles[player].team;
  const s: MatchStats = {
    score: [0, 0], ownGoals: 0,
    goalsFrom: { pass: 0, shot: 0, dribble: 0, clear: 0, tackle: 0, control: 0, body: 0, hands: 0, none: 0, own: 0 },
    shots: [0, 0], shotsAfterBuildUp: 0, passes: 0, passesCompleted: 0, possessionChanges: 0,
    lossesAfter: { pass: 0, shot: 0, dribble: 0, clear: 0, tackle: 0, control: 0, body: 0, hands: 0, none: 0 },
    pingPong: 0, meanSpell: 0, fouls: 0, yellow: 0, red: 0, penalties: 0, offsides: 0, corners: 0, throwIns: 0, goalKicks: 0, keeperCatches: 0,
  };
  const lastSwing = new Map<number, { kind: BallAction['kind']; time: number }>();
  let prev: { player: number; time: number; part: 'boot' | 'body' | 'hands' } | null = null;
  let spellStart = 0, spellSum = 0;
  let lastChange: { from: 0 | 1; time: number } | null = null;
  let openPass: { player: number } | null = null;
  let movePasses = 0;
  for (const ev of events) {
    switch (ev.type) {
      case 'swing':
        lastSwing.set(ev.player, { kind: ev.action, time: ev.time });
        if (ev.action === 'shot') { s.shots[team(ev.player)]++; if (movePasses >= 3) s.shotsAfterBuildUp++; }
        if (ev.action === 'pass') { s.passes++; openPass = { player: ev.player }; }
        break;
      case 'touch': case 'catch': {
        if (openPass && ev.player !== openPass.player) {
          if (team(ev.player) === team(openPass.player)) { s.passesCompleted++; movePasses++; }
          openPass = null;
        }
        if (prev && team(prev.player) !== team(ev.player)) {
          s.possessionChanges++;
          movePasses = 0;
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
      case 'goal':
        s.score[ev.team]++;
        if (ev.ownGoal) s.ownGoals++;
        if (ev.ownGoal || !prev) s.goalsFrom.own++;
        else {
          const sw = lastSwing.get(prev.player);
          s.goalsFrom[prev.part !== 'boot' ? prev.part : sw && prev.time - sw.time < 1 ? sw.kind : 'none']++;
        }
        break;
      case 'out':
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
    }
  }
  s.meanSpell = +(spellSum / Math.max(1, s.possessionChanges)).toFixed(1);
  return s;
}
