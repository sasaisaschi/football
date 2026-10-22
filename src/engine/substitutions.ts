import type { MatchEngine } from './match-engine';
import type { RestartState } from './restarts';
import { chooseTaker } from './restarts';
import { PITCH } from '../physics/pitch-geometry';
import type { PlayerProfile, Role, SubReason, TeamId } from './types';

/** Law 3 (competition rules of the top leagues): five substitutes, used on at most three occasions plus half-time. */
export const MAX_SUBSTITUTIONS = 5, SUB_OCCASIONS = 3;

/** Substitutions made per team, the stoppages they were made at, and who has come on (no one returns). */
export class SubstitutionLog {
  readonly made: [number, number] = [0, 0];
  readonly occasions: [number, number] = [0, 0];
  readonly lastRestart: [RestartState | null, RestartState | null] = [null, null];
  readonly cameOn = new Set<number>();
}

/** Can `team` still make a change now? Only with the ball out of play, within the limits of Law 3. */
export function canSubstitute(e: MatchEngine, team: TeamId): boolean {
  const r = e.restart, log = e.subs;
  const deadBall = e.phase === 'stopped' || (e.phase === 'decision' && e.momentResume === 'stopped');
  if (!r || !deadBall || log.made[team] >= MAX_SUBSTITUTIONS) return false;
  return log.lastRestart[team] === r || halfTimeRestart(e, r) || log.occasions[team] < SUB_OCCASIONS;
}

/** The kick-off of the second half: changes at half-time do not use up an occasion (Law 3). */
function halfTimeRestart(e: MatchEngine, r: RestartState): boolean {
  return r.kind === 'kickoff' && e.half === 2 && e.clockSeconds() < 1;
}

/** Bench players of `team` who may still come on. */
export function benchOf(e: MatchEngine, team: TeamId): PlayerProfile[] {
  return e.profiles.filter(p => p.team === team && p.squad === 'bench' && e.referee.sentOff.has(p.id) && !e.subs.cameOn.has(p.id));
}

/**
 * Law 3: `on` replaces `off` while the ball is out of play. The replaced player leaves and may not return; the
 * substitute enters at the halfway line and takes over his position, or `role` (a substitute keeper after a red card
 * to the keeper goes in goal). Throws on an illegal change.
 */
export function substitute(e: MatchEngine, off: number, on: number, role?: Role, reason?: SubReason): void {
  const po = e.profiles[off], pn = e.profiles[on];
  if (po.team !== pn.team) throw new Error('Substitution between different teams');
  if (!canSubstitute(e, po.team)) throw new Error('No substitution possible now (ball in play or limit reached)');
  if (e.referee.sentOff.has(off)) throw new Error(`${po.name} is not on the pitch`);
  if (!benchOf(e, pn.team).some(p => p.id === on)) throw new Error(`${pn.name} cannot come on`);
  if (role === 'GK' && pn.role !== 'GK') throw new Error(`${pn.name} is no keeper`);
  const r = e.restart!, log = e.subs;
  if (log.lastRestart[po.team] !== r && !halfTimeRestart(e, r)) log.occasions[po.team]++;
  log.lastRestart[po.team] = r;
  log.made[po.team]++;
  e.leavePitch(off);
  e.referee.sentOff.add(off);
  pn.role = role ?? po.role;
  log.cameOn.add(on);
  e.referee.sentOff.delete(on);
  const body = e.bodies[on];
  body.body.setEnabled(true);
  body.collider.setEnabled(true);
  e.setPartsEnabled(on, true);
  if (pn.role === 'GK') e.keepers.get(on)?.hands.collider.setEnabled(true);
  const side = po.team === 0 ? 1 : -1;
  body.place(0, side * (PITCH.halfWidth - 0.5), side > 0 ? Math.PI : 0);
  e.legs[on].snap();
  e.heads[on].reset();
  e.chests[on].reset();
  e.brains[on].perception.reset(e.truth());
  if (r.taker === off) r.taker = chooseTaker(r.kind, r.team, r.spot, e.profiles, e.positions(), e.referee.sentOff);
  e.emit({ type: 'substitution', team: po.team, off, on, role: pn.role, ...(reason ? { reason } : {}) });
}

/** Off the pitch (red card, substitution, bench): no collider, no body in the simulation, forgotten by everyone. */
export function leavePitch(e: MatchEngine, player: number): void {
  const body = e.bodies[player];
  body.collider.setEnabled(false);
  for (const b of e.legs[player].boots) b.collider.setEnabled(false);
  e.heads[player].reset();
  e.chests[player].reset();
  e.keepers.get(player)?.hands.collider.setEnabled(false);
  // He walks off: placed beside the pitch, outside the boards, where he no longer takes part.
  body.place(0, (PITCH.halfWidth + PITCH.runOff + 4) * (e.profiles[player].team === 0 ? 1 : -1), 0);
  body.body.setEnabled(false);
  // His boots, head, chest and hands leave the simulation too (moving 20 idle bench boots each tick cost ≈ 10 %).
  setPartsEnabled(e, player, false);
  for (const b of e.brains) b.perception.forget(player);
}

export function setPartsEnabled(e: MatchEngine, player: number, on: boolean): void {
  for (const b of e.legs[player].boots) b.body.setEnabled(on);
  e.heads[player].body.setEnabled(on);
  e.chests[player].body.setEnabled(on);
  e.keepers.get(player)?.hands.body.setEnabled(on);
}
