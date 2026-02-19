import * as React from "react";
import {
  Annotorious,
  type AnnotoriousOpenSeadragonAnnotator,
  OpenSeadragonAnnotator,
  OpenSeadragonAnnotatorContext,
  useAnnotator,
  useAnnotations,
  useSelection,
} from "@annotorious/react";
import "@annotorious/react/annotorious-react.css";
import { useTranslation } from "react-i18next";
import {
  type CanvasAnnotatorLike,
  getStoredCanvasAnnotations,
  registerCanvasAnnotator,
  setCanvasBridgeState,
  setCanvasLocalAnnotationCount,
  setCanvasLocalCloverMarks,
  setCanvasSelectedLocalScholiumId,
  setStoredCanvasAnnotations,
  type LocalScholium,
  type StoredAnnotation,
} from "./annotation-runtime";
import { applyDefaultMotivation, getPrimaryMotivation } from "./motivation";
import { shouldSkipSyncOnHydration } from "./hydration-sync";
import { ANNOTATIONS_I18N_NAMESPACE } from "./i18n";

type ViewerStateLike = {
  activeCanvas?: string;
  openSeadragonViewer?: unknown;
};

type BridgePluginProps = {
  canvas?: { id?: string };
  defaultMotivation?: string | string[];
  useViewerState: () => ViewerStateLike;
};

type ToolName = "rectangle" | "polygon";

type RuntimeAnnotation = {
  id: string;
  bodies?: Array<{ purpose?: string; value?: string; language?: string }>;
  motivation?: string | string[];
  target?: unknown;
};

type RuntimeBody = {
  purpose?: string;
  value?: string;
  language?: string;
};

function RegisterExistingOSD({ viewer }: { viewer: unknown }) {
  const { setViewer } = React.useContext(OpenSeadragonAnnotatorContext);

  React.useEffect(() => {
    if (!viewer) {
      return;
    }

    setViewer(viewer as never);
    return () => {
      setViewer(undefined as never);
    };
  }, [viewer, setViewer]);

  return null;
}

function DrawingToolbar() {
  const annotator = useAnnotator<AnnotoriousOpenSeadragonAnnotator>();
  const { t } = useTranslation(ANNOTATIONS_I18N_NAMESPACE);
  const [drawingEnabled, setDrawingEnabled] = React.useState(false);
  const [activeTool, setActiveTool] = React.useState<ToolName>("rectangle");
  const savedMouseGesture = React.useRef<{
    dragToPan?: boolean;
    clickToZoom?: boolean;
    dblClickToZoom?: boolean;
    pinchToZoom?: boolean;
    flickEnabled?: boolean;
  } | null>(null);

  React.useEffect(() => {
    if (!annotator) {
      return;
    }
    if (drawingEnabled) {
      annotator.setDrawingMode("drag");
      annotator.setDrawingTool(activeTool);
    }
    annotator.setDrawingEnabled(drawingEnabled);
  }, [annotator, drawingEnabled, activeTool]);

  React.useEffect(() => {
    if (!annotator?.viewer) {
      return;
    }

    const mouseSettings = annotator.viewer.gestureSettingsMouse as {
      dragToPan?: boolean;
      clickToZoom?: boolean;
      dblClickToZoom?: boolean;
      pinchToZoom?: boolean;
      flickEnabled?: boolean;
    };

    if (drawingEnabled) {
      if (!savedMouseGesture.current) {
        savedMouseGesture.current = {
          dragToPan: mouseSettings.dragToPan,
          clickToZoom: mouseSettings.clickToZoom,
          dblClickToZoom: mouseSettings.dblClickToZoom,
          pinchToZoom: mouseSettings.pinchToZoom,
          flickEnabled: mouseSettings.flickEnabled,
        };
      }

      mouseSettings.dragToPan = false;
      mouseSettings.clickToZoom = false;
      mouseSettings.dblClickToZoom = false;
      mouseSettings.pinchToZoom = false;
      mouseSettings.flickEnabled = false;
    } else if (savedMouseGesture.current) {
      mouseSettings.dragToPan = savedMouseGesture.current.dragToPan ?? true;
      mouseSettings.clickToZoom = savedMouseGesture.current.clickToZoom ?? true;
      mouseSettings.dblClickToZoom = savedMouseGesture.current.dblClickToZoom ?? true;
      mouseSettings.pinchToZoom = savedMouseGesture.current.pinchToZoom ?? true;
      mouseSettings.flickEnabled = savedMouseGesture.current.flickEnabled ?? true;
      savedMouseGesture.current = null;
    }

    annotator.viewer.setMouseNavEnabled(!drawingEnabled);

    return () => {
      const saved = savedMouseGesture.current;
      if (saved) {
        mouseSettings.dragToPan = saved.dragToPan ?? true;
        mouseSettings.clickToZoom = saved.clickToZoom ?? true;
        mouseSettings.dblClickToZoom = saved.dblClickToZoom ?? true;
        mouseSettings.pinchToZoom = saved.pinchToZoom ?? true;
        mouseSettings.flickEnabled = saved.flickEnabled ?? true;
        savedMouseGesture.current = null;
      }
      annotator.viewer.setMouseNavEnabled(true);
    };
  }, [annotator, drawingEnabled]);

  if (!annotator) {
    return null;
  }

  return (
    <div
      style={{
        display: "inline-flex",
        gap: "0.35rem",
        alignItems: "center",
        background: "rgba(15, 23, 42, 0.8)",
        padding: "0.35rem",
        borderRadius: "0.35rem",
        color: "#fff",
      }}
    >
      <button
        type="button"
        onClick={() => setDrawingEnabled((current) => !current)}
        style={{ fontWeight: drawingEnabled ? 700 : 400 }}
      >
        {drawingEnabled ? t("drawingOn") : t("drawingOff")}
      </button>
      <button
        type="button"
        onClick={() => {
          setActiveTool("rectangle");
          setDrawingEnabled(true);
        }}
        style={{ fontWeight: activeTool === "rectangle" ? 700 : 400 }}
      >
        {t("drawingRectangle")}
      </button>
      <button
        type="button"
        onClick={() => {
          setActiveTool("polygon");
          setDrawingEnabled(true);
        }}
        style={{ fontWeight: activeTool === "polygon" ? 700 : 400 }}
      >
        {t("drawingPolygon")}
      </button>
    </div>
  );
}

