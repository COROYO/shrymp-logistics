import { describe, expect, it } from "vitest";
import { PRINT_SLIP_CHUNK_MAX, printJobChunkRange } from "./print-slip-chunk";

describe("printJobChunkRange", () => {
  it("slices a mid-job window", () => {
    expect(printJobChunkRange(100, 8, 4)).toEqual({
      start: 8,
      end: 12,
      nextOffset: 12,
      done: false,
      count: 4,
    });
  });

  it("marks the last partial chunk done", () => {
    expect(printJobChunkRange(10, 8, 4)).toEqual({
      start: 8,
      end: 10,
      nextOffset: 10,
      done: true,
      count: 2,
    });
  });

  it("clamps offset past the end", () => {
    expect(printJobChunkRange(5, 99, 4)).toEqual({
      start: 5,
      end: 5,
      nextOffset: 5,
      done: true,
      count: 0,
    });
  });

  it("caps limit at PRINT_SLIP_CHUNK_MAX", () => {
    const r = printJobChunkRange(1000, 0, 500);
    expect(r.count).toBe(PRINT_SLIP_CHUNK_MAX);
    expect(r.done).toBe(false);
  });

  it("treats empty jobs as done", () => {
    expect(printJobChunkRange(0, 0, 4).done).toBe(true);
  });
});
