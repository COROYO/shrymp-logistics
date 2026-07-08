import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { forecastSeries, FORECAST_HORIZON_DAYS } from "./engine";

const WEEK = [0, 0, 10, 10, 10, 20, 30];
const eightWeeks = Array.from({ length: 56 }, (_, i) => WEEK[i % 7]);

describe("forecastSeries — model selection", () => {
  it("routes empty / zero-demand series to NONE", () => {
    expect(forecastSeries([]).method).toBe("NONE");
    expect(forecastSeries([0, 0, 0]).method).toBe("NONE");
    expect(forecastSeries([]).dailyForecast).toHaveLength(
      FORECAST_HORIZON_DAYS,
    );
  });

  it("routes short dense series to MOVING_AVERAGE", () => {
    const result = forecastSeries([1, 2, 1, 2, 1, 2, 1, 2, 1, 2]);
    expect(result.method).toBe("MOVING_AVERAGE");
  });

  it("routes intermittent series to CROSTON", () => {
    const days = Array.from({ length: 60 }, (_, i) => (i % 5 === 4 ? 6 : 0));
    expect(forecastSeries(days).method).toBe("CROSTON");
  });

  it("routes long dense series to HOLT_WINTERS and runs a backtest", () => {
    const result = forecastSeries(eightWeeks);
    expect(result.method).toBe("HOLT_WINTERS");
    expect(result.backtestMae).not.toBeNull();
    expect(result.backtestMae!).toBeLessThan(3); // noise-free pattern
  });

  it("reports trailing demand rate and history stats", () => {
    const result = forecastSeries(eightWeeks);
    // mean of WEEK = 80/7 ≈ 11.43
    expect(result.avgDailyUnits).toBeGreaterThan(11);
    expect(result.avgDailyUnits).toBeLessThan(12);
    expect(result.historyDays).toBe(56);
    expect(result.nonzeroDays).toBe(40);
    expect(result.historyTotalUnits).toBe(640);
  });
});

describe("forecastSeries — properties", () => {
  const seriesArb = fc.array(fc.nat({ max: 50 }), { maxLength: 200 });

  it("always yields finite, non-negative forecasts of the requested length", () => {
    fc.assert(
      fc.property(seriesArb, (days) => {
        const result = forecastSeries(days, 30);
        expect(result.dailyForecast).toHaveLength(30);
        for (const v of result.dailyForecast) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
        expect(Number.isFinite(result.sigmaDaily)).toBe(true);
      }),
    );
  });

  it("is deterministic — same input, same output", () => {
    fc.assert(
      fc.property(seriesArb, (days) => {
        expect(forecastSeries(days)).toEqual(forecastSeries(days));
      }),
    );
  });
});
