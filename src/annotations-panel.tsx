import * as React from "react";
import type { PluginInformationPanel } from "@samvera/clover-iiif";
import { useTranslation } from "react-i18next";
import { ANNOTATIONS_I18N_NAMESPACE } from "./i18n";
import {
  getAllStoredCanvasAnnotations,
  getCanvasAnnotator,
  registerCanvasAnnotator,
  setCanvasBridgeState,
  useCanvasRuntimeState,
} from "./annotation-runtime";
import {
  buildAnnotationPageExport,
  downloadAnnotationPageExport,
  downloadWebVttExport,
} from "./annotation-export";
import { getPrimaryMotivation } from "./motivation";
import { buildTemporalTarget, createMediaCanvasAnnotator } from "./media-annotator";
import {
  loadParakeetTranscriber,
  PARAKEET_SAMPLE_RATE,
  type ParakeetWord,
  type ParakeetTranscriber,
} from "./stt-parakeet";
import {
  AudioChunkBuffer,
  AudioRecorder,
  SmartProgressiveStreamingHandler,
  ViewerAudioRecorder,
} from "./stt-streaming";
import {
  isWebVttBody,
  parseWebVttCues,
  segmentWordsIntoWebVttCues,
  serializeWebVttCues,
} from "./webvtt";

type CanvasLike = {
  id: string;
  type?: string;
  label?: unknown;
  thumbnail?: Array<{ id: string; format?: string }>;
  items?: Array<unknown>;
  annotations?: Array<unknown>;
};

type ManifestLike = {
  items?: Array<unknown>;
};

type AnnotationLike = {
  id?: string;
  bodies?: Array<{ purpose?: string; value?: string; language?: string; [key: string]: unknown }>;
  body?: unknown;
  target?: unknown;
  motivation?: string | string[];
};

type AnnotationBody = {
  purpose?: string;
  value?: string;
  language?: string;
  [key: string]: unknown;
};

type CanvasMediaType = "image" | "video" | "audio" | "unknown";

type ViewerStateLike = {
  activeCanvas?: string;
  activeManifest?: string;
  visibleAnnotations?: Array<unknown>;
  vault: { get: (idOrRef: unknown) => unknown };
};

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function getFirstBody(body: unknown): Record<string, unknown> | undefined {
  if (!body) {
    return undefined;
  }

  const firstBody = ensureArray(body)[0];
  if (!firstBody || typeof firstBody !== "object") {
    return undefined;
  }

  return firstBody as Record<string, unknown>;
}

type VaultLike = { get: (idOrRef: any) => unknown };

function detectCanvasMediaType(canvas: CanvasLike, vault: VaultLike): CanvasMediaType {
  const firstPageRef = canvas.items?.[0];
  const page = firstPageRef
    ? (vault.get(firstPageRef) as { items?: Array<unknown> } | undefined)
    : undefined;
  const firstAnnotationRef = page?.items?.[0];
  const annotation = firstAnnotationRef
    ? (vault.get(firstAnnotationRef) as AnnotationLike | undefined)
    : undefined;
  const body = getFirstBody(annotation?.body);

  const type = typeof body?.type === "string" ? body.type.toLowerCase() : "";
  if (type === "video") {
    return "video";
  }
  if (type === "sound" || type === "audio") {
    return "audio";
  }
  if (type === "image") {
    return "image";
  }

  const format = typeof body?.format === "string" ? body.format.toLowerCase() : "";
  if (format.startsWith("video/")) {
    return "video";
  }
  if (format.startsWith("audio/")) {
    return "audio";
  }
  if (format.startsWith("image/")) {
    return "image";
  }

  return "unknown";
}

function getCanvasMediaBodyUrl(canvas: CanvasLike, vault: VaultLike): string | null {
  const firstPageRef = canvas.items?.[0];
  const page = firstPageRef
    ? (vault.get(firstPageRef) as { items?: Array<unknown> } | undefined)
    : undefined;
  const firstAnnotationRef = page?.items?.[0];
  const annotation = firstAnnotationRef
    ? (vault.get(firstAnnotationRef) as AnnotationLike | undefined)
    : undefined;
  const body = getFirstBody(annotation?.body);
  const mediaId = typeof body?.id === "string" ? body.id.trim() : "";

  return mediaId.length > 0 ? mediaId : null;
}

function updateBodyValue(
  bodies: Array<{ purpose?: string; value?: string; language?: string; [key: string]: unknown }>,
  purpose: string,
  value: string,
) {
  const index = bodies.findIndex((body) => body?.purpose === purpose);
  const trimmed = value.trim();

  if (!trimmed) {
    if (index >= 0) {
      bodies.splice(index, 1);
    }
    return;
  }

  const nextBody = {
    type: "TextualBody",
    purpose,
    value: trimmed,
  };

  if (index >= 0) {
    bodies[index] = { ...bodies[index], ...nextBody };
    return;
  }

  bodies.push(nextBody);
}

function normalizeLanguageValue(language: unknown): string | undefined {
  return typeof language === "string" && language.trim().length > 0
    ? language.trim().toLowerCase()
    : undefined;
}

function getTranslationBodies(
  bodies: Array<{ purpose?: string; value?: string; language?: string; [key: string]: unknown }>,
): Array<{ purpose: "supplementing" | "translating"; value: string; language?: string }> {
  return bodies.reduce<
    Array<{ purpose: "supplementing" | "translating"; value: string; language?: string }>
  >((acc, body) => {
    const purpose =
      body.purpose === "translating"
        ? "translating"
        : body.purpose === "supplementing"
          ? "supplementing"
          : undefined;
    if (!purpose) {
      return acc;
    }

    if (isWebVttBody(body)) {
      return acc;
    }

    const value = typeof body.value === "string" ? body.value.trim() : "";
    if (!value) {
      return acc;
    }

    const language = normalizeLanguageValue(body.language);

    acc.push({ purpose, value, language });
    return acc;
  }, []);
}

function getSupplementingBodies(
  bodies: Array<{ purpose?: string; value?: string; language?: string; [key: string]: unknown }>,
): Array<{ value: string; language?: string }> {
  return getTranslationBodies(bodies)
    .filter((translation) => translation.purpose === "supplementing")
    .map((translation) => ({
      value: translation.value,
      language: translation.language,
    }));
}

function replaceSupplementingBodies(
  bodies: Array<{ purpose?: string; value?: string; language?: string; [key: string]: unknown }>,
  translations: Array<{ value: string; language?: string }>,
) {
  const preserved = bodies.filter(
    (body) => body.purpose !== "supplementing" || isWebVttBody(body),
  );

  const normalizedTranslations = translations
    .map((translation) => {
      const value = translation.value.trim();
      if (!value) {
        return undefined;
      }

      const language = normalizeLanguageValue(translation.language);

      return {
        type: "TextualBody",
        purpose: "supplementing",
        value,
        ...(language ? { language } : {}),
      };
    })
    .filter(
      (
        body,
      ): body is {
        type: "TextualBody";
        purpose: "supplementing";
        value: string;
        language?: string;
      } => Boolean(body),
    );

  return [...preserved, ...normalizedTranslations];
}

const STT_TIMED_WORDS_SCHEMA = "clover.parakeet.word_timestamps.v1";
const STT_TIMED_WORDS_BODY_PURPOSE = "describing";
const STT_TIMED_WORDS_BODY_FORMAT = "application/json";
const WEBVTT_BODY_FORMAT = "text/vtt";

type TimedTranscriptStorage = "json" | "vtt";

type TimedTranscriptWord = {
  text: string;
  start_time: number;
  end_time: number;
  confidence?: number;
};

type TimedTranscriptPayload = {
  schema: typeof STT_TIMED_WORDS_SCHEMA;
  language?: string;
  words: TimedTranscriptWord[];
};

type RemoteWebVttPayloadById = Record<string, TimedTranscriptPayload | null>;

function getAnnotationBodies(
  annotation: Partial<{ bodies?: AnnotationBody[]; body?: unknown }>,
): AnnotationBody[] {
  const rawBodies = Array.isArray(annotation.bodies)
    ? annotation.bodies
    : ensureArray(annotation.body as AnnotationBody | AnnotationBody[] | undefined);

  return rawBodies
    .filter((body): body is AnnotationBody => Boolean(body && typeof body === "object"))
    .map((body) => ({ ...body }));
}

function parseTemporalRangeFromSelectorText(value: string): { start: number; end: number } | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const fragment = normalized.includes("#")
    ? normalized.slice(normalized.indexOf("#") + 1)
    : normalized;
  const temporalPart = fragment
    .split("&")
    .map((part) => part.trim())
    .find((part) => part.startsWith("t="));
  if (!temporalPart) {
    return null;
  }

  const rawTemporal = temporalPart.slice(2);
  const rawWithoutNpt = rawTemporal.startsWith("npt:") ? rawTemporal.slice(4) : rawTemporal;
  const [rawStart, rawEnd] = rawWithoutNpt.split(",", 2).map((part) => part.trim());
  const start = Number.parseFloat(rawStart);
  if (!Number.isFinite(start)) {
    return null;
  }

  const parsedEnd = Number.parseFloat(rawEnd ?? "");
  const end = Number.isFinite(parsedEnd) && parsedEnd >= start ? parsedEnd : start;
  return {
    start: Math.max(0, start),
    end: Math.max(0, end),
  };
}

function parseTemporalRangeFromTarget(target: unknown): { start: number; end: number } | null {
  if (!target) {
    return null;
  }

  if (typeof target === "string") {
    return parseTemporalRangeFromSelectorText(target);
  }

  if (typeof target !== "object") {
    return null;
  }

  const typedTarget = target as { selector?: unknown; source?: unknown; id?: unknown };
  if (typeof typedTarget.selector === "string") {
    return parseTemporalRangeFromSelectorText(typedTarget.selector);
  }
  if (typedTarget.selector && typeof typedTarget.selector === "object") {
    const selectorValue = (typedTarget.selector as { value?: unknown }).value;
    if (typeof selectorValue === "string") {
      return parseTemporalRangeFromSelectorText(selectorValue);
    }
  }
  if (typeof typedTarget.source === "string") {
    const fromSource = parseTemporalRangeFromSelectorText(typedTarget.source);
    if (fromSource) {
      return fromSource;
    }
  }
  if (typeof typedTarget.id === "string") {
    return parseTemporalRangeFromSelectorText(typedTarget.id);
  }

  return null;
}

function toFiniteNonNegativeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

function normalizeTimedTranscriptWords(rawWords: unknown): TimedTranscriptWord[] {
  if (!Array.isArray(rawWords)) {
    return [];
  }

  return rawWords
    .map((rawWord): TimedTranscriptWord | undefined => {
      if (!rawWord || typeof rawWord !== "object") {
        return undefined;
      }

      const candidate = rawWord as Record<string, unknown>;
      const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
      if (!text) {
        return undefined;
      }

      const start = toFiniteNonNegativeNumber(candidate.start_time);
      const end = Math.max(start, toFiniteNonNegativeNumber(candidate.end_time));
      const confidence = typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)
        ? candidate.confidence
        : undefined;

      return {
        text,
        start_time: start,
        end_time: end,
        confidence,
      };
    })
    .filter((word): word is TimedTranscriptWord => Boolean(word));
}

function buildApproximateTimedWordsFromText(
  text: string,
  start: number,
  end: number,
): TimedTranscriptWord[] {
  const tokens = text
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return [];
  }

  const normalizedStart = Math.max(0, Number.isFinite(start) ? start : 0);
  const normalizedEnd = Number.isFinite(end) ? Math.max(normalizedStart, end) : normalizedStart;
  const minimumDuration = Math.max(0.4, tokens.length * 0.28);
  const effectiveEnd = Math.max(normalizedEnd, normalizedStart + minimumDuration);
  const stride = (effectiveEnd - normalizedStart) / tokens.length;

  return tokens.map((token, index) => {
    const tokenStart = normalizedStart + stride * index;
    const tokenEnd = index === tokens.length - 1
      ? effectiveEnd
      : normalizedStart + stride * (index + 1);
    return {
      text: token,
      start_time: +tokenStart.toFixed(3),
      end_time: +Math.max(tokenStart, tokenEnd).toFixed(3),
    };
  });
}

function buildApproximateTimedPayloadFromText(
  text: string,
  language: string | undefined,
  start: number,
  end: number,
): TimedTranscriptPayload | null {
  const words = buildApproximateTimedWordsFromText(text, start, end);
  if (words.length === 0) {
    return null;
  }

  const normalizedLanguage =
    typeof language === "string" && language.trim().length > 0
      ? language.trim().toLowerCase()
      : undefined;
  return {
    schema: STT_TIMED_WORDS_SCHEMA,
    ...(normalizedLanguage ? { language: normalizedLanguage } : {}),
    words,
  };
}

