import i18next from "i18next";
import { initCloverI18n } from "@samvera/clover-iiif/i18n";

export const ANNOTATIONS_I18N_NAMESPACE = "CloverMark";

export type AnnotationsTranslationStrings = {
  activeCanvas: string;
  mediaType: string;
  mediaImage: string;
  mediaVideo: string;
  mediaAudio: string;
  mediaUnknown: string;
  visibleAnnotations: string;
  nativeCanvasAnnotations: string;
  localDraftAnnotations: string;
  sessionCloverMarks: string;
  noSessionCloverMarks: string;
  scholiumLabel: string;
  scholiumComment: string;
  focusScholium: string;
  deleteScholium: string;
  scholiumSource: string;
  scholiumSelector: string;
  canvases: string;
  jumpToCanvas: string;
  noCanvasAvailable: string;
  exportAnnotations: string;
  exportWebVtt: string;
  exportNoAnnotations: string;
  exportNoWebVtt: string;
  exportSuccess: string;
  exportWebVttSuccess: string;
  motivation: string;
  motivationUnspecified: string;
  motivationCommenting: string;
  motivationHighlighting: string;
  motivationDescribing: string;
  motivationTranscribing: string;
  motivationTranslating: string;
  motivationTagging: string;
  motivationSupplementing: string;
  bodyLabelCommenting: string;
  bodyLabelHighlighting: string;
  bodyLabelDescribing: string;
  bodyLabelTranscribing: string;
  bodyLabelTranslating: string;
  bodyLabelTagging: string;
  bodyLabelSupplementing: string;
  translationSectionLabel: string;
  translationNone: string;
  translationLanguage: string;
  translationLanguageUnspecified: string;
  translationLanguagePlaceholder: string;
  translationText: string;
  translationTextPlaceholder: string;
  translationSave: string;
  translationAdd: string;
  translationDelete: string;
  drawingOn: string;
  drawingOff: string;
  drawingRectangle: string;
  drawingPolygon: string;
  selectorTypeRectangle: string;
  selectorTypePolygon: string;
  selectorTypePoint: string;
  selectorTypeFragment: string;
  sttTitle: string;
  sttLoadModel: string;
  sttReloadModel: string;
  sttStartRecording: string;
  sttStartViewer: string;
  sttStartViewerFast: string;
  sttStopRecording: string;
  sttModel: string;
  sttStatus: string;
  sttIdle: string;
  sttMicLevel: string;
  sttSourceMic: string;
  sttSourceViewer: string;
  sttEmbeddedHint: string;
  sttNoTranscript: string;
  sttTranscriptLabel: string;
  sttTranscriptPlaceholder: string;
  sttSaveTranscript: string;
  sttTimedWordsLabel: string;
  sttTimedWordsHint: string;
  sttSessionTime: string;
  sttLatency: string;
  sttRtf: string;
  sttModelLoading: string;
  sttModelLoadingProgress: string;
  sttModelReady: string;
  sttModelError: string;
  sttModelStateLabel: string;
  sttModelStateNotLoaded: string;
  sttModelStateLoading: string;
  sttModelStateReady: string;
  sttModelStateError: string;
  sttModelStateLoadNow: string;
  sttModelStateRetry: string;
  sttNeedsSelection: string;
  sttRecording: string;
  sttRecordingViewer: string;
  sttRecordingViewerFast: string;
  sttStopping: string;
  sttStopped: string;
  sttEditedSaved: string;
  sttSavedToTranslation: string;
  sttStreamingError: string;
  sttMicError: string;
  sttViewerError: string;
  sttViewerUnavailable: string;
  sttAutoScholiumLabel: string;
  sttLiveAnnotationLabel: string;
  tabLabel: string;
};

export type AnnotationsTranslationOverrides = Partial<
  AnnotationsTranslationStrings
>;

export type AnnotationsTranslationResources = Record<
  string,
  AnnotationsTranslationOverrides
>;

