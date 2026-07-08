import { crostonForecast } from "./models/croston";
import { holtWintersForecast } from "./models/holt-winters";
import { movingAverageForecast } from "./models/moving-average";
import type { EngineResult, ForecastMethod, ModelFit } from "./types";

export const FORECAST_HORIZON_DAYS = 90;

/** Zero-day share above which demand counts as intermittent → Croston. */
const INTERMITTENT_ZERO_SHARE = 0.65;
const BACKTEST_HOLDOUT_DAYS = 14;
/** Trailing window for the plain demand-rate KPI (units/day). */
const AVG_WINDOW_DAYS = 28;

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

function pickMethod(days: number[]): ForecastMethod {
  const n = days.length;
  const total = days.reduce((s, v) => s + v, 0);
  if (n === 0 || total <= 0) return "NONE";
  const nonzero = days.filter((v) => v > 0).length;
  const zeroShare = 1 - nonzero / n;
  if (zeroShare > INTERMITTENT_ZERO_SHARE) {
    return nonzero >= 3 ? "CROSTON" : "MOVING_AVERAGE";
  }
  if (n >= 21) return "HOLT_WINTERS";
  return "MOVING_AVERAGE";
}

function runMethod(
  method: ForecastMethod,
  days: number[],
  horizon: number,
): ModelFit {
  switch (method) {
    case "HOLT_WINTERS":
      return (
        holtWintersForecast(days, horizon) ?? movingAverageForecast(days, horizon)
      );
    case "CROSTON":
      return crostonForecast(days, horizon);
    case "MOVING_AVERAGE":
      return movingAverageForecast(days, horizon);
    case "NONE":
      return {
        dailyForecast: new Array<number>(horizon).fill(0),
        sigmaDaily: 0,
        oneStepMae: null,
      };
  }
}

/**
 * Forecast a variant's daily demand series. Deterministic: same input,
 * same output — no clock, no randomness.
 */
export function forecastSeries(
  days: number[],
  horizon = FORECAST_HORIZON_DAYS,
): EngineResult {
  const n = days.length;
  const total = days.reduce((s, v) => s + v, 0);
  const nonzero = days.filter((v) => v > 0).length;
  const method = pickMethod(days);
  const fitted = runMethod(method, days, horizon);

  // Holdout backtest: refit on the truncated series, score on the held-out
  // tail. Only when there is enough history for the refit to be meaningful.
  let backtestMae: number | null = null;
  if (method !== "NONE" && n >= 3 * BACKTEST_HOLDOUT_DAYS) {
    const train = days.slice(0, n - BACKTEST_HOLDOUT_DAYS);
    const actual = days.slice(n - BACKTEST_HOLDOUT_DAYS);
    const holdoutFit = runMethod(method, train, BACKTEST_HOLDOUT_DAYS);
    const absSum = actual.reduce(
      (s, y, i) => s + Math.abs(y - holdoutFit.dailyForecast[i]),
      0,
    );
    backtestMae = round4(absSum / BACKTEST_HOLDOUT_DAYS);
  }

  const avgWindow = days.slice(-Math.min(AVG_WINDOW_DAYS, n));
  const avgDailyUnits =
    avgWindow.length > 0
      ? avgWindow.reduce((s, v) => s + v, 0) / avgWindow.length
      : 0;

  return {
    method,
    dailyForecast: fitted.dailyForecast.map((v) => round4(Math.max(0, v))),
    sigmaDaily: round4(fitted.sigmaDaily),
    backtestMae,
    avgDailyUnits: round4(avgDailyUnits),
    historyDays: n,
    nonzeroDays: nonzero,
    historyTotalUnits: Math.round(total * 100) / 100,
  };
}
