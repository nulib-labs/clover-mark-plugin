export type WebVttCue = {
  identifier?: string;
  start_time: number;
  end_time: number;
  text: string;
};

export type TimedWordLike = {
  text: string;
  start_time: number;
  end_time: number;
};

export type CaptionSegmentationOptions = {
  maxCueChars?: number;
  maxCueDurationSeconds?: number;
  minCueDurationSeconds?: number;
  maxWordsPerCue?: number;
  maxInterWordGapSeconds?: number;
};

const WEBVTT_HEADER = /^WEBVTT(?:[ \t].*)?$/i;
const WEBVTT_TIMING_LINE = /^([^\s]+)\s+-->\s+([^\s]+)(?:\s+.*)?$/;
const WEBVTT_TIMESTAMP = /^(?:(\d+):)?(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/;

type WebVttBodyLike = Partial<{ format: unknown; value: unknown }> | null | undefined;

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function normalizeCueText(value: string): string {
  return decodeBasicHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

function endsWithSentencePunctuation(value: string): boolean {
  return /[.!?]["')\]]*$/.test(value.trim());
}

function endsWithSoftPunctuation(value: string): boolean {
  return /[,;:]["')\]]*$/.test(value.trim());
}

function startsWithUppercase(value: string): boolean {
  const trimmed = value.trim();
  return /^[A-Z]/.test(trimmed);
}

function splitCueWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9'-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

const CONNECTOR_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "been",
  "being",
  "but",
  "by",
  "for",
  "from",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "our",
  "so",
  "that",
  "the",
  "their",
  "then",
  "these",
  "this",
  "those",
  "to",
  "was",
  "were",
  "which",
  "with",
]);

function startsWithConnector(value: string): boolean {
  const first = splitCueWords(value)[0];
  return typeof first === "string" && CONNECTOR_WORDS.has(first);
}

function endsWithConnector(value: string): boolean {
  const words = splitCueWords(value);
  const last = words[words.length - 1];
  return typeof last === "string" && CONNECTOR_WORDS.has(last);
}

function isDanglingCueText(value: string): boolean {
  const words = splitCueWords(value);
  if (words.length === 0) {
    return true;
  }
  if (words.length === 1) {
    return CONNECTOR_WORDS.has(words[0]);
  }
  if (words.length <= 3 && words.every((word) => CONNECTOR_WORDS.has(word))) {
    return true;
  }

  return endsWithConnector(value);
}

function buildCueTextFromWords(words: TimedWordLike[]): string {
  return normalizeCueText(words.map((word) => word.text).join(" "));
}

function toFiniteNonNegativeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

function normalizeTimedWord(value: TimedWordLike): TimedWordLike | null {
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (!text) {
    return null;
  }

  const start = toFiniteNonNegativeNumber(value.start_time);
  const endCandidate = toFiniteNonNegativeNumber(value.end_time);
  const end = Math.max(start, endCandidate);
  return {
    text,
    start_time: +start.toFixed(3),
    end_time: +end.toFixed(3),
  };
}

function parseTimestamp(rawValue: string): number | null {
  const value = rawValue.trim();
  if (!value) {
    return null;
  }

  const match = value.match(WEBVTT_TIMESTAMP);
  if (!match) {
    return null;
  }

  const hours = Number.parseInt(match[1] ?? "0", 10);
  const minutes = Number.parseInt(match[2] ?? "0", 10);
  const seconds = Number.parseInt(match[3] ?? "0", 10);
  const millisecondsText = (match[4] ?? "0").padEnd(3, "0").slice(0, 3);
  const milliseconds = Number.parseInt(millisecondsText, 10);

  if (
    !Number.isFinite(hours)
    || !Number.isFinite(minutes)
    || !Number.isFinite(seconds)
    || !Number.isFinite(milliseconds)
  ) {
    return null;
  }

  return Math.max(0, hours * 3600 + minutes * 60 + seconds + milliseconds / 1000);
}

function formatTimestamp(secondsValue: number): string {
  const totalMilliseconds = Math.max(0, Math.round(secondsValue * 1000));
  const hours = Math.floor(totalMilliseconds / 3600000);
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000);
  const seconds = Math.floor((totalMilliseconds % 60000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0"),
  ].join(":") + `.${String(milliseconds).padStart(3, "0")}`;
}

function sanitizeCue(cue: WebVttCue): WebVttCue | null {
  const text = cue.text.trim();
  if (!text) {
    return null;
  }

  const start = toFiniteNonNegativeNumber(cue.start_time);
  const endCandidate = toFiniteNonNegativeNumber(cue.end_time);
  const end = endCandidate > start ? endCandidate : +(start + 0.001).toFixed(3);

  return {
    ...(typeof cue.identifier === "string" && cue.identifier.trim().length > 0
      ? { identifier: cue.identifier.trim() }
      : {}),
    start_time: +start.toFixed(3),
    end_time: +end.toFixed(3),
    text,
  };
}

export function segmentWordsIntoWebVttCues(
  inputWords: TimedWordLike[],
  options: CaptionSegmentationOptions = {},
): WebVttCue[] {
  const maxCueChars = Math.max(28, options.maxCueChars ?? 56);
  const maxCueDurationSeconds = Math.max(2.5, options.maxCueDurationSeconds ?? 6.5);
  const hardMaxCueDurationSeconds = Math.max(maxCueDurationSeconds + 1.5, maxCueDurationSeconds * 1.35);
  const minCueDurationSeconds = Math.max(0.9, options.minCueDurationSeconds ?? 1.4);
  const maxWordsPerCue = Math.max(3, options.maxWordsPerCue ?? 16);
  const maxInterWordGapSeconds = Math.max(0.1, options.maxInterWordGapSeconds ?? 1.1);

  const words = inputWords
    .map((word) => normalizeTimedWord(word))
    .filter((word): word is TimedWordLike => Boolean(word))
    .sort((left, right) => {
      if (left.start_time !== right.start_time) {
        return left.start_time - right.start_time;
      }
      return left.end_time - right.end_time;
    });

  if (words.length === 0) {
    return [];
  }

  const groups: TimedWordLike[][] = [];
  let currentWords: TimedWordLike[] = [];

  const flushCurrent = () => {
    if (currentWords.length === 0) {
      return;
    }
    groups.push(currentWords);
    currentWords = [];
  };

  for (const word of words) {
    if (currentWords.length === 0) {
      currentWords.push(word);
      continue;
    }

    const previous = currentWords[currentWords.length - 1];
    const cueStart = currentWords[0].start_time;
    const cueDuration = Math.max(0, previous.end_time - cueStart);
    const interWordGap = Math.max(0, word.start_time - previous.end_time);
    const nextDuration = Math.max(0, word.end_time - cueStart);
    const nextText = buildCueTextFromWords([...currentWords, word]);
    const currentText = buildCueTextFromWords(currentWords);
    const currentEndsSentence = endsWithSentencePunctuation(previous.text);
    const currentEndsSoft = endsWithSoftPunctuation(previous.text);
    const nextStartsConnector = startsWithConnector(word.text);
    const currentIsDangling = isDanglingCueText(currentText);
    const currentEndsConnector = endsWithConnector(currentText);

    const shouldBreakOnHardLimit =
      interWordGap > maxInterWordGapSeconds * 1.8
      || (currentWords.length >= 3 && nextDuration > hardMaxCueDurationSeconds)
      || (currentWords.length >= 4 && nextText.length > Math.round(maxCueChars * 1.65))
      || currentWords.length >= maxWordsPerCue + 4;
    const shouldBreakOnSoftLimit =
      interWordGap > maxInterWordGapSeconds
      || (currentWords.length >= 2 && nextDuration > maxCueDurationSeconds)
      || (currentWords.length >= 3 && nextText.length > maxCueChars)
      || currentWords.length >= maxWordsPerCue;
    const shouldBreakOnNaturalBoundary =
      cueDuration >= minCueDurationSeconds
      && (
        currentEndsSentence
        || (
          currentEndsSoft
          && (nextText.length > Math.round(maxCueChars * 0.72) || nextDuration > maxCueDurationSeconds * 0.7)
        )
      );
    const shouldAvoidSoftBreak =
      currentWords.length < 3
      || currentIsDangling
      || currentEndsConnector
      || nextStartsConnector;

    if (shouldBreakOnHardLimit || shouldBreakOnNaturalBoundary || (shouldBreakOnSoftLimit && !shouldAvoidSoftBreak)) {
      flushCurrent();
    }

    currentWords.push(word);
  }

  flushCurrent();

  if (groups.length <= 1) {
    return groups.map((group) => {
      const first = group[0];
      const last = group[group.length - 1];
      return {
        start_time: first.start_time,
        end_time: Math.max(first.start_time + 0.001, last.end_time),
        text: buildCueTextFromWords(group),
      };
    });
  }

  // Merge orphan/dangling fragments (e.g. a trailing "of") into neighboring cues.
  const canMerge = (left: TimedWordLike[], right: TimedWordLike[]): boolean => {
    const merged = [...left, ...right];
    const mergedText = buildCueTextFromWords(merged);
    const duration = merged[merged.length - 1].end_time - merged[0].start_time;
    return mergedText.length <= Math.round(maxCueChars * 1.75)
      && duration <= hardMaxCueDurationSeconds * 1.5;
  };

  for (let index = 0; index < groups.length; index += 1) {
    const currentGroup = groups[index];
    const currentText = buildCueTextFromWords(currentGroup);
    const currentIsDangling =
      isDanglingCueText(currentText)
      || (splitCueWords(currentText).length <= 2 && !endsWithSentencePunctuation(currentText));
    const nextGroup = groups[index + 1];
    const previousGroup = groups[index - 1];
    const nextText = nextGroup ? buildCueTextFromWords(nextGroup) : "";

    if (nextGroup && (endsWithConnector(currentText) || startsWithConnector(nextText)) && canMerge(currentGroup, nextGroup)) {
      groups[index] = [...currentGroup, ...nextGroup];
      groups.splice(index + 1, 1);
      index -= 1;
      continue;
    }

    if (currentIsDangling && previousGroup && canMerge(previousGroup, currentGroup)) {
      groups[index - 1] = [...previousGroup, ...currentGroup];
      groups.splice(index, 1);
      index -= 1;
      continue;
    }

    if (
      currentIsDangling
      && nextGroup
      && startsWithUppercase(nextText)
      && canMerge(currentGroup, nextGroup)
    ) {
      groups[index] = [...currentGroup, ...nextGroup];
      groups.splice(index + 1, 1);
      index -= 1;
    }
  }

  return groups
    .map((group) => {
      const text = buildCueTextFromWords(group);
      if (!text) {
        return null;
      }
      const first = group[0];
      const last = group[group.length - 1];
      return {
        start_time: first.start_time,
        end_time: Math.max(first.start_time + 0.001, last.end_time),
        text,
      };
    })
    .filter((cue): cue is WebVttCue => Boolean(cue));
}

export function isWebVttFormat(format: unknown): boolean {
  if (typeof format !== "string") {
    return false;
  }

  const normalized = format.trim().toLowerCase();
  return normalized === "text/vtt" || normalized === "text/webvtt";
}

export function looksLikeWebVtt(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = normalizeLineEndings(value).replace(/^\uFEFF/, "").trimStart();
  const firstLine = normalized.split("\n", 1)[0]?.trim() ?? "";
  return WEBVTT_HEADER.test(firstLine);
}

export function isWebVttBody(body: WebVttBodyLike): boolean {
  if (!body || typeof body !== "object") {
    return false;
  }

  return isWebVttFormat(body.format) || looksLikeWebVtt(body.value);
}

export function parseWebVttCues(rawValue: string): WebVttCue[] {
  const normalized = normalizeLineEndings(rawValue).replace(/^\uFEFF/, "");
  const trimmed = normalized.trim();
  if (!trimmed) {
    return [];
  }

  const blocks = trimmed.split(/\n{2,}/);
  if (blocks.length === 0) {
    return [];
  }

  const headerLine = blocks[0].split("\n", 1)[0]?.trim() ?? "";
  if (!WEBVTT_HEADER.test(headerLine)) {
    return [];
  }

  const cues: WebVttCue[] = [];

  for (const rawBlock of blocks.slice(1)) {
    const block = rawBlock.trim();
    if (!block) {
      continue;
    }

    const lines = block.split("\n").map((line) => line.trimEnd());
    if (lines.length === 0) {
      continue;
    }

    const firstLine = lines[0].trim();
    if (
      firstLine.startsWith("NOTE")
      || firstLine === "STYLE"
      || firstLine === "REGION"
    ) {
      continue;
    }

    let timingIndex = -1;
    for (let index = 0; index < Math.min(lines.length, 2); index += 1) {
      if (lines[index].includes("-->")) {
        timingIndex = index;
        break;
      }
    }

    if (timingIndex < 0) {
      continue;
    }

    const timingLine = lines[timingIndex].trim();
    const timingMatch = timingLine.match(WEBVTT_TIMING_LINE);
    if (!timingMatch) {
      continue;
    }

    const start = parseTimestamp(timingMatch[1]);
    const end = parseTimestamp(timingMatch[2]);
    if (start === null || end === null || end < start) {
      continue;
    }

    const cueText = normalizeCueText(lines.slice(timingIndex + 1).join(" "));
    if (!cueText) {
      continue;
    }

    const identifier = timingIndex > 0 ? lines[0].trim() : undefined;
    cues.push({
      ...(identifier ? { identifier } : {}),
      start_time: +start.toFixed(3),
      end_time: +end.toFixed(3),
      text: cueText,
    });
  }

  return cues;
}

export function serializeWebVttCues(input: WebVttCue[]): string {
  const cues = input
    .map((cue) => sanitizeCue(cue))
    .filter((cue): cue is WebVttCue => Boolean(cue))
    .sort((left, right) => {
      if (left.start_time !== right.start_time) {
        return left.start_time - right.start_time;
      }
      return left.end_time - right.end_time;
    });

  if (cues.length === 0) {
    return "WEBVTT\n\n";
  }

  const lines: string[] = ["WEBVTT", ""];
  for (const cue of cues) {
    if (cue.identifier) {
      lines.push(cue.identifier);
    }
    lines.push(`${formatTimestamp(cue.start_time)} --> ${formatTimestamp(cue.end_time)}`);
    lines.push(cue.text);
    lines.push("");
  }

  return `${lines.join("\n").replace(/\n+$/, "\n")}`;
}
