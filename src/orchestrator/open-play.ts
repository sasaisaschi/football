import { evaluateOptions, threatAt, type EvaluatedOption } from '../ai/options';
import { DEFENDERS, offsideLineU, shapeTarget, toTeam } from '../ai/shape';
import type { MatchEngine } from '../engine/match-engine';
import type { DecisionOption, MomentKind, OptionVisual, PlayerIntent, TeamId, TeamInstruction, Vec2 } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';
import { brainContext, carrier, dist, participantsFor, playerName, type MomentDraft } from './common';
import { tr } from '../i18n';

/** A pass or take-on the player could realistically pull off (estimated chance of success); a shot is offered whenever the player would consider it. */
const MIN_SUCCESS = 0.3;
/** Threat at stake for an attacking moment (≈ 27 m central): expected threat of the ball's position or the shot's chance. */
const STAKES = 0.02;
/** Options within this much expected threat (goal probability) of the best one make a real dilemma. */
const DILEMMA_GAP = 0.05;
/** A ball lost after holding it at least this long (s) is a real loss of possession, not a ricochet. */
const SPELL_FOR_COUNTER_PRESS = 4;

/** What the orchestrator remembers about possession, for transitions. */
export type PossessionTrack = { possessionChangedAt: number; lostSpell: number };

/** The user's player has the ball near the opponents' box and faces a real choice between alternatives. */
export function attackingMoment(e: MatchEngine, team: TeamId): MomentDraft | null {
  const c = carrier(e, team);
  if (c === null || e.legs[c].busy()) return null; // too late: the swing is already under way
  const sign = e.sign(team);
  const ball = e.ballPos();
  if (toTeam(sign, { x: ball.x, z: ball.z }).u < 0.42) return null;
  const brain = e.brains[c];
  const pic = brain.picture(brainContext(e, c));
  const options = evaluateOptions(pic).filter(o => o.kind !== 'clear');
  const shot = options.find(o => o.kind === 'shot');
  const passes = options.filter(o => o.kind === 'pass').slice(0, 2);
  const dribble = options.find(o => o.kind === 'dribble');
  // Only options a player could realistically pull off; their values may be negative (a risk of losing the ball),
  // so a dilemma is judged by how close they are, not by a ratio or a fixed floor that shifts with the AI's
  // value model.
  const candidates = [shot, ...passes, dribble].filter((o): o is EvaluatedOption => !!o && (o.kind === 'shot' || o.success >= MIN_SUCCESS));
  if (candidates.length < 2) return null;
  const best = Math.max(...candidates.map(o => o.value));
  // Relevant: there is real threat at stake and at least two options are close enough to be a dilemma.
  if (Math.max(threatAt(sign, { x: ball.x, z: ball.z }), shot?.success ?? 0) < STAKES) return null;
  // Ordered as on the reference picture's cards: passes first, then the take-on, the shot last.
  const order = { pass: 0, dribble: 1, shot: 2 } as Record<string, number>;
  const contenders = candidates.filter(o => o.value >= best - DILEMMA_GAP).slice(0, 4).sort((a, b) => (order[a.kind] ?? 1) - (order[b.kind] ?? 1));
  if (contenders.length < 2) return null;
  const from = { x: ball.x, z: ball.z };
  const decisionOptions: DecisionOption[] = contenders.map((o, i) => ({
    id: `${o.kind}-${i}`,
    label: optionLabel(e, sign, o),
    detail: o.note,
    effect: { type: 'player', player: c, intent: { type: 'ball', action: o.action, source: 'user', decidedAt: e.time } satisfies PlayerIntent },
    outlook: outlook(o),
    estimate: o.success,
    visual: ballVisual(c, from, o),
  }));
  const aiChoice = brain.chooseAction(brainContext(e, c));
  const fallback = decisionOptions.find(d => d.effect.type === 'player' && d.effect.intent.type === 'ball' && d.effect.intent.action.kind === aiChoice.kind) ?? decisionOptions[0];
  const kind: MomentKind = shot ? 'finish-or-pass' : 'take-on';
  const keeper = e.profiles.find(p => p.team !== team && p.role === 'GK' && !e.referee.sentOff.has(p.id));
  return {
    kind, category: 'attack', title: shot ? tr('Shoot or lay it off?', 'Abschluss oder Ablage?') : tr('Take him on or pass?', 'Durchsetzen oder abspielen?'),
    situation: tr(`${playerName(e, c)} has the ball ${Math.round(Math.hypot(sign * PITCH.halfLength - ball.x, ball.z))} m from goal.`, `${playerName(e, c)} hat den Ball ${Math.round(Math.hypot(sign * PITCH.halfLength - ball.x, ball.z))} m vor dem Tor.`),
    focusPlayer: c, options: decisionOptions, defaultOptionId: fallback.id,
    participants: participantsFor(e, team, c, decisionOptions, shot && keeper ? [keeper.id] : []),
  };
}

