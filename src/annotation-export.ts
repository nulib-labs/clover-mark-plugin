import type { StoredAnnotation } from "./annotation-runtime";

const IIIF_PRESENTATION_3_CONTEXT = "http://iiif.io/api/presentation/3/context.json";
const DEFAULT_EXPORT_BASE_ID = "urn:clover-mark-export";

type StoredAnnotationsByCanvasId = Record<string, StoredAnnotation[] | undefined>;

type AnnotationPageLike = {
  "@context": string;
  id: string;
  type: "AnnotationPage";
  label: Record<string, string[]>;
  summary: Record<string, string[]>;
  items: Array<Record<string, unknown>>;
};

const MEDIA_FRAGMENTS_CONFORMS_TO = "http://www.w3.org/TR/media-frags/";

type UnknownRecord = Record<string, unknown>;

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeAnnotationBody(annotation: StoredAnnotation): unknown[] {
  const rawBodies =
    "body" in annotation
      ? ensureArray(annotation.body as unknown)
      : ensureArray(annotation.bodies);

  return rawBodies
    .map((body) => normalizeBody(body))
    .filter((body): body is unknown => body !== undefined);
}

function normalizeBody(body: unknown): unknown | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }

  if (typeof body === "string") {
    const trimmed = body.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof body !== "object") {
    return body;
  }

  const source = body as UnknownRecord;
  const normalized: UnknownRecord = {};

  for (const key of [
    "id",
    "type",
    "purpose",
    "value",
    "language",
    "format",
    "creator",
    "created",
    "modified",
  ] as const) {
    const value = source[key];
    if (value !== undefined) {
      normalized[key] = value;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeTarget(target: unknown, fallbackCanvasId: string): unknown {
  if (typeof target === "string") {
    const trimmed = target.trim();
    if (!trimmed) {
      return fallbackCanvasId;
    }

    const stringSelector = selectorFromString(trimmed);
    if (stringSelector) {
      const [source] = trimmed.split("#");
      return {
        type: "SpecificResource",
        source: source || fallbackCanvasId,
        selector: stringSelector,
      };
    }

    return trimmed;
  }

  if (!target || typeof target !== "object") {
    return fallbackCanvasId;
  }

  const sourceTarget = target as UnknownRecord;
  const sourceRaw =
    typeof sourceTarget.source === "string" && sourceTarget.source.trim().length > 0
      ? sourceTarget.source.trim()
      : typeof sourceTarget.id === "string" && sourceTarget.id.trim().length > 0
        ? sourceTarget.id.trim()
        : fallbackCanvasId;
  const sourceStringSelector = selectorFromString(sourceRaw);
  const selector = normalizeSelector(sourceTarget.selector) ?? sourceStringSelector;
  const source = sourceRaw.includes("#") ? sourceRaw.split("#")[0] || fallbackCanvasId : sourceRaw;

  if (!selector) {
    return source;
  }

  return {
    type: "SpecificResource",
    source,
    selector,
  };
}

function selectorFromString(value: string): UnknownRecord | undefined {
  const [, fragment] = value.split("#");
  if (!fragment) {
    return undefined;
  }

  const trimmed = fragment.trim();
  if (!trimmed) {
    return undefined;
  }

  if (isMediaFragmentValue(trimmed)) {
    return {
      type: "FragmentSelector",
      conformsTo: MEDIA_FRAGMENTS_CONFORMS_TO,
      value: trimmed,
    };
  }

  return undefined;
}

function normalizeSelector(selector: unknown): UnknownRecord | undefined {
  if (!selector) {
    return undefined;
  }

  if (typeof selector === "string") {
    const trimmed = selector.trim();
    if (!trimmed) {
      return undefined;
    }
    if (isMediaFragmentValue(trimmed)) {
      return {
        type: "FragmentSelector",
        conformsTo: MEDIA_FRAGMENTS_CONFORMS_TO,
        value: trimmed,
      };
    }
    return {
      type: "SvgSelector",
      value: trimmed,
    };
  }

  if (typeof selector !== "object") {
    return undefined;
  }

  const sourceSelector = selector as UnknownRecord;
  const rawType = typeof sourceSelector.type === "string" ? sourceSelector.type.trim().toLowerCase() : "";
  const rawValue = typeof sourceSelector.value === "string" ? sourceSelector.value.trim() : "";

  if (rawType === "fragmentselector" && rawValue) {
    return {
      type: "FragmentSelector",
      conformsTo: MEDIA_FRAGMENTS_CONFORMS_TO,
      value: rawValue,
    };
  }

  if (rawType === "svgselector" && rawValue) {
    return {
      type: "SvgSelector",
      value: rawValue,
    };
  }

  const geometry =
    sourceSelector.geometry && typeof sourceSelector.geometry === "object"
      ? (sourceSelector.geometry as UnknownRecord)
      : undefined;
  const x = geometry?.x;
  const y = geometry?.y;
  const w = geometry?.w;
  const h = geometry?.h;

  if (
    (rawType === "rectangle" || rawType === "rect" || rawType === "point" || rawType === "fragmentselector") &&
    typeof x === "number" &&
    typeof y === "number"
  ) {
    const width = rawType === "point" ? 1 : typeof w === "number" ? w : 1;
    const height = rawType === "point" ? 1 : typeof h === "number" ? h : 1;
    return {
      type: "FragmentSelector",
      conformsTo: MEDIA_FRAGMENTS_CONFORMS_TO,
      value: `xywh=${x},${y},${width},${height}`,
    };
  }

  return undefined;
}

function isMediaFragmentValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized
    .split("&")
    .some((part) => part.startsWith("xywh=") || part.startsWith("t="));
}

function getCreatedFromAnnotation(annotation: StoredAnnotation): string | undefined {
  if (typeof annotation.created === "string" && annotation.created.trim().length > 0) {
    return annotation.created.trim();
  }

  const target = annotation.target;
  if (target && typeof target === "object") {
    const created = (target as UnknownRecord).created;
    if (typeof created === "string" && created.trim().length > 0) {
      return created.trim();
    }
  }

  return undefined;
}

function getCreatorFromAnnotation(annotation: StoredAnnotation): unknown {
  if (annotation.creator !== undefined) {
    return annotation.creator;
  }

  const target = annotation.target;
  if (target && typeof target === "object") {
    const creator = (target as UnknownRecord).creator;
    if (creator !== undefined) {
      return creator;
    }
  }

  return undefined;
}

function normalizeMotivation(
  motivation: StoredAnnotation["motivation"],
): string | string[] | undefined {
  if (!motivation) return undefined;
  if (Array.isArray(motivation)) {
    const normalized = motivation
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0);
    if (normalized.length === 0) return undefined;
    return normalized.length === 1 ? normalized[0] : normalized;
  }
  if (typeof motivation === "string" && motivation.trim().length > 0) {
    return motivation.trim();
  }
  return undefined;
}

