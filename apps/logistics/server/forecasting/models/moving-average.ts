import type { ModelFit } from "../types";

const WINDOW = 28;

/** Flat forecast at the trailing-window mean. Fallback for short histories. */
export function movingAverageForecast(
  days: number[],
  horizon: number,
): ModelFit {
  const window = days.slice(-Math.min(WINDOW, days.length));
  const n = window.length;
  const mean = n > 0 ? window.reduce((s, v) => s + v, 0) / n : 0;
  const variance =
    n > 0 ? window.reduce((s, v) => s + (v - mean) ** 2, 0) / n : 0;
  const level = Math.max(0, mean);
  return {
    dailyForecast: new Array<number>(horizon).fill(level),
    sigmaDaily: Math.sqrt(variance),
    oneStepMae:
      n > 0 ? window.reduce((s, v) => s + Math.abs(v - mean), 0) / n : null,
  };
}