/**
 * The words on an option's card, as in the client's reference picture ("Steilpass auf Nr. 9", "Direkt aufs Tor
 * schießen"). A pass is named by what it really is: played into the space ahead of a team-mate towards goal (a through
 * ball), lofted into the box (a cross) or long, or simply to his feet.
 */
export function optionLabel(e: MatchEngine, sign: 1 | -1, o: EvaluatedOption): string {
  const a = o.action;
  if (a.kind === 'shot') return tr('Shoot at goal', 'Direkt aufs Tor schießen');
  if (a.kind !== 'pass') return tr('Take on the defender', 'Gegenspieler ausspielen');
  const n = e.profiles[a.receiver].number;
  const at = e.bodies[a.receiver].position(), ball = e.ballPos();
  const ahead = sign * (a.aim.x - at.x), forward = sign * (a.aim.x - ball.x);
  const inBox = sign * a.aim.x > PITCH.halfLength - PITCH.penaltyAreaDepth && Math.abs(a.aim.z) < PITCH.penaltyAreaHalfWidth;
  if (a.lofted) return inBox ? tr(`Cross to No. ${n}`, `Flanke auf Nr. ${n}`) : tr(`Long ball to No. ${n}`, `Hoher Ball auf Nr. ${n}`);
  if (forward > 4 && ahead > 1.2) return tr(`Through ball to No. ${n}`, `Steilpass auf Nr. ${n}`);
  return tr(`Pass to No. ${n}`, `Pass auf Nr. ${n}`);
}

/** The overlay of a ball option: where the ball is meant to go from the ball's current position. */
export function ballVisual(actor: number, from: Vec2, o: EvaluatedOption): OptionVisual {
  const a = o.action;
  if (a.kind === 'pass') return { actor, ball: { to: a.aim, kind: a.lofted ? 'lofted' : 'ground', receiver: a.receiver } };
  if (a.kind === 'shot') return { actor, ball: { to: { x: a.aim.x, z: a.aim.z }, kind: 'shot' } };
  if (a.kind === 'dribble') return { actor, ball: { to: { x: from.x + a.direction.x * 6, z: from.z + a.direction.z * 6 }, kind: 'dribble' } };
  return { actor };
}

/** Where the defensive line (mean of the back four) stands under an instruction, from the real shape model. */
export function lineUnder(e: MatchEngine, team: TeamId, instruction: TeamInstruction, inPossession: boolean): number {
  const sign = e.sign(team);
  const b = e.ballPos();
  const opponents = e.profiles.filter(p => p.team !== team && !e.referee.sentOff.has(p.id)).map(p => e.bodies[p.id].position());
  const xs = e.profiles.filter(p => p.team === team && DEFENDERS.has(p.role) && !e.referee.sentOff.has(p.id))
    .map(p => shapeTarget(p.role, { sign, ball: { x: b.x, z: b.z }, inPossession, instruction, offsideLineU: offsideLineU(sign, opponents) }).x);
  return xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
}

