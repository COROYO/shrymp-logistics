import type { ModelFit } from "../types";

/**
 * Croston's method with the Syntetos–Boylan approximation (SBA) — the
 * standard estimator for intermittent demand (many zero days). Smooths
 * non-zero demand sizes and inter-demand intervals separately; the SBA
 * factor (1 − α/2) corrects Croston's upward bias.
 */
export function crostonForecast(
  days: number[],
  horizon: number,
  alpha = 0.1,
): ModelFit {
  let size: number | null = null; // smoothed demand size
  let interval: number | null = null; // smoothed inter-demand interval
  let periodsSinceDemand = 1;

  for (const y of days) {
    if (y > 0) {
      size = size == null ? y : size + alpha * (y - size);
      interval =
        interval == null
          ? periodsSinceDemand
          : interval + alpha * (periodsSinceDemand - interval);
      periodsSinceDemand = 1;
    } else {
      periodsSinceDemand++;
    }
  }

  const rate =
    size != null && interval != null && interval > 0
      ? Math.max(0, (size / interval) * (1 - alpha / 2))
      : 0;

  const n = days.length;
  const mean = n > 0 ? days.reduce((s, v) => s + v, 0) / n : 0;
  const variance =
    n > 0 ? days.reduce((s, v) => s + (v - mean) ** 2, 0) / n : 0;
  const absErr =
    n > 0 ? days.reduce((s, v) => s + Math.abs(v - rate), 0) / n : null;

  return {
    dailyForecast: new Array<number>(horizon).fill(rate),
    sigmaDaily: Math.sqrt(variance),
    oneStepMae: absErr,
  };
}
