import { useEffect, useId, useRef, useState } from "react";
import { useDemoI18n } from "../../i18n/demos";
import { CheckIcon, CopyIcon } from "./icons";
import { highlightJson } from "./json";
import { TOOLS, type ToolName } from "./mcp";

/** The offline client config, verbatim from packages/mcp/README.md ("Client configuration"). */
const CONFIG = `{
  "mcpServers": {
    "emojisense": {
      "command": "npx",
      "args": ["-y", "@emojisense/mcp"]
    }
  }
}`;

type CopyState = "idle" | "copied" | "failed";

/** How to install the server, and which of its tools the assistant is using right now. */
export function ConfigPanel({ activeTool }: { activeTool: ToolName | undefined }) {
  const [copy, setCopy] = useState<CopyState>("idle");
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  const codeRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const { t } = useDemoI18n();

  useEffect(() => () => clearTimeout(reset.current), []);

  const onCopy = async () => {
    let next: CopyState = "copied";
    try {
      await navigator.clipboard.writeText(CONFIG);
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
          <code ref={codeRef}>{highlightJson(CONFIG)}</code>
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
