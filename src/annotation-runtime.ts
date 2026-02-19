import * as React from "react";

export type BridgeMode = "none" | "openseadragon";

export type LocalScholium = {
  id: string;
  label: string;
  comment: string;
  motivation?: string;
  translations: Array<{
    purpose: "supplementing" | "translating";
    language?: string;
    value: string;
  }>;
  source?: string;
  selectorText?: string;
  selectorType?: string;
};

export type CanvasAnnotatorLike = {
  fitBounds: (arg: { id: string } | string, opts?: { padding?: number }) => void;
  getAnnotationById: (id: string) => unknown;
  removeAnnotation: (arg: string | Partial<{ id: string }>) => unknown;
  setSelected: (arg?: string | string[], editable?: boolean) => void;
  updateAnnotation: (
    annotation: Partial<{ id: string; bodies?: unknown[]; motivation?: string | string[] }> &
      Record<string, unknown>,
  ) => unknown;
};

export type CanvasRuntimeState = {
  bridgeMode: BridgeMode;
  localAnnotationCount: number;
  localCloverMarks: LocalScholium[];
  selectedLocalScholiumId: string | null;
  bridgeReady: boolean;
};

export type StoredAnnotation = {
  id: string;
  body?: unknown;
  bodies?: unknown[];
  target?: unknown;
  motivation?: string | string[];
  [key: string]: unknown;
};

type RuntimeState = {
  byCanvasId: Record<string, CanvasRuntimeState>;
};

const DEFAULT_CANVAS_RUNTIME_STATE: CanvasRuntimeState = {
  bridgeMode: "none",
  localAnnotationCount: 0,
  localCloverMarks: [],
  selectedLocalScholiumId: null,
  bridgeReady: false,
};

let state: RuntimeState = {
  byCanvasId: {},
};

const listeners = new Set<() => void>();
const annotatorsByCanvasId: Record<string, CanvasAnnotatorLike | undefined> = {};
const annotationsByCanvasId: Record<string, StoredAnnotation[] | undefined> = {};

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function subscribeRuntimeState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRuntimeStateSnapshot(): RuntimeState {
  return state;
}

function updateCanvasRuntimeState(
  canvasId: string,
  updates: Partial<CanvasRuntimeState>,
): void {
  const current = state.byCanvasId[canvasId] ?? DEFAULT_CANVAS_RUNTIME_STATE;
  const next = { ...current, ...updates };

  if (
    current.bridgeMode === next.bridgeMode &&
    current.bridgeReady === next.bridgeReady &&
    current.localAnnotationCount === next.localAnnotationCount &&
    current.selectedLocalScholiumId === next.selectedLocalScholiumId &&
    current.localCloverMarks === next.localCloverMarks
  ) {
    return;
  }

  state = {
    byCanvasId: {
      ...state.byCanvasId,
      [canvasId]: next,
    },
  };

  emitChange();
}

export function setCanvasBridgeState(
  canvasId: string,
  bridgeMode: BridgeMode,
  bridgeReady: boolean,
): void {
  updateCanvasRuntimeState(canvasId, { bridgeMode, bridgeReady });
}

export function setCanvasLocalAnnotationCount(canvasId: string, count: number): void {
  updateCanvasRuntimeState(canvasId, { localAnnotationCount: Math.max(0, count) });
}

export function setCanvasLocalCloverMarks(canvasId: string, cloverMarks: LocalScholium[]): void {
  updateCanvasRuntimeState(canvasId, {
    localCloverMarks: cloverMarks,
    localAnnotationCount: cloverMarks.length,
  });
}

export function setCanvasSelectedLocalScholiumId(
  canvasId: string,
  annotationId: string | null,
): void {
  updateCanvasRuntimeState(canvasId, {
    selectedLocalScholiumId: annotationId,
  });
}

export function registerCanvasAnnotator(
  canvasId: string,
  annotator: CanvasAnnotatorLike | null,
): void {
  if (!annotator) {
    delete annotatorsByCanvasId[canvasId];
    return;
  }

  annotatorsByCanvasId[canvasId] = annotator;
}

export function getCanvasAnnotator(canvasId?: string): CanvasAnnotatorLike | undefined {
  if (!canvasId) {
    return undefined;
  }

  return annotatorsByCanvasId[canvasId];
}

export function setStoredCanvasAnnotations(
  canvasId: string,
  annotations: StoredAnnotation[],
): void {
  annotationsByCanvasId[canvasId] = annotations;
}

export function getStoredCanvasAnnotations(canvasId?: string): StoredAnnotation[] {
  if (!canvasId) {
    return [];
  }

  const stored = annotationsByCanvasId[canvasId];
  if (!Array.isArray(stored) || stored.length === 0) {
    return [];
  }

  return stored;
}

export function getAllStoredCanvasAnnotations(): Record<string, StoredAnnotation[]> {
  const entries = Object.entries(annotationsByCanvasId)
    .filter(([, annotations]) => Array.isArray(annotations) && annotations.length > 0)
    .map(([canvasId, annotations]) => [canvasId, annotations as StoredAnnotation[]]);

  return Object.fromEntries(entries);
}

export function useCanvasRuntimeState(canvasId?: string): CanvasRuntimeState {
  return React.useSyncExternalStore(
    subscribeRuntimeState,
    () => {
      if (!canvasId) {
        return DEFAULT_CANVAS_RUNTIME_STATE;
      }

      return state.byCanvasId[canvasId] ?? DEFAULT_CANVAS_RUNTIME_STATE;
    },
    () => DEFAULT_CANVAS_RUNTIME_STATE,
  );
}

export function __resetRuntimeForTests(): void {
  state = { byCanvasId: {} };

  Object.keys(annotatorsByCanvasId).forEach((key) => {
    delete annotatorsByCanvasId[key];
  });

  Object.keys(annotationsByCanvasId).forEach((key) => {
    delete annotationsByCanvasId[key];
  });
}
