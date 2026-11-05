import type { Project, Task } from "../types";

export interface TaskNode {
  task: Task;
  children: TaskNode[];
}

/** Builds a forest of tasks where subtasks nest under their parent. */
export function buildTree(tasks: Task[]): TaskNode[] {
  const map = new Map<string, TaskNode>();
  for (const t of tasks) map.set(t.id, { task: t, children: [] });

  const roots: TaskNode[] = [];
  for (const t of tasks) {
    const node = map.get(t.id)!;
    if (t.parentTaskId && map.has(t.parentTaskId)) {
      map.get(t.parentTaskId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: TaskNode[]) => {
    nodes.sort(
      (a, b) =>
        a.task.sortOrder - b.task.sortOrder ||
        a.task.createdAt.localeCompare(b.task.createdAt),
    );
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

export interface ProjectGroup {
  project: Project;
  roots: TaskNode[];
}

/** Groups the panel's tasks under their projects (projects sorted by order). */
export function groupTasksByProject(
  tasks: Task[],
  projects: Project[],
  options?: { onlyNonEmpty?: boolean },
): ProjectGroup[] {
  const sorted = [...projects].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
  );

  return sorted
    .map((project) => ({
      project,
      roots: buildTree(tasks.filter((t) => t.projectId === project.id)),
    }))
    .filter((g) => (options?.onlyNonEmpty ? g.roots.length > 0 : true));
}

/** Groups tasks by their creation month ("YYYY-MM"), newest first. */
export function groupTasksByMonth(tasks: Task[]) {
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const month = (t.createdAt || "").slice(0, 7);
    if (!month) continue;
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month)!.push(t);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, items]) => ({
      month,
      items: items.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }));
}
