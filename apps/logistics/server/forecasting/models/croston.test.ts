import { describe, expect, it } from "vitest";
import { crostonForecast } from "./croston";

describe("crostonForecast", () => {
  it("estimates the demand rate of an intermittent series", () => {
    // demand of 6 units every 5th day → true rate 1.2/day
    const days = Array.from({ length: 60 }, (_, i) => (i % 5 === 4 ? 6 : 0));
    const fit = crostonForecast(days, 30);
    const rate = fit.dailyForecast[0];
    expect(rate).toBeGreaterThan(0.9);
    expect(rate).toBeLessThan(1.4);
    // flat forecast
    expect(new Set(fit.dailyForecast).size).toBe(1);
  });

  it("forecasts zero when there was never any demand", () => {
    const fit = crostonForecast(new Array(30).fill(0), 10);
    expect(fit.dailyForecast.every((v) => v === 0)).toBe(true);
  });

  it("never returns negative values", () => {
    const days = [0, 3, 0, 0, 1, 0, 0, 0, 2, 0];
    const fit = crostonForecast(days, 5);
    for (const v of fit.dailyForecast) expect(v).toBeGreaterThanOrEqual(0);
  });
});
