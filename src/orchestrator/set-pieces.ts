import { groundPassSpeed, loftedPassSpeed } from '../ai/ball-model';
import { CORNER_SLOTS, cornerAssignment, cornerSlotSpot, type CornerSlot } from '../ai/corner-routine';
import { evaluateOptions, type EvaluatedOption, type Picture } from '../ai/options';
import { toTeam } from '../ai/shape';
import { aiThrowTarget, throwTargets } from '../ai/throw-in';
import type { MatchEngine } from '../engine/match-engine';
import type { BallAction, DecisionOption, PlayerIntent, TeamId, Vec2 } from '../engine/types';
import { inPenaltyArea, PITCH } from '../physics/pitch-geometry';
import { MAX_ELEVATION } from '../physics/legs';
import { brainContext, dist, participantsFor, playerName, type MomentDraft } from './common';
import { ballVisual, outlook } from './open-play';

/** A set-piece runner further away than this from his zone could not be there in time (m). */
const ZONE_REACH = 30;
/** Throw-ins in the own half are routine; only in the opponents' half is the choice worth a stop. */
const THROW_IN_FROM_U = 0;
/** Free kicks are only worth a stop in the opponents' half. */
const FREE_KICK_FROM_U = 0.15;
/** A direct free kick is offered as a shot only from this close to goal (m) and with at least this chance. */
const FREE_KICK_SHOT_RANGE = 30, FREE_KICK_SHOT_XG = 0.03;

const ballIntent = (e: MatchEngine, action: BallAction): PlayerIntent => ({ type: 'ball', action, source: 'user', decidedAt: e.time });
const runIntent = (e: MatchEngine, to: Vec2): PlayerIntent => ({ type: 'move', action: { kind: 'run-behind', target: to }, source: 'user', decidedAt: e.time, until: e.time + 15 });

/** The taker's own picture with the ball where the referee placed it (his perception may still lag a tick). */
function takerPicture(e: MatchEngine, taker: number, spot: Vec2): Picture {
  const pic = e.brains[taker].picture(brainContext(e, taker));
  return { ...pic, ball: { pos: { x: spot.x, y: 0.11, z: spot.z }, vel: { x: 0, y: 0, z: 0 } } };
}

/** What the taker would play himself from the restart: his best pass or clearance, as in his own decision. */
function aiRestartPick(pic: Picture): EvaluatedOption | null {
  return evaluateOptions(pic).filter(o => o.kind === 'pass' || o.kind === 'clear')[0] ?? null;
}

/** The option the players would have chosen: same receiver, else the one aimed closest to the AI's own target. */
function closestTo(options: DecisionOption[], receiver: number | undefined, aim: Vec2 | null): string {
  const byReceiver = options.find(o => receiver !== undefined && o.visual?.ball?.receiver === receiver);
  if (byReceiver || !aim) return (byReceiver ?? options[0]).id;
  return options.reduce((a, b) => (dist(b.visual?.ball?.to ?? aim, aim) < dist(a.visual?.ball?.to ?? aim, aim) ? b : a)).id;
}

