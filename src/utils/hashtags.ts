import type { Task } from "../types";

/** Hashtags sugeridos por defecto, además de los ya usados. */
export const DEFAULT_TAGS = [
  "foco",
  "pausa",
  "espera",
  "importante",
  "focus",
  "next",
  "waiting",
  "review",
  "idea",
  "topic/work",
  "topic/code",
  "topic/design",
];

/** Unión de los hashtags por defecto y los ya presentes en las tareas. */
export function knownTags(tasks: Task[]): string[] {
  const set = new Set(DEFAULT_TAGS);
  for (const t of tasks) {
    for (const h of t.hashtags) set.add(h);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Detecta el hashtag que se está escribiendo justo antes del cursor.
 * Devuelve la posición de inicio del `#` y el token (sin el `#`).
 */
export function currentTagToken(
  value: string,
  caret: number,
): { start: number; token: string } | null {
  const before = value.slice(0, caret);
  const hashIdx = before.lastIndexOf("#");
  if (hashIdx < 0) return null;
  // El '#' debe iniciar palabra (precedido de inicio, espacio o '|').
  if (hashIdx > 0 && !/[\s|]/.test(before[hashIdx - 1])) return null;
  const token = before.slice(hashIdx + 1);
  if (token === "" || /[\s|]/.test(token)) return null;
  return { start: hashIdx, token };
}