function getBodyValue(
  annotation: RuntimeAnnotation,
  preferredPurpose: string,
): string | undefined {
  const bodies = Array.isArray(annotation.bodies) ? annotation.bodies : [];
  const purposeBody = bodies.find((body) => body?.purpose === preferredPurpose);
  if (typeof purposeBody?.value === "string" && purposeBody.value.trim().length > 0) {
    return purposeBody.value;
  }

  const firstValueBody = bodies.find((body) => typeof body?.value === "string" && body.value.trim().length > 0);
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

    const runtimeBody = body as RuntimeBody;
    const purpose =
      runtimeBody.purpose === "translating"
        ? "translating"
        : runtimeBody.purpose === "supplementing"
          ? "supplementing"
          : undefined;
    if (!purpose) {
      return acc;
    }

    const value = typeof runtimeBody.value === "string" ? runtimeBody.value.trim() : "";
    if (!value) {
      return acc;
    }

    const language =
      typeof runtimeBody.language === "string" && runtimeBody.language.trim().length > 0
        ? runtimeBody.language.trim()
        : undefined;

    acc.push({ purpose, value, language });
    return acc;
  }, []);
}

function getTargetDetails(annotation: RuntimeAnnotation): Pick<LocalScholium, "source" | "selectorText" | "selectorType"> {
  const target = annotation.target as
    | string
    | {
        id?: string;
        source?: string;
        selector?: unknown;
      }
    | undefined;

  if (!target) {
    return {};
  }

  if (typeof target === "string") {
    return { source: target, selectorText: target };
  }

  const selector = target.selector as
    | string
    | {
        type?: string;
        value?: string;
        geometry?: { x?: number; y?: number; w?: number; h?: number; bounds?: unknown };
      }
    | undefined;

  let selectorText: string | undefined;
  const selectorType = typeof selector === "object" ? selector?.type : undefined;
  if (typeof selector === "string") {
    selectorText = selector;
  } else if (typeof selector?.value === "string") {
    selectorText = selector.value;
  } else if (selectorType === "FragmentSelector") {
    const geometry = selector?.geometry as
      | { x?: number; y?: number; w?: number; h?: number; bounds?: unknown }
      | undefined;
    if (
      geometry &&
      typeof geometry.x === "number" &&
      typeof geometry.y === "number" &&
      typeof geometry.w === "number" &&
      typeof geometry.h === "number"
    ) {
      selectorText = `xywh=${Math.round(geometry.x)},${Math.round(geometry.y)},${Math.round(geometry.w)},${Math.round(geometry.h)}`;
    } else if (
      geometry?.bounds &&
      typeof geometry.bounds === "object" &&
      "minX" in geometry.bounds &&
      "minY" in geometry.bounds &&
      "maxX" in geometry.bounds &&
      "maxY" in geometry.bounds
    ) {
      const bounds = geometry.bounds as {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
      };
      selectorText = `xywh=${Math.round(bounds.minX)},${Math.round(bounds.minY)},${Math.round(bounds.maxX - bounds.minX)},${Math.round(bounds.maxY - bounds.minY)}`;
    }
  }

  if (!selectorText && selectorType) {
    selectorText = selectorType;
  }

  return {
    source: target.source ?? target.id,
    selectorText,
    selectorType,
  };
}

