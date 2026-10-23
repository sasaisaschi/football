import RAPIER from '@dimforge/rapier3d-simd-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { MatchEngine } from '../engine/match-engine';
import { Orchestrator } from '../orchestrator/orchestrator';
import { decodeFrame, encodeEngineFrame, encodeFrame, frameSize } from './frame-codec';
import { SimRunner, type RunnerConfig } from './runner';

beforeAll(async () => {
  await RAPIER.init();
});

const config: RunnerConfig = { seed: 11, halfMinutes: 3, userTeam: 0, cooldown: 20, maxPerHalf: 4, timeoutSeconds: 12 };

describe('chronological simulation runner', () => {
  it('frames survive the transfer encoding', () => {
    const e = new MatchEngine({ seed: 3, halfMinutes: 45 });
    for (let i = 0; i < 200; i++) e.step();
    const s = e.snapshot();
    const buf = new Float32Array(frameSize(e.profiles.length));
    encodeFrame(s, buf);
    const d = decodeFrame(buf, 0, e.profiles.length);
    expect(d.tick).toBe(s.tick);
    expect(d.phase).toBe(s.phase);
    expect(d.players[7].position.x).toBeCloseTo(s.players[7].position.x, 4);
    expect(d.players[7].boots[1].z).toBeCloseTo(s.players[7].boots[1].z, 4);
    expect(d.ball.position.y).toBeCloseTo(s.ball.position.y, 4);
    expect(d.restart?.kind ?? null).toBe(s.restart?.kind ?? null);
    // Written straight from the engine it is the same frame; players off the pitch are only marked as such.
    const direct = new Float32Array(frameSize(e.profiles.length));
    const viaSnapshot = new Float32Array(frameSize(e.profiles.length));
    encodeEngineFrame(e, direct);
    encodeFrame(s, viaSnapshot);
    const fromDirect = decodeFrame(direct, 0, e.profiles.length), fromSnapshot = decodeFrame(viaSnapshot, 0, e.profiles.length);
    expect({ ...fromDirect, players: [] }).toEqual({ ...fromSnapshot, players: [] });
    fromDirect.players.forEach((p, i) => {
      if (p.sentOff) expect(fromSnapshot.players[i]).toMatchObject({ sentOff: true, booked: p.booked });
      else expect(p).toEqual(fromSnapshot.players[i]);
    });
  });

  it('stops at an open moment, computes nothing past it, and continues from exactly that state', () => {
    const r = new SimRunner(config);
    let produced = 0, moments = 0;
    while (!r.engine.moment && produced < 60 * 400) {
      const b = r.advance(30);
      produced += b.count;
      if (b.moment) {
        moments++;
        // The last frame is the frozen state; the simulation does not move while the moment is open.
        const tick = r.engine.tick;
        expect(decodeFrame(b.frames, (b.count - 1) * r.frameFloats, r.profiles.length).tick).toBe(tick);
        expect(r.advance(30).count).toBe(0);
        expect(r.engine.tick).toBe(tick);
        r.resolve(b.moment.defaultOptionId, 'timeout');
        expect(r.advance(1).firstTick).toBe(tick + 1);
        break;
      }
    }
    expect(moments).toBe(1);
  }, 120_000);

  it('produces the same match as stepping the engine directly (no tick is skipped or added)', () => {
    const r = new SimRunner(config);
    const direct = new MatchEngine({ seed: config.seed, halfMinutes: config.halfMinutes });
    const orchestrator = new Orchestrator({ userTeam: 0, cooldown: config.cooldown, maxPerHalf: config.maxPerHalf, timeoutSeconds: 12 });
    direct.director = orchestrator.attach();
    let ticks = 0;
    while (ticks < 60 * 90) {
      const b = r.advance(45);
      ticks += b.count;
      if (b.moment) r.resolve(b.moment.defaultOptionId, 'timeout');
      if (b.done) break;
    }
    while (direct.tick < r.engine.tick) {
      direct.step();
      if (direct.phase === 'decision') direct.resolveMoment(direct.moment!.defaultOptionId, 'timeout');
    }
    expect(direct.tick).toBe(r.engine.tick);
    expect(direct.ballPos()).toEqual(r.engine.ballPos());
    expect(direct.events.map(e => e.type)).toEqual(r.engine.events.map(e => e.type));
  }, 120_000);
});
