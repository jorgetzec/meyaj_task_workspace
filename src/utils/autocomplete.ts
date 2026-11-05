import { currentTagToken } from "./hashtags";

export interface InlineSuggestion {
  kind: "classifier" | "hashtag";
  /** Index in `value` where the token begins. */
  start: number;
  /** The token currently being typed (without the `#` prefix). */
  token: string;
  matches: string[];
}

/**
 * Detects an inline autocomplete context at the caret position:
 *  - before the first `|` -> a classifier is being typed;
 *  - after a `#` -> a hashtag is being typed.
 */
export function getInlineSuggestion(
  value: string,
  caret: number,
  classifiers: string[],
  knownTags: string[],
): InlineSuggestion | null {
  const before = value.slice(0, caret);
  const pipeIdx = before.indexOf("|");

  if (pipeIdx < 0) {
    // Typing the classifier (before the separator).
    const token = before.trim();
    if (token === "") return null;
    const matches = classifiers.filter(
      (c) =>
        c.toLowerCase().startsWith(token.toLowerCase()) &&
        c.toUpperCase() !== token.toUpperCase(),
    );
    return { kind: "classifier", start: 0, token, matches };
  }

  // After the separator: hashtags.
  const tag = currentTagToken(value, caret);
  if (tag) {
    const matches = knownTags.filter(
      (t) => t.startsWith(tag.token) && t !== tag.token,
    );
    return { kind: "hashtag", start: tag.start, token: tag.token, matches };
  }

  return null;
}
