import type { BallAction, Vec2 } from '../engine/types';
import { PITCH } from '../physics/pitch-geometry';
import { evaluateOptions, type Picture } from './options';

type Control = Extract<BallAction, { kind: 'control' }>;

/** Farthest a touch can turn the ball away from its line of travel with the inside of the foot (rad). */
const MAX_TURN = 1.9;

/**
 * Directional first touch: the receiver judges his next action as it will look at the reception point and
 * takes the ball into that direction, away from the nearest opponent, instead of killing it dead. Whether the
 * touch goes where he wanted is still decided by the boot/ball contact.
 */
export function firstTouch(pic: Picture, at: Vec2): Control {
  const ballSpeed = Math.hypot(pic.ball.vel.x, pic.ball.vel.z);
  if (ballSpeed < 0.5) return { kind: 'control' };
  const travel = { x: pic.ball.vel.x / ballSpeed, z: pic.ball.vel.z / ballSpeed };
  const there: Picture = { ...pic, pos: at, vel: { x: 0, z: 0 }, ball: { pos: { x: at.x, y: pic.ball.pos.y, z: at.z }, vel: { x: 0, y: 0, z: 0 } } };
  const next = evaluateOptions(there).find(o => o.kind !== 'clear');
  if (!next) return { kind: 'control' };
  const a = next.action;
  const towards = (t: Vec2) => {
    const dx = t.x - at.x, dz = t.z - at.z, d = Math.hypot(dx, dz) || 1;
    return { x: dx / d, z: dz / d };
  };
  const wanted = a.kind === 'dribble' ? a.direction : a.kind === 'pass' ? towards(a.aim) : a.kind === 'shot' ? towards(a.aim) : null;
  if (!wanted) return { kind: 'control' };
  // A dribble is taken in stride; before a pass or shot the ball is only set a step ahead.
  const speed = a.kind === 'dribble' ? 2.6 : 1.6;
  const base = Math.atan2(wanted.z, wanted.x);
  let best: { dir: Vec2; score: number } | null = null;
  for (const turn of [0, -0.5, 0.5, -1, 1]) {
    const dir = { x: Math.cos(base + turn), z: Math.sin(base + turn) };
    // A ball cannot be sent back the way it came with a touch; that needs a cushion first.
    if (Math.acos(Math.max(-1, Math.min(1, dir.x * travel.x + dir.z * travel.z))) > MAX_TURN) continue;
    const landing = { x: at.x + dir.x * 1.5, z: at.z + dir.z * 1.5 };
    if (Math.abs(landing.x) > PITCH.halfLength - 1 || Math.abs(landing.z) > PITCH.halfWidth - 1) continue;
    let room = 4;
    for (const o of pic.opponents) room = Math.min(room, Math.hypot(o.pos.x - landing.x, o.pos.z - landing.z));
    const score = room - 0.8 * Math.abs(turn);
    if (!best || score > best.score) best = { dir, score };
  }
  return best ? { kind: 'control', touch: { direction: best.dir, speed } } : { kind: 'control' };
}
