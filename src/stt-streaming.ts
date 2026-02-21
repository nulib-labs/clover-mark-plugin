import {
  PARAKEET_SAMPLE_RATE,
  type ParakeetWord,
  type ParakeetTranscriptionResult,
  type ParakeetTranscriber,
} from "./stt-parakeet";

export type PartialTranscription = {
  fixedText: string;
  activeText: string;
  timestamp: number;
  isFinal: boolean;
  words?: ParakeetWord[];
  metadata?: Pick<ParakeetTranscriptionResult, "latencySeconds" | "audioDurationSeconds" | "rtf">;
};

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class AudioChunkBuffer {
  private audioBuffer = new Float32Array(0);
  private readonly sampleRate: number;

  constructor(sampleRate: number = PARAKEET_SAMPLE_RATE) {
    this.sampleRate = sampleRate;
  }

  appendChunk(chunk: Float32Array): void {
    const nextBuffer = new Float32Array(this.audioBuffer.length + chunk.length);
    nextBuffer.set(this.audioBuffer);
    nextBuffer.set(chunk, this.audioBuffer.length);
    this.audioBuffer = nextBuffer;
  }

  getBuffer(): Float32Array {
    return this.audioBuffer;
  }

  getDurationSeconds(): number {
    return this.audioBuffer.length / this.sampleRate;
  }

  reset(): void {
    this.audioBuffer = new Float32Array(0);
  }
}

export class AudioRecorder {
  private readonly onDataAvailable: (chunk: Float32Array) => void;
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private isRecording = false;

  constructor(onDataAvailable: (chunk: Float32Array) => void) {
    this.onDataAvailable = onDataAvailable;
  }

  async start(): Promise<void> {
    const constraints: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    this.audioContext = new AudioContext();

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    const nativeSampleRate = this.audioContext.sampleRate;
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (event) => {
      if (!this.isRecording) {
        return;
      }

      const mono = event.inputBuffer.getChannelData(0);
      const resampled = this.resample(mono, nativeSampleRate, PARAKEET_SAMPLE_RATE);
      this.onDataAvailable(resampled);
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
    this.isRecording = true;
  }

  async stop(): Promise<void> {
    this.isRecording = false;

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.audioContext && this.audioContext.state !== "closed") {
      await this.audioContext.close();
      this.audioContext = null;
    }
  }

  private resample(
    sourceData: Float32Array,
    sourceSampleRate: number,
    targetSampleRate: number,
  ): Float32Array {
    if (sourceSampleRate === targetSampleRate) {
      return new Float32Array(sourceData);
    }

    const ratio = sourceSampleRate / targetSampleRate;
    const targetLength = Math.round(sourceData.length / ratio);
    const result = new Float32Array(targetLength);

    for (let index = 0; index < targetLength; index += 1) {
      const sourcePosition = index * ratio;
      const left = Math.floor(sourcePosition);
      const right = Math.min(left + 1, sourceData.length - 1);
      const fraction = sourcePosition - left;

      result[index] = sourceData[left] * (1 - fraction) + sourceData[right] * fraction;
    }

    return result;
  }
}

export class ViewerAudioRecorder {
  private readonly onDataAvailable: (chunk: Float32Array) => void;
  private readonly useCaptureStream: boolean;
  private readonly monitorOutput: boolean;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private outputGain: GainNode | null = null;
  private isRecording = false;

  constructor(
    onDataAvailable: (chunk: Float32Array) => void,
    options: Partial<{ useCaptureStream: boolean; monitorOutput: boolean }> = {},
  ) {
    this.onDataAvailable = onDataAvailable;
    this.useCaptureStream = options.useCaptureStream ?? true;
    this.monitorOutput = options.monitorOutput ?? true;
  }

  async startFromElement(element: HTMLAudioElement | HTMLVideoElement): Promise<void> {
    if (!element) {
      throw new Error("No media element is available.");
    }

    this.audioContext = new AudioContext();
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    const nativeSampleRate = this.audioContext.sampleRate;
    const source = this.createSourceFromElement(
      element,
      this.audioContext,
      this.useCaptureStream,
    );
    this.source = source;
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (event) => {
      if (!this.isRecording) {
        return;
      }

      const mono = event.inputBuffer.getChannelData(0);
      const resampled = this.resample(mono, nativeSampleRate, PARAKEET_SAMPLE_RATE);
      this.onDataAvailable(resampled);
    };

    this.source.connect(this.processor);
    if (this.monitorOutput) {
      this.processor.connect(this.audioContext.destination);
    } else {
      this.outputGain = this.audioContext.createGain();
      this.outputGain.gain.value = 0;
      this.processor.connect(this.outputGain);
      this.outputGain.connect(this.audioContext.destination);
    }
    this.isRecording = true;
  }

