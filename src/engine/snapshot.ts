import type { MatchEngine } from './match-engine';
import type { MatchSnapshot, PlayerView } from './types';

/** What presentation may read of the engine at one tick: positions, ball, phase, restart, moment and form. */
export function engineSnapshot(e: MatchEngine): MatchSnapshot {
  const ball = e.physics.ball;
  const t = ball.translation(), v = ball.linvel(), w = ball.angvel(), r = ball.rotation();
  return {
    tick: e.tick,
    time: e.time,
    half: e.half,
    clockSeconds: e.clockSeconds(),
    phase: e.phase,
    score: [e.score[0], e.score[1]],
    ball: { position: { x: t.x, y: t.y, z: t.z }, velocity: { x: v.x, y: v.y, z: v.z }, spin: { x: w.x, y: w.y, z: w.z }, rotation: { x: r.x, y: r.y, z: r.z, w: r.w }, heldBy: e.heldBy },
    players: e.profiles.map(p => {
      const body = e.bodies[p.id], legs = e.legs[p.id];
      const pos = body.translation(), vel = body.linvel();
      return {
        id: p.id,
        position: { x: pos.x, y: pos.y, z: pos.z },
        velocity: { x: vel.x, y: vel.y, z: vel.z },
        heading: body.heading,
        boots: [legs.bootWorld(0), legs.bootWorld(1)],
        swingingBoot: legs.swing ? legs.swing.plan.side : -1,
        hands: e.handsOf(p.id),
        upperBody: upperBodyView(e, p.id),
        lying: body.lying(),
        booked: e.referee.redCards.has(p.id) ? 'red' : e.referee.yellow.has(p.id) ? 'yellow' : 'none',
        sentOff: e.referee.sentOff.has(p.id),
      };
    }),
    possession: e.possession(),
    lastTouch: e.referee.lastTouch?.player ?? null,
    restart: e.restart ? { kind: e.restart.kind, team: e.restart.team, position: e.restart.spot, taker: e.restart.taker, placed: e.restart.placed } : null,
    moment: e.moment,
    minds: e.minds.map(m => ({ confidence: m.confidence, recent: m.recent.map(x => ({ action: x.action, ok: x.ok })) })),
  };
}

function upperBodyView(e: MatchEngine, id: number): PlayerView['upperBody'] {
  const head = e.heads[id].active();
  if (head) return { part: 'head', position: head };
  const chest = e.chests[id].active();
  return chest ? { part: 'chest', position: chest } : null;
}
