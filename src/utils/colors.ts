/** Preset swatches offered to the user when picking a project color. */
export const PROJECT_PRESET_COLORS = [
  "#7b9bff",
  "#5ec8d8",
  "#4fbf8b",
  "#a3d15f",
  "#d8c04f",
  "#f0a35e",
  "#e0715d",
  "#e05d8f",
  "#c07be0",
  "#8b7bd8",
  "#8b93a7",
  "#6b7280",
];

/** Palette used to derive a stable color from a classifier name. */
const CLASSIFIER_PALETTE = [
  "#7b9bff",
  "#5ec8d8",
  "#4fbf8b",
  "#a3d15f",
  "#d8c04f",
  "#f0a35e",
  "#e0715d",
  "#e05d8f",
  "#c07be0",
  "#8b7bd8",
  "#8b93a7",
  "#6b7280",
];

export function normalizeHex(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(value) ? value : null;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Stable fallback color for a classifier without an explicitly assigned color. */
export function classifierColor(name: string, assignedColor?: string | null): string {
  const assigned = assignedColor ? normalizeHex(assignedColor) : null;
  if (assigned) return assigned;
  const normalized = name.trim().toUpperCase();
  return CLASSIFIER_PALETTE[hashString(normalized) % CLASSIFIER_PALETTE.length];
}

function expandedHex(hex: string): string {
  const normalized = normalizeHex(hex) ?? "#7b9bff";
  const bare = normalized.slice(1);
  return bare.length === 3
    ? bare
        .split("")
        .map((char) => char + char)
        .join("")
    : bare;
}

/** Darkens a chip label enough to stay legible on light surfaces. */
export function chipTextColor(hex: string, lightTheme: boolean): string {
  if (!lightTheme) return hex;
  const bare = expandedHex(hex);
  const channels = [0, 2, 4].map((start) => Math.round(parseInt(bare.slice(start, start + 2), 16) * 0.68));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** A translucent chip background that works for either three- or six-digit hex. */
export function chipBackgroundColor(hex: string, lightTheme: boolean): string {
  const bare = expandedHex(hex);
  const [r, g, b] = [0, 2, 4].map((start) => parseInt(bare.slice(start, start + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${lightTheme ? 0.09 : 0.13})`;
}

/** White or near-black text that keeps readable contrast over `hex`. */
export function contrastTextColor(hex: string): string {
  const stripped = hex.replace("#", "");
  const full =
    stripped.length === 3
      ? stripped
          .split("")
          .map((char) => char + char)
          .join("")
      : stripped;

  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? "#0b0b10" : "#ffffff";
}
