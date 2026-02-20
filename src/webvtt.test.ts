import { describe, expect, it } from "vitest";
import {
  isWebVttBody,
  isWebVttFormat,
  looksLikeWebVtt,
  parseWebVttCues,
  segmentWordsIntoWebVttCues,
  serializeWebVttCues,
} from "./webvtt";

describe("webvtt utilities", () => {
  it("detects WEBVTT formats and body shapes", () => {
    expect(isWebVttFormat("text/vtt")).toBe(true);
    expect(isWebVttFormat("text/webvtt")).toBe(true);
    expect(isWebVttFormat("application/json")).toBe(false);
    expect(looksLikeWebVtt("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi")).toBe(true);
    expect(isWebVttBody({ format: "text/vtt", value: "" })).toBe(true);
    expect(isWebVttBody({ value: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi" })).toBe(true);
    expect(isWebVttBody({ format: "application/json", value: "{}" })).toBe(false);
  });

  it("parses cue-level WEBVTT segments", () => {
    const cues = parseWebVttCues(`
WEBVTT

00:00:00.000 --> 00:00:01.500
Hello world

00:00:01.750 --> 00:00:02.500
Again
`);

    expect(cues).toEqual([
      {
        start_time: 0,
        end_time: 1.5,
        text: "Hello world",
      },
      {
        start_time: 1.75,
        end_time: 2.5,
        text: "Again",
      },
    ]);
  });

  it("supports identifiers, ignores NOTE blocks, and strips cue markup", () => {
    const cues = parseWebVttCues(`
WEBVTT

NOTE this should be ignored
detail line

cue-1
00:00:03.000 --> 00:00:05.000 align:start position:0%
<v Speaker>Hello <c.green>world</c>!</v>
`);

    expect(cues).toEqual([
      {
        identifier: "cue-1",
        start_time: 3,
        end_time: 5,
        text: "Hello world!",
      },
    ]);
  });

  it("serializes cues back to WEBVTT", () => {
    const vtt = serializeWebVttCues([
      {
        identifier: "cue-1",
        start_time: 0,
        end_time: 1.5,
        text: "Hello world",
      },
      {
        start_time: 2,
        end_time: 3.25,
        text: "Second line",
      },
    ]);

    expect(vtt).toContain("WEBVTT");
    expect(vtt).toContain("00:00:00.000 --> 00:00:01.500");
    expect(vtt).toContain("00:00:02.000 --> 00:00:03.250");

    expect(parseWebVttCues(vtt)).toEqual([
      {
        identifier: "cue-1",
        start_time: 0,
        end_time: 1.5,
        text: "Hello world",
      },
      {
        start_time: 2,
        end_time: 3.25,
        text: "Second line",
      },
    ]);
  });

  it("groups word-level timestamps into caption-length cues", () => {
    const cues = segmentWordsIntoWebVttCues([
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
      { text: "Hans", start_time: 10.16, end_time: 10.48 },
      { text: "Moldenhauer", start_time: 10.64, end_time: 11.44 },
      { text: "Collection.", start_time: 11.44, end_time: 12.08 },
    ]);

    expect(cues.length).toBeGreaterThan(1);
    expect(cues.length).toBeLessThan(8);
    expect(cues.some((cue) => cue.text.includes("Our music library"))).toBe(true);
    expect(cues.some((cue) => cue.text.includes("Moldenhauer"))).toBe(true);
    expect(cues.some((cue) => cue.text.includes("Collection."))).toBe(true);
  });

  it("avoids dangling function-word cues after segmentation", () => {
    const cues = segmentWordsIntoWebVttCues([
      { text: "Our music library", start_time: 0, end_time: 4.241 },
      { text: "is home to", start_time: 4.241, end_time: 8.483 },
      { text: "many distinctive collections,", start_time: 8.483, end_time: 12.724 },
      { text: "including the Hans", start_time: 12.724, end_time: 16.965 },
      { text: "Moldenhauer collection.", start_time: 16.965, end_time: 19.793 },
      { text: "It contains thousands", start_time: 19.793, end_time: 24.034 },
      { text: "of", start_time: 24.034, end_time: 25.448 },
    ]);

    expect(cues.length).toBeGreaterThan(1);
    expect(cues.some((cue) => cue.text.trim().toLowerCase() === "of")).toBe(false);
    expect(cues.some((cue) => cue.text.toLowerCase().startsWith("of "))).toBe(false);
  });
});
