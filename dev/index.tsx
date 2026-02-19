import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import Viewer from "@samvera/clover-iiif/viewer";
import { initCloverI18n } from "@samvera/clover-iiif/i18n";
import { cloverMarkPlugin } from "../src";
import "./index.css";

const MANIFEST_URL =
  "https://api.dc.library.northwestern.edu/api/v2/collections/8fdc5942-12a0-4abd-8f43-5d19b37ece75?as=iiif";
const MOTIVATION_OPTIONS = [
  "commenting",
  "highlighting",
  "tagging",
  "supplementing",
] as const;
const TRANSLATION_LANGUAGE_OPTIONS = ["en", "fr", "es", "ht", "ar"] as const;
const MANIFEST_EXAMPLES = [
  {
    title: "Northwestern University Libraries",
    source: "McCormick Library of Special Collections Audiovisual Collection",
    description: "IIIF collection from Northwestern's McCormick Library of Special Collections.",
    url: MANIFEST_URL,
  },
  {
    title: "Villanova Digital Library",
    source: "Villanova University",
    description: "Collection item suitable for testing cross-institution compatibility.",
    url: "https://digital.library.villanova.edu/Item/vudl:571305/Manifest",
  },
  {
    title: "Leipzig University",
    source: "Universitatsbibliothek Leipzig",
    description: "High-quality image manifest useful for navigation and annotation checks.",
    url: "https://iiif.ub.uni-leipzig.de/0000029625/manifest.json",
  },
] as const;
const VIEWER_THEME = {
  colors: {
    primary: "#111827",
    primaryMuted: "#22304d",
    primaryAlt: "#0f1c33",
    accent: "#1858d6",
    accentMuted: "#4f84eb",
    accentAlt: "#0f44a8",
    secondary: "#ffffff",
    secondaryMuted: "#edf2fb",
    secondaryAlt: "#c0d0eb",
  },
} as const;
type MotivationOption = (typeof MOTIVATION_OPTIONS)[number];
type TranslationLanguageOption = (typeof TRANSLATION_LANGUAGE_OPTIONS)[number];

