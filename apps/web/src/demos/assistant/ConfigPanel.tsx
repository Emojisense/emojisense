import { useEffect, useId, useRef, useState } from "react";
import { useDemoI18n } from "../../i18n/demos";
import { CheckIcon, CopyIcon } from "./icons";
import { highlightJson } from "./json";
import { TOOLS, type ToolName } from "./mcp";

/** The client configs, verbatim from packages/mcp/README.md ("Client configuration"). */
const OFFLINE_CONFIG = `{
  "mcpServers": {
    "emojisense": {
      "command": "npx",
      "args": ["-y", "@emojisense/mcp"]
    }
  }
}`;

const SEMANTIC_CONFIG = `{
  "mcpServers": {
    "emojisense": {
      "command": "npx",
      "args": ["-y", "@emojisense/mcp"],
      "env": {
        "EMOJISENSE_API_URL": "https://api.emojisense.com",
        "EMOJISENSE_SECRET_KEY": "sk_live_…"
      }
    }
  }
}`;

interface ConfigPanelProps {
  activeTool: ToolName | undefined;
  /** The server has an API key, so unsure queries also go to meaning search. */
  semantic: boolean;
  onSemanticChange: (semantic: boolean) => void;
}

type CopyState = "idle" | "copied" | "failed";

/** How to install the server, with or without its semantic layer, and the tool in use right now. */
export function ConfigPanel({ activeTool, semantic, onSemanticChange }: ConfigPanelProps) {
  const [copy, setCopy] = useState<CopyState>("idle");
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  const codeRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const { t } = useDemoI18n();
  const config = semantic ? SEMANTIC_CONFIG : OFFLINE_CONFIG;

  useEffect(() => () => clearTimeout(reset.current), []);

  const onCopy = async () => {
    let next: CopyState = "copied";
    try {
      await navigator.clipboard.writeText(config);
    } catch {
      // No clipboard access (permissions, insecure context): select the code for a manual copy.
      next = "failed";
      const code = codeRef.current;
      if (code) getSelection()?.selectAllChildren(code);
    }
    setCopy(next);
    clearTimeout(reset.current);
    reset.current = setTimeout(() => setCopy("idle"), 2400);
  };

  return (
    <aside className="assistant-side" aria-labelledby={titleId}>
      <div className="assistant-side-head">
        <p className="assistant-side-kicker">{t.t("assistant.config.kicker")}</p>
        <p className="assistant-side-title" id={titleId}>
          {t.t("assistant.config.title")}
        </p>
        <p className="assistant-side-lead">{t.t("assistant.config.lead")}</p>
      </div>

      <label className="assistant-switch">
        <input
          type="checkbox"
          role="switch"
          checked={semantic}
          aria-checked={semantic}
          onChange={(event) => onSemanticChange(event.currentTarget.checked)}
        />
        <span className="assistant-switch-track" aria-hidden="true" />
        <span className="assistant-switch-text">
          <strong>{t.t("assistant.config.semantic")}</strong>
          <span>{semantic ? t.t("assistant.config.semanticOn") : t.t("assistant.config.semanticOff")}</span>
        </span>
      </label>

      <div className="assistant-config">
        <div className="assistant-config-bar">
          <span>mcp.json</span>
          <button type="button" className="assistant-copy" data-state={copy} onClick={onCopy}>
            {copy === "copied" ? <CheckIcon /> : <CopyIcon />}
            <span aria-live="polite">
              {copy === "copied"
                ? t.t("assistant.config.copied")
                : copy === "failed"
                  ? t.t("assistant.config.copyFailed")
                  : t.t("assistant.config.copy")}
            </span>
          </button>
        </div>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable code block must be reachable by keyboard. */}
        <pre tabIndex={0}>
          <code ref={codeRef}>{highlightJson(config)}</code>
        </pre>
      </div>

      <ul className="assistant-tools" aria-label={t.t("assistant.config.tools")}>
        {TOOLS.map((tool) => (
          <li key={tool.name} data-active={tool.name === activeTool}>
            <code>{tool.name}</code>
            <span>{t.t(`assistant.config.summaries.${tool.name}`)}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
