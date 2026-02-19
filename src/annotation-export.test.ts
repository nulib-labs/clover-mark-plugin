import { describe, expect, it } from "vitest";
import { buildAnnotationPageExport } from "./annotation-export";

describe("annotation export", () => {
  it("builds a IIIF AnnotationPage from stored annotations", () => {
    const annotationPage = buildAnnotationPageExport({
      manifestId: "https://example.org/manifest.json",
      canvasOrder: ["canvas-1", "canvas-2"],
      storedByCanvasId: {
        "canvas-1": [
          {
            id: "anno-1",
            bodies: [{ type: "TextualBody", purpose: "tagging", value: "Ship" }],
            target: "canvas-1#xywh=10,20,30,40",
            motivation: "tagging",
          },
        ],
        "canvas-2": [
          {
            id: "anno-2",
            bodies: [
              { type: "TextualBody", purpose: "commenting", value: "Edge detail" },
              { type: "TextualBody", purpose: "tagging", value: "Architecture" },
            ],
            target: "canvas-2",
            motivation: ["commenting", "tagging"],
          },
        ],
      },
    });

    expect(annotationPage).toEqual({
      "@context": "http://iiif.io/api/presentation/3/context.json",
      id: "https://example.org/manifest.json#annotation-page",
      type: "AnnotationPage",
      label: { en: ["CloverMark Export"] },
      summary: { en: ["2 annotations across 2 canvases."] },
      items: [
        {
          id: "anno-1",
          type: "Annotation",
          body: { type: "TextualBody", purpose: "tagging", value: "Ship" },
          motivation: "tagging",
          target: {
            type: "SpecificResource",
            source: "canvas-1",
            selector: {
              type: "FragmentSelector",
              conformsTo: "http://www.w3.org/TR/media-frags/",
              value: "xywh=10,20,30,40",
            },
          },
        },
        {
          id: "anno-2",
          type: "Annotation",
          body: [
            { type: "TextualBody", purpose: "commenting", value: "Edge detail" },
            { type: "TextualBody", purpose: "tagging", value: "Architecture" },
          ],
          motivation: ["commenting", "tagging"],
          target: "canvas-2",
        },
      ],
    });
  });

  it("falls back to generated ids and target canvas id", () => {
    const annotationPage = buildAnnotationPageExport({
      storedByCanvasId: {
        "canvas-1": [
          {
            id: "",
            bodies: [{ type: "TextualBody", purpose: "commenting", value: "Note" }],
          },
        ],
      },
    });

    expect(annotationPage.id).toBe("urn:clover-mark-export#annotation-page");
    expect(annotationPage.items).toEqual([
      {
        id: "urn:clover-mark-export#annotation-page/annotation-1",
        type: "Annotation",
        body: { type: "TextualBody", purpose: "commenting", value: "Note" },
        target: "canvas-1",
      },
    ]);
  });

  it("preserves multiple language-tagged translations on the same target", () => {
    const annotationPage = buildAnnotationPageExport({
      storedByCanvasId: {
        "canvas-1": [
          {
            id: "anno-translations",
            bodies: [
              {
                type: "TextualBody",
                purpose: "supplementing",
                value: "Bonjour",
                language: "fr",
              },
              {
                type: "TextualBody",
                purpose: "supplementing",
                value: "Hello",
                language: "en",
              },
            ],
            target: "canvas-1#xywh=10,20,30,40",
            motivation: "supplementing",
          },
        ],
      },
    });

    expect(annotationPage.items).toEqual([
      {
        id: "anno-translations",
        type: "Annotation",
        body: [
          {
            type: "TextualBody",
            purpose: "supplementing",
            value: "Bonjour",
            language: "fr",
          },
          {
            type: "TextualBody",
            purpose: "supplementing",
            value: "Hello",
            language: "en",
          },
        ],
        motivation: "supplementing",
        target: {
          type: "SpecificResource",
          source: "canvas-1",
          selector: {
            type: "FragmentSelector",
            conformsTo: "http://www.w3.org/TR/media-frags/",
            value: "xywh=10,20,30,40",
          },
        },
      },
    ]);
  });

  it("normalizes annotorious-style targets and strips runtime body fields", () => {
    const annotationPage = buildAnnotationPageExport({
      storedByCanvasId: {
        "canvas-1": [
          {
            id: "anno-a",
            bodies: [
              {
                type: "TextualBody",
                purpose: "supplementing",
                value: "vêtements de cyclisme",
                language: "fr",
                annotation: "anno-a",
              },
            ],
            target: {
              annotation: "anno-a",
              selector: {
                type: "RECTANGLE",
                geometry: {
                  x: 10,
                  y: 20,
                  w: 30,
                  h: 40,
                },
              },
              creator: { id: "guest-1" },
              created: "2026-02-18T06:02:11.976Z",
            },
            motivation: "supplementing",
          },
        ],
      },
    });

    expect(annotationPage.items).toEqual([
      {
        id: "anno-a",
        type: "Annotation",
        target: {
          type: "SpecificResource",
          source: "canvas-1",
          selector: {
            type: "FragmentSelector",
            conformsTo: "http://www.w3.org/TR/media-frags/",
            value: "xywh=10,20,30,40",
          },
        },
        body: {
          type: "TextualBody",
          purpose: "supplementing",
          value: "vêtements de cyclisme",
          language: "fr",
        },
        motivation: "supplementing",
        created: "2026-02-18T06:02:11.976Z",
        creator: { id: "guest-1" },
      },
    ]);
  });

  it("normalizes temporal media fragments from string and selector targets", () => {
    const annotationPage = buildAnnotationPageExport({
      storedByCanvasId: {
        "canvas-1": [
          {
            id: "anno-temporal-string",
            bodies: [{ type: "TextualBody", purpose: "supplementing", value: "Segment text" }],
            target: "canvas-1#t=16.99,19.95",
            motivation: "supplementing",
          },
          {
            id: "anno-temporal-selector",
            bodies: [{ type: "TextualBody", purpose: "supplementing", value: "Another segment" }],
            target: {
              source: "canvas-1",
              selector: "t=20.1,24.3",
            },
            motivation: "supplementing",
          },
        ],
      },
    });

    expect(annotationPage.items).toEqual([
      {
        id: "anno-temporal-string",
        type: "Annotation",
        target: {
          type: "SpecificResource",
          source: "canvas-1",
          selector: {
            type: "FragmentSelector",
            conformsTo: "http://www.w3.org/TR/media-frags/",
            value: "t=16.99,19.95",
          },
        },
        body: {
          type: "TextualBody",
          purpose: "supplementing",
          value: "Segment text",
        },
        motivation: "supplementing",
      },
      {
        id: "anno-temporal-selector",
        type: "Annotation",
        target: {
          type: "SpecificResource",
          source: "canvas-1",
          selector: {
            type: "FragmentSelector",
            conformsTo: "http://www.w3.org/TR/media-frags/",
            value: "t=20.1,24.3",
          },
        },
        body: {
          type: "TextualBody",
          purpose: "supplementing",
          value: "Another segment",
        },
        motivation: "supplementing",
      },
    ]);
  });
});