  async stop(): Promise<void> {
    this.isRecording = false;

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.outputGain) {
      this.outputGain.disconnect();
      this.outputGain = null;
    }
    if (this.audioContext && this.audioContext.state !== "closed") {
      await this.audioContext.close();
      this.audioContext = null;
    }
  }

  private createSourceFromElement(
    element: HTMLAudioElement | HTMLVideoElement,
    audioContext: AudioContext,
    useCaptureStream: boolean,
  ): MediaStreamAudioSourceNode | MediaElementAudioSourceNode {
    if (useCaptureStream) {
      const mediaElementWithCapture = element as HTMLMediaElement & {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
      };

      const streamFactory =
        mediaElementWithCapture.captureStream ?? mediaElementWithCapture.mozCaptureStream;
      if (typeof streamFactory === "function") {
        const stream = streamFactory.call(mediaElementWithCapture);
        if (stream && stream.getAudioTracks().length > 0) {
          return audioContext.createMediaStreamSource(stream);
        }
      }
    }

    return audioContext.createMediaElementSource(element);
  }

  private resample(
    sourceData: Float32Array,
    sourceSampleRate: number,
    targetSampleRate: number,
  ): Float32Array {
    if (sourceSampleRate === targetSampleRate) {
      return new Float32Array(sourceData);
    }

    const ratio = sourceSampleRate / targetSampleRate;
    const targetLength = Math.round(sourceData.length / ratio);
    const result = new Float32Array(targetLength);

    for (let index = 0; index < targetLength; index += 1) {
      const sourcePosition = index * ratio;
      const left = Math.floor(sourcePosition);
      const right = Math.min(left + 1, sourceData.length - 1);
      const fraction = sourcePosition - left;

      result[index] = sourceData[left] * (1 - fraction) + sourceData[right] * fraction;
    }

    return result;
  }
}

type StreamingOptions = {
  emissionIntervalSeconds?: number;
  maxWindowSeconds?: number;
  sentenceBufferSeconds?: number;
  sampleRate?: number;
};

export class SmartProgressiveStreamingHandler {
  private readonly model: Pick<ParakeetTranscriber, "transcribe">;
  private readonly emissionIntervalSeconds: number;
  private readonly maxWindowSeconds: number;
  private readonly sentenceBufferSeconds: number;
  private readonly sampleRate: number;
  private fixedSentences: string[] = [];
  private fixedWords: ParakeetWord[] = [];
  private fixedEndTime = 0;
  private lastTranscribedLength = 0;

  constructor(
    model: Pick<ParakeetTranscriber, "transcribe">,
    options: StreamingOptions = {},
  ) {
    this.model = model;
    this.emissionIntervalSeconds = options.emissionIntervalSeconds ?? 0.5;
    this.maxWindowSeconds = options.maxWindowSeconds ?? 15;
    this.sentenceBufferSeconds = options.sentenceBufferSeconds ?? 2;
    this.sampleRate = options.sampleRate ?? PARAKEET_SAMPLE_RATE;
  }

  reset(): void {
    this.fixedSentences = [];
    this.fixedWords = [];
    this.fixedEndTime = 0;
    this.lastTranscribedLength = 0;
  }

  async transcribeIncremental(audio: Float32Array): Promise<PartialTranscription> {
    if (audio.length < this.sampleRate * 0.5 || audio.length === this.lastTranscribedLength) {
      return {
        fixedText: this.fixedSentences.join(" "),
        activeText: "",
        timestamp: audio.length / this.sampleRate,
        isFinal: false,
        words: [...this.fixedWords],
      };
    }

    this.lastTranscribedLength = audio.length;
    const windowBaseTime = this.fixedEndTime;
    const startSamples = Math.floor(windowBaseTime * this.sampleRate);
    const transcriptionWindow = audio.slice(startSamples);
    let result = await this.model.transcribe(transcriptionWindow);
    let activeWindowBaseTime = windowBaseTime;

    const windowDuration = transcriptionWindow.length / this.sampleRate;
    if (windowDuration >= this.maxWindowSeconds && result.words.length > 0) {
      const cutoff = windowDuration - this.sentenceBufferSeconds;
      const lockableWords = result.words.filter((word) => word.end_time < cutoff);

      if (lockableWords.length > 0) {
        const lockableText = lockableWords.map((word) => word.text).join(" ").trim();
        if (lockableText) {
          this.fixedSentences.push(lockableText);
        }
        this.fixedWords.push(
          ...lockableWords.map((word) => ({
            ...word,
            start_time: windowBaseTime + word.start_time,
            end_time: windowBaseTime + word.end_time,
          })),
        );

        this.fixedEndTime += lockableWords[lockableWords.length - 1].end_time;
        const nextStartSamples = Math.floor(this.fixedEndTime * this.sampleRate);
        result = await this.model.transcribe(audio.slice(nextStartSamples));
        activeWindowBaseTime = this.fixedEndTime;
      }
    }

    const activeWords = result.words.map((word) => ({
      ...word,
      start_time: activeWindowBaseTime + word.start_time,
      end_time: activeWindowBaseTime + word.end_time,
    }));

    return {
      fixedText: this.fixedSentences.join(" ").trim(),
      activeText: result.text.trim(),
      timestamp: audio.length / this.sampleRate,
      isFinal: false,
      words: [...this.fixedWords, ...activeWords],
      metadata: {
        latencySeconds: result.latencySeconds,
        audioDurationSeconds: result.audioDurationSeconds,
        rtf: result.rtf,
      },
    };
  }