/** Possession just changed in midfield: counter boldly / secure the ball, or counter-press / drop off. */
export function transitionMoment(e: MatchEngine, team: TeamId, track: PossessionTrack): MomentDraft | null {
  if (e.time - track.possessionChangedAt > 0.8) return null;
  const touch = e.referee.lastTouch;
  if (!touch) return null;
  const ball = e.ballPos();
  const sign = e.sign(team);
  const u = toTeam(sign, { x: ball.x, z: ball.z }).u;
  const ahead = (t: TeamId) => e.profiles.filter(p => !e.referee.sentOff.has(p.id) && p.team === t && sign * (e.bodies[p.id].position().x - ball.x) > 0).length;
  const base = e.instructions[team];
  const instr = (over: Partial<TeamInstruction>): TeamInstruction => ({ ...base, ...over });
  const line = (i: TeamInstruction, own: boolean): OptionVisual['line'] => ({ team, from: lineUnder(e, team, base, own), to: lineUnder(e, team, i, own) });
  if (touch.team === team && u > -0.6 && u < 0.05 && e.time - e.halfStartedAt > 20) {
    // A real counter: won in our half, the ball carrier is moving forward and the opponents are outnumbered
    // or level ahead of the ball.
    const attackers = ahead(team), defenders = ahead((1 - team) as TeamId);
    const carrierV = e.bodies[touch.player].velocity();
    if (attackers < 2 || defenders > attackers + 1 || sign * carrierV.x < 1.5) return null;
    const counter = instr({ risk: 0.95, lineHeight: 0.5, press: 'high' }), secure = instr({ risk: 0.15, lineHeight: 0 });
    const options: DecisionOption[] = [
      { id: 'counter', label: tr('Counter fast', 'Schnell kontern'), detail: tr('High risk, forwards run in behind', 'Risiko hoch, Stürmer laufen tief'), effect: { type: 'team', team, instruction: counter, seconds: 15 }, outlook: tr(`${attackers} against ${defenders} ahead of the ball`, `${attackers} gegen ${defenders} vor dem Ball`), visual: { actor: touch.player, line: line(counter, true), zone: { x: ball.x + sign * 25, z: ball.z * 0.5, r: 9 } } },
      { id: 'secure', label: tr('Keep the ball', 'Ball sichern'), detail: tr('Slow it down, let the team move up', 'Tempo raus, Mannschaft nachrücken lassen'), effect: { type: 'team', team, instruction: secure, seconds: 15 }, outlook: tr('less risk of losing it, the opponents regroup', 'weniger Ballverlustrisiko, Gegner formiert sich'), visual: { actor: touch.player, line: line(secure, true) } },
    ];
    return {
      kind: 'counter-attack', category: 'transition', title: tr('Ball won – counter?', 'Ballgewinn – Konter?'), situation: tr(`Ball won ${Math.round((u + 1) * 52.5)} m from our own goal.`, `Ballgewinn ${Math.round((u + 1) * 52.5)} m vor dem eigenen Tor.`),
      focusPlayer: touch.player, options, defaultOptionId: base.risk > 0.6 ? 'counter' : 'secure', participants: participantsFor(e, team, touch.player, options),
    };
  }
  // A real loss: we had the ball for a while and the opponent now has it under control, not a ricochet.
  if (touch.team !== team && u > 0.15 && e.time - e.halfStartedAt > 20 && track.lostSpell >= SPELL_FOR_COUNTER_PRESS && carrier(e, touch.team) !== null) {
    const press = instr({ press: 'high', lineHeight: 0.7 }), drop = instr({ press: 'low', lineHeight: -0.6 });
    const options: DecisionOption[] = [
      { id: 'gegenpress', label: tr('Counter-press now', 'Sofort gegenpressen'), detail: tr('Press high, the line steps up', 'Hoch pressen, Linie rückt auf'), effect: { type: 'team', team, instruction: press, seconds: 10 }, outlook: tr('quick regain possible, space behind the defence', 'schnelle Rückeroberung möglich, Raum hinter der Abwehr'), visual: { actor: touch.player, line: line(press, false), zone: { x: ball.x, z: ball.z, r: 8 } } },
      { id: 'drop', label: tr('Drop off', 'Fallen lassen'), detail: tr('Compact behind the ball', 'Kompakt hinter den Ball'), effect: { type: 'team', team, instruction: drop, seconds: 10 }, outlook: tr('safer, the opponents build up calmly', 'sicherer, Gegner baut ruhig auf'), visual: { actor: touch.player, line: line(drop, false) } },
    ];
    // The team acts; the player nearest to the ball leads the press (or the retreat).
    const ours = e.profiles.filter(p => p.team === team && p.role !== 'GK' && !e.referee.sentOff.has(p.id)).sort((a, b) => dist(e.bodies[a.id].position(), ball) - dist(e.bodies[b.id].position(), ball))[0];
    for (const o of options) if (o.visual) o.visual.actor = ours.id;
    return {
      kind: 'counter-press', category: 'transition', title: tr('Ball lost in their half', 'Ballverlust in der gegnerischen Hälfte'), situation: tr(`${playerName(e, touch.player)} has just won the ball.`, `${playerName(e, touch.player)} hat den Ball gerade erobert.`),
      focusPlayer: ours.id, options, defaultOptionId: base.press === 'high' ? 'gegenpress' : 'drop', participants: participantsFor(e, team, ours.id, options, [touch.player]),
    };
  }
  return null;
}

