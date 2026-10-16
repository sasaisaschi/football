import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('no magnetism', () => {
  it('no source file pushes, steers or teleports the ball except ball.ts (drag, dead-ball placement)', () => {
    const dir = import.meta.dirname;
    for (const file of readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      // ball.ts owns drag and the referee's placement of a dead ball; nothing else may push the ball.
      if (file === 'ball.ts') continue;
      const code = readFileSync(join(dir, file), 'utf8');
      expect(code, file).not.toMatch(/ball\.(applyImpulse|setLinvel|setTranslation|addForce|applyTorqueImpulse)\(/);
    }
  });
});
