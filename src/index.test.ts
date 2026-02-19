import { describe, expect, it, vi } from "vitest";

vi.mock("./annotations-bridge", () => ({
  AnnotationsBridge: () => null,
}));

vi.mock("./annotations-panel", () => ({
  cloverMarkPanel: () => null,
}));

import { cloverMarkPlugin } from "./index";

describe("cloverMarkPlugin", () => {
  it("sets default motivation to supplementing", () => {
    const plugin = cloverMarkPlugin();
    expect(plugin.imageViewer?.controls?.componentProps).toEqual({
      defaultMotivation: "supplementing",
    });
    expect(plugin.informationPanel?.componentProps).toEqual({
      defaultMotivation: "supplementing",
      motivationOptions: undefined,
      translationLanguageOptions: undefined,
      defaultTranslationLanguage: undefined,
      enableStreamingStt: undefined,
      sttModelVersion: undefined,
      sttUpdateIntervalMs: undefined,
    });
  });

  it("allows overriding default motivation", () => {
    const plugin = cloverMarkPlugin({
      defaultMotivation: "tagging",
      motivationOptions: ["tagging", "commenting", "describing"],
    });
    expect(plugin.imageViewer?.controls?.componentProps).toEqual({
      defaultMotivation: "tagging",
    });
    expect(plugin.informationPanel?.componentProps).toEqual({
      defaultMotivation: "tagging",
      motivationOptions: ["tagging", "commenting", "describing"],
      translationLanguageOptions: undefined,
      defaultTranslationLanguage: undefined,
      enableStreamingStt: undefined,
      sttModelVersion: undefined,
      sttUpdateIntervalMs: undefined,
    });
  });
});
