import type { ModelFit } from "../types";

/**
 * Additive Holt-Winters (triple exponential smoothing) with a weekly
 * season (m = 7) — level + trend + day-of-week pattern, which dominates
 * e-commerce demand. Smoothing params come from a fixed, deterministic
 * grid search minimizing one-step-ahead MAE (no randomness — same input,
 * same output).
 */

const M = 7;
const MIN_DAYS = 3 * M;

const ALPHAS = [0.05, 0.1, 0.2, 0.3, 0.5];
const BETAS = [0.01, 0.05, 0.1];
const GAMMAS = [0.05, 0.1, 0.3];

type FitState = {
  level: number;
  trend: number;
  season: number[];
  mae: number;
  sigma: number;
};

function initSeason(days: number[]): { season: number[]; level: number; trend: number } {
  const weeks = Math.min(4, Math.floor(days.length / M));
  const weekMeans: number[] = [];
  for (let w = 0; w < weeks; w++) {
    let sum = 0;
    for (let i = 0; i < M; i++) sum += days[w * M + i];
    weekMeans.push(sum / M);
  }
  const season = new Array<number>(M).fill(0);
  for (let i = 0; i < M; i++) {
    let sum = 0;
    for (let w = 0; w < weeks; w++) sum += days[w * M + i] - weekMeans[w];
    season[i] = sum / weeks;
  }
  const level = weekMeans[0];
  const trend = weeks >= 2 ? (weekMeans[1] - weekMeans[0]) / M : 0;
  return { season, level, trend };
}

function fit(days: number[], alpha: number, beta: number, gamma: number): FitState {
  const init = initSeason(days);
  let level = init.level;
  let trend = init.trend;
  const season = [...init.season];

  let absSum = 0;
  let sqSum = 0;
  let count = 0;

  for (let t = 0; t < days.length; t++) {
    const s = season[t % M];
    const predicted = level + trend + s;
    const err = days[t] - predicted;
    if (t >= M) {
      // skip the init week — its errors reflect seeding, not the model
      absSum += Math.abs(err);
      sqSum += err * err;
      count++;
    }
    const newLevel = alpha * (days[t] - s) + (1 - alpha) * (level + trend);
    trend = beta * (newLevel - level) + (1 - beta) * trend;
    season[t % M] = gamma * (days[t] - newLevel) + (1 - gamma) * s;
    level = newLevel;
  }

  return {
    level,
    trend,
    season,
    mae: count > 0 ? absSum / count : Infinity,
    sigma: count > 0 ? Math.sqrt(sqSum / count) : 0,
  };
}

/** Returns null when the series is too short — caller falls back. */
export function holtWintersForecast(
  days: number[],
  horizon: number,
): ModelFit | null {
  if (days.length < MIN_DAYS) return null;

  let best: FitState | null = null;
  for (const alpha of ALPHAS) {
    for (const beta of BETAS) {
      for (const gamma of GAMMAS) {
        const candidate = fit(days, alpha, beta, gamma);
        if (best === null || candidate.mae < best.mae) best = candidate;
      }
    }
  }
  const chosen = best as FitState;

  const n = days.length;
  const dailyForecast: number[] = [];
  for (let k = 0; k < horizon; k++) {
    const raw = chosen.level + (k + 1) * chosen.trend + chosen.season[(n + k) % M];
    dailyForecast.push(Math.max(0, raw));
  }

  return {
    dailyForecast,
    sigmaDaily: chosen.sigma,
    oneStepMae: Number.isFinite(chosen.mae) ? chosen.mae : null,
  };
}
