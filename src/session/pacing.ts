/**
 * How fast the shown match time moves, in the manager view and in a 3D scene. It never shows anything the simulation
 * has not computed tick by tick and never passes an open moment; it only chooses the pace.
 *
 * Manager view: the shown time follows the simulation at the chosen pace, but stays at least LAG behind it, so that
 * the real build-up of a moment found next has not been shown yet and can be played in 3D for the first time.
 * Scene: the build-up runs in real time (the last fraction of a second slowed down into the freeze), the consequence
 * in real time from frames computed after the decision.
 */
export const HZ = 60;
/** Real seconds of play shown in 3D before the freeze. */
export const BUILD_UP = 6;
/** The manager view stays this far behind the simulation (s); more than BUILD_UP, so the build-up is still unseen. */
export const LAG = 8;
/** The last seconds before the freeze run in slow motion at this pace. */
export const SLOW_MO_SECONDS = 0.8, SLOW_MO_PACE = 0.35;
/** Pace of the manager view (× real time); the simulation itself is the limit for "fast". */
export const MANAGER_PACE = { normal: 3, fast: 60 } as const;
export type ManagerPace = keyof typeof MANAGER_PACE;

export type SimState = {
  /** Last tick the simulation has produced. */
  produced: number;
  /** Tick at which an open moment holds the simulation, if any. */
  momentTick: number | null;
  /** The open moment is shown as a 3D scene (open play and set pieces); coach moments are not. */
  sceneMoment: boolean;
  done: boolean;
};

/** Furthest tick the manager view may show now. */
export function managerCap(s: SimState): number {
  if (s.momentTick !== null) return s.sceneMoment ? s.momentTick - BUILD_UP * HZ : s.momentTick;
  if (s.done) return s.produced;
  return s.produced - LAG * HZ;
}

/** The manager view's next tick: forward at the pace, never past the cap, never backwards. */
export function managerStep(tick: number, dt: number, pace: number, s: SimState): number {
  return Math.max(tick, Math.min(managerCap(s), tick + dt * HZ * pace));
}

/** Has the manager view reached the point where the open moment's scene (or dialog) takes over? */
export function readyForMoment(tick: number, s: SimState): boolean {
  return s.momentTick !== null && tick >= managerCap(s) - 1e-6;
}

/** Build-up in 3D: real time, slowing into the freeze, never past the moment. */
export function buildUpStep(tick: number, dt: number, momentTick: number): number {
  const pace = momentTick - tick <= SLOW_MO_SECONDS * HZ ? SLOW_MO_PACE : 1;
  return Math.min(momentTick, tick + dt * HZ * pace);
}

/** Consequence in 3D: real time over what has been computed since the decision. */
export function consequenceStep(tick: number, dt: number, produced: number): number {
  return Math.max(tick, Math.min(produced, tick + dt * HZ));
}