/** Throw-in for the user team (Law 15): short, forward or back – each to a team-mate the arms can really reach. */
export function throwInMoment(e: MatchEngine, team: TeamId): MomentDraft | null {
  const r = e.restart;
  if (!r || r.kind !== 'throw-in' || r.team !== team) return null;
  const sign = e.sign(team);
  if (toTeam(sign, r.spot).u < THROW_IN_FROM_U) return null;
  const pic = takerPicture(e, r.taker, r.spot);
  const height = e.bodies[r.taker].height;
  const targets = throwTargets(pic, height);
  if (targets.length < 2) return null;
  const ai = aiThrowTarget(pic, height);
  const from = r.spot;
  const short = [...targets].sort((a, b) => dist(a.target, from) - dist(b.target, from))[0];
  const forward = [...targets].filter(t => t.gain > 3).sort((a, b) => b.gain - a.gain)[0];
  const back = [...targets].filter(t => t.gain < -2).sort((a, b) => b.room - a.room)[0];
  const picks: { id: string; label: string; t: typeof targets[number] }[] = [];
  const add = (id: string, label: string, t: typeof targets[number] | undefined) => { if (t && !picks.some(p => p.t.id === t.id)) picks.push({ id, label, t }); };
  if (ai) add('ai', ai.gain > 3 ? 'Nach vorn' : ai.gain < -2 ? 'Zurück' : 'Kurz', ai);
  add('short', 'Kurz', short);
  add('forward', 'Nach vorn', forward);
  add('back', 'Zurück', back);
  if (picks.length < 2) return null;
  const options: DecisionOption[] = picks.slice(0, 3).map(p => ({
    id: `throw-${p.t.id}`,
    label: `${p.label} auf ${playerName(e, p.t.id)}`,
    detail: `Einwurf über ${Math.round(dist(p.t.target, from))} m, ${p.t.gain >= 0 ? `${Math.round(p.t.gain)} m Raumgewinn` : `${Math.round(-p.t.gain)} m zurück`}`,
    effect: { type: 'player', player: r.taker, intent: ballIntent(e, { kind: 'throw', velocity: { x: 0, y: 0, z: 0 }, receiver: p.t.id }) },
    outlook: p.t.room < 2.5 ? `Gegenspieler ${p.t.room.toFixed(1)} m entfernt – umkämpft` : `${Math.min(8, p.t.room).toFixed(0)} m Platz zum nächsten Gegner`,
    visual: { actor: r.taker, ball: { to: p.t.target, kind: 'throw', receiver: p.t.id } },
  }));
  const defaultId = ai ? `throw-${ai.id}` : options[0].id;
  return {
    kind: 'throw-in', category: 'set-piece', title: 'Einwurf – wohin?', situation: `${playerName(e, r.taker)} wirft ein, ${Math.round((toTeam(sign, from).u + 1) * 52.5)} m vor dem eigenen Tor.`,
    focusPlayer: r.taker, options, defaultOptionId: options.some(o => o.id === defaultId) ? defaultId : options[0].id,
    participants: participantsFor(e, team, r.taker, options),
  };
}

const SLOT_LABEL: Record<CornerSlot, string> = { 'near-post': 'Erster Pfosten', 'far-post': 'Zweiter Pfosten', 'penalty-spot': 'Elfmeterpunkt', edge: 'Rückraum', short: 'Kurz ausführen' };

