import type { DecisionMoment, DecisionOption, MatchSnapshot, PlayerProfile, Vec2 } from '../engine/types';
import { tr } from '../i18n';
import { attackSign } from '../physics/pitch-geometry';
import { goalDistance, shotXg } from './shot-model';
import type { MatchStatsBoard } from './stats';
import type { Mode } from './types';

/** Why the moment matters, from the frozen frame: who presses, how open each option is, what the recent minutes say. */
export type MomentBrief = { lines: string[]; options: { id: string; note: string; risk: 'low' | 'medium' | 'high' | null }[] };

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/** Shortest distance from p to the segment a–b. */
function toSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
}

const riskOf = (estimate: number | undefined): MomentBrief['options'][number]['risk'] =>
  estimate === undefined ? null : estimate >= 0.65 ? 'low' : estimate >= 0.4 ? 'medium' : 'high';

/**
 * Part of stage 3 (explain) for decision moments: the facts behind the choice, measured in the frame the match is
 * frozen in. It explains and compares; it never picks for the user and never changes an option.
 */
export function briefMoment(m: DecisionMoment, s: MatchSnapshot, profiles: readonly PlayerProfile[], stats: MatchStatsBoard, mode: Mode): MomentBrief {
  const name = (id: number) => profiles[id].name;
  const actor = s.players[m.focusPlayer];
  const me: Vec2 = { x: actor.position.x, z: actor.position.z };
  const opponents = s.players.filter(p => !p.sentOff && profiles[p.id].team !== m.team);
  const lines: string[] = [];
  const analyst = mode === 'analyst';
  const sign = attackSign(m.team, s.half);

  // Who is closing in on the actor, and how fast.
  const near = opponents.map(p => {
    const d = dist(p.position, me);
    const rel = { x: actor.velocity.x - p.velocity.x, z: actor.velocity.z - p.velocity.z };
    const closing = d > 0 ? (rel.x * (p.position.x - me.x) + rel.z * (p.position.z - me.z)) / d : 0;
    return { id: p.id, d, closing };
  }).sort((a, b) => a.d - b.d)[0];
  const attacking = s.possession === m.team && m.category !== 'coach';
  // At a restart the ball is dead: pressure on the taker says nothing.
  if (near && m.category !== 'coach' && !s.restart) {
    if (attacking) {
      lines.push(near.d < 3
        ? tr(`Under pressure: ${name(near.id)} is ${near.d.toFixed(1)} m away${near.closing > 0.5 ? `, closing at ${near.closing.toFixed(1)} m/s` : ''}.`, `Unter Druck: ${name(near.id)} ist ${near.d.toFixed(1)} m entfernt${near.closing > 0.5 ? ` und kommt mit ${near.closing.toFixed(1)} m/s näher` : ''}.`)
        : tr(`Time on the ball: the nearest opponent, ${name(near.id)}, is ${near.d.toFixed(1)} m away.`, `Zeit am Ball: Der nächste Gegner, ${name(near.id)}, ist ${near.d.toFixed(1)} m entfernt.`));
    }
  }
  // Defending: what the opponent with the ball could do from where he is.
  if (!attacking && s.lastTouch !== null && profiles[s.lastTouch].team !== m.team && m.category !== 'coach') {
    const carrier = s.players[s.lastTouch], at = { x: carrier.position.x, z: carrier.position.z };
    const theirSign = attackSign(profiles[s.lastTouch].team, s.half);
    const xg = shotXg(at, theirSign);
    lines.push(tr(`${name(s.lastTouch)} is ${Math.round(goalDistance(at, theirSign))} m from our goal${analyst ? ` – a shot from here: model xG ${xg.toFixed(2)}` : xg > 0.1 ? ' – dangerous if he shoots' : ''}.`, `${name(s.lastTouch)} ist ${Math.round(goalDistance(at, theirSign))} m vor unserem Tor${analyst ? ` – ein Schuss von hier: Modell-xG ${xg.toFixed(2)}` : xg > 0.1 ? ' – gefährlich, wenn er schießt' : ''}.`));
    // Our man on the ball carrier, and how many of ours are between the ball and our goal against their runners near it.
    if (m.focusPlayer !== s.lastTouch && profiles[m.focusPlayer].team === m.team) {
      lines.push(tr(`${name(m.focusPlayer)} is ${dist(me, at).toFixed(1)} m from him.`, `${name(m.focusPlayer)} ist ${dist(me, at).toFixed(1)} m von ihm entfernt.`));
    }
    const ownGoalX = -sign * 52.5;
    const goalSide = s.players.filter(p => !p.sentOff && profiles[p.id].team === m.team && profiles[p.id].role !== 'GK' && Math.abs(p.position.x - ownGoalX) < Math.abs(at.x - ownGoalX)).length;
    const runners = opponents.filter(p => p.id !== s.lastTouch && Math.abs(p.position.x - ownGoalX) < 30).length;
    lines.push(tr(`${goalSide} of ours goal-side of the ball, ${runners} of theirs within 30 m of our goal.`, `${goalSide} von uns zwischen Ball und Tor, ${runners} Gegner im Umkreis von 30 m vor unserem Tor.`));
  }

  // Each option: the passing lane and the receiver's room, measured; the players' own estimate where there is one.
  const ball: Vec2 = { x: s.ball.position.x, z: s.ball.position.z };
  const options = m.options.map((o: DecisionOption) => {
    const v = o.visual?.ball;
    const parts: string[] = [];
    if (v && v.kind !== 'shot' && v.kind !== 'dribble') {
      const lane = Math.min(...opponents.map(p => toSegment(p.position, ball, v.to)));
      const room = v.receiver !== undefined ? Math.min(...opponents.map(p => dist(p.position, s.players[v.receiver!].position))) : null;
      parts.push(analyst ? tr(`lane ${lane.toFixed(1)} m clear`, `Passweg ${lane.toFixed(1)} m frei`) : lane < 1.5 ? tr('lane tight', 'Passweg eng') : tr('lane open', 'Passweg offen'));
      if (room !== null) parts.push(analyst ? tr(`receiver ${room.toFixed(1)} m free`, `Empfänger ${room.toFixed(1)} m frei`) : room < 2 ? tr('receiver marked', 'Empfänger gedeckt') : tr('receiver free', 'Empfänger frei'));
    }
    if (v?.kind === 'shot' && analyst) parts.push(tr(`${Math.round(goalDistance(ball, sign))} m to goal`, `${Math.round(goalDistance(ball, sign))} m zum Tor`));
    if (o.estimate !== undefined) parts.push(tr(`players' estimate ${Math.round(o.estimate * 100)} %`, `Einschätzung ${Math.round(o.estimate * 100)} %`));
    return { id: o.id, note: parts.join(' · '), risk: riskOf(o.estimate) };
  });

  // Why the options differ: the safest against the boldest, by the players' own estimate.
  const rated = m.options.filter(o => o.estimate !== undefined).sort((a, b) => b.estimate! - a.estimate!);
  if (rated.length >= 2) {
    const safe = rated[0], bold = rated[rated.length - 1];
    lines.push(tr(`Safest: ${safe.label} (${Math.round(safe.estimate! * 100)} %). Boldest: ${bold.label} (${Math.round(bold.estimate! * 100)} %) – less likely to come off, more to gain if it does.`, `Am sichersten: ${safe.label} (${Math.round(safe.estimate! * 100)} %). Am mutigsten: ${bold.label} (${Math.round(bold.estimate! * 100)} %) – seltener erfolgreich, aber mit mehr Ertrag.`));
  }

  // The last minutes, from the statistics so far (fans get the short version).
  if (!analyst) {
    const theirShots = stats.shots.filter(x => x.team !== m.team && s.time - x.time <= 300).length, ourShots = stats.shots.filter(x => x.team === m.team && s.time - x.time <= 300).length;
    if (theirShots + ourShots >= 2) lines.push(tr(`Shots in the last 5 minutes: us ${ourShots}, them ${theirShots}.`, `Schüsse in den letzten 5 Minuten: wir ${ourShots}, die anderen ${theirShots}.`));
  } else {
    const recent = (t: 0 | 1) => stats.shots.filter(x => x.team === t && s.time - x.time <= 300);
    const ours = recent(m.team), theirs = recent((1 - m.team) as 0 | 1);
    const xg = (l: typeof ours) => l.reduce((a, x) => a + x.xg, 0).toFixed(2);
    lines.push(tr(`Last 5 min: shots ${ours.length}:${theirs.length}, xG ${xg(ours)}:${xg(theirs)}.`, `Letzte 5 min: Schüsse ${ours.length}:${theirs.length}, xG ${xg(ours)}:${xg(theirs)}.`));
  }
  return { lines, options };
}
