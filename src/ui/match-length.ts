import { tr } from '../i18n';

/**
 * How a match length is named everywhere (start, score bug, result): a shorter match is a shortened playing time with
 * every second simulated, never presented as a full 90-minute match.
 */
export function lengthLabel(halfMinutes: number): { short: string; long: string; full: boolean } {
  const full = halfMinutes >= 45;
  return {
    full,
    short: `2×${halfMinutes}`,
    long: full ? tr('Full match · 2 × 45 min', 'Volle Spielzeit · 2 × 45 min') : tr(`Short match · 2 × ${halfMinutes} min instead of 2 × 45`, `Kurzpartie · 2 × ${halfMinutes} min statt 2 × 45`),
  };
}