function AnnotationRuntimeSync({
  canvasId,
  defaultMotivation,
}: {
  canvasId: string;
  defaultMotivation?: string | string[];
}) {
  const annotator = useAnnotator<AnnotoriousOpenSeadragonAnnotator>();
  const annotations = useAnnotations() as RuntimeAnnotation[];
  const selection = useSelection();
  const canvasIdRef = React.useRef(canvasId);
  const hydratedRef = React.useRef(false);
  const skipSyncRef = React.useRef(false);

  React.useEffect(() => {
    canvasIdRef.current = canvasId;
    hydratedRef.current = false;
    skipSyncRef.current = false;
  }, [canvasId]);

  React.useEffect(() => {
    registerCanvasAnnotator(canvasId, (annotator as unknown as CanvasAnnotatorLike) ?? null);

    return () => {
      registerCanvasAnnotator(canvasId, null);
    };
  }, [annotator, canvasId]);

  React.useEffect(() => {
    if (!annotator) {
      return;
    }

    const hydrateFromStored = () => {
      const stored = getStoredCanvasAnnotations(canvasIdRef.current);
      const annotatorLike = annotator as unknown as {
        setAnnotations?: (next: StoredAnnotation[], replace?: boolean) => void;
        setVisible?: (visible: boolean) => void;
      };

      if (typeof annotatorLike.setVisible === "function") {
        annotatorLike.setVisible(true);
      }

      if (
        shouldSkipSyncOnHydration(
          stored.length,
          typeof annotatorLike.setAnnotations === "function",
        )
      ) {
        skipSyncRef.current = true;
        annotatorLike.setAnnotations?.(stored, true);
      }

      hydratedRef.current = true;
    };

    hydrateFromStored();

    const viewer = annotator.viewer as
      | {
          addHandler?: (event: string, handler: () => void) => void;
          removeHandler?: (event: string, handler: () => void) => void;
        }
      | undefined;

    const onOpen = () => {
      hydrateFromStored();
    };

    viewer?.addHandler?.("open", onOpen);

    return () => {
      viewer?.removeHandler?.("open", onOpen);
    };
  }, [annotator, canvasId]);

  React.useEffect(() => {
    if (!annotator) {
      return;
    }

    const viewer = annotator.viewer as
      | {
          isOpen?: () => boolean;
        }
      | undefined;

    if (viewer?.isOpen?.() === false) {
      return;
    }

    const stored = getStoredCanvasAnnotations(canvasIdRef.current);
    const annotatorLike = annotator as unknown as {
      setAnnotations?: (next: StoredAnnotation[], replace?: boolean) => void;
      setVisible?: (visible: boolean) => void;
    };

    if (typeof annotatorLike.setVisible === "function") {
      annotatorLike.setVisible(true);
    }
    if (
      shouldSkipSyncOnHydration(
        stored.length,
        typeof annotatorLike.setAnnotations === "function",
      )
    ) {
      skipSyncRef.current = true;
      annotatorLike.setAnnotations?.(stored, true);
    }
    hydratedRef.current = true;
  }, [annotator, canvasId]);

  React.useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }

    const stableCanvasId = canvasIdRef.current;
    const nextAnnotations = annotations.map((annotation) => {
      const normalized = applyDefaultMotivation(annotation, defaultMotivation);
      try {
        return JSON.parse(JSON.stringify(normalized)) as StoredAnnotation;
      } catch {
        return { ...(normalized as Record<string, unknown>) } as StoredAnnotation;
      }
    });

    setStoredCanvasAnnotations(stableCanvasId, nextAnnotations);
    setCanvasLocalAnnotationCount(stableCanvasId, annotations.length);

    const nextCloverMarks = nextAnnotations.map((annotation) => {
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
      } as LocalScholium;
    });

    setCanvasLocalCloverMarks(stableCanvasId, nextCloverMarks);
  }, [annotations, canvasId, defaultMotivation]);

  React.useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }

    const selected = selection.selected?.[0]?.annotation?.id ?? null;
    setCanvasSelectedLocalScholiumId(canvasIdRef.current, selected);
  }, [canvasId, selection.selected]);

  return null;
}

export const AnnotationsBridge: React.FC<BridgePluginProps> = ({
  canvas,
  defaultMotivation,
  useViewerState,
}) => {
  const { activeCanvas, openSeadragonViewer } = useViewerState();
  const canvasId = canvas?.id ?? activeCanvas;

  React.useEffect(() => {
    if (!canvasId) {
      return;
    }

    if (!openSeadragonViewer) {
      setCanvasBridgeState(canvasId, "none", false);
      return;
    }

    setCanvasBridgeState(canvasId, "openseadragon", true);
  }, [canvasId, openSeadragonViewer]);

  if (!canvasId || !openSeadragonViewer) {
    return null;
  }

  return (
    <Annotorious>
      <OpenSeadragonAnnotator key={canvasId} drawingEnabled={false}>
        <RegisterExistingOSD viewer={openSeadragonViewer} />
        <DrawingToolbar />
        <AnnotationRuntimeSync
          key={canvasId}
          canvasId={canvasId}
          defaultMotivation={defaultMotivation}
        />
      </OpenSeadragonAnnotator>
    </Annotorious>
  );
};
