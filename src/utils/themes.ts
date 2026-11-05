export const THEME_VAR_KEYS = [
  ["bg", "--bg"],
  ["bgElevated", "--bg-elevated"],
  ["bgHover", "--bg-hover"],
  ["bgActive", "--bg-active"],
  ["border", "--border"],
  ["borderStrong", "--border-strong"],
  ["text", "--text"],
  ["textDim", "--text-dim"],
  ["textFaint", "--text-faint"],
  ["accent", "--accent"],
  ["accentDim", "--accent-dim"],
  ["danger", "--danger"],
  ["success", "--success"],
  ["selection", "--selection"],
] as const;

const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const HUE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:deg|grad|rad|turn)?$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function inRange(value: string, max: number, percentageOnly = false): boolean {
  const percent = value.endsWith("%");
  if (percentageOnly && !percent) return false;
  const number = percent ? value.slice(0, -1) : value;
  return NUMBER.test(number) && Number.isFinite(Number(number)) &&
    Number(number) >= 0 && Number(number) <= (percent ? 100 : max);
}

function isFunctionalColor(value: string): boolean {
  const match = /^(rgb|rgba|hsl|hsla)\(([^()]*)\)$/i.exec(value);
  if (!match) return false;

  const body = match[2].trim();
  let channels: string[];
  let alpha: string | undefined;
  if (body.includes(",")) {
    if (body.includes("/")) return false;
    const parts = body.split(",").map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) return false;
    channels = parts.slice(0, 3);
    alpha = parts.length === 4 ? parts[3] : undefined;
    // Legacy RGB syntax cannot mix percentages with numeric channels.
    if (/^rgb/i.test(match[1]) &&
      channels.some((part) => part.endsWith("%") !== channels[0].endsWith("%"))) {
      return false;
    }
  } else {
    const parts = body.split("/");
    if (parts.length > 2) return false;
    channels = parts[0].trim().split(/\s+/);
    alpha = parts.length === 2 ? parts[1].trim() : undefined;
    if (channels.length !== 3) return false;
  }

  if (alpha !== undefined && !inRange(alpha, 1)) return false;
  if (/^rgb/i.test(match[1])) return channels.every((part) => inRange(part, 255));

  const hue = channels[0];
  return HUE.test(hue) && Number.isFinite(Number.parseFloat(hue)) &&
    inRange(channels[1], 100, true) && inRange(channels[2], 100, true);
}

function isSafeColor(value: string): boolean {
  const hex = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value);
  if (!hex && !isFunctionalColor(value)) return false;
  return typeof CSS === "undefined" || typeof CSS.supports !== "function" ||
    CSS.supports("color", value);
}

/** Accepts decoded JSON; an empty name lets the caller provide a localized default. */
export function parseTheme(input: unknown): { name: string; vars: Record<string, string> } {
  if (!isRecord(input)) throw new Error("THEME_INVALID_OBJECT");

  const colors = Object.prototype.hasOwnProperty.call(input, "colors") ? input.colors
    : Object.prototype.hasOwnProperty.call(input, "vars") ? input.vars : input;
  if (!isRecord(colors)) throw new Error("THEME_INVALID_COLORS");

  const vars: Record<string, string> = {};
  for (const [key] of THEME_VAR_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(colors, key)) continue;
    const value = colors[key];
    if (typeof value !== "string" || !isSafeColor(value.trim())) {
      throw new Error(`THEME_INVALID_COLOR:${key}`);
    }
    vars[key] = value.trim();
  }
  if (Object.keys(vars).length === 0) throw new Error("THEME_NO_COLORS");

  return {
    name: typeof input.name === "string" ? input.name.trim() : "",
    vars,
  };
}
