import { describe, expect, it, vi } from "vitest";
import {
  CLOVER_MARK_NATIVE_PAGE_SUFFIX,
  buildNativeAnnotationPageForCanvas,
  syncNativeAnnotationPageToVault,
} from "./native-annotations";
import { parseWebVttCues } from "./webvtt";

function decodeDataUri(uri: string): string {
  const [, encoded = ""] = uri.split(",", 2);
  return decodeURIComponent(encoded);
}

describe("native annotation sync", () => {
  it("builds native annotation page and converts timed-word JSON to segmented WEBVTT body", () => {
    const page = buildNativeAnnotationPageForCanvas("canvas-1", [
      {
        id: "anno-1",
        motivation: "supplementing",
        target: "canvas-1#t=6.56,25.448",
        bodies: [
          {
            type: "TextualBody",
            purpose: "describing",
            format: "application/json",
            value: JSON.stringify({
              schema: "clover.parakeet.word_timestamps.v1",
              words: [
                { text: "Our", start_time: 6.56, end_time: 6.96 },
                { text: "music", start_time: 6.96, end_time: 7.28 },
                { text: "library", start_time: 7.28, end_time: 7.76 },
                { text: "is", start_time: 7.76, end_time: 7.92 },
                { text: "home", start_time: 7.92, end_time: 8.16 },
                { text: "to", start_time: 8.16, end_time: 8.32 },
                { text: "many", start_time: 8.32, end_time: 8.56 },
                { text: "distinctive", start_time: 8.56, end_time: 9.12 },
                { text: "collections,", start_time: 9.12, end_time: 9.68 },
                { text: "including", start_time: 9.68, end_time: 10.0 },
                { text: "the", start_time: 10.0, end_time: 10.16 },
                { text: "Moldenhauer", start_time: 10.64, end_time: 11.44 },
                { text: "collection.", start_time: 11.44, end_time: 12.08 },
              ],
            }),
          },
        ],
      },
    ]);

    expect(page.id).toBe(`canvas-1${CLOVER_MARK_NATIVE_PAGE_SUFFIX}`);
    expect(page.items).toHaveLength(1);
    const annotation = page.items[0];
    expect(annotation.type).toBe("Annotation");
    expect(annotation.target).toEqual({
      type: "SpecificResource",
      source: {
        id: "canvas-1",
        type: "Canvas",
      },
      selector: {
        type: "FragmentSelector",
        value: "t=6.56,25.448",
      },
    });
    expect(Array.isArray(annotation.body)).toBe(true);

    const body = (annotation.body as Array<Record<string, unknown>>)[0];
    expect(body.format).toBe("text/vtt");
    expect(typeof body.id).toBe("string");

    const webVtt = decodeDataUri(String(body.id));
    const cues = parseWebVttCues(webVtt);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues.length).toBeLessThan(8);
    expect(cues.some((cue) => cue.text.includes("Our music library"))).toBe(true);
  });

  it("prioritizes WEBVTT bodies first when annotations include label text bodies", () => {
    const page = buildNativeAnnotationPageForCanvas("canvas-1", [
      {
        id: "anno-ordered",
        target: "canvas-1#t=1,2",
        bodies: [
          {
            type: "TextualBody",
            purpose: "tagging",
            value: "Viewer transcription",
          },
          {
            type: "TextualBody",
            purpose: "describing",
            format: "application/json",
            value: JSON.stringify({
              schema: "clover.parakeet.word_timestamps.v1",
              words: [
                { text: "Our", start_time: 1.0, end_time: 1.25 },
                { text: "music", start_time: 1.25, end_time: 1.55 },
                { text: "library", start_time: 1.55, end_time: 1.95 },
              ],
            }),
          },
        ],
      },
    ]);

    const bodies = page.items[0].body as Array<Record<string, unknown>>;
    expect(bodies).toHaveLength(2);
    expect(bodies[0].format).toBe("text/vtt");
    expect(bodies[1].value).toBe("Viewer transcription");
  });

  it("preserves external WEBVTT body references", () => {
    const page = buildNativeAnnotationPageForCanvas("canvas-1", [
      {
        id: "anno-vtt-remote",
        target: "canvas-1#t=1,2",
        bodies: [
          {
            type: "TextualBody",
            purpose: "supplementing",
            format: "text/vtt",
            id: "https://example.org/captions.vtt",
          },
        ],
      },
    ]);

    const body = (page.items[0].body as Array<Record<string, unknown>>)[0];
    expect(body.id).toBe("https://example.org/captions.vtt");
    expect(body.format).toBe("text/vtt");
  });

  it("normalizes object targets so source is a Canvas resource with an id", () => {
    const page = buildNativeAnnotationPageForCanvas("canvas-1", [
      {
        id: "anno-vtt-remote",
        target: {
          type: "SpecificResource",
          source: "canvas-1",
          selector: {
            type: "FragmentSelector",
            value: "t=1,2",
          },
        },
        bodies: [
          {
            type: "TextualBody",
            purpose: "supplementing",
            value: "hello",
          },
        ],
      },
    ]);

    expect(page.items[0].target).toEqual({
      type: "SpecificResource",
      source: {
        id: "canvas-1",
        type: "Canvas",
      },
      selector: {
        type: "FragmentSelector",
        value: "t=1,2",
      },
    });
  });

  it("loads page into vault and appends canvas annotations reference", () => {
    const canvas = { id: "canvas-1", type: "Canvas", annotations: [{ id: "anno-page-a", type: "AnnotationPage" }] };
    const loadSync = vi.fn();
    const modifyEntityField = vi.fn((_, key: string, value: unknown) => {
      (canvas as Record<string, unknown>)[key] = value;
    });
    const get = vi.fn((ref: unknown) => {
      if (ref && typeof ref === "object" && "id" in ref && (ref as { id?: string }).id === "canvas-1") {
        return canvas;
      }
      return undefined;
    });

    const pageId = syncNativeAnnotationPageToVault(
      { loadSync, modifyEntityField, get },
      "canvas-1",
      [],
    );

    expect(pageId).toBe(`canvas-1${CLOVER_MARK_NATIVE_PAGE_SUFFIX}`);
    expect(loadSync).toHaveBeenCalledTimes(1);
    expect(modifyEntityField).toHaveBeenCalledTimes(1);
    expect((canvas.annotations as Array<{ id: string }>).some((entry) => entry.id === pageId)).toBe(true);
  });
});
