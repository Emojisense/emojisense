import { type ComponentType, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { AutoplayStop } from "../demos/autoplay-control";
import AssistantSkin from "../demos/stage/AssistantSkin";
import ColonSkin from "../demos/stage/ColonSkin";
import FrimousseSkin from "../demos/stage/FrimousseSkin";
import LauncherSkin from "../demos/stage/LauncherSkin";
import PickerSkin from "../demos/stage/PickerSkin";
import { SKINS, type SkinId, type SkinKind, type SkinProps } from "../demos/stage/skins";
import { horizontalStep, useTranslator } from "../i18n/react";
import { StageI18nProvider, type StageMessages } from "../i18n/stage";
import { useEngine } from "../lib/engine-client";
import { integrationOf, type Status } from "../lib/integrations";
import { LOGO_VIEWBOX, LOGOS, type LogoName } from "../lib/logos";
import "../demos/stage.css";

const SKIN_VIEWS: Record<SkinKind, ComponentType<SkinProps>> = {
  frimousse: FrimousseSkin,
  colon: ColonSkin,
  picker: PickerSkin,
  launcher: LauncherSkin,
  assistant: AssistantSkin,
};

function Logo({ name }: { name: LogoName }) {
  const logo = LOGOS[name];
  return logo.kind === "icon" ? (
    <svg className="stg-logo" viewBox={logo.viewBox ?? LOGO_VIEWBOX} aria-hidden="true" focusable="false">
      <path d={logo.path} />
    </svg>
  ) : null;
}

export interface IntegrationStageProps {
  /** The catalog's `integrations.stage` part, in the page's language. */
  messages: StageMessages;
  /** Each tool's integration name, e.g. "Tiptap extension". */
  names: Record<SkinId, string>;
  statusLabels: Record<Status, string>;
  /** Intl tag of the page. */
  lang: string;
  /** The docs are English: a translated page says so on its links. */
  docsLang?: string | undefined;
}

/**
 * One real engine behind the tools people type in: editors, a forum, a blog, a browser, a launcher
 * and an AI assistant. Each tab plays its tool once, then hands it to the visitor.
 */
export function IntegrationStage({ messages, names, statusLabels, lang, docsLang }: IntegrationStageProps) {
  const t = useTranslator(messages, lang);
  const id = useId();
  const [current, setCurrent] = useState<SkinId>(SKINS[0]?.id ?? "tiptap");
  const [visible, setVisible] = useState(false);
  const { engine } = useEngine();
  const rootRef = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  // The autoplay waits until the stage is on screen.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { threshold: 0.4 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // WAI-ARIA tabs: arrows move between tabs, Home and End jump to the first and last.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = SKINS.findIndex((skin) => skin.id === current);
    const step = horizontalStep(event);
    const jumps: Record<string, number> = { Home: 0, End: SKINS.length - 1 };
    const nextIndex = step === 0 ? jumps[event.key] : (index + step + SKINS.length) % SKINS.length;
    const next = nextIndex === undefined ? undefined : SKINS[nextIndex];
    if (nextIndex === undefined || !next) return;
    event.preventDefault();
    setCurrent(next.id);
    tabs.current[nextIndex]?.focus();
  };

  const index = SKINS.findIndex((skin) => skin.id === current);
  const skin = SKINS[index] ?? SKINS[0];
  if (!skin) return null;
  const integration = integrationOf(skin.key);
  const View = SKIN_VIEWS[skin.kind];
  const panelId = `${id}-panel`;

  return (
    <StageI18nProvider messages={messages} lang={lang}>
      <div className="stg" ref={rootRef}>
        <div className="stg-tabs" role="tablist" aria-label={t.t("tabs")} onKeyDown={onKeyDown}>
          {SKINS.map((item, i) => (
            <button
              key={item.id}
              ref={(element) => {
                tabs.current[i] = element;
              }}
              id={`${id}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={item.id === current}
              aria-controls={panelId}
              tabIndex={item.id === current ? 0 : -1}
              className="stg-tab"
              onClick={() => setCurrent(item.id)}
            >
              <Logo name={item.logo} />
              {LOGOS[item.logo].label}
            </button>
          ))}
        </div>

        <div id={panelId} role="tabpanel" aria-labelledby={`${id}-tab-${current}`} className="stg-panel">
          {/* The stop button comes first in the DOM, before the moving demo; CSS puts it below. */}
          <AutoplayStop label={t.t("stop")} onStop={() => tabs.current[index]?.focus()}>
            <div className="stg-stage" data-skin={skin.id}>
              <div className="stg-window">
                <View key={skin.id} skin={skin} engine={engine} visible={visible} />
              </div>
              <div className="stg-aside">
                <p className="stg-aside-brand">
                  <Logo name={skin.logo} />
                  <span className="stg-badge" data-status={integration.status}>
                    {statusLabels[integration.status]}
                  </span>
                </p>
                <h3 className="stg-aside-name">{names[skin.id]}</h3>
                <p className="stg-aside-pitch">{messages.skins[skin.id].pitch}</p>
                <a className="stg-aside-docs" href={integration.docs} hrefLang={docsLang}>
                  {t.t("docs")}
                  <span className="visually-hidden">: {names[skin.id]}</span>
                  <svg className="stg-arrow" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <path d="M3.5 8h9M8.5 4l4 4-4 4" />
                  </svg>
                </a>
                <p className="stg-aside-note">
                  <span className="stg-live" aria-hidden="true" />
                  {t.t("caption")}
                </p>
              </div>
            </div>
          </AutoplayStop>
        </div>
      </div>
    </StageI18nProvider>
  );
}
