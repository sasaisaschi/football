/**
 * Rapier interaction groups: (membership << 16) | filter.
 * Feet only touch the ball, so a swinging leg never shoves its own or another body
 * with the unbounded mass of a kinematic collider.
 */
const BODY = 1 << 0;
const BALL = 1 << 1;
const FOOT = 1 << 2;
const WORLD = 1 << 3;
const ALL = 0xffff;

const groups = (membership: number, filter: number) => (membership << 16) | filter;

export const GROUPS = {
  body: groups(BODY, BODY | BALL | WORLD),
  ball: groups(BALL, ALL),
  foot: groups(FOOT, BALL),
  world: groups(WORLD, BODY | BALL),
} as const;
