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

  it("provides provisional words during incremental streaming", async () => {
    const model = {
      transcribe: async () => ({
        text: "alpha beta",
        words: [
          { text: "alpha", start_time: 0, end_time: 1 },
          { text: "beta", start_time: 1, end_time: 2 },
        ],
        latencySeconds: 0.05,
        audioDurationSeconds: 2,
        rtf: 20,
      }),
    };
    const handler = new SmartProgressiveStreamingHandler(model, {
      sampleRate: 10,
      maxWindowSeconds: 15,
      sentenceBufferSeconds: 2,
    });

    const partial = await handler.transcribeIncremental(new Float32Array(20));

    expect(partial.isFinal).toBe(false);
    expect(partial.words?.map((word) => word.text)).toEqual(["alpha", "beta"]);
    expect(partial.words?.[0]?.start_time).toBe(0);
    expect(partial.words?.[1]?.end_time).toBe(2);
  });

  it("streams cumulative timed words as batch windows finalize", async () => {
    const sampleRate = 10;
    const model = {
      transcribe: async (audio: Float32Array) => {
        const durationSeconds = audio.length / sampleRate;
        const wholeSeconds = Math.floor(durationSeconds);
        const words = Array.from({ length: wholeSeconds }, (_, index) => ({
          text: `w${index}`,
          start_time: index,
          end_time: index + 1,
        }));

        return {
          text: words.map((word) => word.text).join(" "),
          words,
          latencySeconds: 0.05,
          audioDurationSeconds: durationSeconds,
          rtf: 20,
        };
      },
    };
    const handler = new SmartProgressiveStreamingHandler(model, {
      sampleRate,
      maxWindowSeconds: 4,
      sentenceBufferSeconds: 1,
    });

    const streamedWordCounts: number[] = [];
    let finalWords: Array<{ text: string; start_time: number; end_time: number }> = [];
    for await (const partial of handler.transcribeBatch(new Float32Array(90))) {
      streamedWordCounts.push(partial.words?.length ?? 0);
      if (partial.isFinal) {
        finalWords = partial.words ?? [];
      }
    }

    expect(streamedWordCounts).toEqual([4, 6, 8, 9]);
    expect(finalWords[0]?.start_time).toBe(0);
    expect(finalWords[finalWords.length - 1]?.end_time).toBe(9);
  });
});
