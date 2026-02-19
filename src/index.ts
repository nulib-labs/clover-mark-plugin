import type { PluginConfig } from "@samvera/clover-iiif";
import {
  createInternationalStringLabel,
  registerAnnotationsTranslations,
  type AnnotationsTranslationResources,
} from "./i18n";
import { cloverMarkPanel } from "./annotations-panel";
import { AnnotationsBridge } from "./annotations-bridge";

export type CreateCloverMarkPluginOptions = {
  id?: string;
  enableImageDrawing?: boolean;
  enableStreamingStt?: boolean;
  sttModelVersion?: string;
  sttUpdateIntervalMs?: number;
  defaultMotivation?: string | string[];
  motivationOptions?: string[];
  tabLabel?: string;
  tabLabelByLanguage?: Record<string, string>;
  translations?: AnnotationsTranslationResources;
  translationLanguageOptions?: string[];
  defaultTranslationLanguage?: string;
};

export function cloverMarkPlugin(
  options: CreateCloverMarkPluginOptions = {},
): PluginConfig {
  registerAnnotationsTranslations(options.translations);

  return {
    id: options.id ?? "clover-mark",
    imageViewer: options.enableImageDrawing === false
      ? undefined
        : {
          controls: {
            component: AnnotationsBridge,
            componentProps: {
              defaultMotivation: options.defaultMotivation ?? "supplementing",
            },
          },
        },
    informationPanel: {
      component: cloverMarkPanel,
      componentProps: {
        defaultMotivation: options.defaultMotivation ?? "supplementing",
        motivationOptions: options.motivationOptions,
        translationLanguageOptions: options.translationLanguageOptions,
        defaultTranslationLanguage: options.defaultTranslationLanguage,
        enableStreamingStt: options.enableStreamingStt,
        sttModelVersion: options.sttModelVersion,
        sttUpdateIntervalMs: options.sttUpdateIntervalMs,
      },
      label: createInternationalStringLabel({
        tabLabel: options.tabLabel,
        tabLabelByLanguage: options.tabLabelByLanguage,
      }),
    },
  };
}

export { cloverMarkPanel };
export {
  ANNOTATIONS_I18N_NAMESPACE,
  type AnnotationsTranslationOverrides,
  type AnnotationsTranslationResources,
  type AnnotationsTranslationStrings,
} from "./i18n";
