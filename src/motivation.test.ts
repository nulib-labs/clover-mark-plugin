import { describe, expect, it } from "vitest";
import {
  applyDefaultMotivation,
  getPrimaryMotivation,
  hasAnnotationMotivation,
} from "./motivation";

describe("motivation", () => {
  it("detects present motivations", () => {
    expect(hasAnnotationMotivation("commenting")).toBe(true);
    expect(hasAnnotationMotivation(["", "tagging"])).toBe(true);
    expect(hasAnnotationMotivation(undefined)).toBe(false);
    expect(hasAnnotationMotivation(["", "  "])).toBe(false);
  });

  it("applies a default motivation only when missing", () => {
    expect(applyDefaultMotivation({ id: "a" }, "commenting")).toEqual({
      id: "a",
      motivation: "commenting",
    });

    expect(
      applyDefaultMotivation(
        { id: "b", motivation: "supplementing" },
        "commenting",
      ),
    ).toEqual({
      id: "b",
      motivation: "supplementing",
    });
  });

  it("returns the first non-empty motivation", () => {
    expect(getPrimaryMotivation("commenting")).toBe("commenting");
    expect(getPrimaryMotivation(["", " describing "])).toBe("describing");
    expect(getPrimaryMotivation(["", " "])).toBeUndefined();
  });
});
