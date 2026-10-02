import apiFetch from "@wordpress/api-fetch";
import domReady from "@wordpress/dom-ready";
import { __ } from "@wordpress/i18n";
import "./admin.scss";

/** Settings that only matter with the API connection on. */
const API_FIELDS = ["publishable-key", "semantic-search", "suggest-reactions", "emoji-set", "api-url"];

domReady(() => {
  const connection = document.getElementById("emojisense-api-enabled");
  const rows = API_FIELDS.map((id) => document.getElementById(`emojisense-${id}`)?.closest("tr")).filter(
    Boolean,
  );
  const sync = () => {
    for (const row of rows) row.classList.toggle("emojisense-settings__row--off", !connection?.checked);
  };
  connection?.addEventListener("change", sync);
  sync();

  const button = document.getElementById("emojisense-test-connection");
  const result = document.querySelector(".emojisense-settings__test-result");
  button?.addEventListener("click", async () => {
    button.disabled = true;
    result.className = "emojisense-settings__test-result";
    result.textContent = __("Testing…", "emojisense");
    try {
      const response = await apiFetch({ path: "/emojisense/v1/test-connection", method: "POST" });
      result.classList.add("is-ok");
      result.textContent = response.message;
    } catch (error) {
      result.classList.add("is-error");
      result.textContent = error?.message ?? __("The test failed.", "emojisense");
    } finally {
      button.disabled = false;
    }
  });
});
