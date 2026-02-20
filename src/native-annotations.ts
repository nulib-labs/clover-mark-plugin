import type { StoredAnnotation } from "./annotation-runtime";
import {
  parseWebVttCues,
  segmentWordsIntoWebVttCues,
  serializeWebVttCues,
  type TimedWordLike,
} from "./webvtt";

const STT_TIMED_WORDS_SCHEMA = "clover.parakeet.word_timestamps.v1";
const STT_TIMED_WORDS_BODY_PURPOSE = "describing";
const STT_TIMED_WORDS_BODY_FORMAT = "application/json";
const WEBVTT_BODY_FORMAT = "text/vtt";

export const CLOVER_MARK_NATIVE_PAGE_SUFFIX = "#clover-mark-native-annotations";

type UnknownRecord = Record<string, unknown>;

type NativeAnnotationPage = {
  id: string;
  type: "AnnotationPage";
  items: Array<Record<string, unknown>>;
};

type VaultLike = {
  loadSync: (id: string, json: unknown) => unknown;
  get: (ref: any) => unknown;
  modifyEntityField: (entity: any, key: string, value: any) => void;
};

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeBodySource(annotation: StoredAnnotation): unknown[] {
  if ("body" in annotation) {
    return ensureArray(annotation.body as unknown);
  }
  return ensureArray(annotation.bodies as unknown);
}

function toDataUriWebVtt(vtt: string): string {
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(vtt)}`;
}

function normalizeTimedWords(rawWords: unknown): TimedWordLike[] {
  if (!Array.isArray(rawWords)) {
    return [];
  }

  return rawWords
    .map((rawWord): TimedWordLike | undefined => {
      if (!rawWord || typeof rawWord !== "object") {
        return undefined;
      }
      const candidate = rawWord as Record<string, unknown>;
      const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
      const start = typeof candidate.start_time === "number" ? candidate.start_time : NaN;
      const end = typeof candidate.end_time === "number" ? candidate.end_time : NaN;
      if (!text || !Number.isFinite(start) || !Number.isFinite(end)) {
        return undefined;
      }
      return {
        text,
        start_time: Math.max(0, start),
        end_time: Math.max(Math.max(0, start), Math.max(0, end)),
      };
    })
    .filter((word): word is TimedWordLike => Boolean(word));
}

function extractSegmentedVttBodyValue(body: UnknownRecord): string | undefined {
  const format = typeof body.format === "string" ? body.format.trim().toLowerCase() : "";
  const value = typeof body.value === "string" ? body.value : "";

  if (format === WEBVTT_BODY_FORMAT && value.trim().length > 0) {
    const cues = parseWebVttCues(value);
    const words = cues.map((cue) => ({
      text: cue.text,
      start_time: cue.start_time,
      end_time: cue.end_time,
    }));
    const segmented = segmentWordsIntoWebVttCues(words);
    return serializeWebVttCues(segmented.length > 0 ? segmented : cues);
  }

  if (
    format.includes("json")
    && typeof body.purpose === "string"
    && body.purpose.trim().toLowerCase() === STT_TIMED_WORDS_BODY_PURPOSE
    && value.trim().length > 0
  ) {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (parsed.schema !== STT_TIMED_WORDS_SCHEMA) {
        return undefined;
      }
      const words = normalizeTimedWords(parsed.words);
      if (words.length === 0) {
        return undefined;
      }
      const segmented = segmentWordsIntoWebVttCues(words);
      if (segmented.length === 0) {
        return undefined;
      }
      return serializeWebVttCues(segmented);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function normalizeTextBody(
  body: UnknownRecord,
  annotationId: string,
  bodyIndex: number,
): Record<string, unknown> | null {
  const segmentedVttValue = extractSegmentedVttBodyValue(body);
  if (segmentedVttValue) {
    return {
      id: toDataUriWebVtt(segmentedVttValue),
      type: "TextualBody",
      format: WEBVTT_BODY_FORMAT,
      ...(typeof body.language === "string" && body.language.trim().length > 0
        ? { language: body.language.trim().toLowerCase() }
        : {}),
    };
  }

  const hasExternalVttRef =
    typeof body.format === "string"
    && body.format.trim().toLowerCase() === WEBVTT_BODY_FORMAT
    && typeof body.id === "string"
    && body.id.trim().length > 0;
  if (hasExternalVttRef) {
    return {
      id: body.id,
      type: "TextualBody",
      format: WEBVTT_BODY_FORMAT,
      ...(typeof body.language === "string" && body.language.trim().length > 0
        ? { language: body.language.trim().toLowerCase() }
        : {}),
    };
  }

  if (typeof body.value !== "string" || body.value.trim().length === 0) {
    return null;
  }

  const nextBody: Record<string, unknown> = {
    id:
      typeof body.id === "string" && body.id.trim().length > 0
        ? body.id
        : `${annotationId}#body-${bodyIndex + 1}`,
    type: typeof body.type === "string" && body.type.trim().length > 0 ? body.type : "TextualBody",
    value: body.value.trim(),
  };

  for (const key of ["purpose", "format", "language"] as const) {
    const keyValue = body[key];
    if (typeof keyValue === "string" && keyValue.trim().length > 0) {
      nextBody[key] = key === "language" ? keyValue.trim().toLowerCase() : keyValue.trim();
    }
  }

  return nextBody;
}

function isWebVttTextBody(body: Record<string, unknown>): boolean {
  const format = typeof body.format === "string" ? body.format.trim().toLowerCase() : "";
  if (format === WEBVTT_BODY_FORMAT) {
    return true;
  }

  const bodyId = typeof body.id === "string" ? body.id.trim().toLowerCase() : "";
  return bodyId.startsWith("data:text/vtt");
}

