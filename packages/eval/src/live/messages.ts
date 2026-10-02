import { readFileSync } from "node:fs";

/** One line of queries/reactions.jsonl: a chat message and the reactions people would use. */
export interface LabelledMessage {
  id: string;
  text: string;
  /** BCP 47 language of the text. The API maps languages without a pack to "en". */
  locale: string;
  /** celebration, thanks, sympathy, agreement, humor, frustration, … (for analysis only). */
  intent: string;
  answers: string[];
  /** Literal-noun traps that must not reach the top 4 ("smoke tests" → 🚬). */
  forbid?: string[];
  note?: string;
}

export function parseMessages(text: string): LabelledMessage[] {
  const seen = new Set<string>();
  return text
    .split("\n")
    .map((line, i) => ({ line, where: `reactions.jsonl line ${i + 1}` }))
    .filter(({ line }) => line.trim() !== "")
    .map(({ line, where }) => {
      let message: Partial<LabelledMessage>;
      try {
        message = JSON.parse(line);
      } catch {
        throw new Error(`${where}: not valid JSON`);
      }
      if (!message.id || seen.has(message.id)) throw new Error(`${where}: "id" missing or repeated`);
      seen.add(message.id);
      if (typeof message.text !== "string" || message.text.trim() === "") {
        throw new Error(`${where}: "text" is required`);
      }
      if (!Array.isArray(message.answers) || message.answers.length < 2) {
        throw new Error(`${where}: "answers" must list at least 2 emoji`);
      }
      return { locale: "en", intent: "other", ...message } as LabelledMessage;
    });
}

export const loadMessages = (path: string) => parseMessages(readFileSync(path, "utf8"));
