/**
 * Rapier interaction groups, encoded as (membership << 16) | filter.
 * Boots and keeper hands are kinematic (unbounded mass): they may only touch the ball,
 * otherwise a swinging leg would shove bodies with infinite force.
 */
const BODY = 1 << 0;
const BALL = 1 << 1;
const BOOT = 1 << 2;
const HANDS = 1 << 3;
const WORLD = 1 << 4;

const group = (membership: number, filter: number) => (membership << 16) | filter;

export const GROUPS = {
  body: group(BODY, BODY | BALL | WORLD),
  ball: group(BALL, BODY | BOOT | HANDS | WORLD),
  boot: group(BOOT, BALL),
  hands: group(HANDS, BALL),
  world: group(WORLD, BODY | BALL),
} as const;
