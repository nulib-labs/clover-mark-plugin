export const PARAKEET_SAMPLE_RATE = 16_000;

export type ParakeetBackend = "webgpu-hybrid" | "wasm";

export type ParakeetProgressEvent = {
  file: string;
  loaded: number;
  total: number;
  progress: number;
};

export type ParakeetWord = {
  text: string;
  start_time: number;
  end_time: number;
  confidence?: number;
};

export type ParakeetTranscriptionResult = {
  text: string;
  words: ParakeetWord[];
  latencySeconds: number;
  audioDurationSeconds: number;
  rtf: number;
};

export type ParakeetTranscribeOptions = {
  timeOffsetSeconds?: number;
};

export type ParakeetTranscriber = {
  backend: ParakeetBackend;
  modelVersion: string;
  transcribe: (
    audio: Float32Array,
    options?: ParakeetTranscribeOptions,
  ) => Promise<ParakeetTranscriptionResult>;
};

type ParakeetModelLike = {
  transcribe: (
    audio: Float32Array,
    sampleRate: number,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
};

type FromHubFn = (
  modelVersion: string,
  options: Record<string, unknown>,
) => Promise<ParakeetModelLike>;

type ParakeetModuleLike = {
  fromHub: FromHubFn;
};

let sharedTranscriber: ParakeetTranscriber | null = null;
let sharedTranscriberPromise: Promise<ParakeetTranscriber> | null = null;

function toFiniteNonNegativeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

function supportsWebGpu(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  return typeof (navigator as { gpu?: unknown }).gpu !== "undefined";
}

async function importParakeetModule(): Promise<ParakeetModuleLike> {
  const moduleUrl = "https://cdn.jsdelivr.net/npm/parakeet.js@1.2.1/+esm";
  const imported = await import(/* @vite-ignore */ moduleUrl);

  if (!imported || typeof (imported as { fromHub?: unknown }).fromHub !== "function") {
    throw new Error("parakeet.js module does not expose fromHub()");
  }

  return imported as ParakeetModuleLike;
}

function normalizeWords(rawWords: unknown): ParakeetWord[] {
  if (!Array.isArray(rawWords)) {
    return [];
  }

  return rawWords
    .map((word): ParakeetWord | undefined => {
      if (!word || typeof word !== "object") {
        return undefined;
      }

      const candidate = word as Record<string, unknown>;
      const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
      if (!text) {
        return undefined;
      }

      const startTime = toFiniteNonNegativeNumber(candidate.start_time);
      const endTime = toFiniteNonNegativeNumber(candidate.end_time);
      const confidence =
        typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)
          ? candidate.confidence
          : undefined;

      return {
        text,
        start_time: startTime,
        end_time: endTime >= startTime ? endTime : startTime,
        confidence,
      };
    })
    .filter((word): word is ParakeetWord => Boolean(word));
}

function getTranscriptionText(rawResult: unknown): string {
  if (!rawResult || typeof rawResult !== "object") {
    return "";
  }

  const candidate = rawResult as Record<string, unknown>;
  if (typeof candidate.utterance_text === "string") {
    return candidate.utterance_text.trim();
  }
  if (typeof candidate.text === "string") {
    return candidate.text.trim();
  }

  return "";
}

export async function loadParakeetTranscriber(options: {
  modelVersion?: string;
  onProgress?: (event: ParakeetProgressEvent) => void;
} = {}): Promise<ParakeetTranscriber> {
  if (sharedTranscriber) {
    return sharedTranscriber;
  }

  if (sharedTranscriberPromise) {
    return sharedTranscriberPromise;
  }

  const modelVersion = options.modelVersion ?? "parakeet-tdt-0.6b-v3";
  const backend: ParakeetBackend = supportsWebGpu() ? "webgpu-hybrid" : "wasm";

  sharedTranscriberPromise = (async () => {
    const module = await importParakeetModule();
    const quantization =
      backend === "wasm"
        ? { encoderQuant: "int8", decoderQuant: "int8", preprocessor: "nemo128" }
        : { encoderQuant: "fp32", decoderQuant: "int8", preprocessor: "nemo128" };

    const model = await module.fromHub(modelVersion, {
      backend,
      ...quantization,
      progress: (rawEvent: unknown) => {
        if (!options.onProgress || !rawEvent || typeof rawEvent !== "object") {
          return;
        }

        const eventCandidate = rawEvent as Record<string, unknown>;
        const file = typeof eventCandidate.file === "string" ? eventCandidate.file : "model";
        const loaded = toFiniteNonNegativeNumber(eventCandidate.loaded);
        const total = toFiniteNonNegativeNumber(eventCandidate.total);
        const progress = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;

        options.onProgress({ file, loaded, total, progress });
      },
    });

    await model.transcribe(new Float32Array(PARAKEET_SAMPLE_RATE), PARAKEET_SAMPLE_RATE);

    const transcriber: ParakeetTranscriber = {
      backend,
      modelVersion,
      transcribe: async (audio, transcribeOptions = {}) => {
        const timeOffsetSeconds = toFiniteNonNegativeNumber(transcribeOptions.timeOffsetSeconds);
        const startTime = performance.now();
        const rawResult = await model.transcribe(audio, PARAKEET_SAMPLE_RATE, {
          returnTimestamps: true,
          returnConfidences: true,
          temperature: 1.0,
          timeOffset: timeOffsetSeconds,
        });
        const endTime = performance.now();

        const latencySeconds = Math.max(0.001, (endTime - startTime) / 1000);
        const audioDurationSeconds = audio.length / PARAKEET_SAMPLE_RATE;
        const rtf = audioDurationSeconds > 0 ? audioDurationSeconds / latencySeconds : 0;
        const text = getTranscriptionText(rawResult);
        const words = normalizeWords(
          rawResult && typeof rawResult === "object"
            ? (rawResult as Record<string, unknown>).words
            : undefined,
        );

        return {
          text,
          words,
          latencySeconds,
          audioDurationSeconds,
          rtf,
        };
      },
    };

    sharedTranscriber = transcriber;
    return transcriber;
  })();

  try {
    return await sharedTranscriberPromise;
  } catch (error) {
    sharedTranscriberPromise = null;
    throw error;
  }
}