function buildApproximateTimedPayloadFromAnnotation(
  annotation: Partial<{ target?: unknown; bodies?: AnnotationBody[]; body?: unknown }>,
): TimedTranscriptPayload | null {
  const range = parseTemporalRangeFromTarget(annotation.target);
  const bodies = getAnnotationBodies(annotation);
  const supplementing = getSupplementingBodies(bodies);
  const primary = supplementing[0];
  if (!primary || !primary.value.trim()) {
    return null;
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? start;
  return buildApproximateTimedPayloadFromText(
    primary.value,
    primary.language,
    start,
    end,
  );
}

function buildTimedTranscriptText(words: TimedTranscriptWord[]): string {
  const joined = words
    .map((word) => word.text.trim())
    .filter((text) => text.length > 0)
    .join(" ")
    .trim();
  if (!joined) {
    return "";
  }

  return joined
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");
}

function parseTimedTranscriptPayload(rawValue: string): TimedTranscriptPayload | null {
  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    if (parsed?.schema !== STT_TIMED_WORDS_SCHEMA) {
      return null;
    }

    const words = normalizeTimedTranscriptWords(parsed.words);
    if (words.length === 0) {
      return null;
    }

    const language = normalizeLanguageValue(parsed.language);

    return {
      schema: STT_TIMED_WORDS_SCHEMA,
      language,
      words,
    };
  } catch {
    return null;
  }
}

function parseWebVttPayload(rawValue: string, language: unknown): TimedTranscriptPayload | null {
  const cues = parseWebVttCues(rawValue);
  if (cues.length === 0) {
    return null;
  }

  const words = normalizeTimedTranscriptWords(
    cues.map((cue) => ({
      text: cue.text,
      start_time: cue.start_time,
      end_time: cue.end_time,
    })),
  );
  if (words.length === 0) {
    return null;
  }

  const normalizedLanguage = normalizeLanguageValue(language);
  return {
    schema: STT_TIMED_WORDS_SCHEMA,
    ...(normalizedLanguage ? { language: normalizedLanguage } : {}),
    words,
  };
}

function getTimedTranscriptPayload(
  bodies: AnnotationBody[],
  remoteWebVttByBodyId?: RemoteWebVttPayloadById,
): { payload: TimedTranscriptPayload; index: number; storage: TimedTranscriptStorage } | null {
  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index];
    if (!body || typeof body !== "object") {
      continue;
    }

    const format = typeof body.format === "string" ? body.format.toLowerCase() : "";
    const value = typeof body.value === "string" ? body.value : "";

    if (body.purpose === STT_TIMED_WORDS_BODY_PURPOSE && format.includes("json") && value.trim().length > 0) {
      const payload = parseTimedTranscriptPayload(value);
      if (payload) {
        return { payload, index, storage: "json" };
      }
    }

    if (isWebVttBody(body)) {
      if (value.trim().length > 0) {
        const payload = parseWebVttPayload(value, body.language);
        if (payload) {
          return { payload, index, storage: "vtt" };
        }
      }

      const bodyId = typeof body.id === "string" ? body.id.trim() : "";
      if (bodyId && remoteWebVttByBodyId) {
        const remotePayload = remoteWebVttByBodyId[bodyId];
        if (remotePayload) {
          const normalizedLanguage = normalizeLanguageValue(body.language);
          return {
            payload: {
              ...remotePayload,
              ...(normalizedLanguage ? { language: normalizedLanguage } : {}),
            },
            index,
            storage: "vtt",
          };
        }
      }
    }
  }

  return null;
}

function upsertTimedTranscriptPayloadBody(
  bodies: AnnotationBody[],
  payload: TimedTranscriptPayload,
): AnnotationBody[] {
  const timed = getTimedTranscriptPayload(bodies);
  if (payload.words.length === 0) {
    if (!timed) {
      return bodies;
    }
    return bodies.filter((_, bodyIndex) => bodyIndex !== timed.index);
  }

  const normalizedLanguage = normalizeLanguageValue(payload.language);
  const normalizedPayload: TimedTranscriptPayload = {
    schema: STT_TIMED_WORDS_SCHEMA,
    ...(normalizedLanguage ? { language: normalizedLanguage } : {}),
    words: payload.words,
  };
  const existingPurposeCandidate = timed ? bodies[timed.index]?.purpose : undefined;
  const existingPurpose = typeof existingPurposeCandidate === "string"
    && existingPurposeCandidate.trim().length > 0
    ? existingPurposeCandidate
    : STT_TIMED_WORDS_BODY_PURPOSE;
  const timedBody: AnnotationBody = timed?.storage === "vtt"
    ? {
      type: "TextualBody",
      purpose: existingPurpose,
      format: WEBVTT_BODY_FORMAT,
      value: serializeWebVttCues(
        segmentWordsIntoWebVttCues(normalizedPayload.words),
      ),
      ...(normalizedPayload.language ? { language: normalizedPayload.language } : {}),
    }
    : {
      type: "TextualBody",
      purpose: STT_TIMED_WORDS_BODY_PURPOSE,
      format: STT_TIMED_WORDS_BODY_FORMAT,
      value: JSON.stringify(normalizedPayload),
    };

  if (!timed) {
    return [...bodies, timedBody];
  }

  const nextBodies = [...bodies];
  nextBodies[timed.index] = {
    ...nextBodies[timed.index],
    ...timedBody,
  };
  return nextBodies;
}

function normalizeLanguageOptions(
  languageOptions: string[] | undefined,
  defaultLanguage: string | undefined,
): string[] {
  const normalized = (languageOptions ?? [])
    .map((language) => language.trim().toLowerCase())
    .filter((language) => language.length > 0);
  const fallbackDefault = defaultLanguage?.trim().toLowerCase();

  if (fallbackDefault && !normalized.includes(fallbackDefault)) {
    normalized.unshift(fallbackDefault);
  }

  if (normalized.length === 0) {
    return ["en", "fr", "es"];
  }

  return Array.from(new Set(normalized));
}

function commitInputOnEnter(
  event: React.KeyboardEvent<HTMLInputElement>,
  onCommit: (value: string) => void,
) {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  onCommit(event.currentTarget.value);
  event.currentTarget.blur();
}

function commitTextareaOnKey(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  onCommit: (value: string) => void,
) {
  if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) {
    return;
  }

  event.preventDefault();
  onCommit(event.currentTarget.value);
  event.currentTarget.blur();
}

const PANEL_WIDTH_STORAGE_KEY = "clover-mark-panel-width";
const PANEL_WIDTH_DEFAULT_PERCENT = 46;
const PANEL_WIDTH_MIN_PERCENT = 32;
const PANEL_WIDTH_MAX_PERCENT = 62;
const PANEL_WIDTH_CLOVER_DEFAULT_PERCENT = 38.2;

const CLOVER_MARK_PANEL_LAYOUT_CSS = `
.clover-viewer-content > div[data-aside-active='true'] {
  width: calc(100% - var(--clover-mark-information-panel-width, ${PANEL_WIDTH_CLOVER_DEFAULT_PERCENT}%));
}

.clover-viewer-content > aside[data-aside-active='true'] {
  width: var(--clover-mark-information-panel-width, ${PANEL_WIDTH_CLOVER_DEFAULT_PERCENT}%);
  min-width: 28rem;
  max-width: min(70vw, 64rem);
}

.clover-mark-panel-root {
  position: relative;
  display: grid;
  gap: 1rem;
  padding: 1.15rem 1rem 1.5rem;
  min-height: 100%;
  align-content: start;
}

.clover-mark-panel-root input,
.clover-mark-panel-root select,
.clover-mark-panel-root textarea,
.clover-mark-panel-root button {
  font-size: 0.92rem;
  line-height: 1.35;
}

.clover-mark-panel-root input,
.clover-mark-panel-root select,
.clover-mark-panel-root textarea {
  width: 100%;
}

.clover-mark-panel-root input,
.clover-mark-panel-root select {
  min-height: 2rem;
  padding: 0.35rem 0.45rem;
}

.clover-mark-panel-root textarea {
  min-height: 5.5rem;
  padding: 0.45rem 0.5rem;
  resize: vertical;
}

.clover-mark-panel-resize-handle {
  position: absolute;
  top: 0.8rem;
  left: -0.75rem;
  width: 0.7rem;
  height: calc(100% - 1.6rem);
  border: none;
  background: transparent;
  padding: 0;
  cursor: ew-resize;
  touch-action: none;
  z-index: 4;
}

.clover-mark-panel-resize-handle::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 2px;
  border-radius: 999px;
  background: #d1d5db;
  transition: width 120ms ease, background-color 120ms ease;
}

.clover-mark-panel-resize-handle:hover::before,
.clover-mark-panel-resize-handle:focus-visible::before,
.clover-mark-panel-resize-handle[data-resizing='true']::before {
  width: 3px;
  background: #2563eb;
}

@media (max-width: 767px) {
  .clover-viewer-content > aside[data-aside-active='true'] {
    width: 100%;
    min-width: 0;
    max-width: none;
  }

  .clover-mark-panel-root {
    padding-left: 0.8rem;
    padding-right: 0.8rem;
  }

  .clover-mark-panel-resize-handle {
    display: none;
  }
}
`;

function clampPanelWidthPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return PANEL_WIDTH_DEFAULT_PERCENT;
  }

  return Math.min(PANEL_WIDTH_MAX_PERCENT, Math.max(PANEL_WIDTH_MIN_PERCENT, value));
}

function loadPanelWidthPercent(): number {
  if (typeof window === "undefined") {
    return PANEL_WIDTH_DEFAULT_PERCENT;
  }

  let stored = "";
  try {
    stored = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY) ?? "";
  } catch {
    return PANEL_WIDTH_DEFAULT_PERCENT;
  }
  if (!stored) {
    return PANEL_WIDTH_DEFAULT_PERCENT;
  }

  const parsed = Number.parseFloat(stored);
  return clampPanelWidthPercent(parsed);
}

function getMotivationLabel(value: string, t: (key: string) => string): string {
  const trimmed = value.trim().toLowerCase();
  const keyByMotivation: Record<string, string> = {
    commenting: "motivationCommenting",
    highlighting: "motivationHighlighting",
    describing: "motivationDescribing",
    transcribing: "motivationTranscribing",
    translating: "motivationTranslating",
    tagging: "motivationTagging",
    supplementing: "motivationSupplementing",
  };

  const translationKey = keyByMotivation[trimmed];
  if (translationKey) {
    return t(translationKey);
  }

  if (!trimmed) {
    return t("motivationUnspecified");
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function getSelectorLabel(value: string, t: (key: string) => string): string {
  const normalized = value.trim().toLowerCase();
  const keyBySelector: Record<string, string> = {
    rectangle: "selectorTypeRectangle",
    polygon: "selectorTypePolygon",
    point: "selectorTypePoint",
    fragmentselector: "selectorTypeFragment",
  };

  const translationKey = keyBySelector[normalized];
  if (translationKey) {
    return t(translationKey);
  }

  return value;
}

function getBodyLabelForMotivation(
  motivation: string,
  t: (key: string) => string,
): string {
  const normalized = motivation.trim().toLowerCase();
  const keyByMotivation: Record<string, string> = {
    commenting: "bodyLabelCommenting",
    highlighting: "bodyLabelHighlighting",
    describing: "bodyLabelDescribing",
    transcribing: "bodyLabelTranscribing",
    translating: "bodyLabelTranslating",
    tagging: "bodyLabelTagging",
    supplementing: "bodyLabelSupplementing",
  };

  const translationKey = keyByMotivation[normalized];
  if (!translationKey) {
    return t("scholiumComment");
  }

  return t(translationKey);
}

type SttLoadState = "not_loaded" | "loading" | "ready" | "error";
type SttInputSource = "microphone" | "viewer";
type SttTranscriptionMode = "realtime" | "fast";
type SttRecorderLike = {
  stop: () => Promise<void>;
};

type CanvasAnnotatorWithCreation = ReturnType<typeof getCanvasAnnotator> & {
  createAnnotation?: (annotation: Record<string, unknown>) => unknown;
  addAnnotation?: (annotation: Record<string, unknown>) => void;
};

function isCanvasAnnotatorWithCreate(
  annotator: ReturnType<typeof getCanvasAnnotator>,
): annotator is CanvasAnnotatorWithCreation & { createAnnotation: (annotation: Record<string, unknown>) => unknown } {
  return Boolean(
    annotator &&
      typeof (annotator as CanvasAnnotatorWithCreation).createAnnotation === "function",
  );
}

function isCanvasAnnotatorWithAdd(
  annotator: ReturnType<typeof getCanvasAnnotator>,
): annotator is CanvasAnnotatorWithCreation & { addAnnotation: (annotation: Record<string, unknown>) => void } {
  return Boolean(
    annotator &&
      typeof (annotator as CanvasAnnotatorWithCreation).addAnnotation === "function",
  );
}

function mergeTranscriptionText(fixedText: string, activeText: string): string {
  return [fixedText.trim(), activeText.trim()].filter((segment) => segment.length > 0).join(" ").trim();
}

function getActiveMediaElement(): HTMLVideoElement | HTMLAudioElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  const mediaElements = Array.from(
    document.querySelectorAll("video, audio"),
  ) as Array<HTMLVideoElement | HTMLAudioElement>;

  if (mediaElements.length === 0) {
    return null;
  }

  const playing = mediaElements.find((element) => !element.paused && !element.ended);
  if (playing) {
    return playing;
  }

  return mediaElements[0];
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
}

function getWordTimestampRange(
  words: ParakeetWord[],
  fallbackDurationSeconds: number,
  baseOffsetSeconds = 0,
): { start: number; end: number } | null {
  const offset = Number.isFinite(baseOffsetSeconds) ? Math.max(0, baseOffsetSeconds) : 0;
  if (words.length === 0) {
    if (fallbackDurationSeconds <= 0) {
      return null;
    }
    return {
      start: offset,
      end: offset + fallbackDurationSeconds,
    };
  }

  const firstWord = words[0];
  const lastWord = words[words.length - 1];
  const start = Number.isFinite(firstWord.start_time) ? Math.max(0, firstWord.start_time) : 0;
  const lastEnd = Number.isFinite(lastWord.end_time)
    ? Math.max(0, lastWord.end_time)
    : start;
  const end = Math.max(start, lastEnd);

  return {
    start,
    end,
  };
}

function downmixAudioBufferChannelData(
  audioBuffer: AudioBuffer,
  startSeconds: number,
): Float32Array {
  const startIndex = Math.max(
    0,
    Math.min(audioBuffer.length, Math.floor(startSeconds * audioBuffer.sampleRate)),
  );
  const frameCount = Math.max(0, audioBuffer.length - startIndex);
  if (frameCount === 0) {
    return new Float32Array(0);
  }

  const channelCount = Math.max(1, audioBuffer.numberOfChannels);
  const mono = new Float32Array(frameCount);
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const source = audioBuffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < frameCount; sampleIndex += 1) {
      mono[sampleIndex] += source[startIndex + sampleIndex] / channelCount;
    }
  }

  return mono;
}