export function buildAnnotationPageExport(options: {
  manifestId?: string;
  storedByCanvasId: StoredAnnotationsByCanvasId;
  canvasOrder?: string[];
  label?: string;
}): AnnotationPageLike {
  const baseId = options.manifestId?.trim() || DEFAULT_EXPORT_BASE_ID;
  const annotationPageId = `${baseId}#annotation-page`;
  const seenCanvasIds = new Set<string>();
  const orderedCanvasIds: string[] = [];

  for (const canvasId of options.canvasOrder ?? []) {
    if (!canvasId || seenCanvasIds.has(canvasId)) continue;
    seenCanvasIds.add(canvasId);
    orderedCanvasIds.push(canvasId);
  }

  for (const canvasId of Object.keys(options.storedByCanvasId)) {
    if (!canvasId || seenCanvasIds.has(canvasId)) continue;
    seenCanvasIds.add(canvasId);
    orderedCanvasIds.push(canvasId);
  }

  const items: Array<Record<string, unknown>> = [];
  let annotationIndex = 0;
  let touchedCanvasCount = 0;

  for (const canvasId of orderedCanvasIds) {
    const annotations = options.storedByCanvasId[canvasId];
    if (!Array.isArray(annotations) || annotations.length === 0) continue;

    touchedCanvasCount += 1;
    for (const annotation of annotations) {
      annotationIndex += 1;
      const body = normalizeAnnotationBody(annotation);
      const motivation = normalizeMotivation(annotation.motivation);
      const target = normalizeTarget(annotation.target, canvasId);
      const id =
        typeof annotation.id === "string" && annotation.id.trim().length > 0
          ? annotation.id
          : `${annotationPageId}/annotation-${annotationIndex}`;
      const created = getCreatedFromAnnotation(annotation);
      const creator = getCreatorFromAnnotation(annotation);

      const item: Record<string, unknown> = {
        id,
        type: "Annotation",
        target,
      };

      if (body.length === 1) {
        item.body = body[0];
      } else if (body.length > 1) {
        item.body = body;
      }

      if (motivation) {
        item.motivation = motivation;
      }
      if (created) {
        item.created = created;
      }
      if (creator !== undefined) {
        item.creator = creator;
      }

      items.push(item);
    }
  }

  const label = options.label?.trim() || "CloverMark Export";

  return {
    "@context": IIIF_PRESENTATION_3_CONTEXT,
    id: annotationPageId,
    type: "AnnotationPage",
    label: { en: [label] },
    summary: {
      en: [
        `${items.length} annotation${items.length === 1 ? "" : "s"} across ${touchedCanvasCount} canvas${touchedCanvasCount === 1 ? "" : "es"}.`,
      ],
    },
    items,
  };
}

export function downloadAnnotationPageExport(
  annotationPage: AnnotationPageLike,
  filename = "clover-mark-annotations.json",
): void {
  const json = JSON.stringify(annotationPage, null, 2);
  const blob = new Blob([json], { type: "application/ld+json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
