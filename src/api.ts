import { invoke } from "@tauri-apps/api/core";
import type {
  Classifier,
  CreateTaskInput,
  HistoryEntry,
  Panel,
  PanelState,
} from "./types";

export const api = {
  bootstrap: () => invoke<PanelState>("bootstrap"),

  loadState: (panelId: string) => invoke<PanelState>("load_state", { panelId }),

  listHistory: (panelId: string) =>
    invoke<HistoryEntry[]>("list_history", { panelId }),

  restoreTask: (historyId: string) =>
    invoke<PanelState>("restore_task", { historyId }),

  exportMarkdown: (panelId: string) =>
    invoke<string>("export_markdown", { panelId }),

  createPanel: (title: string) => invoke<PanelState>("create_panel", { title }),

    renamePanel: (panelId: string, title: string) =>
      invoke<Panel[]>("rename_panel", { panelId, title }),

    deletePanel: (panelId: string) =>
      invoke<PanelState>("delete_panel", { panelId }),

    moveProject: (projectId: string, targetPanelId: string) =>
      invoke<PanelState>("move_project", { projectId, targetPanelId }),

    setProjectIcon: (projectId: string, icon: string | null) =>
      invoke<PanelState>("set_project_icon", { projectId, icon }),

  setPanelArchived: (panelId: string, archived: boolean) =>
    invoke<PanelState>("set_panel_archived", { panelId, archived }),

  createProject: (
    panelId: string,
    label: string,
    colorAccent: string | null,
  ) =>
    invoke<PanelState>("create_project", {
      panelId,
      label,
      colorAccent,
    }),

  listClassifiers: () => invoke<Classifier[]>("list_classifiers"),

  createClassifier: (name: string) =>
    invoke<Classifier[]>("create_classifier", { name }),

  deleteClassifier: (name: string) =>
    invoke<Classifier[]>("delete_classifier", { name }),

  createTask: (input: CreateTaskInput) =>
    invoke<PanelState>("create_task", { input }),

  updateTask: (taskId: string, content: string) =>
    invoke<PanelState>("update_task", { taskId, content }),

  deleteTask: (taskId: string) =>
    invoke<PanelState>("delete_task", { taskId }),

  completeTask: (taskId: string) =>
    invoke<PanelState>("complete_task", { taskId }),

  setTaskParent: (taskId: string, parentTaskId: string | null) =>
    invoke<PanelState>("set_task_parent", { taskId, parentTaskId }),

  moveTask: (taskId: string, projectId: string) =>
    invoke<PanelState>("move_task", { taskId, projectId }),

  reorderProjectTasks: (projectId: string, orderedIds: string[]) =>
    invoke<PanelState>("reorder_project_tasks", { projectId, orderedIds }),

  reorderProjects: (panelId: string, orderedIds: string[]) =>
    invoke<PanelState>("reorder_projects", { panelId, orderedIds }),

  importMarkdown: (panelId: string, markdown: string) =>
    invoke<PanelState>("import_markdown", { panelId, markdown }),

  hashtagsFrom: (content: string) =>
    invoke<string[]>("hashtags_from", { content }),
};
