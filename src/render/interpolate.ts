import type { MatchSnapshot, PlayerView, Vec3 } from '../engine/types';

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** Between two simulated ticks for a smooth picture; a player placed while the ball was dead is not slid across. */
export function lerpPlayer(a: PlayerView, b: PlayerView, t: number): PlayerView {
  if (Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) > 3) return b;
  const dh = Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading));
  return {
    ...b,
    position: lerp3(a.position, b.position, t),
    heading: a.heading + dh * t,
    boots: [lerp3(a.boots[0], b.boots[0], t), lerp3(a.boots[1], b.boots[1], t)],
    hands: a.hands && b.hands ? lerp3(a.hands, b.hands, t) : b.hands,
    lying: a.lying + (b.lying - a.lying) * t,
    upperBody: a.upperBody && b.upperBody && a.upperBody.part === b.upperBody.part ? { part: b.upperBody.part, position: lerp3(a.upperBody.position, b.upperBody.position, t) } : b.upperBody,
  };
}

/** The ball between two ticks (a placed dead ball jumps, it is not slid). */
export function lerpBall(a: MatchSnapshot['ball'], b: MatchSnapshot['ball'], t: number): Vec3 {
  if (Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) > 3) return b.position;
  return lerp3(a.position, b.position, t);
}