const DEFAULT_TRANSLATIONS: AnnotationsTranslationStrings = {
  activeCanvas: "Active canvas",
  mediaType: "Media type",
  mediaImage: "Image",
  mediaVideo: "Video",
  mediaAudio: "Audio",
  mediaUnknown: "Unknown",
  visibleAnnotations: "Visible CloverMarks",
  nativeCanvasAnnotations: "Canvas CloverMarks (native)",
  localDraftAnnotations: "Draft CloverMarks (session)",
  sessionCloverMarks: "Session CloverMarks",
  noSessionCloverMarks: "No session CloverMarks yet. Use drawing tools to add one.",
  scholiumLabel: "Label",
  scholiumComment: "Comment",
  focusScholium: "Focus",
  deleteScholium: "Delete",
  scholiumSource: "Source",
  scholiumSelector: "Selector",
  canvases: "Canvases",
  jumpToCanvas: "Jump",
  noCanvasAvailable: "No canvases available",
  exportAnnotations: "Export annotations (IIIF)",
  exportWebVtt: "Export WEBVTT",
  exportNoAnnotations: "No session annotations to export.",
  exportNoWebVtt: "No timed WEBVTT segments are available to export.",
  exportSuccess: "Exported {{count}} annotation(s).",
  exportWebVttSuccess: "Exported {{count}} WEBVTT cue(s).",
  motivation: "Motivation",
  motivationUnspecified: "Unspecified",
  motivationCommenting: "Commenting",
  motivationHighlighting: "Highlighting",
  motivationDescribing: "Describing",
  motivationTranscribing: "Transcribing",
  motivationTranslating: "Translating",
  motivationTagging: "Tagging",
  motivationSupplementing: "Supplementing",
  bodyLabelCommenting: "Comment",
  bodyLabelHighlighting: "Highlight",
  bodyLabelDescribing: "Description",
  bodyLabelTranscribing: "Transcription",
  bodyLabelTranslating: "Translation",
  bodyLabelTagging: "Tag",
  bodyLabelSupplementing: "Supplement",
  translationSectionLabel: "Translations",
  translationNone: "No translations yet.",
  translationLanguage: "Language",
  translationLanguageUnspecified: "Unspecified",
  translationLanguagePlaceholder: "e.g. en, fr, ht",
  translationText: "Translation text",
  translationTextPlaceholder: "Add translated text for this same selector",
  translationSave: "Save translation",
  translationAdd: "+ Add translation",
  translationDelete: "Delete translation",
  drawingOn: "Drawing: on",
  drawingOff: "Drawing: off",
  drawingRectangle: "Rectangle",
  drawingPolygon: "Polygon",
  selectorTypeRectangle: "Rectangle",
  selectorTypePolygon: "Polygon",
  selectorTypePoint: "Point",
  selectorTypeFragment: "Fragment",
  sttTitle: "Streaming transcription",
  sttLoadModel: "Load Parakeet model (~2.5GB)",
  sttReloadModel: "Reload model",
  sttStartRecording: "Start microphone",
  sttStartViewer: "Real-time transcription",
  sttStartViewerFast: "Fast transcription",
  sttStopRecording: "Stop recording",
  sttModel: "Model",
  sttStatus: "Status",
  sttIdle: "Idle",
  sttMicLevel: "Mic level",
  sttSourceMic: "microphone",
  sttSourceViewer: "viewer",
  sttEmbeddedHint: "Use microphone, real-time viewer transcription, or fast viewer transcription inside each Translation text field.",
  sttNoTranscript: "No live transcript yet.",
  sttTranscriptLabel: "Transcript",
  sttTranscriptPlaceholder: "No live transcript yet.",
  sttSaveTranscript: "Save transcript text",
  sttTimedWordsLabel: "Timed segments",
  sttTimedWordsHint: "Edit each caption segment while preserving its original timestamp window.",
  sttSessionTime: "Session",
  sttLatency: "Latency",
  sttRtf: "RTF",
  sttModelLoading: "Loading model...",
  sttModelLoadingProgress: "Loading {{progress}}...",
  sttModelReady: "Model ready ({{backend}}).",
  sttModelError: "Model load failed: {{message}}",
  sttModelStateLabel: "Parakeet",
  sttModelStateNotLoaded: "not loaded",
  sttModelStateLoading: "loading",
  sttModelStateReady: "loaded",
  sttModelStateError: "error",
  sttModelStateLoadNow: "Load now",
  sttModelStateRetry: "Retry load",
  sttNeedsSelection: "Select or create a CloverMark to attach live transcription.",
  sttRecording: "Recording and transcribing...",
  sttRecordingViewer: "Streaming viewer audio and transcribing...",
  sttRecordingViewerFast: "Fast transcription mode is processing viewer audio...",
  sttStopping: "Stopping recording...",
  sttStopped: "Recording stopped.",
  sttEditedSaved: "Transcript text saved.",
  sttSavedToTranslation: "Transcript saved to Translation text.",
  sttStreamingError: "Streaming error: {{message}}",
  sttMicError: "Microphone error: {{message}}",
  sttViewerError: "Viewer audio error: {{message}}",
  sttViewerUnavailable: "No playable audio/video element is available in the viewer.",
  sttAutoScholiumLabel: "Viewer transcription",
  sttLiveAnnotationLabel: "Live transcript ({{time}})",
  tabLabel: "CloverMark",
};

