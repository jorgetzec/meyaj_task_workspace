export interface Panel {
  id: string;
  title: string;
  sortOrder: number;
  createdAt: string;
  archived: boolean;
}

export interface Classifier {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  label: string;
  colorAccent: string | null;
  icon?: string | null;
  sortOrder: number;
  panelId: string;
}

export interface Task {
  id: string;
  content: string;
  completed: boolean;
  createdAt: string;
  completedAt: string | null;
  projectId: string | null;
  classifier: string | null;
  sortOrder: number;
  parentTaskId: string | null;
  hashtags: string[];
}

export interface HistoryEntry {
  id: string;
  panelId: string;
  taskId: string | null;
  classifier: string | null;
  projectLabel: string | null;
  snapshotContent: string;
  createdAt: string;
  completedAt: string;
}

export interface PanelState {
  activePanelId: string;
  createdTaskId?: string | null;
  panels: Panel[];
  projects: Project[];
  classifiers: Classifier[];
  tasks: Task[];
}

export interface CreateTaskInput {
  panelId: string;
  projectId: string | null;
  classifier: string | null;
  content: string;
  parentTaskId: string | null;
}

export type ViewKind = "all" | "project" | "month" | "history";

export interface Tab {
  view: ViewKind;
  label: string | null;
}

export type Theme = "dark" | "light" | "dracula" | "nord" | "custom";

export type Lang = "es" | "en";
