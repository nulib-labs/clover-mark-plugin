import {
  type CanvasAnnotatorLike,
  type LocalScholium,
  type StoredAnnotation,
  getStoredCanvasAnnotations,
  setCanvasLocalAnnotationCount,
  setCanvasLocalCloverMarks,
  setCanvasSelectedLocalScholiumId,
  setStoredCanvasAnnotations,
} from "./annotation-runtime";
import { applyDefaultMotivation, getPrimaryMotivation } from "./motivation";

type RuntimeBody = {
  purpose?: string;
  value?: string;
  language?: string;
  [key: string]: unknown;
};

type RuntimeAnnotation = {
  id: string;
  bodies?: RuntimeBody[];
  target?: unknown;
  motivation?: string | string[];
};

const MEDIA_FRAGMENTS_CONFORMS_TO = "http://www.w3.org/TR/media-frags/";

function toFiniteNonNegativeNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

function formatFragmentTime(value: number): string {
  const rounded = Math.round(toFiniteNonNegativeNumber(value) * 1000) / 1000;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }

  return rounded.toFixed(3).replace(/\.?0+$/, "");
}

function cloneStoredAnnotation(annotation: StoredAnnotation): StoredAnnotation {
  try {
    return JSON.parse(JSON.stringify(annotation)) as StoredAnnotation;
  } catch {
    return { ...annotation };
  }
}

function buildAnnotationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `scholium-${crypto.randomUUID()}`;
  }

  return `scholium-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getBodyValue(annotation: RuntimeAnnotation, preferredPurpose: string): string | undefined {
  const bodies = Array.isArray(annotation.bodies) ? annotation.bodies : [];
  const purposeBody = bodies.find((body) => body?.purpose === preferredPurpose);
  if (typeof purposeBody?.value === "string" && purposeBody.value.trim().length > 0) {
    return purposeBody.value;
  }

  const firstValueBody = bodies.find(
    (body) => typeof body?.value === "string" && body.value.trim().length > 0,
  );
  if (typeof firstValueBody?.value === "string") {
    return firstValueBody.value;
  }

  return undefined;
}

function getTranslationBodies(annotation: RuntimeAnnotation): LocalScholium["translations"] {
  const bodies = Array.isArray(annotation.bodies) ? annotation.bodies : [];

  return bodies.reduce<LocalScholium["translations"]>((acc, body) => {
    if (!body || typeof body !== "object") {
      return acc;
    }

    const purpose =
      body.purpose === "translating"
        ? "translating"
        : body.purpose === "supplementing"
          ? "supplementing"
          : undefined;
    if (!purpose) {
      return acc;
    }

    const value = typeof body.value === "string" ? body.value.trim() : "";
    if (!value) {
      return acc;
    }

    const language =
      typeof body.language === "string" && body.language.trim().length > 0
        ? body.language.trim()
        : undefined;

    acc.push({ purpose, value, language });
    return acc;
  }, []);
}

function getTargetDetails(
  annotation: RuntimeAnnotation,
): Pick<LocalScholium, "source" | "selectorText" | "selectorType"> {
  const target = annotation.target as
    | string
    | { id?: string; source?: string; selector?: unknown }
    | undefined;

  if (!target) {
    return {};
  }

  if (typeof target === "string") {
    const trimmed = target.trim();
    if (!trimmed) {
      return {};
    }

    const [source, selector] = trimmed.split("#");
    if (selector && selector.trim()) {
      return {
        source: source || trimmed,
        selectorText: selector.trim(),
        selectorType: "FragmentSelector",
      };
    }

    return { source: trimmed, selectorText: trimmed };
  }

  const selector = target.selector as
    | string
    | { type?: string; value?: string }
    | undefined;
  const selectorType = typeof selector === "object" ? selector.type : undefined;
  const selectorText =
    typeof selector === "string"
      ? selector
      : typeof selector?.value === "string"
        ? selector.value
        : selectorType;

  return {
    source: target.source ?? target.id,
    selectorText,
    selectorType,
  };
}

function getLocalCloverMarks(annotations: StoredAnnotation[]): LocalScholium[] {
  return annotations.map((annotation) => {
    const runtimeAnnotation = annotation as RuntimeAnnotation;
    const { source, selectorText, selectorType } = getTargetDetails(runtimeAnnotation);
    const label = getBodyValue(runtimeAnnotation, "tagging") ?? annotation.id ?? "Scholium";
    const comment = getBodyValue(runtimeAnnotation, "commenting") ?? "";

    return {
      id: annotation.id,
      label,
      comment,
      motivation: getPrimaryMotivation(annotation.motivation),
      translations: getTranslationBodies(runtimeAnnotation),
      source,
      selectorText,
      selectorType,
    };
  });
}

function parseTemporalFragmentValue(rawValue: string): { start: number; end?: number } | undefined {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }

  const hashFragment = trimmed.includes("#") ? trimmed.slice(trimmed.indexOf("#") + 1) : trimmed;
  const parts = hashFragment.split("&");
  const temporalPart = parts.find((part) => part.trim().startsWith("t="));
  if (!temporalPart) {
    return undefined;
  }

  const rawTemporal = temporalPart.trim().slice(2);
  const withoutNptPrefix = rawTemporal.startsWith("npt:") ? rawTemporal.slice(4) : rawTemporal;
  const [rawStart, rawEnd] = withoutNptPrefix.split(",", 2).map((part) => part.trim());
  const start = Number.parseFloat(rawStart);
  if (!Number.isFinite(start)) {
    return undefined;
  }

  const end = rawEnd === undefined ? undefined : Number.parseFloat(rawEnd);
  if (end !== undefined && Number.isFinite(end) && end >= start) {
    return { start, end };
  }

  return { start };
}

function getTemporalSegment(target: unknown): { start: number; end?: number } | undefined {
  if (typeof target === "string") {
    return parseTemporalFragmentValue(target);
  }

  if (!target || typeof target !== "object") {
    return undefined;
  }

  const typedTarget = target as { selector?: unknown; source?: string; id?: string };
  const selector = typedTarget.selector;
  if (typeof selector === "string") {
    return parseTemporalFragmentValue(selector);
  }

  if (selector && typeof selector === "object") {
    const selectorValue = (selector as { value?: unknown }).value;
    if (typeof selectorValue === "string") {
      return parseTemporalFragmentValue(selectorValue);
    }
  }

  if (typeof typedTarget.source === "string") {
    const fromSource = parseTemporalFragmentValue(typedTarget.source);
    if (fromSource) {
      return fromSource;
    }
  }

  if (typeof typedTarget.id === "string") {
    return parseTemporalFragmentValue(typedTarget.id);
  }

  return undefined;
}

export function buildTemporalTarget(
  canvasId: string,
  start: number,
  end: number,
): StoredAnnotation["target"] {
  const normalizedStart = toFiniteNonNegativeNumber(start);
  const normalizedEnd = Math.max(normalizedStart, toFiniteNonNegativeNumber(end));
  const fragment = `t=${formatFragmentTime(normalizedStart)},${formatFragmentTime(normalizedEnd)}`;

  return {
    type: "SpecificResource",
    source: canvasId,
    selector: {
      type: "FragmentSelector",
      conformsTo: MEDIA_FRAGMENTS_CONFORMS_TO,
      value: fragment,
    },
  };
}

export type MediaCanvasAnnotator = CanvasAnnotatorLike & {
  createAnnotation: (
    annotation: Partial<{
      id: string;
      body?: unknown;
      bodies?: unknown[];
      target?: unknown;
      motivation?: string | string[];
    }> &
      Record<string, unknown>,
  ) => StoredAnnotation;
};

export function createMediaCanvasAnnotator(options: {
  canvasId: string;
  defaultMotivation?: string | string[];
  getPlayer?: () => HTMLVideoElement | HTMLAudioElement | null | undefined;
  player?: HTMLVideoElement | HTMLAudioElement | null;
}): MediaCanvasAnnotator {
  const { canvasId, defaultMotivation, player, getPlayer } = options;
  let selectedAnnotationId: string | null = null;
  let annotations = getStoredCanvasAnnotations(canvasId).map((annotation) =>
    cloneStoredAnnotation(annotation),
  );

  const syncRuntime = () => {
    const persisted = annotations.map((annotation) => cloneStoredAnnotation(annotation));
    setStoredCanvasAnnotations(canvasId, persisted);
    setCanvasLocalAnnotationCount(canvasId, persisted.length);
    setCanvasLocalCloverMarks(canvasId, getLocalCloverMarks(persisted));

    if (
      selectedAnnotationId &&
      !persisted.some((annotation) => annotation.id === selectedAnnotationId)
    ) {
      selectedAnnotationId = null;
    }

    setCanvasSelectedLocalScholiumId(canvasId, selectedAnnotationId);
  };

  const annotator: MediaCanvasAnnotator = {
    createAnnotation: (annotationInput) => {
      const nextId =
        typeof annotationInput.id === "string" && annotationInput.id.trim().length > 0
          ? annotationInput.id.trim()
          : buildAnnotationId();
      const normalized = applyDefaultMotivation(
        {
          ...(annotationInput as Record<string, unknown>),
          id: nextId,
        },
        defaultMotivation,
      ) as StoredAnnotation;

      annotations = [...annotations, cloneStoredAnnotation(normalized)];
      selectedAnnotationId = nextId;
      syncRuntime();

      return cloneStoredAnnotation(normalized);
    },
    fitBounds: (arg) => {
      const annotationId = typeof arg === "string" ? arg : arg?.id;
      if (!annotationId) {
        return;
      }

      const annotation = annotations.find((candidate) => candidate.id === annotationId);
      const segment = getTemporalSegment(annotation?.target);
      const resolvedPlayer = getPlayer?.() ?? player;
      if (!segment || !resolvedPlayer) {
        return;
      }

      try {
        resolvedPlayer.currentTime = segment.start;
      } catch {
        // Browsers can block programmatic seeking.
      }
    },
    getAnnotationById: (id) => {
      const annotation = annotations.find((candidate) => candidate.id === id);
      return annotation ? cloneStoredAnnotation(annotation) : undefined;
    },
    removeAnnotation: (arg) => {
      const annotationId =
        typeof arg === "string" ? arg : typeof arg?.id === "string" ? arg.id : "";
      if (!annotationId) {
        return;
      }

      annotations = annotations.filter((annotation) => annotation.id !== annotationId);
      if (selectedAnnotationId === annotationId) {
        selectedAnnotationId = null;
      }
      syncRuntime();
    },
    setSelected: (arg) => {
      if (Array.isArray(arg)) {
        selectedAnnotationId = typeof arg[0] === "string" ? arg[0] : null;
      } else if (typeof arg === "string" && arg.trim().length > 0) {
        selectedAnnotationId = arg;
      } else {
        selectedAnnotationId = null;
      }

      setCanvasSelectedLocalScholiumId(canvasId, selectedAnnotationId);
    },
    updateAnnotation: (annotationInput) => {
      const annotationId =
        typeof annotationInput.id === "string" ? annotationInput.id.trim() : "";
      if (!annotationId) {
        return;
      }

      const existingIndex = annotations.findIndex((annotation) => annotation.id === annotationId);
      if (existingIndex < 0) {
        return;
      }

      const merged = applyDefaultMotivation(
        {
          ...annotations[existingIndex],
          ...(annotationInput as Record<string, unknown>),
          id: annotationId,
        },
        defaultMotivation,
      ) as StoredAnnotation;

      annotations = [
        ...annotations.slice(0, existingIndex),
        cloneStoredAnnotation(merged),
        ...annotations.slice(existingIndex + 1),
      ];
      syncRuntime();
    },
  };

  syncRuntime();
  return annotator;
}
