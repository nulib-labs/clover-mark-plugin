import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetRuntimeForTests,
  getCanvasAnnotator,
  getStoredCanvasAnnotations,
  getRuntimeStateSnapshot,
  registerCanvasAnnotator,
  setCanvasBridgeState,
  setCanvasLocalAnnotationCount,
  setCanvasLocalCloverMarks,
  setCanvasSelectedLocalScholiumId,
  setStoredCanvasAnnotations,
  type CanvasAnnotatorLike,
} from "./annotation-runtime";

describe("annotation-runtime", () => {
  beforeEach(() => {
    __resetRuntimeForTests();
  });

  it("stores local runtime state per canvas", () => {
    setCanvasBridgeState("canvas-a", "openseadragon", true);
    setCanvasLocalAnnotationCount("canvas-a", 2);
    setCanvasSelectedLocalScholiumId("canvas-a", "anno-1");
    setCanvasLocalCloverMarks("canvas-a", [
      { id: "anno-1", label: "Label", comment: "Comment", translations: [] },
      { id: "anno-2", label: "Label 2", comment: "", translations: [] },
    ]);

    const snapshot = getRuntimeStateSnapshot();
    expect(snapshot.byCanvasId["canvas-a"]).toEqual({
      bridgeMode: "openseadragon",
      bridgeReady: true,
      localAnnotationCount: 2,
      selectedLocalScholiumId: "anno-1",
      localCloverMarks: [
        { id: "anno-1", label: "Label", comment: "Comment", translations: [] },
        { id: "anno-2", label: "Label 2", comment: "", translations: [] },
      ],
    });
  });

  it("stores and returns raw annotations per canvas for rehydration", () => {
    setStoredCanvasAnnotations("canvas-a", [
      {
        id: "anno-a",
        target: {
          source: "canvas-a",
          selector: {
            type: "FragmentSelector",
            value: "xywh=10,10,20,20",
          },
        },
      },
    ]);
    setStoredCanvasAnnotations("canvas-b", [{ id: "anno-b" }]);

    expect(getStoredCanvasAnnotations("canvas-a")).toEqual([
      {
        id: "anno-a",
        target: {
          source: "canvas-a",
          selector: {
            type: "FragmentSelector",
            value: "xywh=10,10,20,20",
          },
        },
      },
    ]);
    expect(getStoredCanvasAnnotations("canvas-b")).toEqual([{ id: "anno-b" }]);
    expect(getStoredCanvasAnnotations("missing-canvas")).toEqual([]);
  });

  it("registers and unregisters annotators per canvas", () => {
    const annotator = {
      fitBounds: () => undefined,
      getAnnotationById: () => undefined,
      removeAnnotation: () => undefined,
      setSelected: () => undefined,
      updateAnnotation: () => undefined,
    } satisfies CanvasAnnotatorLike;

    registerCanvasAnnotator("canvas-a", annotator);
    expect(getCanvasAnnotator("canvas-a")).toBe(annotator);

    registerCanvasAnnotator("canvas-a", null);
    expect(getCanvasAnnotator("canvas-a")).toBeUndefined();
  });
});