function resampleAudioLinear(
  sourceData: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (sourceSampleRate === targetSampleRate) {
    return new Float32Array(sourceData);
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const targetLength = Math.max(1, Math.round(sourceData.length / ratio));
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

async function decodeViewerMediaAudio(
  sourceCandidates: string[],
  startSeconds: number,
): Promise<Float32Array> {
  if (sourceCandidates.length === 0) {
    throw new Error("Viewer media source URL is unavailable.");
  }

  const fetchWithCredentials = (url: string) => fetch(url, { credentials: "include" });
  const absoluteUrl = (value: string, base?: string): string => {
    try {
      return new URL(value, base ?? window.location.href).toString();
    } catch {
      return value;
    }
  };

  const parseAttributes = (raw: string): Record<string, string> => {
    const attributes: Record<string, string> = {};
    const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(raw)) !== null) {
      const key = match[1];
      const rawValue = match[2] ?? "";
      attributes[key] = rawValue.startsWith("\"") && rawValue.endsWith("\"")
        ? rawValue.slice(1, -1)
        : rawValue;
    }
    return attributes;
  };

  const decodeArrayBufferToParakeet = async (
    input: ArrayBuffer,
    offsetSeconds: number,
  ): Promise<Float32Array> => {
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(input.slice(0));
      const mono = downmixAudioBufferChannelData(decoded, offsetSeconds);
      return resampleAudioLinear(mono, decoded.sampleRate, PARAKEET_SAMPLE_RATE);
    } finally {
      if (context.state !== "closed") {
        await context.close().catch(() => undefined);
      }
    }
  };

  const concatArrayBuffers = (buffers: ArrayBuffer[]): ArrayBuffer => {
    const totalLength = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const buffer of buffers) {
      merged.set(new Uint8Array(buffer), offset);
      offset += buffer.byteLength;
    }
    return merged.buffer;
  };

  const decodeHlsPlaylistAudio = async (
    playlistUrl: string,
    offsetSeconds: number,
    depth = 0,
  ): Promise<Float32Array> => {
    if (depth > 4) {
      throw new Error("HLS playlist nesting is too deep.");
    }

    const playlistResponse = await fetchWithCredentials(playlistUrl);
    if (!playlistResponse.ok) {
      throw new Error(`Failed to fetch HLS playlist (${playlistResponse.status}).`);
    }
    const playlistText = await playlistResponse.text();
    const lines = playlistText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (!lines.some((line) => line.toUpperCase() === "#EXTM3U")) {
      throw new Error("Invalid HLS playlist format.");
    }

    const audioRenditionUris: string[] = [];
    const variants: Array<{ uri: string; bandwidth: number }> = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.startsWith("#EXT-X-MEDIA:")) {
        const attrs = parseAttributes(line.slice("#EXT-X-MEDIA:".length));
        if (attrs.TYPE?.toUpperCase() === "AUDIO" && attrs.URI) {
          audioRenditionUris.push(absoluteUrl(attrs.URI, playlistUrl));
        }
        continue;
      }
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const attrs = parseAttributes(line.slice("#EXT-X-STREAM-INF:".length));
        const bandwidth = Number.parseInt(attrs.BANDWIDTH ?? "0", 10) || 0;
        let nextIndex = index + 1;
        while (nextIndex < lines.length && lines[nextIndex].startsWith("#")) {
          nextIndex += 1;
        }
        if (nextIndex < lines.length) {
          variants.push({
            uri: absoluteUrl(lines[nextIndex], playlistUrl),
            bandwidth,
          });
          index = nextIndex;
        }
      }
    }

    if (audioRenditionUris.length > 0 || variants.length > 0) {
      const renditionUrl =
        audioRenditionUris[0] ??
        variants.sort((left, right) => right.bandwidth - left.bandwidth)[0]?.uri;
      if (!renditionUrl) {
        throw new Error("HLS master playlist has no playable renditions.");
      }
      return decodeHlsPlaylistAudio(renditionUrl, offsetSeconds, depth + 1);
    }

    let mapUrl: string | null = null;
    let pendingDuration = 0;
    let elapsedSeconds = 0;
    let firstIncludedSegmentStartSeconds: number | null = null;
    const segmentUrls: string[] = [];
    for (const line of lines) {
      if (line.startsWith("#EXT-X-MAP:")) {
        const attrs = parseAttributes(line.slice("#EXT-X-MAP:".length));
        if (attrs.URI) {
          mapUrl = absoluteUrl(attrs.URI, playlistUrl);
        }
        continue;
      }
      if (line.startsWith("#EXTINF:")) {
        const rawDuration = line.slice("#EXTINF:".length).split(",")[0];
        pendingDuration = Number.parseFloat(rawDuration) || 0;
        continue;
      }
      if (line.startsWith("#")) {
        continue;
      }

      const segmentUrl = absoluteUrl(line, playlistUrl);
      const segmentDuration = Math.max(0, pendingDuration);
      const segmentStart = elapsedSeconds;
      const segmentEnd = elapsedSeconds + segmentDuration;
      if (segmentDuration === 0 || segmentEnd >= offsetSeconds) {
        if (firstIncludedSegmentStartSeconds === null) {
          firstIncludedSegmentStartSeconds = segmentStart;
        }
        segmentUrls.push(segmentUrl);
      }
      elapsedSeconds = segmentEnd;
      pendingDuration = 0;
    }

    if (segmentUrls.length === 0) {
      throw new Error("HLS media playlist has no decodable segments.");
    }

    const segmentBuffers: ArrayBuffer[] = [];
    if (mapUrl) {
      const mapResponse = await fetchWithCredentials(mapUrl);
      if (!mapResponse.ok) {
        throw new Error(`Failed to fetch HLS init segment (${mapResponse.status}).`);
      }
      segmentBuffers.push(await mapResponse.arrayBuffer());
    }

    for (const segmentUrl of segmentUrls) {
      const segmentResponse = await fetchWithCredentials(segmentUrl);
      if (!segmentResponse.ok) {
        throw new Error(`Failed to fetch HLS segment (${segmentResponse.status}).`);
      }
      segmentBuffers.push(await segmentResponse.arrayBuffer());
    }

    const mergedBuffer = concatArrayBuffers(segmentBuffers);
    const trimOffsetSeconds = firstIncludedSegmentStartSeconds === null
      ? 0
      : Math.max(0, offsetSeconds - firstIncludedSegmentStartSeconds);
    return decodeArrayBufferToParakeet(mergedBuffer, trimOffsetSeconds);
  };

  let lastError = "Failed to fetch viewer media.";
  for (const candidate of sourceCandidates) {
    try {
      const normalizedCandidate = absoluteUrl(candidate);
      const lowerCandidate = normalizedCandidate.toLowerCase();
      if (lowerCandidate.includes(".m3u8")) {
        return decodeHlsPlaylistAudio(normalizedCandidate, startSeconds);
      }

      const response = await fetchWithCredentials(normalizedCandidate);
      if (!response.ok) {
        lastError = `Failed to fetch viewer media (${response.status}).`;
        continue;
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (contentType.includes("mpegurl") || contentType.includes("application/vnd.apple.mpegurl")) {
        return decodeHlsPlaylistAudio(normalizedCandidate, startSeconds);
      }

      const mediaBuffer = await response.arrayBuffer();
      return decodeArrayBufferToParakeet(mediaBuffer, startSeconds);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError);
}

type HlsCtorLike = {
  isSupported: () => boolean;
  Events: {
    MANIFEST_PARSED: string;
    ERROR: string;
  };
  new (config?: Record<string, unknown>): {
    loadSource: (url: string) => void;
    attachMedia: (media: HTMLMediaElement) => void;
    on: (event: string, cb: (...args: unknown[]) => void) => void;
    destroy: () => void;
  };
};

let cachedHlsCtorPromise: Promise<HlsCtorLike | null> | null = null;
const HLS_CDN_ESM_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/+esm";
const HLS_NPM_MODULE_NAME = "hls.js";

async function loadHlsCtor(): Promise<HlsCtorLike | null> {
  if (cachedHlsCtorPromise) {
    return cachedHlsCtorPromise;
  }

  cachedHlsCtorPromise = (async () => {
    try {
      const npmImported = await import(
        /* @vite-ignore */ HLS_NPM_MODULE_NAME
      );
      const npmCtor = (
        npmImported as unknown as { default?: unknown; Hls?: unknown }
      ).default ?? (npmImported as unknown as { Hls?: unknown }).Hls;
      if (
        npmCtor &&
        typeof npmCtor === "function" &&
        typeof (npmCtor as HlsCtorLike).isSupported === "function"
      ) {
        return npmCtor as HlsCtorLike;
      }
    } catch {
      // npm package may not be installed; continue to CDN fallback.
    }

    try {
      const imported = await import(
        /* @vite-ignore */ HLS_CDN_ESM_URL
      );
      const maybeCtor = (
        imported as unknown as { default?: unknown; Hls?: unknown }
      ).default ?? (imported as unknown as { Hls?: unknown }).Hls;
      if (
        maybeCtor &&
        typeof maybeCtor === "function" &&
        typeof (maybeCtor as HlsCtorLike).isSupported === "function"
      ) {
        return maybeCtor as HlsCtorLike;
      }
    } catch {
      // Ignore CDN load failures; fallback will continue with native media loading.
    }
    return null;
  })();

  return cachedHlsCtorPromise;
}

function createHiddenMediaElement(): HTMLVideoElement {
  const hidden = document.createElement("video");
  hidden.preload = "auto";
  hidden.crossOrigin = "use-credentials";
  hidden.muted = false;
  hidden.defaultMuted = false;
  hidden.volume = 1;
  hidden.playsInline = true;
  hidden.controls = false;
  hidden.style.position = "fixed";
  hidden.style.left = "-99999px";
  hidden.style.top = "0";
  hidden.style.width = "1px";
  hidden.style.height = "1px";
  hidden.style.opacity = "0";
  hidden.style.pointerEvents = "none";
  hidden.setAttribute("aria-hidden", "true");
  document.body.appendChild(hidden);
  return hidden;
}

function removeHiddenMediaElement(element: HTMLVideoElement | null): void {
  if (!element) {
    return;
  }

  try {
    element.pause();
  } catch {
    // Ignore cleanup errors.
  }

  element.removeAttribute("src");
  element.load();
  if (element.parentElement) {
    element.parentElement.removeChild(element);
  }
}

async function attachHiddenMediaSource(
  element: HTMLVideoElement,
  sourceCandidates: string[],
): Promise<() => void> {
  const waitForMetadata = () =>
    new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Hidden media failed to load."));
      };
      const cleanup = () => {
        element.removeEventListener("loadedmetadata", onLoaded);
        element.removeEventListener("error", onError);
      };
      element.addEventListener("loadedmetadata", onLoaded, { once: true });
      element.addEventListener("error", onError, { once: true });
    });

  const tryNative = async (url: string): Promise<boolean> => {
    try {
      element.src = url;
      element.load();
      await waitForMetadata();
      return true;
    } catch {
      return false;
    }
  };

  const hlsCtor = await loadHlsCtor();

  for (const source of sourceCandidates) {
    const lower = source.toLowerCase();
    if (lower.includes(".m3u8")) {
      if (hlsCtor?.isSupported()) {
        const hls = new hlsCtor({
          enableWorker: true,
          lowLatencyMode: false,
          xhrSetup: (xhr: XMLHttpRequest) => {
            xhr.withCredentials = true;
          },
        });
        const attached = await new Promise<boolean>((resolve) => {
          const onParsed = () => resolve(true);
          const onError = () => resolve(false);
          hls.on(hlsCtor.Events.MANIFEST_PARSED, onParsed);
          hls.on(hlsCtor.Events.ERROR, onError);
          hls.loadSource(source);
          hls.attachMedia(element);
        });
        if (attached) {
          return () => {
            hls.destroy();
          };
        }
        hls.destroy();
      }

      const loadedNatively = await tryNative(source);
      if (loadedNatively) {
        return () => undefined;
      }
      continue;
    }

    const loadedNatively = await tryNative(source);
    if (loadedNatively) {
      return () => undefined;
    }
  }

  throw new Error("Unable to load hidden media source for fallback capture.");
}