function App() {
  const i18n = useMemo(() => initCloverI18n(), []);
  const [language, setLanguage] = useState("en");
  const [defaultMotivation, setDefaultMotivation] = useState<MotivationOption>("supplementing");
  const [defaultTranslationLanguage, setDefaultTranslationLanguage] =
    useState<TranslationLanguageOption>("en");
  const [iiifContent, setIiifContent] = useState(MANIFEST_URL);
  const [manifestInput, setManifestInput] = useState(MANIFEST_URL);
  const motivationLabelsByLanguage = useMemo(
    () => ({
      en: {
        commenting: "Commenting",
        highlighting: "Highlighting",
        tagging: "Tagging",
        supplementing: "Supplementing",
      },
      es: {
        commenting: "Comentario",
        highlighting: "Resaltado",
        tagging: "Etiquetado",
        supplementing: "Suplemento",
      },
      fr: {
        commenting: "Commentaire",
        highlighting: "Surlignage",
        tagging: "Étiquetage",
        supplementing: "Complément",
      },
    }),
    [],
  );
  const plugins = useMemo(
    () => [
      cloverMarkPlugin({
        defaultMotivation,
        motivationOptions: [...MOTIVATION_OPTIONS],
        translationLanguageOptions: [...TRANSLATION_LANGUAGE_OPTIONS],
        defaultTranslationLanguage,
        enableStreamingStt: true,
        tabLabel:
          {
            en: "CloverMark",
            es: "CloverMark",
            fr: "CloverMark (français)",
          }[language] ?? "CloverMark",
        translations: {
          es: {
            tabLabel: "CloverMark",
            motivationCommenting: "Comentario",
            motivationHighlighting: "Resaltado",
            motivationDescribing: "Descripción",
            motivationTranscribing: "Transcripción",
            motivationTranslating: "Traducción",
            motivationTagging: "Etiquetado",
            motivationSupplementing: "Suplemento",
          },
          fr: {
            tabLabel: "CloverMark (français)",
            motivationCommenting: "Commentaire",
            motivationHighlighting: "Surlignage",
            motivationDescribing: "Description",
            motivationTranscribing: "Transcription",
            motivationTranslating: "Traduction",
            motivationTagging: "Étiquetage",
            motivationSupplementing: "Complément",
          },
        },
      }),
    ],
    [defaultMotivation, defaultTranslationLanguage, language],
  );

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = manifestInput.trim();
    if (!trimmed) {
      return;
    }
    setIiifContent(trimmed);
  }

  function onSelectExample(url: string) {
    setManifestInput(url);
    setIiifContent(url);
  }

  return (
    <div className="clover-mark-demo">
      <header className="clover-mark-demo__header">
        <p className="clover-mark-demo__eyebrow">Clover Viewer Demo Workspace</p>
        <h1>CloverMark Plugin</h1>
        <p className="clover-mark-demo__lead">
          Configure annotation defaults, then load a IIIF manifest to validate image and audiovisual
          behavior in one place.
        </p>
      </header>

      <section className="clover-mark-demo__panel" aria-label="Demo controls">
        <div className="clover-mark-demo__field-grid">
          <div className="clover-mark-demo__field">
            <label htmlFor="language">Demo language</label>
            <select
              id="language"
              value={language}
              onChange={(event) => {
                const nextLanguage = event.target.value;
                setLanguage(nextLanguage);
                void i18n.changeLanguage(nextLanguage);
              }}
            >
              <option value="en">English</option>
              <option value="fr">French</option>
              <option value="es">Spanish</option>
            </select>
          </div>
          <div className="clover-mark-demo__field">
            <label htmlFor="default-translation-language">Default translation language</label>
            <select
              id="default-translation-language"
              value={defaultTranslationLanguage}
              onChange={(event) =>
                setDefaultTranslationLanguage(
                  event.target.value as TranslationLanguageOption,
                )
              }
            >
              {TRANSLATION_LANGUAGE_OPTIONS.map((languageOption) => (
                <option key={languageOption} value={languageOption}>
                  {languageOption}
                </option>
              ))}
            </select>
          </div>
          <div className="clover-mark-demo__field">
            <label htmlFor="default-motivation">Default motivation</label>
            <select
              id="default-motivation"
              value={defaultMotivation}
              onChange={(event) => setDefaultMotivation(event.target.value as MotivationOption)}
            >
              {MOTIVATION_OPTIONS.map((motivation) => (
                <option key={motivation} value={motivation}>
                  {motivationLabelsByLanguage[language as keyof typeof motivationLabelsByLanguage]?.[
                    motivation
                  ] ?? motivation}
                </option>
              ))}
            </select>
          </div>
        </div>

        <form onSubmit={onSubmit} className="clover-mark-demo__manifest-form">
          <label htmlFor="manifest-url">Manifest URL</label>
          <div className="clover-mark-demo__manifest-row">
            <input
              id="manifest-url"
              type="url"
              value={manifestInput}
              onChange={(event) => setManifestInput(event.target.value)}
              placeholder="https://example.org/manifest.json"
            />
            <button type="submit">Load Manifest</button>
          </div>
        </form>

        <section className="clover-mark-demo__examples" aria-labelledby="manifest-examples-heading">
          <div className="clover-mark-demo__examples-heading">
            <h2 id="manifest-examples-heading">Manifest Examples</h2>
          </div>
          <div className="manifest-example-grid">
            {MANIFEST_EXAMPLES.map((example) => {
              const selected = manifestInput.trim() === example.url;
              return (
                <article
                  key={example.url}
                  className={`manifest-example-card${selected ? " manifest-example-card--selected" : ""}`}
                >
                  <h3>{example.title}</h3>
                  <p className="manifest-example-card__source">{example.source}</p>
                  <p className="manifest-example-card__description">{example.description}</p>
                  <p className="manifest-example-card__url">{example.url}</p>
                  <button type="button" onClick={() => onSelectExample(example.url)}>
                    {selected ? "Selected" : "Use Example"}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      </section>

      <section className="clover-mark-demo__viewer">
        <Viewer
          key={`${iiifContent}:${language}:${defaultMotivation}:${defaultTranslationLanguage}`}
          iiifContent={iiifContent}
          customTheme={VIEWER_THEME}
          plugins={plugins}
          options={{
            informationPanel: {
              open: true,
            },
            showTitle: true,
          }}
        />
      </section>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root container");
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