const BUILTIN_TRANSLATIONS: AnnotationsTranslationResources = {
  fr: {
    activeCanvas: "Canvas actif",
    mediaType: "Type de média",
    mediaImage: "Image",
    mediaVideo: "Vidéo",
    mediaAudio: "Audio",
    mediaUnknown: "Inconnu",
    visibleAnnotations: "CloverMarks visibles",
    nativeCanvasAnnotations: "CloverMarks du canvas (natif)",
    localDraftAnnotations: "Brouillons de session",
    sessionCloverMarks: "CloverMarks de session",
    noSessionCloverMarks: "Aucun CloverMark de session. Utilisez les outils de dessin pour en ajouter un.",
    scholiumLabel: "Étiquette",
    scholiumComment: "Commentaire",
    focusScholium: "Cibler",
    deleteScholium: "Supprimer",
    scholiumSource: "Source",
    scholiumSelector: "Sélecteur",
    canvases: "Canvases",
    jumpToCanvas: "Aller",
    noCanvasAvailable: "Aucun canvas disponible",
    exportAnnotations: "Exporter les annotations (IIIF)",
    exportWebVtt: "Exporter WEBVTT",
    exportNoAnnotations: "Aucune annotation de session à exporter.",
    exportNoWebVtt: "Aucun segment WEBVTT horodaté à exporter.",
    exportSuccess: "{{count}} annotation(s) exportée(s).",
    exportWebVttSuccess: "{{count}} repère(s) WEBVTT exporté(s).",
    tabLabel: "CloverMark (français)",
    motivation: "Motivation",
    motivationUnspecified: "Non précisée",
    motivationCommenting: "Commentaire",
    motivationHighlighting: "Surlignage",
    motivationDescribing: "Description",
    motivationTranscribing: "Transcription",
    motivationTranslating: "Traduction",
    motivationTagging: "Étiquetage",
    motivationSupplementing: "Complément",
    bodyLabelCommenting: "Commentaire",
    bodyLabelHighlighting: "Surlignage",
    bodyLabelDescribing: "Description",
    bodyLabelTranscribing: "Transcription",
    bodyLabelTranslating: "Traduction",
    bodyLabelTagging: "Étiquette",
    bodyLabelSupplementing: "Complément",
    translationSectionLabel: "Traductions",
    translationNone: "Aucune traduction pour le moment.",
    translationLanguage: "Langue",
    translationLanguageUnspecified: "Non précisée",
    translationLanguagePlaceholder: "p. ex. en, fr, ht",
    translationText: "Texte traduit",
    translationTextPlaceholder: "Ajouter un texte traduit pour ce même sélecteur",
    translationSave: "Enregistrer la traduction",
    translationAdd: "+ Ajouter une traduction",
    translationDelete: "Supprimer la traduction",
    drawingOn: "Dessin: activé",
    drawingOff: "Dessin: désactivé",
    drawingRectangle: "Rectangle",
    drawingPolygon: "Polygone",
    selectorTypeRectangle: "Rectangle",
    selectorTypePolygon: "Polygone",
    selectorTypePoint: "Point",
    selectorTypeFragment: "Fragment",
    sttTitle: "Transcription en continu",
    sttLoadModel: "Charger le modèle Parakeet (~2.5GB)",
    sttReloadModel: "Recharger le modèle",
    sttStartRecording: "Démarrer le micro",
    sttStartViewer: "Transcription en temps réel",
    sttStartViewerFast: "Transcription rapide",
    sttStopRecording: "Arrêter l'enregistrement",
    sttModel: "Modèle",
    sttStatus: "Statut",
    sttIdle: "Inactif",
    sttMicLevel: "Niveau micro",
    sttSourceMic: "micro",
    sttSourceViewer: "viewer",
    sttEmbeddedHint: "Utilisez le micro, la transcription en temps réel du viewer ou la transcription rapide dans chaque champ de texte de traduction.",
    sttNoTranscript: "Aucune transcription en direct pour le moment.",
    sttTranscriptLabel: "Transcription",
    sttTranscriptPlaceholder: "Aucune transcription en direct pour le moment.",
    sttSaveTranscript: "Enregistrer le texte transcrit",
    sttTimedWordsLabel: "Segments horodatés",
    sttTimedWordsHint: "Modifiez chaque segment de sous-titre tout en conservant sa fenêtre temporelle d'origine.",
    sttSessionTime: "Session",
    sttLatency: "Latence",
    sttRtf: "RTF",
    sttModelLoading: "Chargement du modèle...",
    sttModelLoadingProgress: "Chargement {{progress}}...",
    sttModelReady: "Modèle prêt ({{backend}}).",
    sttModelError: "Échec du chargement du modèle: {{message}}",
    sttModelStateLabel: "Parakeet",
    sttModelStateNotLoaded: "non chargé",
    sttModelStateLoading: "chargement",
    sttModelStateReady: "chargé",
    sttModelStateError: "erreur",
    sttModelStateLoadNow: "Charger maintenant",
    sttModelStateRetry: "Réessayer",
    sttNeedsSelection: "Sélectionnez ou créez un CloverMark pour y associer la transcription en direct.",
    sttRecording: "Enregistrement et transcription...",
    sttRecordingViewer: "Capture de l'audio du viewer et transcription...",
    sttRecordingViewerFast: "Le mode de transcription rapide traite l'audio du viewer...",
    sttStopping: "Arrêt de l'enregistrement...",
    sttStopped: "Enregistrement arrêté.",
    sttEditedSaved: "Texte transcrit enregistré.",
    sttSavedToTranslation: "Transcription enregistrée dans le texte de traduction.",
    sttStreamingError: "Erreur de flux: {{message}}",
    sttMicError: "Erreur micro: {{message}}",
    sttViewerError: "Erreur audio du viewer: {{message}}",
    sttViewerUnavailable: "Aucun élément audio/vidéo lisible n'est disponible dans le viewer.",
    sttAutoScholiumLabel: "Transcription du viewer",
    sttLiveAnnotationLabel: "Transcription en direct ({{time}})",
  },
  es: {
    activeCanvas: "Lienzo activo",
    mediaType: "Tipo de medio",
    mediaImage: "Imagen",
    mediaVideo: "Video",
    mediaAudio: "Audio",
    mediaUnknown: "Desconocido",
    visibleAnnotations: "CloverMarks visibles",
    nativeCanvasAnnotations: "CloverMarks del lienzo (nativo)",
    localDraftAnnotations: "Borradores de sesión",
    sessionCloverMarks: "CloverMarks de sesión",
    noSessionCloverMarks: "Aún no hay CloverMarks de sesión. Usa las herramientas de dibujo para agregar uno.",
    scholiumLabel: "Etiqueta",
    scholiumComment: "Comentario",
    focusScholium: "Enfocar",
    deleteScholium: "Eliminar",
    scholiumSource: "Fuente",
    scholiumSelector: "Selector",
    canvases: "Lienzos",
    jumpToCanvas: "Ir",
    noCanvasAvailable: "No hay lienzos disponibles",
    exportAnnotations: "Exportar anotaciones (IIIF)",
    exportWebVtt: "Exportar WEBVTT",
    exportNoAnnotations: "No hay anotaciones de sesión para exportar.",
    exportNoWebVtt: "No hay segmentos WEBVTT temporizados para exportar.",
    exportSuccess: "Se exportaron {{count}} anotación(es).",
    exportWebVttSuccess: "Se exportaron {{count}} cue(s) WEBVTT.",
    tabLabel: "CloverMark",
    motivation: "Motivación",
    motivationUnspecified: "Sin especificar",
    motivationCommenting: "Comentario",
    motivationHighlighting: "Resaltado",
    motivationDescribing: "Descripción",
    motivationTranscribing: "Transcripción",
    motivationTranslating: "Traducción",
    motivationTagging: "Etiquetado",
    motivationSupplementing: "Suplemento",
    bodyLabelCommenting: "Comentario",
    bodyLabelHighlighting: "Resaltado",
    bodyLabelDescribing: "Descripción",
    bodyLabelTranscribing: "Transcripción",
    bodyLabelTranslating: "Traducción",
    bodyLabelTagging: "Etiqueta",
    bodyLabelSupplementing: "Suplemento",
    translationSectionLabel: "Traducciones",
    translationNone: "Aún no hay traducciones.",
    translationLanguage: "Idioma",
    translationLanguageUnspecified: "Sin especificar",
    translationLanguagePlaceholder: "p. ej. en, fr, ht",
    translationText: "Texto traducido",
    translationTextPlaceholder: "Agregar texto traducido para este mismo selector",
    translationSave: "Guardar traducción",
    translationAdd: "+ Agregar traducción",
    translationDelete: "Eliminar traducción",
    drawingOn: "Dibujo: activado",
    drawingOff: "Dibujo: desactivado",
    drawingRectangle: "Rectángulo",
    drawingPolygon: "Polígono",
    selectorTypeRectangle: "Rectángulo",
    selectorTypePolygon: "Polígono",
    selectorTypePoint: "Punto",
    selectorTypeFragment: "Fragmento",
    sttTitle: "Transcripción en streaming",
    sttLoadModel: "Cargar modelo Parakeet (~2.5GB)",
    sttReloadModel: "Recargar modelo",
    sttStartRecording: "Iniciar micrófono",
    sttStartViewer: "Transcripción en tiempo real",
    sttStartViewerFast: "Transcripción rápida",
    sttStopRecording: "Detener grabación",
    sttModel: "Modelo",
    sttStatus: "Estado",
    sttIdle: "Inactivo",
    sttMicLevel: "Nivel de micrófono",
    sttSourceMic: "micrófono",
    sttSourceViewer: "visor",
    sttEmbeddedHint: "Usa micrófono, transcripción en tiempo real del visor o transcripción rápida del visor dentro de cada campo de texto de traducción.",
    sttNoTranscript: "Aún no hay transcripción en vivo.",
    sttTranscriptLabel: "Transcripción",
    sttTranscriptPlaceholder: "Aún no hay transcripción en vivo.",
    sttSaveTranscript: "Guardar texto transcrito",
    sttTimedWordsLabel: "Segmentos con marca de tiempo",
    sttTimedWordsHint: "Edita cada segmento de subtítulo conservando su ventana de tiempo original.",
    sttSessionTime: "Sesión",
    sttLatency: "Latencia",
    sttRtf: "RTF",
    sttModelLoading: "Cargando modelo...",
    sttModelLoadingProgress: "Cargando {{progress}}...",
    sttModelReady: "Modelo listo ({{backend}}).",
    sttModelError: "Error al cargar el modelo: {{message}}",
    sttModelStateLabel: "Parakeet",
    sttModelStateNotLoaded: "no cargado",
    sttModelStateLoading: "cargando",
    sttModelStateReady: "cargado",
    sttModelStateError: "error",
    sttModelStateLoadNow: "Cargar ahora",
    sttModelStateRetry: "Reintentar",
    sttNeedsSelection: "Selecciona o crea un CloverMark para adjuntar la transcripción en vivo.",
    sttRecording: "Grabando y transcribiendo...",
    sttRecordingViewer: "Capturando audio del visor y transcribiendo...",
    sttRecordingViewerFast: "El modo de transcripción rápida está procesando el audio del visor...",
    sttStopping: "Deteniendo grabación...",
    sttStopped: "Grabación detenida.",
    sttEditedSaved: "Texto transcrito guardado.",
    sttSavedToTranslation: "Transcripción guardada en el texto de traducción.",
    sttStreamingError: "Error de streaming: {{message}}",
    sttMicError: "Error de micrófono: {{message}}",
    sttViewerError: "Error de audio del visor: {{message}}",
    sttViewerUnavailable: "No hay ningún elemento de audio/video reproducible disponible en el visor.",
    sttAutoScholiumLabel: "Transcripción del visor",
    sttLiveAnnotationLabel: "Transcripción en vivo ({{time}})",
  },
};