  async *transcribeProgressive(audio: Float32Array): AsyncGenerator<PartialTranscription> {
    this.reset();

    const totalDuration = audio.length / this.sampleRate;
    let currentTime = 0;
    while (currentTime < totalDuration) {
      currentTime += this.emissionIntervalSeconds;
      const currentSamples = Math.min(
        Math.floor(currentTime * this.sampleRate),
        audio.length,
      );
      yield await this.transcribeIncremental(audio.slice(0, currentSamples));
      await pause(this.emissionIntervalSeconds * 1000);
    }

    const finalResult = await this.transcribeIncremental(audio);
    yield {
      ...finalResult,
      isFinal: true,
    };
  }

  async *transcribeBatch(audio: Float32Array): AsyncGenerator<PartialTranscription> {
    this.reset();

    const totalDuration = audio.length / this.sampleRate;
    let processedUpTo = 0;
    const minimumProgressSeconds = Math.max(0.25, 1 / this.sampleRate);

    while (processedUpTo < totalDuration) {
      const windowStart = processedUpTo;
      const windowEnd = Math.min(processedUpTo + this.maxWindowSeconds, totalDuration);
      const windowDuration = windowEnd - windowStart;

      const windowStartSamples = Math.floor(windowStart * this.sampleRate);
      const windowEndSamples = Math.floor(windowEnd * this.sampleRate);
      const audioWindow = audio.slice(windowStartSamples, windowEndSamples);
      const result = await this.model.transcribe(audioWindow);
      const toAbsoluteWord = (word: ParakeetWord): ParakeetWord => ({
        ...word,
        start_time: windowStart + word.start_time,
        end_time: windowStart + word.end_time,
      });

      if (windowDuration >= this.maxWindowSeconds) {
        const cutoff = windowDuration - this.sentenceBufferSeconds;
        const lockableWords = result.words.filter((word) => word.end_time < cutoff);

        if (lockableWords.length > 0) {
          const fixedTextChunk = lockableWords.map((word) => word.text).join(" ").trim();
          if (fixedTextChunk) {
            this.fixedSentences.push(fixedTextChunk);
          }
          this.fixedWords.push(...lockableWords.map(toAbsoluteWord));

          processedUpTo = windowStart + lockableWords[lockableWords.length - 1].end_time;
          if (processedUpTo <= windowStart) {
            processedUpTo = Math.min(windowEnd, windowStart + minimumProgressSeconds);
          }
          const activeText = result.words
            .filter((word) => word.end_time >= cutoff)
            .map((word) => word.text)
            .join(" ")
            .trim();
          const activeWords = result.words
            .filter((word) => word.end_time >= cutoff)
            .map(toAbsoluteWord);

          yield {
            fixedText: this.fixedSentences.join(" ").trim(),
            activeText,
            timestamp: windowEnd,
            isFinal: false,
            words: [...this.fixedWords, ...activeWords],
            metadata: {
              latencySeconds: result.latencySeconds,
              audioDurationSeconds: result.audioDurationSeconds,
              rtf: result.rtf,
            },
          };
          continue;
        }

        const halfText = result.text.trim();
        if (halfText) {
          this.fixedSentences.push(halfText);
        }
        processedUpTo = windowStart + windowDuration / 2;
        if (processedUpTo <= windowStart) {
          processedUpTo = Math.min(windowEnd, windowStart + minimumProgressSeconds);
        }

        yield {
          fixedText: this.fixedSentences.join(" ").trim(),
          activeText: "",
          timestamp: windowEnd,
          isFinal: false,
          words: [...this.fixedWords, ...result.words.map(toAbsoluteWord)],
          metadata: {
            latencySeconds: result.latencySeconds,
            audioDurationSeconds: result.audioDurationSeconds,
            rtf: result.rtf,
          },
        };
        continue;
      }

      const finalText = result.text.trim();
      if (finalText) {
        this.fixedSentences.push(finalText);
      }
      this.fixedWords.push(...result.words.map(toAbsoluteWord));
      processedUpTo = windowEnd;

      yield {
        fixedText: this.fixedSentences.join(" ").trim(),
        activeText: "",
        timestamp: windowEnd,
        isFinal: true,
        words: [...this.fixedWords],
        metadata: {
          latencySeconds: result.latencySeconds,
          audioDurationSeconds: result.audioDurationSeconds,
          rtf: result.rtf,
        },
      };
    }
  }

  async transcribeBatchLatest(audio: Float32Array): Promise<PartialTranscription> {
    let last: PartialTranscription | null = null;

    for await (const partial of this.transcribeBatch(audio)) {
      last = partial;
    }

    if (last) {
      return last;
    }

    return {
      fixedText: "",
      activeText: "",
      timestamp: audio.length / this.sampleRate,
      isFinal: false,
    };
  }

  async finalize(audio: Float32Array): Promise<string> {
    const result = await this.transcribeIncremental(audio);
    return [result.fixedText, result.activeText].filter((part) => part.trim().length > 0).join(" ").trim();
  }
}
