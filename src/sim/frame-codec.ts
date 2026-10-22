import type { MatchEngine } from '../engine/match-engine';
import type { MatchPhase, MatchSnapshot, PlayerView, RestartKind, TeamId, Vec3 } from '../engine/types';

/**
 * Compact transfer of one simulation tick from the worker to the renderer: everything a frame needs to draw, as 32-bit
 * floats (≈ 2.3 kB per tick instead of a few hundred cloned objects). Moment and minds travel in their own messages.
 */
const PHASES: MatchPhase[] = ['pre-kickoff', 'in-play', 'stopped', 'decision', 'half-time', 'full-time'];
const RESTARTS: RestartKind[] = ['kickoff', 'throw-in', 'corner', 'goal-kick', 'free-kick', 'penalty', 'drop-ball'];
const HEADER = 10, BALL = 10, RESTART = 6, PLAYER = 25;

export const frameSize = (players: number) => HEADER + BALL + RESTART + players * PLAYER;

export function encodeFrame(s: MatchSnapshot, out: Float32Array, at = 0): void {
  let i = at;
  const put = (v: number) => { out[i++] = v; };
  const v3 = (v: Vec3) => { put(v.x); put(v.y); put(v.z); };
  put(s.tick); put(s.time); put(s.half); put(s.clockSeconds); put(PHASES.indexOf(s.phase)); put(s.score[0]); put(s.score[1]);
  put(s.possession ?? -1); put(s.lastTouch ?? -1); put(s.ball.heldBy ?? -1);
  v3(s.ball.position); v3(s.ball.velocity);
  put(s.ball.rotation.x); put(s.ball.rotation.y); put(s.ball.rotation.z); put(s.ball.rotation.w);
  const r = s.restart;
  put(r ? RESTARTS.indexOf(r.kind) : -1); put(r?.team ?? -1); put(r?.position.x ?? 0); put(r?.position.z ?? 0); put(r?.taker ?? -1); put(r?.placed ? 1 : 0);
  for (const p of s.players) {
    v3(p.position); v3(p.velocity); put(p.heading); v3(p.boots[0]); v3(p.boots[1]); put(p.swingingBoot);
    put(p.hands ? 1 : 0); v3(p.hands ?? ZERO);
    put(p.upperBody ? (p.upperBody.part === 'head' ? 1 : 2) : 0); v3(p.upperBody?.position ?? ZERO);
    put(p.lying); put(p.booked === 'none' ? 0 : p.booked === 'yellow' ? 1 : 2); put(p.sentOff ? 1 : 0);
  }
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The same frame as encodeFrame(e.snapshot()), written straight from the engine: building a whole snapshot (32 players,
 * minds) for every tick only to flatten it again cost ≈ 4 % of a tick in the worker. Players off the pitch are written
 * as such without reading their bodies.
 */
export function encodeEngineFrame(e: MatchEngine, out: Float32Array, at = 0): void {
  let i = at;
  const put = (v: number) => { out[i++] = v; };
  const v3 = (v: Readonly<Vec3>) => { out[i++] = v.x; out[i++] = v.y; out[i++] = v.z; };
  const ball = e.physics.ball;
  put(e.tick); put(e.time); put(e.half); put(e.clockSeconds()); put(PHASES.indexOf(e.phase)); put(e.score[0]); put(e.score[1]);
  put(e.possession() ?? -1); put(e.referee.lastTouch?.player ?? -1); put(e.heldByPlayer() ?? -1);
  v3(ball.translation()); v3(ball.linvel());
  const q = ball.rotation();
  put(q.x); put(q.y); put(q.z); put(q.w);
  const r = e.restart;
  put(r ? RESTARTS.indexOf(r.kind) : -1); put(r?.team ?? -1); put(r?.spot.x ?? 0); put(r?.spot.z ?? 0); put(r?.taker ?? -1); put(r?.placed ? 1 : 0);
  for (const p of e.profiles) {
    if (e.referee.sentOff.has(p.id)) {
      out.fill(0, i, i + PLAYER - 1);
      out[i + 13] = -1; // no swinging boot
      i += PLAYER - 1;
      put(1);
      if (e.referee.redCards.has(p.id)) out[i - 2] = 2;
      continue;
    }
    const body = e.bodies[p.id], legs = e.legs[p.id];
    v3(body.translation()); v3(body.linvel()); put(body.heading);
    v3(legs.boots[0].body.translation()); v3(legs.boots[1].body.translation());
    put(legs.swing ? legs.swing.plan.side : -1);
    const hands = e.handsOf(p.id);
    put(hands ? 1 : 0); v3(hands ?? ZERO);
    const head = e.heads[p.id].active(), chest = head ? null : e.chests[p.id].active();
    put(head ? 1 : chest ? 2 : 0); v3(head ?? chest ?? ZERO);
    put(body.lying()); put(e.referee.redCards.has(p.id) ? 2 : e.referee.yellow.has(p.id) ? 1 : 0); put(0);
  }
}

export function decodeFrame(a: Float32Array, at: number, players: number): MatchSnapshot {
  let i = at;
  const get = () => a[i++];
  const v3 = (): Vec3 => ({ x: get(), y: get(), z: get() });
  const tick = get(), time = get(), half = get() as 1 | 2, clockSeconds = get(), phase = PHASES[get()], score: [number, number] = [get(), get()];
  const possession = get(), lastTouch = get(), heldBy = get();
  const position = v3(), velocity = v3();
  const rotation = { x: get(), y: get(), z: get(), w: get() };
  const rk = get(), rt = get(), rx = get(), rz = get(), taker = get(), placed = get();
  const list: PlayerView[] = [];
  for (let id = 0; id < players; id++) {
    const pos = v3(), vel = v3(), heading = get(), b0 = v3(), b1 = v3(), swinging = get() as -1 | 0 | 1;
    const hasHands = get(), hands = v3();
    const upper = get(), upperPos = v3();
    const lying = get(), booked = get(), sentOff = get();
    list.push({
      id, position: pos, velocity: vel, heading, boots: [b0, b1], swingingBoot: swinging,
      hands: hasHands ? hands : null,
      upperBody: upper ? { part: upper === 1 ? 'head' : 'chest', position: upperPos } : null,
      lying, booked: booked === 0 ? 'none' : booked === 1 ? 'yellow' : 'red', sentOff: sentOff === 1,
    });
  }
  return {
    tick, time, half, clockSeconds, phase, score,
    ball: { position, velocity, spin: ZERO, rotation, heldBy: heldBy < 0 ? null : heldBy },
    players: list,
    possession: possession < 0 ? null : (possession as TeamId),
    lastTouch: lastTouch < 0 ? null : lastTouch,
    restart: rk < 0 ? null : { kind: RESTARTS[rk], team: rt as TeamId, position: { x: rx, z: rz }, taker, placed: placed === 1 },
    moment: null,
    minds: [],
  };
}
