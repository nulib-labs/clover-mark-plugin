import { describe, expect, it } from "vitest";
import { shouldSkipSyncOnHydration } from "./hydration-sync";

describe("annotations-bridge hydration sync guard", () => {
  it("does not skip sync when there are no stored annotations", () => {
    expect(shouldSkipSyncOnHydration(0, true)).toBe(false);
  });

  it("skips sync only when stored annotations are injected", () => {
    expect(shouldSkipSyncOnHydration(1, true)).toBe(true);
    expect(shouldSkipSyncOnHydration(1, false)).toBe(false);
  });
});
