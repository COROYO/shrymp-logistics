import { describe, expect, it } from "vitest";
import {
  buildTestModeMutationMock,
  extractMutationRootField,
  isGraphQLMutation,
  summarizeTestModeMutation,
} from "./test-mode";

describe("test-mode", () => {
  it("detects GraphQL mutations", () => {
    expect(isGraphQLMutation("mutation TagsAdd { tagsAdd { node { id } } }")).toBe(
      true,
    );
    expect(isGraphQLMutation("  query Order { order { id } }")).toBe(false);
  });

  it("extracts mutation root field", () => {
    expect(
      extractMutationRootField(
        "mutation TagsAdd($id: ID!) { tagsAdd(id: $id, tags: []) { node { id } } }",
      ),
    ).toBe("tagsAdd");
  });

  it("summarizes tag mutations", () => {
    expect(
      summarizeTestModeMutation("tagsAdd", {
        id: "gid://shopify/Order/1",
        tags: ["LAGER_SHIP"],
      }),
    ).toContain("LAGER_SHIP");
  });

  it("builds safe mocks for outbox ops", () => {
    const mock = buildTestModeMutationMock("tagsAdd", {
      id: "gid://shopify/Order/1",
      tags: ["LAGER_SHIP"],
    });
    expect(mock.tagsAdd).toMatchObject({
      userErrors: [],
      node: { id: "gid://shopify/Order/1" },
    });
  });
});