/** An opponent is through on the user's goal with at most one defender left. */
export function breakawayMoment(e: MatchEngine, team: TeamId): MomentDraft | null {
  const opp = (1 - team) as TeamId;
  const c = carrier(e, opp);
  if (c === null) return null;
  const sign = e.sign(team);
  const cp = e.bodies[c].position(), v = e.bodies[c].velocity();
  const u = toTeam(sign, cp).u;
  if (u > -0.25 || sign * v.x > -2.5) return null; // must be in our half and running at our goal
  const defenders = e.profiles.filter(p => p.team === team && p.role !== 'GK' && !e.referee.sentOff.has(p.id));
  const goalSide = defenders.filter(p => sign * e.bodies[p.id].position().x < sign * cp.x);
  if (goalSide.length > 1) return null;
  const chaser = defenders.map(p => ({ id: p.id, d: dist(e.bodies[p.id].position(), cp) })).sort((a, b) => a.d - b.d)[0];
  if (!chaser || chaser.d > 6) return null;
  const path = { x: cp.x + v.x * 0.8, z: cp.z + v.z * 0.8 };
  const options: DecisionOption[] = [
    { id: 'chase', label: tr('Chase fairly', 'Fair verfolgen'), detail: tr(`${playerName(e, chaser.id)} runs with him, the keeper stays in goal`, `${playerName(e, chaser.id)} läuft mit, Torwart bleibt im Tor`), effect: { type: 'none' }, outlook: tr('the opponent keeps his chance', 'Torchance für den Gegner bleibt'), visual: { actor: chaser.id, runs: [{ player: chaser.id, to: path }] } },
    {
      id: 'tactical-foul', label: tr('Tactical foul', 'Taktisches Foul'), detail: tr(`${playerName(e, chaser.id)} steps into his path`, `${playerName(e, chaser.id)} stellt sich in den Laufweg`),
      effect: { type: 'player', player: chaser.id, intent: { type: 'move', action: { kind: 'tactical-foul', target: c }, source: 'user', decidedAt: e.time, until: e.time + 2.5 } },
      outlook: goalSide.length === 0 ? tr('last man: a red card is likely', 'als Notbremse droht Rot') : tr('yellow card likely, success not certain', 'Gelbe Karte wahrscheinlich, Erfolg nicht sicher'),
      visual: { actor: chaser.id, runs: [{ player: chaser.id, to: { x: cp.x + v.x * 0.35, z: cp.z + v.z * 0.35 } }], zone: { x: cp.x, z: cp.z, r: 1.5 } },
    },
  ];
  const keeper = e.profiles.find(p => p.team === team && p.role === 'GK');
  return {
    kind: 'breakaway-defence', category: 'defence', title: tr('Opponent through on goal', 'Gegner läuft allein aufs Tor'), situation: tr(`${playerName(e, c)} is through, only ${goalSide.length} defender(s) behind.`, `${playerName(e, c)} ist durch, nur noch ${goalSide.length} Verteidiger dahinter.`),
    focusPlayer: chaser.id, options, defaultOptionId: 'chase', participants: participantsFor(e, team, chaser.id, options, keeper ? [keeper.id, c] : [c]),
  };
}

/**
 * An opponent has the ball close to the user's penalty area with defenders around him:
 * press the carrier, block the shooting lane, or let the defence organise itself.
 */
