import { describe, expect, it } from "vitest";
import { SmartProgressiveStreamingHandler } from "./stt-streaming";

describe("SmartProgressiveStreamingHandler batch mode", () => {
  it("returns final text for short audio via transcribeBatchLatest", async () => {
    const model = {
      transcribe: async () => ({
        text: "short clip",
        words: [
          { text: "short", start_time: 0, end_time: 0.5 },
          { text: "clip", start_time: 0.5, end_time: 1 },
        ],
        latencySeconds: 0.05,
        audioDurationSeconds: 1,
        rtf: 20,
      }),
    };
    const handler = new SmartProgressiveStreamingHandler(model, {
      sampleRate: 10,
      maxWindowSeconds: 6,
      sentenceBufferSeconds: 2,
    });

    const partial = await handler.transcribeBatchLatest(new Float32Array(20));
    const merged = [partial.fixedText, partial.activeText].join(" ").trim();

    expect(partial.isFinal).toBe(true);
    expect(partial.timestamp).toBe(2);
    expect(merged).toContain("short clip");
  });

  it("keeps progressing even if lockable timestamps do not advance", async () => {
    const model = {
      transcribe: async () => ({
        text: "stalled",
        words: [{ text: "stalled", start_time: 0, end_time: 0 }],
        latencySeconds: 0.05,
        audioDurationSeconds: 1,
        rtf: 20,
      }),
    };
    const handler = new SmartProgressiveStreamingHandler(model, {
      sampleRate: 10,
      maxWindowSeconds: 6,
      sentenceBufferSeconds: 2,
    });

    const updates: string[] = [];
    for await (const partial of handler.transcribeBatch(new Float32Array(120))) {
      updates.push(`${partial.timestamp}:${partial.isFinal ? "final" : "partial"}`);
    }

    expect(updates.length).toBeGreaterThan(0);
    expect(updates[updates.length - 1]?.endsWith("final")).toBe(true);
  });
});