function prioritizeNativeBodyOrder(
  bodies: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const firstWebVttIndex = bodies.findIndex((body) => isWebVttTextBody(body));
  if (firstWebVttIndex <= 0) {
    return bodies;
  }

  const reordered = [...bodies];
  const [webVttBody] = reordered.splice(firstWebVttIndex, 1);
  if (webVttBody) {
    reordered.unshift(webVttBody);
  }
  return reordered;
}

function normalizeTarget(target: unknown, canvasId: string): unknown {
  const fallbackTarget = {
    type: "SpecificResource",
    source: {
      id: canvasId,
      type: "Canvas",
    },
  };

  if (!target) {
    return fallbackTarget;
  }

  if (typeof target === "string") {
    const trimmed = target.trim();
    if (trimmed.length === 0) {
      return fallbackTarget;
    }

    const hashIndex = trimmed.indexOf("#");
    const sourceId = (hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed).trim() || canvasId;
    const fragment = hashIndex >= 0 ? trimmed.slice(hashIndex + 1).trim() : "";

    return {
      type: "SpecificResource",
      source: {
        id: sourceId,
        type: "Canvas",
      },
      ...(fragment
        ? {
            selector: {
              type: "FragmentSelector",
              value: fragment,
            },
          }
        : {}),
    };
  }

  if (typeof target === "object") {
    const normalizedTarget = { ...(target as Record<string, unknown>) };
    const source = normalizedTarget.source;
    const sourceFromTargetId =
      typeof normalizedTarget.id === "string" && normalizedTarget.id.trim().length > 0
        ? normalizedTarget.id.trim()
        : undefined;
    const sourceId =
      typeof source === "string" && source.trim().length > 0
        ? source.trim()
        : typeof source === "object" && source && typeof (source as Record<string, unknown>).id === "string"
          ? (((source as Record<string, unknown>).id as string).trim() || canvasId)
          : sourceFromTargetId || canvasId;

    if (!source || typeof source === "string") {
      normalizedTarget.source = {
        id: sourceId,
        type: "Canvas",
      };
      return normalizedTarget;
    }

    const normalizedSource = { ...(source as Record<string, unknown>) };
    if (typeof normalizedSource.id !== "string" || normalizedSource.id.trim().length === 0) {
      normalizedSource.id = sourceId;
    }
    if (typeof normalizedSource.type !== "string" || normalizedSource.type.trim().length === 0) {
      normalizedSource.type = "Canvas";
    }

    normalizedTarget.source = normalizedSource;
    return normalizedTarget;
  }

  return fallbackTarget;
}

export function getNativeAnnotationPageId(canvasId: string): string {
  return `${canvasId}${CLOVER_MARK_NATIVE_PAGE_SUFFIX}`;
}

export function hasNativeAnnotationPageRef(
  vault: Pick<VaultLike, "get">,
  canvasId: string,
): boolean {
  const pageId = getNativeAnnotationPageId(canvasId);
  const canvas = vault.get({ id: canvasId, type: "Canvas" }) as
    | { annotations?: Array<{ id?: string } | string> }
    | undefined;
  const existing = ensureArray(canvas?.annotations);

  return existing.some((entry) => {
    if (typeof entry === "string") {
      return entry === pageId;
    }
    return entry?.id === pageId;
  });
}

export function buildNativeAnnotationPageForCanvas(
  canvasId: string,
  annotations: StoredAnnotation[],
): NativeAnnotationPage {
  const pageId = getNativeAnnotationPageId(canvasId);
  const items: Array<Record<string, unknown>> = [];

  for (let annotationIndex = 0; annotationIndex < annotations.length; annotationIndex += 1) {
    const annotation = annotations[annotationIndex];
    const annotationId =
      typeof annotation.id === "string" && annotation.id.trim().length > 0
        ? annotation.id
        : `${pageId}/annotation-${annotationIndex + 1}`;
    const target = normalizeTarget(annotation.target, canvasId);
    const sourceBodies = normalizeBodySource(annotation);
    const bodies = sourceBodies
      .map((body, bodyIndex) => {
        if (!body || typeof body !== "object") {
          return null;
        }
        return normalizeTextBody(body as UnknownRecord, annotationId, bodyIndex);
      })
      .filter((body): body is Record<string, unknown> => Boolean(body));

    if (bodies.length === 0) {
      continue;
    }

    const item: Record<string, unknown> = {
      id: annotationId,
      type: "Annotation",
      target,
      body: prioritizeNativeBodyOrder(bodies),
    };

    if (annotation.motivation !== undefined) {
      item.motivation = annotation.motivation;
    }
    if (annotation.created !== undefined) {
      item.created = annotation.created;
    }
    if (annotation.creator !== undefined) {
      item.creator = annotation.creator;
    }

    items.push(item);
  }

  return {
    id: pageId,
    type: "AnnotationPage",
    items,
  };
}

export function syncNativeAnnotationPageToVault(
  vault: VaultLike,
  canvasId: string,
  annotations: StoredAnnotation[],
): string {
  const page = buildNativeAnnotationPageForCanvas(canvasId, annotations);
  vault.loadSync(page.id, page);

  const canvas = vault.get({ id: canvasId, type: "Canvas" }) as
    | { annotations?: Array<{ id?: string } | string> }
    | undefined;
  const existing = ensureArray(canvas?.annotations);
  const hasPageRef = hasNativeAnnotationPageRef(vault, canvasId);

  if (!hasPageRef) {
    vault.modifyEntityField(
      { id: canvasId, type: "Canvas" },
      "annotations",
      [...existing, { id: page.id, type: "AnnotationPage" }],
    );
  }

  return page.id;
}

export const __internal = {
  extractSegmentedVttBodyValue,
  toDataUriWebVtt,
};
