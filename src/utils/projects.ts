import type { Project } from "../types";

export function normalizeProjectLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Only a leading #/## is a project command; hashtags in task content are untouched. */
export function projectQuery(value: string): string | null {
  const match = /^#{1,2}(?!#)\s*([^\r\n]*)$/.exec(value.trimStart());
  return match ? match[1].trim() : null;
}

export function matchingProjects(projects: Project[], query: string): Project[] {
  const normalized = normalizeProjectLabel(query);
  const rank = (label: string) => {
    const name = normalizeProjectLabel(label);
    if (name === normalized) return 0;
    if (name.startsWith(normalized)) return 1;
    return 2;
  };
  return projects
    .filter((project) => normalizeProjectLabel(project.label).includes(normalized))
    .sort((a, b) => rank(a.label) - rank(b.label) || a.sortOrder - b.sortOrder);
}