export function boxDefenceMoment(e: MatchEngine, team: TeamId): MomentDraft | null {
  const c = carrier(e, (1 - team) as TeamId);
  if (c === null) return null;
  const sign = e.sign(team);
  const cp = e.bodies[c].position();
  const goalX = -sign * PITCH.halfLength;
  const toGoal = Math.hypot(goalX - cp.x, cp.z);
  if (toGoal > 30 || Math.abs(cp.z) > 24) return null;
  const nearest = e.profiles
    .filter(p => p.team === team && p.role !== 'GK' && !e.referee.sentOff.has(p.id))
    .map(p => ({ id: p.id, dist: dist(e.bodies[p.id].position(), cp) }))
    .sort((a, b) => a.dist - b.dist)[0];
  if (!nearest || nearest.dist > 7 || nearest.dist < 1.2) return null;
  const order = (kind: 'press' | 'block-lane' | 'jockey'): DecisionOption['effect'] =>
    ({ type: 'player', player: nearest.id, intent: { type: 'move', action: { kind, target: c }, source: 'user', decidedAt: e.time, until: e.time + 3 } });
  // The points the box-defence orders run to (box-orders.ts): the ball itself, 1.8 m in front of it on the line to
  // goal, 3.5 m goal-side of the carrier.
  const b = e.ballPos();
  const gx = goalX - b.x, gz = -b.z, gd = Math.hypot(gx, gz) || 1;
  const towardsGoal = (m: number) => ({ x: b.x + (gx / gd) * m, z: b.z + (gz / gd) * m });
  const run = (to: Vec2): OptionVisual => ({ actor: nearest.id, runs: [{ player: nearest.id, to }] });
  const options: DecisionOption[] = [
    { id: 'press', label: tr('Close him down', 'Zustellen'), detail: tr(`${playerName(e, nearest.id)} goes at the ball carrier and tackles`, `${playerName(e, nearest.id)} läuft den Ballführenden an und geht in den Zweikampf`), effect: order('press'), outlook: tr('can win the ball – or be beaten', 'kann den Ball erobern – oder wird überlaufen'), visual: run({ x: b.x, z: b.z }) },
    { id: 'block', label: tr('Block the shot', 'Schussbahn blocken'), detail: tr(`${playerName(e, nearest.id)} gets between ball and goal`, `${playerName(e, nearest.id)} stellt sich zwischen Ball und Tor`), effect: order('block-lane'), outlook: tr('makes the shot harder, leaves time for a pass', 'erschwert den Abschluss, lässt Zeit für einen Pass'), visual: { ...run(towardsGoal(1.8)), ball: { to: { x: goalX, z: 0 }, kind: 'shot' } } },
    { id: 'hold', label: tr('Hold the shape', 'Ordnung halten'), detail: tr(`${playerName(e, nearest.id)} stays goal-side at a distance and delays`, `${playerName(e, nearest.id)} bleibt torseitig auf Abstand und verzögert`), effect: order('jockey'), outlook: tr('hard to beat, but the opponent has time to shoot', 'schwer zu überlaufen, der Gegner hat aber Zeit zum Abschluss'), visual: run(towardsGoal(3.5)) },
  ];
  return {
    kind: 'box-defence', category: 'defence', title: tr('Danger at the edge of our box', 'Gefahr vor dem eigenen Strafraum'), situation: tr(`${playerName(e, c)} has the ball ${Math.round(toGoal)} m from our goal.`, `${playerName(e, c)} hat den Ball ${Math.round(toGoal)} m vor unserem Tor.`),
    focusPlayer: nearest.id, options, defaultOptionId: 'hold', participants: participantsFor(e, team, nearest.id, options, [c]),
  };
}

export function outlook(o: EvaluatedOption): string {
  if (o.kind === 'shot') return tr(`scoring chance about ${Math.round(o.success * 100)} % – keeper and defenders can block`, `Abschlusschance etwa ${Math.round(o.success * 100)} % – Torwart und Verteidiger können blocken`);
  if (o.kind === 'pass') return tr(`pass estimated to arrive ${Math.round(o.success * 100)} % of the time`, `Pass kommt nach Einschätzung zu ${Math.round(o.success * 100)} % an`);
  return tr(`gets through about ${Math.round(o.success * 100)} % – otherwise the ball is lost`, `Durchkommen etwa ${Math.round(o.success * 100)} % – sonst Ballverlust`);
}