type CloverMarkPanelProps = PluginInformationPanel & {
  defaultMotivation?: string | string[];
  motivationOptions?: string[];
  translationLanguageOptions?: string[];
  defaultTranslationLanguage?: string;
  enableStreamingStt?: boolean;
  sttModelVersion?: string;
  sttUpdateIntervalMs?: number;
};

export const CloverMarkPanel: React.FC<CloverMarkPanelProps> = ({
  canvas,
  defaultMotivation,
  motivationOptions,
  translationLanguageOptions,
  defaultTranslationLanguage,
  enableStreamingStt,
  sttModelVersion,
  sttUpdateIntervalMs,
  useViewerState,
}) => {
  const { t } = useTranslation(ANNOTATIONS_I18N_NAMESPACE);
  const viewerState = useViewerState();

  const activeCanvasId = canvas?.id ?? viewerState.activeCanvas;
  const activeCanvas = React.useMemo(
    () =>
      activeCanvasId
        ? (viewerState.vault.get(activeCanvasId) as CanvasLike | undefined)
        : undefined,
    [activeCanvasId, viewerState.vault],
  );
  const mediaType = React.useMemo(
    () =>
      activeCanvas
        ? detectCanvasMediaType(activeCanvas, viewerState.vault)
        : "unknown",
    [activeCanvas, viewerState.vault],
  );
  const [hasViewerMedia, setHasViewerMedia] = React.useState(false);
  const isAvCanvas = mediaType === "audio" || mediaType === "video" || hasViewerMedia;
  const runtime = useCanvasRuntimeState(activeCanvasId);
  const [exportMessage, setExportMessage] = React.useState("");
  const [remoteWebVttByBodyId, setRemoteWebVttByBodyId] = React.useState<RemoteWebVttPayloadById>({});
  const [translationDraftByAnnotation, setTranslationDraftByAnnotation] = React.useState<
    Record<string, { language: string; value: string }>
  >({});
  const [sttLoadState, setSttLoadState] = React.useState<SttLoadState>("not_loaded");
  const [sttStatus, setSttStatus] = React.useState("");
  const [sttBackend, setSttBackend] = React.useState<string | null>(null);
  const [sttFixedText, setSttFixedText] = React.useState("");
  const [sttActiveText, setSttActiveText] = React.useState("");
  const [sttSessionDurationSeconds, setSttSessionDurationSeconds] = React.useState(0);
  const [sttMetrics, setSttMetrics] = React.useState<{
    latencySeconds: number;
    rtf: number;
  } | null>(null);
  const [isRecordingStt, setIsRecordingStt] = React.useState(false);
  const [sttRecordingAnnotationId, setSttRecordingAnnotationId] = React.useState<string | null>(null);
  const [sttInputSource, setSttInputSource] = React.useState<SttInputSource>("microphone");
  const [micLevel, setMicLevel] = React.useState(0);
  const [panelWidthPercent, setPanelWidthPercent] = React.useState<number>(() => loadPanelWidthPercent());
  const [isResizingPanel, setIsResizingPanel] = React.useState(false);
  const sttEnabled = enableStreamingStt !== false;
  const sttUpdateFrequencyMs = Math.max(250, sttUpdateIntervalMs ?? 500);
  const sttModel = sttModelVersion ?? "parakeet-tdt-0.6b-v3";
  const sttLazyModelIndicator = React.useMemo(() => {
    switch (sttLoadState) {
      case "ready":
        return {
          text: t("sttModelStateReady"),
          color: "#166534",
          background: "#dcfce7",
          border: "#86efac",
        };
      case "loading":
        return {
          text: t("sttModelStateLoading"),
          color: "#1d4ed8",
          background: "#dbeafe",
          border: "#93c5fd",
        };
      case "error":
        return {
          text: t("sttModelStateError"),
          color: "#b91c1c",
          background: "#fee2e2",
          border: "#fca5a5",
        };
      default:
        return {
          text: t("sttModelStateNotLoaded"),
          color: "#374151",
          background: "#f3f4f6",
          border: "#d1d5db",
        };
    }
  }, [sttLoadState, t]);
  const panelManagedMediaAnnotatorCanvasRef = React.useRef<string | null>(null);
  const sttTranscriberRef = React.useRef<ParakeetTranscriber | null>(null);
  const sttRecorderRef = React.useRef<SttRecorderLike | null>(null);
  const sttBufferRef = React.useRef<AudioChunkBuffer | null>(null);
  const sttHandlerRef = React.useRef<SmartProgressiveStreamingHandler | null>(null);
  const sttIntervalRef = React.useRef<number | null>(null);
  const sttTranscriptionInFlightRef = React.useRef(false);
  const sttLiveAnnotationIdRef = React.useRef<string | null>(null);
  const sttLastCommittedTextRef = React.useRef("");
  const sttTargetAnnotationIdRef = React.useRef<string | null>(null);
  const sttTargetLanguageRef = React.useRef<string>("");
  const sttInputSourceRef = React.useRef<SttInputSource>("microphone");
  const sttTranscriptionModeRef = React.useRef<SttTranscriptionMode>("realtime");
  const sttMediaStartTimeRef = React.useRef<number | null>(null);
  const sttViewerMediaElementRef = React.useRef<HTMLAudioElement | HTMLVideoElement | null>(null);
  const sttViewerSyncDetachRef = React.useRef<(() => void) | null>(null);
  const sttFastTaskRef = React.useRef<{ cancelled: boolean } | null>(null);
  const sttFastHiddenElementRef = React.useRef<HTMLVideoElement | null>(null);
  const sttFastHiddenDetachRef = React.useRef<(() => void) | null>(null);
  const sttAutoLoadAttemptedRef = React.useRef(false);
  const panelRootRef = React.useRef<HTMLElement | null>(null);
  const panelResizeAnchorRef = React.useRef<{ left: number; width: number } | null>(null);
  const manifest = React.useMemo(
    () =>
      viewerState.activeManifest
        ? (viewerState.vault.get(viewerState.activeManifest) as ManifestLike | undefined)
        : undefined,
    [viewerState.activeManifest, viewerState.vault],
  );
  const annotator = getCanvasAnnotator(activeCanvasId);
  const normalizedDefaultMotivation = getPrimaryMotivation(defaultMotivation);
  const availableMotivations = React.useMemo(() => {
    const normalized = (motivationOptions ?? [
      "commenting",
      "transcribing",
      "highlighting",
      "tagging",
      "supplementing",
    ])
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (
      normalizedDefaultMotivation &&
      !normalized.includes(normalizedDefaultMotivation)
    ) {
      normalized.unshift(normalizedDefaultMotivation);
    }

    return Array.from(new Set(normalized));
  }, [motivationOptions, normalizedDefaultMotivation]);
  const availableTranslationLanguages = React.useMemo(
    () =>
      normalizeLanguageOptions(
        translationLanguageOptions,
        defaultTranslationLanguage,
      ),
    [defaultTranslationLanguage, translationLanguageOptions],
  );
  const normalizedDefaultTranslationLanguage = React.useMemo(() => {
    const trimmed = defaultTranslationLanguage?.trim().toLowerCase();
    if (trimmed && trimmed.length > 0) {
      return trimmed;
    }

    return availableTranslationLanguages[0] ?? "en";
  }, [availableTranslationLanguages, defaultTranslationLanguage]);
  const exportCanvasOrder = React.useMemo(() => {
    const fromManifest = ensureArray(manifest?.items)
      .map((canvasRef) => {
        const resolved = viewerState.vault.get(canvasRef as never) as CanvasLike | undefined;
        if (resolved?.id) {
          return resolved.id;
        }

        if (
          canvasRef &&
          typeof canvasRef === "object" &&
          "id" in canvasRef &&
          typeof (canvasRef as { id?: unknown }).id === "string"
        ) {
          return (canvasRef as { id: string }).id;
        }

        return undefined;
      })
      .filter((id): id is string => Boolean(id));

    if (activeCanvasId && !fromManifest.includes(activeCanvasId)) {
      fromManifest.unshift(activeCanvasId);
    }

    return fromManifest;
  }, [activeCanvasId, manifest?.items, viewerState.vault]);
  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let mounted = true;
    const updateHasViewerMedia = () => {
      if (!mounted) {
        return;
      }
      setHasViewerMedia(Boolean(getActiveMediaElement()));
    };

    updateHasViewerMedia();
    const intervalId = window.setInterval(updateHasViewerMedia, 1000);
    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [activeCanvasId]);

  React.useEffect(() => {
    if (!activeCanvasId) {
      return;
    }

    if (!isAvCanvas) {
      return;
    }

    if (getCanvasAnnotator(activeCanvasId)) {
      return;
    }

    const mediaAnnotator = createMediaCanvasAnnotator({
      canvasId: activeCanvasId,
      defaultMotivation: "transcribing",
      getPlayer: () => getActiveMediaElement(),
    });

    registerCanvasAnnotator(activeCanvasId, mediaAnnotator);
    setCanvasBridgeState(activeCanvasId, "none", true);
    panelManagedMediaAnnotatorCanvasRef.current = activeCanvasId;

    return () => {
      if (panelManagedMediaAnnotatorCanvasRef.current !== activeCanvasId) {
        return;
      }

      registerCanvasAnnotator(activeCanvasId, null);
      setCanvasBridgeState(activeCanvasId, "none", false);
      panelManagedMediaAnnotatorCanvasRef.current = null;
    };
  }, [activeCanvasId, isAvCanvas]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(panelWidthPercent));
    } catch {
      // Ignore storage failures so panel resizing still works in restricted contexts.
    }
  }, [panelWidthPercent]);

  React.useEffect(() => {
    const panelRoot = panelRootRef.current;
    if (!panelRoot) {
      return;
    }

    const viewerContent = panelRoot.closest(".clover-viewer-content");
    if (!(viewerContent instanceof HTMLElement)) {
      return;
    }

    viewerContent.style.setProperty("--clover-mark-information-panel-width", `${panelWidthPercent}%`);
    return () => {
      viewerContent.style.removeProperty("--clover-mark-information-panel-width");
    };
  }, [panelWidthPercent]);

  const applyPanelWidthFromClientX = React.useCallback((clientX: number) => {
    const anchor = panelResizeAnchorRef.current;
    if (!anchor) {
      return;
    }

    const rightEdge = anchor.left + anchor.width;
    const nextPercent = ((rightEdge - clientX) / anchor.width) * 100;
    setPanelWidthPercent(clampPanelWidthPercent(nextPercent));
  }, []);

  const handlePanelResizePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      const viewerContent = panelRootRef.current?.closest(".clover-viewer-content");
      if (!(viewerContent instanceof HTMLElement)) {
        return;
      }

      const bounds = viewerContent.getBoundingClientRect();
      if (bounds.width <= 0) {
        return;
      }

      panelResizeAnchorRef.current = {
        left: bounds.left,
        width: bounds.width,
      };
      setIsResizingPanel(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      applyPanelWidthFromClientX(event.clientX);
      event.preventDefault();
    },
    [applyPanelWidthFromClientX],
  );

  const handlePanelResizePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!isResizingPanel) {
        return;
      }

      applyPanelWidthFromClientX(event.clientX);
    },
    [applyPanelWidthFromClientX, isResizingPanel],
  );

  const handlePanelResizePointerEnd = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!isResizingPanel) {
        return;
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      panelResizeAnchorRef.current = null;
      setIsResizingPanel(false);
    },
    [isResizingPanel],
  );

  const handlePanelResizeKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPanelWidthPercent((current) => clampPanelWidthPercent(current + 2));
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setPanelWidthPercent((current) => clampPanelWidthPercent(current - 2));
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        setPanelWidthPercent(PANEL_WIDTH_MAX_PERCENT);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setPanelWidthPercent(PANEL_WIDTH_MIN_PERCENT);
      }
    },
    [],
  );

  const appendSupplementingTranslationValue = React.useCallback(
    (
      annotationId: string,
      language: string,
      value: string,
      clearDraftAfterSave: boolean,
    ): boolean => {
      if (!annotator || !annotationId) {
        return false;
      }

      const normalizedValue = value.trim();
      if (!normalizedValue) {
        return false;
      }

      const annotation = annotator.getAnnotationById(annotationId) as
        | { bodies?: Array<{ purpose?: string; value?: string; language?: string; [key: string]: unknown }> }
        | undefined;
      if (!annotation) {
        return false;
      }

      const existingBodies = Array.isArray(annotation.bodies)
        ? annotation.bodies.map((body) => ({ ...body }))
        : [];
      const existingTranslations = getSupplementingBodies(existingBodies);
      const normalizedLanguage = language.trim().toLowerCase();
      const nextTranslations = [
        ...existingTranslations,
        { value: normalizedValue, language: normalizedLanguage || undefined },
      ];
      const nextBodies = replaceSupplementingBodies(existingBodies, nextTranslations);

      annotator.updateAnnotation({
        ...(annotation as Record<string, unknown>),
        id: annotationId,
        bodies: nextBodies,
      });

      setTranslationDraftByAnnotation((current) => ({
        ...current,
        [annotationId]: {
          language: normalizedLanguage || normalizedDefaultTranslationLanguage,
          value: clearDraftAfterSave ? "" : normalizedValue,
        },
      }));

      return true;
    },
    [annotator, normalizedDefaultTranslationLanguage],
  );

  const commitLiveTranscription = React.useCallback(
    (annotationId: string, mergedText: string, language: string) => {
      const normalizedText = mergedText.trim();
      if (!annotationId || !normalizedText) {
        return;
      }

      const normalizedLanguage =
        language.trim().toLowerCase() || normalizedDefaultTranslationLanguage;

      setTranslationDraftByAnnotation((current) => {
        const existing = current[annotationId] ?? {
          language: normalizedLanguage,
          value: "",
        };

        return {
          ...current,
          [annotationId]: {
            ...existing,
            language: normalizedLanguage,
            value: normalizedText,
          },
        };
      });

      sttLastCommittedTextRef.current = normalizedText;
    },
    [normalizedDefaultTranslationLanguage],
  );

  const persistTimedTranscriptWords = React.useCallback(
    (
      annotationId: string,
      words: Array<{ text: string; start_time: number; end_time: number; confidence?: number }>,
      language: string,
    ) => {
      if (!annotator || !annotationId) {
        return;
      }

      const annotation = annotator.getAnnotationById(annotationId) as
        | { bodies?: AnnotationBody[]; body?: unknown; target?: unknown }
        | undefined;
      if (!annotation) {
        return;
      }

      const existingBodies = getAnnotationBodies(annotation);
      const normalizedWords = normalizeTimedTranscriptWords(words);
      const normalizedLanguage = language.trim().toLowerCase() || undefined;
      const payload: TimedTranscriptPayload = {
        schema: STT_TIMED_WORDS_SCHEMA,
        ...(normalizedLanguage ? { language: normalizedLanguage } : {}),
        words: normalizedWords,
      };
      const nextBodies = upsertTimedTranscriptPayloadBody(existingBodies, payload);

      annotator.updateAnnotation({
        ...(annotation as Record<string, unknown>),
        id: annotationId,
        bodies: nextBodies,
      });
    },
    [annotator],
  );

  const ensureSttTargetAnnotationId = React.useCallback((): string | null => {
    if (!annotator || !activeCanvasId) {
      return null;
    }

    const selectedAnnotationId = runtime.selectedLocalScholiumId;
    if (selectedAnnotationId) {
      const selectedAnnotation = annotator.getAnnotationById(selectedAnnotationId) as AnnotationLike | undefined;
      if (selectedAnnotation) {
        const currentMotivation = getPrimaryMotivation(selectedAnnotation.motivation) ?? "";
        if (currentMotivation.trim().toLowerCase() !== "supplementing") {
          annotator.updateAnnotation({
            ...(selectedAnnotation as Record<string, unknown>),
            id: selectedAnnotationId,
            motivation: "supplementing",
          });
        }
      }
      return selectedAnnotationId;
    }

    const nextAnnotationId = `stt-viewer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const mediaElement = getActiveMediaElement();
    const currentTime = mediaElement?.currentTime ?? 0;
    const target = isAvCanvas
      ? buildTemporalTarget(activeCanvasId, currentTime, currentTime + 1)
      : activeCanvasId;
    const draft = {
      id: nextAnnotationId,
      motivation: "supplementing",
      target,
      bodies: [
        {
          type: "TextualBody",
          purpose: "tagging",
          value: t("sttAutoScholiumLabel"),
        },
      ],
    };

    let createdAnnotationId: string | null = null;
    if (isCanvasAnnotatorWithCreate(annotator)) {
      const created = annotator.createAnnotation(draft) as { id?: unknown } | undefined;
      if (created && typeof created.id === "string" && created.id.trim().length > 0) {
        createdAnnotationId = created.id;
      }
    } else if (isCanvasAnnotatorWithAdd(annotator)) {
      annotator.addAnnotation(draft);
      createdAnnotationId = nextAnnotationId;
    }

    if (!createdAnnotationId) {
      return null;
    }

    annotator.setSelected(createdAnnotationId, true);
    setTranslationDraftByAnnotation((current) => ({
      ...current,
      [createdAnnotationId]: {
        language: normalizedDefaultTranslationLanguage,
        value: "",
      },
    }));

    return createdAnnotationId;
  }, [
    activeCanvasId,
    annotator,
    isAvCanvas,
    normalizedDefaultTranslationLanguage,
    runtime.selectedLocalScholiumId,
    t,
  ]);

  const stopSttRecording = React.useCallback(
    async (finalize: boolean) => {
      if (sttIntervalRef.current !== null) {
        window.clearInterval(sttIntervalRef.current);
        sttIntervalRef.current = null;
      }

      const fastTask = sttFastTaskRef.current;
      sttFastTaskRef.current = null;
      if (fastTask) {
        fastTask.cancelled = true;
      }
      const hiddenDetach = sttFastHiddenDetachRef.current;
      sttFastHiddenDetachRef.current = null;
      if (hiddenDetach) {
        hiddenDetach();
      }
      const viewerSyncDetach = sttViewerSyncDetachRef.current;
      sttViewerSyncDetachRef.current = null;
      if (viewerSyncDetach) {
        viewerSyncDetach();
      }
      removeHiddenMediaElement(sttFastHiddenElementRef.current);
      sttFastHiddenElementRef.current = null;

      const recorder = sttRecorderRef.current;
      sttRecorderRef.current = null;

      if (recorder) {
        try {
          await recorder.stop();
        } catch (error) {
          console.error("Failed to stop audio capture", error);
        }
      }

      if (sttInputSourceRef.current === "viewer") {
        const mediaElement = sttViewerMediaElementRef.current;
        if (mediaElement && !mediaElement.paused) {
          try {
            mediaElement.pause();
          } catch {
            // Browsers can block programmatic playback controls.
          }
        }
      }

      if (finalize && sttBufferRef.current && sttHandlerRef.current) {
        const finalAudio = sttBufferRef.current.getBuffer();
        if (finalAudio.length > PARAKEET_SAMPLE_RATE / 2) {
          try {
            const transcriptionMode = sttTranscriptionModeRef.current;
            const finalPartial =
              transcriptionMode === "fast"
                ? await sttHandlerRef.current.transcribeBatchLatest(finalAudio)
                : null;
            const finalText =
              finalPartial !== null
                ? mergeTranscriptionText(finalPartial.fixedText, finalPartial.activeText)
                : await sttHandlerRef.current.finalize(finalAudio);
            setSttFixedText(finalText);
            setSttActiveText("");
            setSttSessionDurationSeconds(finalAudio.length / PARAKEET_SAMPLE_RATE);
            if (finalPartial?.metadata) {
              setSttMetrics({
                latencySeconds: finalPartial.metadata.latencySeconds,
                rtf: finalPartial.metadata.rtf,
              });
            }

            const targetAnnotationId = sttTargetAnnotationIdRef.current;
            const targetLanguage = sttTargetLanguageRef.current;
            const inputSource = sttInputSourceRef.current;
            const recordedAudioDurationSeconds = finalAudio.length / PARAKEET_SAMPLE_RATE;
            const mediaStartTime = inputSource === "viewer"
              ? Math.max(0, sttMediaStartTimeRef.current ?? 0)
              : 0;
            let timedWords: TimedTranscriptWord[] = [];

            if (targetAnnotationId) {
              try {
                const timingResult = await sttTranscriberRef.current?.transcribe(finalAudio, {
                  timeOffsetSeconds: mediaStartTime,
                });
                timedWords = normalizeTimedTranscriptWords(timingResult?.words);
              } catch (error) {
                console.error("Failed to build timed transcript words", error);
              }

              if (timedWords.length === 0 && finalText.trim().length > 0) {
                timedWords = buildApproximateTimedWordsFromText(
                  finalText,
                  mediaStartTime,
                  mediaStartTime + recordedAudioDurationSeconds,
                );
              }

              persistTimedTranscriptWords(targetAnnotationId, timedWords, targetLanguage);
            }

            if (
              inputSource === "viewer" &&
              annotator &&
              activeCanvasId &&
              targetAnnotationId
            ) {
              try {
                const wordRange = getWordTimestampRange(
                  timedWords,
                  recordedAudioDurationSeconds,
                  mediaStartTime,
                );
                if (wordRange) {
                  const start = wordRange.start;
                  const end = wordRange.end;
                  const annotation = annotator.getAnnotationById(targetAnnotationId) as AnnotationLike | undefined;
                  if (annotation) {
                    annotator.updateAnnotation({
                      ...(annotation as Record<string, unknown>),
                      id: targetAnnotationId,
                      target: buildTemporalTarget(activeCanvasId, start, Math.max(start, end)),
                    });
                  }
                }
              } catch (error) {
                console.error("Failed to attach viewer timeline timestamps", error);
              }
            }

            if (
              targetAnnotationId &&
              finalText.trim().length > 0 &&
              finalText.trim() !== sttLastCommittedTextRef.current
            ) {
              commitLiveTranscription(targetAnnotationId, finalText, targetLanguage);
            }

            if (targetAnnotationId && finalText.trim().length > 0) {
              const saved = appendSupplementingTranslationValue(
                targetAnnotationId,
                targetLanguage,
                finalText,
                true,
              );

              if (saved) {
                setSttStatus(t("sttSavedToTranslation"));
              }
            }
          } catch (error) {
            console.error("Failed to finalize live transcription", error);
          }
        }
      }

      sttTranscriptionInFlightRef.current = false;
      sttBufferRef.current = null;
      sttHandlerRef.current = null;
      sttLiveAnnotationIdRef.current = null;
      sttTargetAnnotationIdRef.current = null;
      sttTargetLanguageRef.current = "";
      sttInputSourceRef.current = "microphone";
      sttTranscriptionModeRef.current = "realtime";
      sttMediaStartTimeRef.current = null;
      sttViewerMediaElementRef.current = null;
      sttViewerSyncDetachRef.current = null;
      sttFastHiddenDetachRef.current = null;
      sttFastHiddenElementRef.current = null;
      sttLastCommittedTextRef.current = "";
      setSttRecordingAnnotationId(null);
      setSttInputSource("microphone");
      setMicLevel(0);
      setIsRecordingStt(false);
    },
    [
      activeCanvasId,
      annotator,
      appendSupplementingTranslationValue,
      commitLiveTranscription,
      persistTimedTranscriptWords,
      t,
    ],
  );

  const handleLoadSttModel = React.useCallback(async () => {
    if (!sttEnabled || sttLoadState === "loading") {
      return;
    }

    setSttLoadState("loading");
    setSttStatus(t("sttModelLoading"));

    try {
      const transcriber = await loadParakeetTranscriber({
        modelVersion: sttModel,
        onProgress: (event) => {
          const progressLabel = event.total > 0
            ? `${event.file}: ${event.progress}%`
            : event.file;
          setSttStatus(t("sttModelLoadingProgress", { progress: progressLabel }));
        },
      });

      sttTranscriberRef.current = transcriber;
      setSttBackend(transcriber.backend);
      setSttLoadState("ready");
      setSttStatus(t("sttModelReady", { backend: transcriber.backend }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSttLoadState("error");
      setSttStatus(t("sttModelError", { message }));
    }
  }, [sttEnabled, sttLoadState, sttModel, t]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!sttEnabled || sttLoadState !== "not_loaded" || sttAutoLoadAttemptedRef.current) {
      return;
    }

    sttAutoLoadAttemptedRef.current = true;
    let cancelled = false;
    const runLoad = () => {
      if (cancelled) {
        return;
      }
      void handleLoadSttModel();
    };

    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(() => {
        runLoad();
      }, { timeout: 2000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(idleId);
      };
    }

    const timeoutId = window.setTimeout(() => {
      runLoad();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [handleLoadSttModel, sttEnabled, sttLoadState]);

  const handleStartSttRecording = React.useCallback(async (
    annotationId: string,
    language: string,
    source: SttInputSource = "microphone",
    mode: SttTranscriptionMode = "realtime",
  ) => {
    if (!sttEnabled || isRecordingStt || !annotationId) {
      return;
    }

    if (sttLoadState !== "ready") {
      await handleLoadSttModel();
    }

    const transcriber = sttTranscriberRef.current;
    if (!transcriber) {
      return;
    }

    try {
      await stopSttRecording(false);
      setSttFixedText("");
      setSttActiveText("");
      setSttSessionDurationSeconds(0);
      setSttMetrics(null);
      setSttStatus(
        source === "viewer"
          ? mode === "fast"
            ? t("sttRecordingViewerFast")
            : t("sttRecordingViewer")
          : t("sttRecording"),
      );
      setSttInputSource(source);
      sttInputSourceRef.current = source;
      sttTranscriptionModeRef.current = mode;
      setSttRecordingAnnotationId(annotationId);
      sttLiveAnnotationIdRef.current = annotationId;
      sttTargetAnnotationIdRef.current = annotationId;
      sttTargetLanguageRef.current = language.trim().toLowerCase() || normalizedDefaultTranslationLanguage;
      sttMediaStartTimeRef.current = null;
      sttViewerMediaElementRef.current = null;
      sttViewerSyncDetachRef.current = null;
      sttLastCommittedTextRef.current = "";

      const buffer = new AudioChunkBuffer(PARAKEET_SAMPLE_RATE);
      sttBufferRef.current = buffer;
      sttHandlerRef.current = new SmartProgressiveStreamingHandler(transcriber, {
        emissionIntervalSeconds: Math.max(0.25, sttUpdateFrequencyMs / 1000),
        maxWindowSeconds: 15,
        sentenceBufferSeconds: 2,
      });

      const onDataAvailable = (chunk: Float32Array) => {
        buffer.appendChunk(chunk);

        let peak = 0;
        for (let index = 0; index < chunk.length; index += 1) {
          const amplitude = Math.abs(chunk[index]);
          if (amplitude > peak) {
            peak = amplitude;
          }
        }
        setMicLevel(Math.min(100, peak * 300));
      };
      let recorder: SttRecorderLike;
      if (source === "viewer") {
        const mediaElement = getActiveMediaElement();
        if (!mediaElement) {
          setSttStatus(t("sttViewerUnavailable"));
          return;
        }
        sttViewerMediaElementRef.current = mediaElement;
        sttMediaStartTimeRef.current = Math.max(0, mediaElement.currentTime || 0);
        const syncDetach = sttViewerSyncDetachRef.current as (() => void) | null;
        if (syncDetach) {
          syncDetach();
        }
        sttViewerSyncDetachRef.current = null;

        if (mode === "fast") {
          const sourceCandidates = [
            activeCanvas ? getCanvasMediaBodyUrl(activeCanvas, viewerState.vault) : null,
            mediaElement.currentSrc || null,
            mediaElement.src || null,
            ...Array.from(mediaElement.querySelectorAll("source"))
              .map((node) => node.getAttribute("src") || node.src || null),
          ]
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter((value): value is string => value.length > 0);
          const uniqueSourceCandidates = Array.from(new Set(sourceCandidates));
          const hasHlsCandidate = uniqueSourceCandidates.some((candidate) =>
            candidate.toLowerCase().includes(".m3u8"),
          );
          const task = { cancelled: false };
          sttFastTaskRef.current = task;
          recorder = {
            stop: async () => {
              task.cancelled = true;
            },
          };
          sttRecorderRef.current = recorder;
          setIsRecordingStt(true);

          void (async () => {
            try {
              const applyPartial = (partial: {
                fixedText: string;
                activeText: string;
                timestamp: number;
                metadata?: { latencySeconds: number; rtf: number };
              }) => {
                setSttFixedText(partial.fixedText);
                setSttActiveText(partial.activeText);
                setSttSessionDurationSeconds(partial.timestamp);
                if (partial.metadata) {
                  setSttMetrics({
                    latencySeconds: partial.metadata.latencySeconds,
                    rtf: partial.metadata.rtf,
                  });
                }

                const merged = mergeTranscriptionText(partial.fixedText, partial.activeText);
                const targetAnnotationId = sttTargetAnnotationIdRef.current;
                const targetLanguage = sttTargetLanguageRef.current;
                if (targetAnnotationId && merged && merged !== sttLastCommittedTextRef.current) {
                  commitLiveTranscription(targetAnnotationId, merged, targetLanguage);
                }
              };

              if (!hasHlsCandidate) {
                try {
                  const decodedAudio = await decodeViewerMediaAudio(
                    uniqueSourceCandidates,
                    sttMediaStartTimeRef.current ?? 0,
                  );
                  if (task.cancelled) {
                    return;
                  }

                  buffer.appendChunk(decodedAudio);
                  if (!sttHandlerRef.current) {
                    return;
                  }

                  for await (const partial of sttHandlerRef.current.transcribeBatch(decodedAudio)) {
                    if (task.cancelled) {
                      return;
                    }

                    applyPartial(partial);
                  }
                  if (!task.cancelled) {
                    await stopSttRecording(true);
                    setSttStatus(t("sttStopped"));
                  }
                  return;
                } catch {
                  // Fall back to hidden player demux for streams decodeAudioData cannot decode directly.
                }
              }

              const hiddenElement = createHiddenMediaElement();
              sttFastHiddenElementRef.current = hiddenElement;
              sttViewerMediaElementRef.current = hiddenElement;
              const detachHiddenSource = await attachHiddenMediaSource(
                hiddenElement,
                uniqueSourceCandidates,
              );
              sttFastHiddenDetachRef.current = detachHiddenSource;

              const seekTime = Math.max(0, sttMediaStartTimeRef.current ?? 0);
              if (seekTime > 0) {
                try {
                  hiddenElement.currentTime = seekTime;
                } catch {
                  // Ignore seek errors and start at the beginning.
                }
              }

              const hiddenRecorder = new ViewerAudioRecorder(onDataAvailable, {
                useCaptureStream: true,
                monitorOutput: false,
              });
              sttRecorderRef.current = hiddenRecorder;
              await hiddenRecorder.startFromElement(hiddenElement);
              hiddenElement.playbackRate = 1;
              await hiddenElement.play();

              while (!task.cancelled && !hiddenElement.ended) {
                const capturedAudio = buffer.getBuffer();
                if (capturedAudio.length >= PARAKEET_SAMPLE_RATE / 2 && sttHandlerRef.current) {
                  const partial = await sttHandlerRef.current.transcribeIncremental(capturedAudio);
                  if (task.cancelled) {
                    return;
                  }
                  applyPartial(partial);
                }

                await new Promise<void>((resolve) => {
                  window.setTimeout(resolve, sttUpdateFrequencyMs);
                });
              }

              if (!task.cancelled) {
                await stopSttRecording(true);
                setSttStatus(t("sttStopped"));
              }
            } catch (error) {
              if (task.cancelled) {
                return;
              }
              const message = error instanceof Error ? error.message : String(error);
              setSttStatus(t("sttViewerError", { message }));
              await stopSttRecording(false);
            }
          })();

          return;
        }

        const viewerRecorder = new ViewerAudioRecorder(onDataAvailable);
        await viewerRecorder.startFromElement(mediaElement);
        const stopForViewerTimelineChange = (reason: string) => {
          setSttStatus(t("sttViewerError", { message: reason }));
          void stopSttRecording(false);
        };
        const onSeeking = () => {
          stopForViewerTimelineChange("Viewer seek detected. Restart transcription to keep timestamps aligned.");
        };
        const onRateChange = () => {
          const playbackRate = Number.isFinite(mediaElement.playbackRate)
            ? mediaElement.playbackRate
            : 1;
          if (Math.abs(playbackRate - 1) > 0.001) {
            stopForViewerTimelineChange(
              `Playback speed changed to ${playbackRate.toFixed(2)}x. Restart at 1.0x for accurate timestamps.`,
            );
          }
        };

        mediaElement.addEventListener("seeking", onSeeking);
        mediaElement.addEventListener("ratechange", onRateChange);
        sttViewerSyncDetachRef.current = () => {
          mediaElement.removeEventListener("seeking", onSeeking);
          mediaElement.removeEventListener("ratechange", onRateChange);
        };
        if (mediaElement.paused) {
          void mediaElement.play().catch(() => undefined);
        }
        recorder = viewerRecorder;
      } else {
        const microphoneRecorder = new AudioRecorder(onDataAvailable);
        await microphoneRecorder.start();
        recorder = microphoneRecorder;
      }

      sttRecorderRef.current = recorder;
      setIsRecordingStt(true);

      sttIntervalRef.current = window.setInterval(async () => {
        if (sttTranscriptionInFlightRef.current || !sttBufferRef.current || !sttHandlerRef.current) {
          return;
        }

        const audio = sttBufferRef.current.getBuffer();
        if (audio.length < PARAKEET_SAMPLE_RATE / 2) {
          return;
        }

        sttTranscriptionInFlightRef.current = true;
        try {
          const partial =
            sttTranscriptionModeRef.current === "fast"
              ? await sttHandlerRef.current.transcribeBatchLatest(audio)
              : await sttHandlerRef.current.transcribeIncremental(audio);
          setSttFixedText(partial.fixedText);
          setSttActiveText(partial.activeText);
          setSttSessionDurationSeconds(partial.timestamp);

          if (partial.metadata) {
            setSttMetrics({
              latencySeconds: partial.metadata.latencySeconds,
              rtf: partial.metadata.rtf,
            });
          }

          const merged = mergeTranscriptionText(partial.fixedText, partial.activeText);
          const targetAnnotationId = sttTargetAnnotationIdRef.current;
          const targetLanguage = sttTargetLanguageRef.current;
          if (targetAnnotationId && merged && merged !== sttLastCommittedTextRef.current) {
            commitLiveTranscription(targetAnnotationId, merged, targetLanguage);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setSttStatus(t("sttStreamingError", { message }));
        } finally {
          sttTranscriptionInFlightRef.current = false;
        }
      }, sttUpdateFrequencyMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSttStatus(
        source === "viewer"
          ? t("sttViewerError", { message })
          : t("sttMicError", { message }),
      );
      await stopSttRecording(false);
    }
  }, [
    activeCanvas,
    commitLiveTranscription,
    handleLoadSttModel,
    isRecordingStt,
    normalizedDefaultTranslationLanguage,
    sttEnabled,
    sttLoadState,
    sttUpdateFrequencyMs,
    stopSttRecording,
    t,
    viewerState.vault,
  ]);

  const handleQuickStartStt = React.useCallback(async (
    source: SttInputSource,
    mode: SttTranscriptionMode,
  ) => {
    if (!isAvCanvas) {
      setSttStatus(t("sttViewerUnavailable"));
      return;
    }

    const annotationId = ensureSttTargetAnnotationId();
    if (!annotationId) {
      setSttStatus(t("sttNeedsSelection"));
      return;
    }

    await handleStartSttRecording(
      annotationId,
      normalizedDefaultTranslationLanguage,
      source,
      mode,
    );
  }, [
    ensureSttTargetAnnotationId,
    handleStartSttRecording,
    isAvCanvas,
    normalizedDefaultTranslationLanguage,
    t,
  ]);

  const handleStopSttRecording = React.useCallback(async () => {
    if (!isRecordingStt) {
      return;
    }

    setSttStatus(t("sttStopping"));
    await stopSttRecording(true);
    setSttStatus(t("sttStopped"));
  }, [isRecordingStt, stopSttRecording, t]);

  const stopSttRecordingRef = React.useRef(stopSttRecording);
  React.useEffect(() => {
    stopSttRecordingRef.current = stopSttRecording;
  }, [stopSttRecording]);

  React.useEffect(() => {
    return () => {
      void stopSttRecordingRef.current(false);
    };
  }, []);

  React.useEffect(() => {
    void stopSttRecordingRef.current(false);
    setSttFixedText("");
    setSttActiveText("");
    setSttSessionDurationSeconds(0);
    setSttMetrics(null);
    setSttStatus("");
    setSttRecordingAnnotationId(null);
    setRemoteWebVttByBodyId({});
  }, [activeCanvasId]);

  React.useEffect(() => {
    if (!annotator || runtime.localCloverMarks.length === 0) {
      return;
    }

    const pending = new Map<string, string | undefined>();
    for (const scholium of runtime.localCloverMarks) {
      const annotation = annotator.getAnnotationById(scholium.id) as
        | { bodies?: AnnotationBody[]; body?: unknown; target?: unknown }
        | undefined;
      if (!annotation) {
        continue;
      }

      const bodies = getAnnotationBodies(annotation);
      for (const body of bodies) {
        if (!isWebVttBody(body)) {
          continue;
        }

        const hasInlineValue = typeof body.value === "string" && body.value.trim().length > 0;
        if (hasInlineValue) {
          continue;
        }

        const bodyId = typeof body.id === "string" ? body.id.trim() : "";
        if (!bodyId) {
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(remoteWebVttByBodyId, bodyId)) {
          continue;
        }

        pending.set(bodyId, normalizeLanguageValue(body.language));
      }
    }

    if (pending.size === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const loaded: RemoteWebVttPayloadById = {};
      for (const [bodyId, language] of pending.entries()) {
        try {
          const response = await fetch(bodyId, {
            redirect: "follow",
            headers: {
              Accept: "text/vtt, text/plain, */*",
            },
          });
          if (!response.ok) {
            throw new Error(`Failed to load VTT (${response.status})`);
          }

          const text = await response.text();
          loaded[bodyId] = parseWebVttPayload(text, language) ?? null;
        } catch (error) {
          console.error("Failed to load remote WEBVTT body", bodyId, error);
          loaded[bodyId] = null;
        }
      }

      if (cancelled || Object.keys(loaded).length === 0) {
        return;
      }

      setRemoteWebVttByBodyId((current) => ({
        ...current,
        ...loaded,
      }));
    })();

    return () => {
      cancelled = true;
    };
  }, [annotator, remoteWebVttByBodyId, runtime.localCloverMarks]);

  const handleExportAnnotations = React.useCallback(() => {
    const storedByCanvasIdForExport = getAllStoredCanvasAnnotations();
    const totalAnnotations = Object.values(storedByCanvasIdForExport).reduce(
      (total, annotations) => total + annotations.length,
      0,
    );

    if (totalAnnotations === 0) {
      setExportMessage(t("exportNoAnnotations"));
      return;
    }

    const annotationPage = buildAnnotationPageExport({
      manifestId: viewerState.activeManifest,
      canvasOrder: exportCanvasOrder,
      storedByCanvasId: storedByCanvasIdForExport,
    });

    downloadAnnotationPageExport(annotationPage);
    setExportMessage(t("exportSuccess", { count: totalAnnotations }));
  }, [exportCanvasOrder, t, viewerState.activeManifest]);

  const handleFocusScholium = React.useCallback(
    (annotationId: string) => {
      if (!annotator || !annotationId) {
        return;
      }

      annotator.setSelected(annotationId, true);
      try {
        annotator.fitBounds(annotationId, { padding: 0.2 });
      } catch {
        // Some selectors are non-spatial; selection still works without fitBounds.
      }
    },
    [annotator],
  );

  const handleDeleteScholium = React.useCallback(
    (annotationId: string) => {
      if (!annotator || !annotationId) {
        return;
      }

      annotator.removeAnnotation(annotationId);
    },
    [annotator],
  );

  const handleSaveTextBody = React.useCallback(
    (annotationId: string, purpose: "tagging" | "commenting", value: string) => {
      if (!annotator || !annotationId) {
        return;
      }

      const annotation = annotator.getAnnotationById(annotationId) as
        | { bodies?: Array<{ purpose?: string; value?: string; [key: string]: unknown }> }
        | undefined;

      if (!annotation) {
        return;
      }

      const bodies = Array.isArray(annotation.bodies)
        ? annotation.bodies.map((body) => ({ ...body }))
        : [];

      updateBodyValue(bodies, purpose, value);
      annotator.updateAnnotation({
        ...(annotation as Record<string, unknown>),
        id: annotationId,
        bodies,
      });
    },
    [annotator],
  );

  const handleSaveMotivation = React.useCallback(
    (annotationId: string, nextMotivation: string) => {
      if (!annotator || !annotationId) {
        return;
      }

      const annotation = annotator.getAnnotationById(annotationId) as
        | AnnotationLike
        | undefined;

      if (!annotation) {
        return;
      }

      const trimmed = nextMotivation.trim();
      annotator.updateAnnotation({
        ...(annotation as Record<string, unknown>),
        id: annotationId,
        motivation: trimmed ? trimmed : undefined,
      });
    },
    [annotator],
  );

  const handleTranslationDraftChange = React.useCallback(
    (annotationId: string, field: "language" | "value", value: string) => {
      if (
        field === "language" &&
        sttRecordingAnnotationId === annotationId
      ) {
        sttTargetLanguageRef.current =
          value.trim().toLowerCase() || normalizedDefaultTranslationLanguage;
      }

      setTranslationDraftByAnnotation((current) => {
        const existing = current[annotationId] ?? {
          language: normalizedDefaultTranslationLanguage,
          value: "",
        };
        return {
          ...current,
          [annotationId]: {
            ...existing,
            [field]: value,
          },
        };
      });
    },
    [normalizedDefaultTranslationLanguage, sttRecordingAnnotationId],
  );

  const handleUpdateSupplementingTranslation = React.useCallback(
    (annotationId: string, index: number, patch: Partial<{ language: string; value: string }>) => {
      if (!annotator || !annotationId || index < 0) {
        return;
      }

      const annotation = annotator.getAnnotationById(annotationId) as
        | { bodies?: Array<{ purpose?: string; value?: string; language?: string; [key: string]: unknown }> }
        | undefined;

      if (!annotation) {
        return;
      }

      const existingBodies = Array.isArray(annotation.bodies)
        ? annotation.bodies.map((body) => ({ ...body }))
        : [];
      const existingTranslations = getSupplementingBodies(existingBodies);
      if (index >= existingTranslations.length) {
        return;
      }

      const nextTranslations = [...existingTranslations];
      nextTranslations[index] = {
        ...nextTranslations[index],
        ...patch,
      };
      const nextBodies = replaceSupplementingBodies(existingBodies, nextTranslations);

      annotator.updateAnnotation({
        ...(annotation as Record<string, unknown>),
        id: annotationId,
        bodies: nextBodies,
      });
    },
    [annotator],
  );

  const handleAppendSupplementingTranslation = React.useCallback(
    (annotationId: string) => {
      if (!annotationId) {
        return;
      }

      const draft = translationDraftByAnnotation[annotationId] ?? {
        language: normalizedDefaultTranslationLanguage,
        value: "",
      };
      const value = draft.value.trim();
      if (!value) {
        return;
      }
      appendSupplementingTranslationValue(annotationId, draft.language, value, true);
    },
    [
      appendSupplementingTranslationValue,
      normalizedDefaultTranslationLanguage,
      translationDraftByAnnotation,
    ],
  );

  const handleDeleteSupplementingTranslation = React.useCallback(
    (annotationId: string, index: number) => {
      if (!annotator || !annotationId || index < 0) {
        return;
      }

      const annotation = annotator.getAnnotationById(annotationId) as
        | { bodies?: Array<{ purpose?: string; value?: string; language?: string; [key: string]: unknown }> }
        | undefined;

      if (!annotation) {
        return;
      }

      const existingBodies = Array.isArray(annotation.bodies)
        ? annotation.bodies.map((body) => ({ ...body }))
        : [];
      const existingTranslations = getSupplementingBodies(existingBodies);
      if (index >= existingTranslations.length) {
        return;
      }

      const nextTranslations = existingTranslations.filter((_, translationIndex) => translationIndex !== index);
      const nextBodies = replaceSupplementingBodies(existingBodies, nextTranslations);

      annotator.updateAnnotation({
        ...(annotation as Record<string, unknown>),
        id: annotationId,
        bodies: nextBodies,
      });
    },
    [annotator],
  );

  const timedTranscriptByAnnotation = React.useMemo(() => {
    const result: Record<string, TimedTranscriptPayload | undefined> = {};
    if (!annotator) {
      return result;
    }

    for (const scholium of runtime.localCloverMarks) {
      const annotation = annotator.getAnnotationById(scholium.id) as
        | { bodies?: AnnotationBody[]; body?: unknown; target?: unknown }
        | undefined;
      if (!annotation) {
        continue;
      }
      const bodies = getAnnotationBodies(annotation);
      const timedTranscript = getTimedTranscriptPayload(bodies, remoteWebVttByBodyId);
      if (timedTranscript) {
        result[scholium.id] = timedTranscript.payload;
        continue;
      }

      const firstSupplementing = scholium.translations.find((translation) =>
        translation.purpose === "supplementing" && translation.value.trim().length > 0,
      );
      if (!firstSupplementing) {
        continue;
      }

      const fromSelector = scholium.selectorText
        ? parseTemporalRangeFromSelectorText(scholium.selectorText)
        : null;
      const fromTarget = parseTemporalRangeFromTarget(annotation.target);
      const start = fromSelector?.start ?? fromTarget?.start ?? 0;
      const end = fromSelector?.end ?? fromTarget?.end ?? start;
      const approximate = buildApproximateTimedPayloadFromText(
        firstSupplementing.value,
        firstSupplementing.language,
        start,
        end,
      );
      if (approximate) {
        result[scholium.id] = approximate;
      }
    }

    return result;
  }, [annotator, remoteWebVttByBodyId, runtime.localCloverMarks]);

  const totalStoredAnnotationCountForExport = Object.values(
    getAllStoredCanvasAnnotations(),
  ).reduce((total, annotations) => total + annotations.length, 0);
  const hasAnnotationsToExport = totalStoredAnnotationCountForExport > 0;

  const exportableWebVttCues = React.useMemo(
    () =>
      runtime.localCloverMarks.flatMap((scholium) => {
        const timedTranscript = timedTranscriptByAnnotation[scholium.id];
        if (!timedTranscript || timedTranscript.words.length === 0) {
          return [];
        }

        return segmentWordsIntoWebVttCues(timedTranscript.words);
      }),
    [runtime.localCloverMarks, timedTranscriptByAnnotation],
  );
  const hasWebVttToExport = exportableWebVttCues.length > 0;

  const handleExportWebVtt = React.useCallback(() => {
    if (exportableWebVttCues.length === 0) {
      setExportMessage(t("exportNoWebVtt"));
      return;
    }

    downloadWebVttExport(serializeWebVttCues(exportableWebVttCues));
    setExportMessage(t("exportWebVttSuccess", { count: exportableWebVttCues.length }));
  }, [exportableWebVttCues, t]);

  const handleUpdateTimedTranscriptWord = React.useCallback(
    (annotationId: string, wordIndex: number, nextValue: string) => {
      if (!annotator || !annotationId || wordIndex < 0) {
        return;
      }

      const normalizedValue = nextValue.trim();
      if (!normalizedValue) {
        return;
      }

      const annotation = annotator.getAnnotationById(annotationId) as
        | { bodies?: AnnotationBody[]; body?: unknown; target?: unknown }
        | undefined;
      if (!annotation) {
        return;
      }

      const existingBodies = getAnnotationBodies(annotation);
      const timed = getTimedTranscriptPayload(existingBodies, remoteWebVttByBodyId)
        ?? (() => {
          const approximate = buildApproximateTimedPayloadFromAnnotation(annotation);
          if (!approximate) {
            return null;
          }
          return { payload: approximate, index: -1 };
        })();
      if (!timed || wordIndex >= timed.payload.words.length) {
        return;
      }

      const nextWords = timed.payload.words.map((word, index) =>
        index === wordIndex
          ? {
            ...word,
            text: normalizedValue,
          }
          : word,
      );
      const nextPayload: TimedTranscriptPayload = {
        schema: STT_TIMED_WORDS_SCHEMA,
        ...(timed.payload.language ? { language: timed.payload.language } : {}),
        words: nextWords,
      };

      let nextBodies = upsertTimedTranscriptPayloadBody(existingBodies, nextPayload);
      const updatedText = buildTimedTranscriptText(nextWords);
      if (updatedText) {
        const translations = getSupplementingBodies(nextBodies);
        let targetTranslationIndex = -1;
        if (nextPayload.language) {
          targetTranslationIndex = translations.findIndex(
            (translation) =>
              (translation.language ?? "").trim().toLowerCase() === nextPayload.language,
          );
        }
        if (targetTranslationIndex < 0 && translations.length > 0) {
          targetTranslationIndex = 0;
        }

        const effectiveLanguage = nextPayload.language
          ?? (translations[targetTranslationIndex]?.language?.trim().toLowerCase() || undefined)
          ?? normalizedDefaultTranslationLanguage;
        const nextTranslations = [...translations];
        if (targetTranslationIndex >= 0) {
          nextTranslations[targetTranslationIndex] = {
            ...nextTranslations[targetTranslationIndex],
            value: updatedText,
            language: nextTranslations[targetTranslationIndex].language ?? effectiveLanguage,
          };
        } else {
          nextTranslations.push({
            value: updatedText,
            language: effectiveLanguage,
          });
        }
        nextBodies = replaceSupplementingBodies(nextBodies, nextTranslations);

        setTranslationDraftByAnnotation((current) => ({
          ...current,
          [annotationId]: {
            language: effectiveLanguage,
            value: updatedText,
          },
        }));
      }

      annotator.updateAnnotation({
        ...(annotation as Record<string, unknown>),
        id: annotationId,
        bodies: nextBodies,
      });
    },
    [annotator, normalizedDefaultTranslationLanguage, remoteWebVttByBodyId],
  );

  const handleSeekToTimedWord = React.useCallback(
    (annotationId: string, timeSeconds: number) => {
      const safeSeconds = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;
      handleFocusScholium(annotationId);

      const mediaElement = getActiveMediaElement();
      if (!mediaElement) {
        setSttStatus(t("sttViewerUnavailable"));
        return;
      }

      try {
        mediaElement.currentTime = safeSeconds;
      } catch {
        setSttStatus(
          t("sttViewerError", { message: "Could not seek to the selected timestamp." }),
        );
      }
    },
    [handleFocusScholium, t],
  );

  return (
    <section
      ref={panelRootRef}
      className="clover-mark-panel-root"
      style={{ display: "grid", gap: "1rem", padding: "1.15rem 1rem 1.5rem", position: "relative" }}
    >
      <style>{CLOVER_MARK_PANEL_LAYOUT_CSS}</style>
      <button
        type="button"
        className="clover-mark-panel-resize-handle"
        onPointerDown={handlePanelResizePointerDown}
        onPointerMove={handlePanelResizePointerMove}
        onPointerUp={handlePanelResizePointerEnd}
        onPointerCancel={handlePanelResizePointerEnd}
        onLostPointerCapture={handlePanelResizePointerEnd}
        onKeyDown={handlePanelResizeKeyDown}
        data-resizing={isResizingPanel ? "true" : "false"}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize CloverMark panel"
        aria-valuemin={PANEL_WIDTH_MIN_PERCENT}
        aria-valuemax={PANEL_WIDTH_MAX_PERCENT}
        aria-valuenow={Math.round(panelWidthPercent)}
        title="Drag to resize CloverMark panel"
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.65rem" }}>
        {sttEnabled ? (
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.75rem", color: "#4b5563", fontWeight: 600 }}>
              {t("sttModelStateLabel")}:
            </span>
            {sttLoadState === "error" || sttLoadState === "not_loaded" ? (
              <button
                type="button"
                onClick={() => {
                  void handleLoadSttModel();
                }}
                style={{
                  fontSize: "0.72rem",
                  lineHeight: 1,
                  fontWeight: 600,
                  padding: "0.2rem 0.45rem",
                  borderRadius: "999px",
                  color: sttLazyModelIndicator.color,
                  background: sttLazyModelIndicator.background,
                  border: `1px solid ${sttLazyModelIndicator.border}`,
                  cursor: "pointer",
                }}
                title={sttBackend ? `${sttModel} (${sttBackend})` : sttModel}
              >
                {sttLazyModelIndicator.text} ·{" "}
                {sttLoadState === "error" ? t("sttModelStateRetry") : t("sttModelStateLoadNow")}
              </button>
            ) : (
              <span
                style={{
                  fontSize: "0.72rem",
                  lineHeight: 1,
                  fontWeight: 600,
                  padding: "0.2rem 0.45rem",
                  borderRadius: "999px",
                  color: sttLazyModelIndicator.color,
                  background: sttLazyModelIndicator.background,
                  border: `1px solid ${sttLazyModelIndicator.border}`,
                }}
                title={sttBackend ? `${sttModel} (${sttBackend})` : sttModel}
              >
                {sttLazyModelIndicator.text}
              </span>
            )}
          </div>
        ) : null}
      </div>
      <section style={{ display: "grid", gap: "0.5rem" }}>
        <button
          type="button"
          onClick={handleExportAnnotations}
          disabled={!hasAnnotationsToExport}
        >
          {t("exportAnnotations")}
        </button>
        <button
          type="button"
          onClick={handleExportWebVtt}
          disabled={!hasWebVttToExport}
        >
          {t("exportWebVtt")}
        </button>
        {exportMessage ? (
          <p style={{ margin: 0, fontSize: "0.85rem" }}>{exportMessage}</p>
        ) : null}
      </section>

      <section>
        <h4 style={{ margin: "0 0 0.6rem" }}>{t("sessionCloverMarks")}</h4>
        {runtime.localCloverMarks.length === 0 ? (
          <div style={{ display: "grid", gap: "0.5rem" }}>
            <p style={{ margin: 0 }}>{t("noSessionCloverMarks")}</p>
            {sttEnabled && isAvCanvas ? (
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    void handleQuickStartStt("viewer", "realtime");
                  }}
                  disabled={sttLoadState === "loading" || isRecordingStt}
                >
                  {t("sttStartViewer")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleQuickStartStt("viewer", "fast");
                  }}
                  disabled={sttLoadState === "loading" || isRecordingStt}
                >
                  {t("sttStartViewerFast")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleQuickStartStt("microphone", "realtime");
                  }}
                  disabled={sttLoadState === "loading" || isRecordingStt}
                >
                  {t("sttStartRecording")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleStopSttRecording();
                  }}
                  disabled={!isRecordingStt}
                >
                  {t("sttStopRecording")}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: "0.8rem" }}>
            {runtime.localCloverMarks.map((scholium) => {
              const isSelected = scholium.id === runtime.selectedLocalScholiumId;
              const selectedMotivation = (
                scholium.motivation ??
                normalizedDefaultMotivation ??
                availableMotivations[0] ??
                ""
              ).trim();
              const bodyLabel = getBodyLabelForMotivation(selectedMotivation, t);
              const translationDraft = translationDraftByAnnotation[scholium.id] ?? {
                language: normalizedDefaultTranslationLanguage,
                value: "",
              };
              const timedTranscript = timedTranscriptByAnnotation[scholium.id];
              const supplementingTranslations = scholium.translations.filter(
                (translation) => translation.purpose === "supplementing",
              );
              const shouldShowSupplementingTranslations =
                selectedMotivation.trim().toLowerCase() === "supplementing";
              return (
                <li
                  key={scholium.id}
                  style={{
                    border: isSelected ? "1px solid #2563eb" : "1px solid #d1d5db",
                    borderRadius: "0.6rem",
                    padding: "0.75rem",
                    display: "grid",
                    gap: "0.55rem",
                  }}
                >
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", justifyContent: "space-between" }}>
                    <button type="button" onClick={() => handleFocusScholium(scholium.id)}>
                      {t("focusScholium")}
                    </button>
                    <button type="button" onClick={() => handleDeleteScholium(scholium.id)}>
                      {t("deleteScholium")}
                    </button>
                  </div>
                  <label style={{ display: "grid", gap: "0.3rem" }}>
                    <span>{t("scholiumLabel")}</span>
                    <input
                      key={`${scholium.id}-label-${scholium.label}`}
                      defaultValue={scholium.label}
                      onBlur={(event) =>
                        handleSaveTextBody(scholium.id, "tagging", event.currentTarget.value)
                      }
                      onKeyDown={(event) =>
                        commitInputOnEnter(event, (value) =>
                          handleSaveTextBody(scholium.id, "tagging", value),
                        )
                      }
                    />
                  </label>
                  {!shouldShowSupplementingTranslations ? (
                    <label style={{ display: "grid", gap: "0.3rem" }}>
                      <span>{bodyLabel}</span>
                      <textarea
                        key={`${scholium.id}-comment-${scholium.comment}`}
                        defaultValue={scholium.comment}
                        rows={4}
                        onBlur={(event) =>
                          handleSaveTextBody(scholium.id, "commenting", event.currentTarget.value)
                        }
                        onKeyDown={(event) =>
                          commitTextareaOnKey(event, (value) =>
                            handleSaveTextBody(scholium.id, "commenting", value),
                          )
                        }
                      />
                    </label>
                  ) : null}
                  <label style={{ display: "grid", gap: "0.3rem" }}>
                    <span>{t("motivation")}</span>
                    <select
                      value={selectedMotivation}
                      onChange={(event) =>
                        handleSaveMotivation(scholium.id, event.currentTarget.value)
                      }
                    >
                      {availableMotivations.map((motivation) => (
                        <option key={motivation} value={motivation}>
                          {getMotivationLabel(motivation, t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {shouldShowSupplementingTranslations ? (
                    <section style={{ display: "grid", gap: "0.55rem" }}>
                      <strong>{bodyLabel}</strong>
                      {supplementingTranslations.length === 0 ? (
                        <p style={{ margin: 0, fontSize: "0.85rem" }}>{t("translationNone")}</p>
                      ) : (
                        <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: "0.45rem" }}>
                          {supplementingTranslations.map((translation, index) => (
                            <li
                              key={`${scholium.id}-translation-${index}`}
                              style={{
                                display: "grid",
                                gap: "0.4rem",
                                border: "1px solid #d1d5db",
                                borderRadius: "0.45rem",
                                padding: "0.55rem",
                              }}
                            >
                              <label style={{ display: "grid", gap: "0.3rem" }}>
                                <span>{t("translationLanguage")}</span>
                                <select
                                  value={translation.language ?? normalizedDefaultTranslationLanguage}
                                  onChange={(event) =>
                                    handleUpdateSupplementingTranslation(
                                      scholium.id,
                                      index,
                                      { language: event.currentTarget.value },
                                    )
                                  }
                                >
                                  {availableTranslationLanguages.map((language) => (
                                    <option key={language} value={language}>
                                      {language}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label style={{ display: "grid", gap: "0.3rem" }}>
                                <span>{t("translationText")}</span>
                                <textarea
                                  rows={3}
                                  value={translation.value}
                                  onChange={(event) =>
                                    handleUpdateSupplementingTranslation(
                                      scholium.id,
                                      index,
                                      { value: event.currentTarget.value },
                                    )
                                  }
                                />
                              </label>
                              <div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDeleteSupplementingTranslation(scholium.id, index)
                                  }
                                >
                                  {t("translationDelete")}
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                      <label style={{ display: "grid", gap: "0.3rem" }}>
                        <span>{t("translationLanguage")}</span>
                        <select
                          value={translationDraft.language || normalizedDefaultTranslationLanguage}
                          onChange={(event) =>
                            handleTranslationDraftChange(
                              scholium.id,
                              "language",
                              event.currentTarget.value,
                            )
                          }
                        >
                          {availableTranslationLanguages.map((language) => (
                            <option key={language} value={language}>
                              {language}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={{ display: "grid", gap: "0.3rem" }}>
                        <span>{t("translationText")}</span>
                        <textarea
                          rows={4}
                          value={translationDraft.value}
                          onChange={(event) =>
                            handleTranslationDraftChange(
                              scholium.id,
                              "value",
                              event.currentTarget.value,
                            )
                          }
                          placeholder={t("translationTextPlaceholder")}
                        />
                      </label>
                      {sttEnabled ? (
                        <section
                          style={{
                            display: "grid",
                            gap: "0.45rem",
                            border: "1px solid #d1d5db",
                            borderRadius: "0.45rem",
                            padding: "0.55rem",
                          }}
                        >
                          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => {
                                void handleLoadSttModel();
                              }}
                              disabled={sttLoadState === "loading"}
                            >
                              {sttLoadState === "ready" ? t("sttReloadModel") : t("sttLoadModel")}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void handleStartSttRecording(
                                  scholium.id,
                                  translationDraft.language || normalizedDefaultTranslationLanguage,
                                );
                              }}
                              disabled={
                                sttLoadState === "loading" ||
                                isRecordingStt
                              }
                            >
                              {t("sttStartRecording")}
                            </button>
                            {isAvCanvas ? (
                              <button
                                type="button"
                                onClick={() => {
                                  void handleStartSttRecording(
                                    scholium.id,
                                    translationDraft.language || normalizedDefaultTranslationLanguage,
                                    "viewer",
                                    "realtime",
                                  );
                                }}
                                disabled={
                                  sttLoadState === "loading" ||
                                  isRecordingStt
                                }
                              >
                                {t("sttStartViewer")}
                              </button>
                            ) : null}
                            {isAvCanvas ? (
                              <button
                                type="button"
                                onClick={() => {
                                  void handleStartSttRecording(
                                    scholium.id,
                                    translationDraft.language || normalizedDefaultTranslationLanguage,
                                    "viewer",
                                    "fast",
                                  );
                                }}
                                disabled={
                                  sttLoadState === "loading" ||
                                  isRecordingStt
                                }
                              >
                                {t("sttStartViewerFast")}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => {
                                void handleStopSttRecording();
                              }}
                              disabled={!isRecordingStt || sttRecordingAnnotationId !== scholium.id}
                            >
                              {t("sttStopRecording")}
                            </button>
                          </div>
                          {sttRecordingAnnotationId === scholium.id ? (
                            <>
                              <div style={{ fontSize: "0.8rem" }}>
                                <strong>{t("sttStatus")}:</strong> {sttStatus || t("sttIdle")}
                                {" "}
                                ({sttInputSource === "viewer" ? t("sttSourceViewer") : t("sttSourceMic")})
                              </div>
                              <div
                                style={{
                                  height: "0.45rem",
                                  width: "100%",
                                  borderRadius: "999px",
                                  background: "#e5e7eb",
                                  overflow: "hidden",
                                }}
                              >
                                <div
                                  style={{
                                    height: "100%",
                                    width: `${Math.max(0, Math.min(100, micLevel))}%`,
                                    background: "#2563eb",
                                    transition: "width 80ms linear",
                                  }}
                                />
                              </div>
                            </>
                          ) : null}
                        </section>
                      ) : null}
                      <div>
                        <button
                          type="button"
                          onClick={() => handleAppendSupplementingTranslation(scholium.id)}
                        >
                          {t("translationAdd")}
                        </button>
                      </div>
                    </section>
                  ) : null}
                  {timedTranscript && timedTranscript.words.length > 0 ? (
                    <section
                      style={{
                        display: "grid",
                        gap: "0.45rem",
                        border: "1px dashed #9ca3af",
                        borderRadius: "0.45rem",
                        padding: "0.55rem",
                        background: "#f9fafb",
                      }}
                    >
                      <strong>{t("sttTimedWordsLabel")}</strong>
                      <p style={{ margin: 0, fontSize: "0.75rem", color: "#4b5563" }}>
                        {t("sttTimedWordsHint")}
                      </p>
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 0,
                          listStyle: "none",
                          display: "grid",
                          gap: "0.35rem",
                          maxHeight: "14rem",
                          overflow: "auto",
                        }}
                      >
                        {timedTranscript.words.map((word, wordIndex) => (
                          <li
                            key={`${scholium.id}-timed-word-${wordIndex}-${word.start_time}-${word.end_time}`}
                            style={{
                              display: "grid",
                              gap: "0.35rem",
                              gridTemplateColumns: "8.25rem 1fr",
                              alignItems: "center",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                handleSeekToTimedWord(scholium.id, word.start_time)
                              }
                              title={`Jump to ${word.start_time.toFixed(2)} seconds`}
                              style={{
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                fontSize: "0.72rem",
                                color: "#1f2937",
                                background: "#e5e7eb",
                                borderRadius: "999px",
                                padding: "0.1rem 0.4rem",
                                display: "inline-flex",
                                justifyContent: "center",
                                border: "none",
                                cursor: "pointer",
                              }}
                            >
                              {word.start_time.toFixed(2)}-{word.end_time.toFixed(2)}s
                            </button>
                            <input
                              key={`${scholium.id}-timed-word-input-${wordIndex}-${word.text}`}
                              defaultValue={word.text}
                              onBlur={(event) =>
                                handleUpdateTimedTranscriptWord(
                                  scholium.id,
                                  wordIndex,
                                  event.currentTarget.value,
                                )
                              }
                              onKeyDown={(event) =>
                                commitInputOnEnter(event, (value) =>
                                  handleUpdateTimedTranscriptWord(scholium.id, wordIndex, value),
                                )
                              }
                            />
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  {scholium.source ? (
                    <div style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>
                      <strong>{t("scholiumSource")}:</strong> {scholium.source}
                    </div>
                  ) : null}
                  {scholium.selectorText ? (
                    <div style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>
                      <strong>{t("scholiumSelector")}:</strong> {getSelectorLabel(scholium.selectorText, t)}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
};

export const cloverMarkPanel = CloverMarkPanel;