export function registerAnnotationsTranslations(
  resources?: AnnotationsTranslationResources,
): void {
  initCloverI18n();

  i18next.addResourceBundle(
    "en",
    ANNOTATIONS_I18N_NAMESPACE,
    DEFAULT_TRANSLATIONS,
    true,
    true,
  );

  for (const [language, resource] of Object.entries(BUILTIN_TRANSLATIONS)) {
    i18next.addResourceBundle(
      language,
      ANNOTATIONS_I18N_NAMESPACE,
      resource,
      true,
      true,
    );
  }

  if (!resources) {
    return;
  }

  for (const [language, resource] of Object.entries(resources)) {
    if (!resource) {
      continue;
    }

    i18next.addResourceBundle(
      language,
      ANNOTATIONS_I18N_NAMESPACE,
      resource,
      true,
      true,
    );
  }
}

export function createInternationalStringLabel(
  options: {
    tabLabel?: string;
    tabLabelByLanguage?: Record<string, string>;
  },
): InternationalStringLike {
  if (options.tabLabelByLanguage && Object.keys(options.tabLabelByLanguage).length > 0) {
    return Object.fromEntries(
      Object.entries(options.tabLabelByLanguage).map(([language, label]) => [language, [label]]),
    );
  }

  const tabLabel = options.tabLabel ?? DEFAULT_TRANSLATIONS.tabLabel;
  return {
    none: [tabLabel],
  };
}
type InternationalStringLike = Record<string, string[]>;