/** Corner for the user team: short, near post, far post or the edge of the area – only zones a team-mate really attacks. */
export function cornerMoment(e: MatchEngine, team: TeamId): MomentDraft | null {
  const r = e.restart;
  if (!r || r.kind !== 'corner' || r.team !== team) return null;
  const sign = e.sign(team);
  const roles = cornerAssignment(e.profiles, team, r.taker, e.referee.sentOff, r.spot, sign);
  const holder = (slot: CornerSlot) => [...roles].find(([, s]) => s === slot)?.[0];
  const options: DecisionOption[] = [];
  for (const slot of CORNER_SLOTS) {
    if (slot === 'penalty-spot' || options.length >= 4) continue;
    const runner = holder(slot);
    if (runner === undefined) continue;
    const zone = cornerSlotSpot(slot, r.spot);
    if (dist(e.bodies[runner].position(), zone) > ZONE_REACH) continue;
    const td = dist(zone, r.spot);
    const lofted = slot !== 'short';
    const action: BallAction = { kind: 'pass', receiver: runner, aim: zone, lofted, speed: lofted ? loftedPassSpeed(td, Math.min(MAX_ELEVATION, 0.42)) : groundPassSpeed(td, 4) };
    const marked = e.profiles.filter(p => p.team !== team && !e.referee.sentOff.has(p.id) && dist(e.bodies[p.id].position(), zone) < 4).length;
    options.push({
      id: `corner-${slot}`,
      label: SLOT_LABEL[slot],
      detail: lofted ? `Hoher Ball auf ${playerName(e, runner)} (${e.profiles[runner].heightM.toFixed(2)} m)` : `Flach zu ${playerName(e, runner)}, dann neu aufbauen`,
      effect: { type: 'players', orders: [{ player: r.taker, intent: ballIntent(e, action) }, { player: runner, intent: runIntent(e, zone) }] },
      outlook: lofted ? (marked === 0 ? 'Zone im Moment frei – der Torwart kann herauskommen' : `${marked} Gegenspieler in der Zone – Kopfballduell`) : 'sicherer Ballbesitz, Flanke später aus besserem Winkel möglich',
      visual: { actor: r.taker, ball: { to: zone, kind: lofted ? 'lofted' : 'ground', receiver: runner }, runs: [{ player: runner, to: zone }], zone: { ...zone, r: 2.5 } },
    });
  }
  if (options.length < 2) return null;
  const ai = aiRestartPick(takerPicture(e, r.taker, r.spot));
  const aiAim = ai?.action.kind === 'pass' ? ai.action.aim : null;
  const keeper = e.profiles.find(p => p.team !== team && p.role === 'GK' && !e.referee.sentOff.has(p.id));
  return {
    kind: 'corner', category: 'set-piece', title: 'Ecke – welche Variante?', situation: `${playerName(e, r.taker)} tritt die Ecke, ${options.length} Varianten sind besetzt.`,
    focusPlayer: r.taker, options, defaultOptionId: closestTo(options, ai?.target, aiAim),
    participants: participantsFor(e, team, r.taker, options, keeper ? [keeper.id] : []),
  };
}

/** Free kick in the opponents' half: a direct shot only from a foul and within range, a pass, or a ball into the box. */
export function freeKickMoment(e: MatchEngine, team: TeamId): MomentDraft | null {
  const r = e.restart;
  if (!r || r.kind !== 'free-kick' || r.team !== team) return null;
  const sign = e.sign(team);
  if (toTeam(sign, r.spot).u < FREE_KICK_FROM_U) return null;
  const pic = takerPicture(e, r.taker, r.spot);
  const all = evaluateOptions(pic);
  const goalDistance = Math.hypot(sign * PITCH.halfLength - r.spot.x, r.spot.z);
  const shot = r.direct && goalDistance < FREE_KICK_SHOT_RANGE ? all.find(o => o.kind === 'shot' && o.success >= FREE_KICK_SHOT_XG) : undefined;
  const pass = all.find(o => o.kind === 'pass' && o.success >= 0.3);
  const options: DecisionOption[] = [];
  const add = (id: string, label: string, o: EvaluatedOption) => options.push({
    id, label, detail: o.note, effect: { type: 'player', player: r.taker, intent: ballIntent(e, o.action) }, outlook: outlook(o), visual: ballVisual(r.taker, r.spot, o),
  });
  if (shot) add('fk-shot', 'Direkt aufs Tor', shot);
  if (pass) add('fk-pass', `Kurz auf ${playerName(e, pass.target!)}`, pass);
  // A ball into the box to the team-mate there with the most room, struck like a cross.
  const box = pic.mates
    .filter(m => m.profile.role !== 'GK' && m.id !== pass?.target && inPenaltyArea(m.pos.x, m.pos.z, sign) && dist(m.pos, r.spot) > 12)
    .map(m => ({ m, room: Math.min(...pic.opponents.map(o => dist(o.pos, m.pos)), 9) }))
    .sort((a, b) => b.room - a.room)[0];
  if (box) {
    const td = dist(box.m.pos, r.spot);
    const action: BallAction = { kind: 'pass', receiver: box.m.id, aim: box.m.pos, lofted: true, speed: loftedPassSpeed(td, Math.min(MAX_ELEVATION, 0.42)) };
    options.push({
      id: 'fk-cross', label: `In den Strafraum auf ${playerName(e, box.m.id)}`, detail: `hoher Ball, ${Math.round(td)} m`,
      effect: { type: 'player', player: r.taker, intent: ballIntent(e, action) },
      outlook: box.room < 2 ? 'eng gedeckt – Kopfballduell' : `${box.room.toFixed(1)} m Platz um den Empfänger`,
      visual: { actor: r.taker, ball: { to: box.m.pos, kind: 'lofted', receiver: box.m.id } },
    });
  }
  if (options.length < 2) return null;
  const ai = aiRestartPick(pic);
  const keeper = e.profiles.find(p => p.team !== team && p.role === 'GK' && !e.referee.sentOff.has(p.id));
  return {
    kind: 'free-kick', category: 'set-piece', title: r.direct ? 'Freistoß – direkt oder spielen?' : 'Indirekter Freistoß', situation: `${playerName(e, r.taker)} am Ball, ${Math.round(goalDistance)} m vor dem Tor.`,
    focusPlayer: r.taker, options, defaultOptionId: closestTo(options, ai?.target, ai?.action.kind === 'pass' ? ai.action.aim : null),
    participants: participantsFor(e, team, r.taker, options, keeper ? [keeper.id] : []),
  };
}

