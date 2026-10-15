import { describe, expect, it } from "vitest";
import {
  shopifyTagError,
  statusTagOps,
  tagsForStatus,
} from "./writeback";

const tags = {
  ship: "LAGER_SHIP",
  stop: "LAGER_STOP",
  packed: "LAGER_PACKED",
};

describe("tagsForStatus", () => {
  it("sets the ship tag and drops stop and packed", () => {
    expect(tagsForStatus("SHIP", tags)).toEqual({
      add: ["LAGER_SHIP"],
      remove: ["LAGER_STOP", "LAGER_PACKED"],
    });
    expect(tagsForStatus("PICKING", tags).add).toEqual(["LAGER_SHIP"]);
  });

  it("sets the stop tag and drops the others", () => {
    expect(tagsForStatus("STOP", tags)).toEqual({
      add: ["LAGER_STOP"],
      remove: ["LAGER_SHIP", "LAGER_PACKED"],
    });
  });

  it("sets the packed tag and drops ship and stop", () => {
    expect(tagsForStatus("PACKED", tags)).toEqual({
      add: ["LAGER_PACKED"],
      remove: ["LAGER_SHIP", "LAGER_STOP"],
    });
  });

  it("skips an empty tag and does not remove the tag it just adds", () => {
    expect(
      tagsForStatus("SHIP", { ship: "", stop: "WAIT", packed: "WAIT" }),
    ).toEqual({ add: [], remove: ["WAIT"] });
    expect(
      tagsForStatus("PACKED", { ship: "SAME", stop: "WAIT", packed: "SAME" }),
    ).toEqual({ add: ["SAME"], remove: ["WAIT"] });
  });

  it("emits no ops when every tag is blank", () => {
    expect(statusTagOps("STOP", { ship: " ", stop: "", packed: "" })).toEqual(
      [],
    );
  });
});

describe("shopifyTagError", () => {
  it("rejects commas and accepts a trimmed tag", () => {
    expect(shopifyTagError("  OK  ")).toBeNull();
    expect(shopifyTagError("A, B")).toMatch(/Komma/);
    expect(shopifyTagError("")).toBeNull();
  });
});
