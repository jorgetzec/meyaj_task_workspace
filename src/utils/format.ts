/** Extracts a compact YYYYMMDD from an ISO-ish datetime string. */
export function yyyymmdd(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.replace(/\D/g, "").slice(0, 8);
}

/** Human-readable short date, e.g. "04 nov 2026". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Parses #hashtag tokens (supports namespaced tags like #tema/science). */
export function parseHashtags(text: string): string[] {
  const tags: string[] = [];
  const re = /#[\p{L}\p{N}_/-]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tag = m[0].slice(1);
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** Today as YYYYMMDD. */
export function todayCompact(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** The pre-formatted prefix for a new task line, e.g. "WORK | ". */
export function prefixForClassifier(cls: string): string {
  return `${cls} | `;
}

/**
 * Parses a typed task entry like "WORK | Review the draft". Returns the
 * classifier (uppercased) and the content. If there is no "|" separator, the
 * whole string is content and the fallback classifier is used.
 */
export function parseTaskEntry(
  value: string,
  fallbackClassifier: string | null,
): { classifier: string | null; content: string } {
  const trimmed = value.trim();
  const idx = trimmed.indexOf("|");
  if (idx > 0) {
    const cls = trimmed.slice(0, idx).trim().toUpperCase();
    const content = trimmed.slice(idx + 1).trim();
    return { classifier: cls || fallbackClassifier, content };
  }
  return { classifier: fallbackClassifier, content: trimmed };
}

/** Groups hashtags into a normalized set with counts. */
export function hashtagCounts(contents: { hashtags: string[] }[]) {
  const counts = new Map<string, number>();
  for (const item of contents) {
    for (const tag of item.hashtags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** Formats a "YYYY-MM" month key into a localized month name + year. */
export function formatMonth(iso: string, lang: "es" | "en"): string {
  const [y, m] = iso.split("-").map(Number);
  if (!y || !m) return iso;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(lang === "en" ? "en-US" : "es-MX", {
    month: "long",
    year: "numeric",
  });
}