/** Penalty for the user team: which corner. The keeper reacts to the shot as always; nothing is guaranteed. */
export function penaltyMoment(e: MatchEngine, team: TeamId): MomentDraft | null {
  const r = e.restart;
  if (!r || r.kind !== 'penalty' || r.team !== team) return null;
  const sign = e.sign(team);
  const gx = sign * PITCH.halfLength;
  // Facing +X the shooter's right is +Z.
  const right = sign;
  const speed = 24 + 4 * e.profiles[r.taker].abilities.shooting;
  const aim = (z: number, y: number): BallAction => ({ kind: 'shot', aim: { x: gx, y, z }, speed });
  const edge = PITCH.goalHalfWidth - 0.65;
  const choices = [
    { id: 'pen-left', label: 'Links unten', action: aim(-right * edge, 0.35), outlook: 'flach in die Ecke – schwer zu halten, wenn er genau kommt' },
    { id: 'pen-right', label: 'Rechts unten', action: aim(right * edge, 0.35), outlook: 'flach in die Ecke – schwer zu halten, wenn er genau kommt' },
    { id: 'pen-centre', label: 'Halbhoch in die Mitte', action: aim(0, 1.3), outlook: 'der Torwart steht dort – nur gut, wenn er früh springt' },
  ];
  const options: DecisionOption[] = choices.map(c => ({
    id: c.id, label: c.label, detail: `${playerName(e, r.taker)} schießt mit ${Math.round(speed)} m/s`,
    effect: { type: 'player', player: r.taker, intent: ballIntent(e, c.action) }, outlook: c.outlook,
    visual: { actor: r.taker, ball: { to: { x: gx, z: c.action.kind === 'shot' ? c.action.aim.z : 0 }, kind: 'shot' } },
  }));
  const ai = evaluateOptions(takerPicture(e, r.taker, r.spot)).find(o => o.kind === 'shot');
  const aiZ = ai?.action.kind === 'shot' ? ai.action.aim.z : 0;
  const keeper = e.profiles.find(p => p.team !== team && p.role === 'GK' && !e.referee.sentOff.has(p.id));
  return {
    kind: 'penalty', category: 'set-piece', title: 'Elfmeter – welche Ecke?', situation: `${playerName(e, r.taker)} legt sich den Ball zurecht.`,
    focusPlayer: r.taker, options, defaultOptionId: aiZ * right > 0 ? 'pen-right' : aiZ * right < 0 ? 'pen-left' : 'pen-centre',
    participants: participantsFor(e, team, r.taker, options, keeper ? [keeper.id] : []),
  };
}
