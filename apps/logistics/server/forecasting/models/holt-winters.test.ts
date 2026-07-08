import { describe, expect, it } from "vitest";
import { holtWintersForecast } from "./holt-winters";

/** Noise-free weekly pattern — HW must reproduce it almost exactly. */
const WEEK = [0, 0, 10, 10, 10, 20, 30];
const eightWeeks = Array.from({ length: 56 }, (_, i) => WEEK[i % 7]);

describe("holtWintersForecast", () => {
  it("reconstructs a stable weekly pattern", () => {
    const fit = holtWintersForecast(eightWeeks, 7);
    expect(fit).not.toBeNull();
    const mae =
      fit!.dailyForecast.reduce(
        (s, v, i) => s + Math.abs(v - WEEK[(56 + i) % 7]),
        0,
      ) / 7;
    expect(mae).toBeLessThan(1.5);
  });

  it("returns null for series shorter than three weeks", () => {
    expect(holtWintersForecast(new Array(20).fill(5), 7)).toBeNull();
  });

  it("never forecasts negative demand, even on a decaying series", () => {
    const decaying = Array.from({ length: 42 }, (_, i) =>
      Math.max(0, 20 - i),
    );
    const fit = holtWintersForecast(decaying, 60);
    expect(fit).not.toBeNull();
    for (const v of fit!.dailyForecast) expect(v).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic", () => {
    const a = holtWintersForecast(eightWeeks, 14);
    const b = holtWintersForecast(eightWeeks, 14);
    expect(a).toEqual(b);
  });
});
