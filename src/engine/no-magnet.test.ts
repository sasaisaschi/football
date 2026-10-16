import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** All production source files (tests and the test-only scenario helper excluded). */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'scenario-helper.ts' ? [path] : [];
  });
}

const BALL_WRITE = /\b(ball|this\.physics\.ball|e\.physics\.ball)\.(applyImpulse|applyImpulseAtPoint|setLinvel|setAngvel|setTranslation|addForce|addTorque|applyTorqueImpulse)\(/g;

describe('no magnetism, no teleport', () => {
  it('only the ball model (forces) and the referee placing a dead ball write ball state', () => {
    const root = join(import.meta.dirname, '..');
    for (const file of sources(root)) {
      const code = readFileSync(file, 'utf8');
      const writes = [...code.matchAll(BALL_WRITE)];
      if (writes.length === 0) continue;
      const rel = file.slice(root.length + 1).replace(/\\/g, '/');
      if (rel === 'physics/ball.ts') {
        // Aerodynamics and rolling resistance only: forces, never velocities or positions.
        expect(writes.every(w => w[2] === 'addForce'), rel).toBe(true);
        continue;
      }
      expect(rel, `${rel} writes ball state`).toBe('engine/match-engine.ts');
      // In the engine every write must sit inside placeDeadBall().
      const start = code.indexOf('private placeDeadBall(');
      const end = start + code.slice(start).search(/\r?\n {2}\}\r?\n/);
      expect(start).toBeGreaterThan(0);
      for (const w of writes) expect(w.index! > start && w.index! < end, `${rel}: ball write outside placeDeadBall`).toBe(true);
    }
  });

  it('placeDeadBall is only called while the ball is dead (restart set-up or kick-off)', () => {
    const code = readFileSync(join(import.meta.dirname, 'match-engine.ts'), 'utf8');
    const callers = [...code.matchAll(/this\.placeDeadBall\(/g)].map(m => {
      const before = code.slice(0, m.index);
      const fn = [...before.matchAll(/\r?\n {2}(?:private |public )?(\w+)\(/g)].pop();
      return fn?.[1];
    });
    expect(new Set(callers)).toEqual(new Set(['setupKickoff', 'advanceRestart']));
  });
});
