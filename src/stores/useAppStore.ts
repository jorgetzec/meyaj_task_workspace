import { create } from "zustand";
import { api } from "../api";
import { parseTheme, THEME_VAR_KEYS } from "../utils/themes";
import { normalizeProjectLabel } from "../utils/projects";
import type {
  Classifier,
  CreateTaskInput,
  FilePickerRequest,
  HistoryEntry,
  Lang,
  Panel,
  PanelState,
  Project,
  Tab,
  Task,
  Theme,
  ViewKind,
} from "../types";

interface AppStore {
  panels: Panel[];
  projects: Project[];
  classifiers: Classifier[];
  tasks: Task[];
  lastCreatedTaskId: string | null;
  history: HistoryEntry[];
  activePanelId: string | null;
  currentView: ViewKind;
  tabs: Tab[];
  projectFilter: string | null;
  loading: boolean;
  error: string | null;
  theme: Theme;
  language: Lang;
  fontScale: number;
  monoFont: string;
  sansFont: string;
  customTheme: { name: string; vars: Record<string, string> } | null;
  settingsOpen: boolean;
  projectFormOpen: boolean;
  searchOpen: boolean;
  filePicker: FilePickerRequest | null;

  init: () => Promise<void>;
  setError: (error: string | null) => void;
  setSettingsOpen: (open: boolean) => void;
  setProjectFormOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setFilePicker: (request: FilePickerRequest | null) => void;
  setActivePanel: (panelId: string) => Promise<void>;
  setView: (view: ViewKind) => void;
  closeTab: (view: ViewKind) => void;
  renameTab: (view: ViewKind, label: string | null) => void;
  addTab: (view: ViewKind) => void;
    reorderTabs: (views: ViewKind[]) => void;
    clearTaskHighlight: () => void;
  setProjectFilter: (id: string | null) => void;
  setTheme: (theme: Theme) => void;
  setLanguage: (lang: Lang) => void;
  setFontScale: (scale: number) => void;
  setMonoFont: (font: string) => void;
  setSansFont: (font: string) => void;
  importTheme: (name: string, vars: Record<string, string>) => void;
  clearCustomTheme: () => void;

  createPanel: (title: string) => Promise<boolean>;
  renamePanel: (panelId: string, title: string) => Promise<boolean>;
  deletePanel: (panelId: string) => Promise<boolean>;
    moveProject: (projectId: string, targetPanelId: string) => Promise<boolean>;
    renameProject: (projectId: string, label: string) => Promise<boolean>;
    setProjectColor: (projectId: string, colorAccent: string | null) => Promise<boolean>;
    deleteProject: (projectId: string) => Promise<boolean>;
    setProjectIcon: (projectId: string, icon: string | null) => Promise<boolean>;
  createProject: (label: string, colorAccent?: string | null) => Promise<Project | null>;
  createTask: (input: Omit<CreateTaskInput, "panelId">) => Promise<boolean>;
  updateTask: (taskId: string, content: string) => Promise<void>;
  setTaskClassifier: (taskId: string, classifier: string | null) => Promise<boolean>;
  deleteTask: (taskId: string) => Promise<boolean>;
  completeTask: (taskId: string) => Promise<boolean>;
  setTaskParent: (taskId: string, parentTaskId: string | null) => Promise<void>;
  moveTask: (taskId: string, projectId: string) => Promise<void>;
  reorderProjectTasks: (projectId: string, orderedIds: string[]) => Promise<void>;
  reorderProjects: (orderedIds: string[]) => Promise<void>;
  importMarkdown: (markdown: string) => Promise<void>;
  archivePanel: (panelId: string, archived: boolean) => Promise<void>;
  restoreTask: (historyId: string) => Promise<void>;
  createClassifier: (name: string) => Promise<boolean>;
  deleteClassifier: (name: string) => Promise<void>;
}

const THEMES: Theme[] = ["dark", "light", "dracula", "nord"];
const VIEWS: ViewKind[] = ["all", "project", "month", "history"];
const defaultTabs = (): Tab[] => VIEWS.map((view) => ({ view, label: null }));

function restoreTabs(): { tabs: Tab[]; currentView: ViewKind } {
  try {
    const saved = JSON.parse(localStorage.getItem("meyaj-tabs") ?? "null");
    if (Array.isArray(saved?.tabs)) {
      const tabs: Tab[] = [];
      for (const tab of saved.tabs) {
        if (!tab || !VIEWS.includes(tab.view) || tabs.some((item) => item.view === tab.view)) continue;
        tabs.push({ view: tab.view, label: typeof tab.label === "string" ? tab.label.trim() || null : null });
      }
      if (tabs.length > 0) {
        return { tabs, currentView: tabs.some((tab) => tab.view === saved.currentView) ? saved.currentView : tabs[0].view };
      }
    }
  } catch {
    // A malformed preference must not prevent the app from opening.
  }
  return { tabs: defaultTabs(), currentView: "all" };
}

function saveTabs(tabs: Tab[], currentView: ViewKind) {
  localStorage.setItem("meyaj-tabs", JSON.stringify({ tabs, currentView }));
}

const FONT_MIN = 0.8;
const FONT_MAX = 1.6;

function clampFont(s: number): number {
  return Math.round(Math.min(FONT_MAX, Math.max(FONT_MIN, s)) * 10) / 10;
}

function applyFontScale(scale: number) {
  document.documentElement.style.setProperty("--font-scale", String(scale));
}

function applyMonoFont(font: string) {
  if (font) document.documentElement.style.setProperty("--mono", font);
  else document.documentElement.style.removeProperty("--mono");
}

function applySansFont(font: string) {
  if (font) document.documentElement.style.setProperty("--sans", font);
  else document.documentElement.style.removeProperty("--sans");
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("meyaj-theme", theme);
}


function applyCustomVars(vars: Record<string, string>) {
  for (const [key, cssVar] of THEME_VAR_KEYS) {
    if (vars[key]) document.documentElement.style.setProperty(cssVar, vars[key]);
  }
}

function clearCustomVars() {
  for (const [, cssVar] of THEME_VAR_KEYS) {
    document.documentElement.style.removeProperty(cssVar);
  }
}

export const useAppStore = create<AppStore>((set, get) => {
  let panelRequest = 0;
    let navigationRevision = 0;
    let requestedPanelId: string | null = null;
  const applyState = (state: PanelState) => {
    set({
      panels: state.panels,
      projects: state.projects,
      classifiers: state.classifiers,
      tasks: state.tasks,
      activePanelId: state.activePanelId,
      projectFilter: state.projects.some((project) => project.id === get().projectFilter)
        ? get().projectFilter : state.projects[0]?.id ?? null,
      error: null,
    });
  };

  const refreshHistory = async (panelId: string) => {
    try {
      const history = await api.listHistory(panelId);
      if (get().activePanelId === panelId) set({ history });
    } catch (e) {
      set({ error: String(e) });
    }
  };

  return {
    panels: [],
    projects: [],
    classifiers: [],
    tasks: [],
    lastCreatedTaskId: null,
    history: [],
    activePanelId: null,
    currentView: "all",
    tabs: defaultTabs(),
    projectFilter: null,
    loading: false,
    error: null,
    theme: "dark",
    language: "es",
    fontScale: 1,
    monoFont: "",
    sansFont: "",
    customTheme: null,
    settingsOpen: false,
    projectFormOpen: false,
    searchOpen: false,
    filePicker: null,

    init: async () => {
      set({ loading: true, error: null });
      const savedTheme = localStorage.getItem("meyaj-theme") as Theme | null;
      const savedLang = (localStorage.getItem("meyaj-lang") as Lang | null) ?? "es";
      const savedScale = Number(localStorage.getItem("meyaj-font-scale"));
      const fontScale = Number.isFinite(savedScale) ? clampFont(savedScale) : 1;
      applyFontScale(fontScale);
      const monoFont = localStorage.getItem("meyaj-mono-font") ?? "";
      const sansFont = localStorage.getItem("meyaj-sans-font") ?? "";
      applyMonoFont(monoFont);
      applySansFont(sansFont);

      // Restore a saved custom theme.
      let customTheme: { name: string; vars: Record<string, string> } | null = null;
      const rawCustom = localStorage.getItem("meyaj-custom-theme");
      if (rawCustom) {
        try {
          customTheme = parseTheme(JSON.parse(rawCustom));
        } catch {
          /* ignore malformed theme */
        }
      }
      const theme = customTheme && (!savedTheme || savedTheme === "custom")
        ? "custom"
        : savedTheme && THEMES.includes(savedTheme) ? savedTheme : "dark";
      clearCustomVars();
      applyTheme(theme);
      if (theme === "custom" && customTheme) applyCustomVars(customTheme.vars);
      set({ theme, language: savedLang, fontScale, monoFont, sansFont, customTheme, ...restoreTabs() });

      try {
        const state = await api.bootstrap();
        applyState(state);
        await refreshHistory(state.activePanelId);
      } catch (e) {
        set({ error: String(e) });
      } finally {
        set({ loading: false });
      }
    },

    setActivePanel: async (panelId) => {
      const request = ++panelRequest;
      ++navigationRevision;
      requestedPanelId = panelId;
      set({ loading: true, error: null });
      try {
        const state = await api.loadState(panelId);
        if (request !== panelRequest) return;
        applyState(state);
        await refreshHistory(panelId);
      } catch (e) {
        if (request === panelRequest) set({ error: String(e) });
      } finally {
        if (request === panelRequest) {
                  requestedPanelId = null;
                  set({ loading: false });
                }
      }
    },

    setView: (view) => {
      ++navigationRevision;
      const tabs = get().tabs.some((tab) => tab.view === view)
        ? get().tabs : [...get().tabs, { view, label: null }];
      saveTabs(tabs, view);
      set({ tabs, currentView: view });
    },
    closeTab: (view) => {
      if (get().tabs.length <= 1) return;
      const index = get().tabs.findIndex((tab) => tab.view === view);
      const tabs = get().tabs.filter((tab) => tab.view !== view);
      const currentView = get().currentView === view
        ? tabs[Math.max(0, index - 1)].view : get().currentView;
      if (currentView !== get().currentView) ++navigationRevision;
      saveTabs(tabs, currentView);
      set({ tabs, currentView });
    },
    renameTab: (view, label) => {
      const tabs = get().tabs.map((tab) => tab.view === view ? { ...tab, label: label?.trim() || null } : tab);
      saveTabs(tabs, get().currentView);
      set({ tabs });
    },
    addTab: (view) => get().setView(view),
        reorderTabs: (views) => {
          const current = get().tabs;
          if (views.length !== current.length || new Set(views).size !== current.length ||
            views.some((view) => !current.some((tab) => tab.view === view))) return;
          const tabs = views.map((view) => current.find((tab) => tab.view === view)!);
          saveTabs(tabs, get().currentView);
          set({ tabs });
        },
        clearTaskHighlight: () => set({ lastCreatedTaskId: null }),
    setProjectFilter: (id) => {
      get().setView("project");
      set({ projectFilter: id });
    },
    setError: (error) => set({ error }),
    setSettingsOpen: (open) => set({ settingsOpen: open }),
    setFilePicker: (request) => set({ filePicker: request }),
    setProjectFormOpen: (open) => set({ projectFormOpen: open }),
    setSearchOpen: (open) => set({ searchOpen: open }),
    setTheme: (theme) => {
      if (theme === "custom") {
        const custom = get().customTheme;
        if (custom) get().importTheme(custom.name, custom.vars);
        return;
      }
      clearCustomVars();
      applyTheme(theme);
      set({ theme });
    },
    setLanguage: (language) => {
      localStorage.setItem("meyaj-lang", language);
      set({ language });
    },
    setFontScale: (scale) => {
      const s = clampFont(scale);
      applyFontScale(s);
      localStorage.setItem("meyaj-font-scale", String(s));
      set({ fontScale: s });
    },
    setMonoFont: (font) => {
      applyMonoFont(font);
      localStorage.setItem("meyaj-mono-font", font);
      set({ monoFont: font });
    },
    setSansFont: (font) => {
      applySansFont(font);
      localStorage.setItem("meyaj-sans-font", font);
      set({ sansFont: font });
    },
    importTheme: (name, vars) => {
      const customTheme = parseTheme({ name, vars });
      clearCustomVars();
      applyTheme("custom");
      applyCustomVars(customTheme.vars);
      localStorage.setItem("meyaj-custom-theme", JSON.stringify(customTheme));
      set({ theme: "custom", customTheme, error: null });
    },
    clearCustomTheme: () => {
      clearCustomVars();
      localStorage.removeItem("meyaj-custom-theme");
      applyTheme("dark");
      set({ theme: "dark", customTheme: null });
    },

    createPanel: async (title) => {
      try {
        const state = await api.createPanel(title);
        ++panelRequest;
        ++navigationRevision;
        requestedPanelId = null;
        applyState(state);
        set({ loading: false });
        await refreshHistory(state.activePanelId);
        return true;
      } catch (e) {
        set({ error: String(e) });
        return false;
      }
    },

    renamePanel: async (panelId, title) => {
      const name = title.trim();
      if (!name) return false;
      try {
        const panels = await api.renamePanel(panelId, name);
        set({ panels, error: null });
        return true;
      } catch (e) {
        set({ error: String(e) });
        return false;
      }
    },

    deletePanel: async (panelId) => {
      if (get().panels.length <= 1) return false;
      const wasActive = get().activePanelId === panelId;
      try {
        const state = await api.deletePanel(panelId);
        if (wasActive) {
          ++panelRequest;
          ++navigationRevision;
          requestedPanelId = null;
          applyState(state);
          set({ loading: false, lastCreatedTaskId: null });
          await refreshHistory(state.activePanelId);
        } else {
          set({ panels: state.panels, error: null });
        }
        return true;
      } catch (e) {
        set({ error: String(e) });
        return false;
      }
    },

    moveProject: async (projectId, targetPanelId) => {
      const sourcePanelId = get().projects.find((project) => project.id === projectId)?.panelId;
      try {
        const state = await api.moveProject(projectId, targetPanelId);
        if (get().activePanelId === sourcePanelId) applyState(state);
        if (requestedPanelId === targetPanelId || (!requestedPanelId && get().activePanelId === targetPanelId)) {
          await get().setActivePanel(targetPanelId);
        }
        return true;
      } catch (e) {
        set({ error: String(e) });
        return false;
      }
    },

    renameProject: async (projectId, label) => {
      try {
        const state = await api.renameProject(projectId, label);
        applyState(state);
        return true;
      } catch (e) {
        set({ error: String(e) });
        return false;
      }
    },

    setProjectColor: async (projectId, colorAccent) => {
      try {
        const state = await api.setProjectColor(projectId, colorAccent);
        applyState(state);
        return true;
      } catch (e) {
        set({ error: String(e) });
        return false;
      }
    },

    deleteProject: async (projectId) => {
      try {
        const state = await api.deleteProject(projectId);
        applyState(state);
        return true;
      } catch (e) {
        set({ error: String(e) });
        return false;
      }
    },

    setProjectIcon: async (projectId, icon) => {
      const panelId = get().activePanelId;
      try {
        const state = await api.setProjectIcon(projectId, icon);
        if (get().activePanelId === panelId) {
          const updated = state.projects.find((project) => project.id === projectId);
          if (updated) set({
            projects: get().projects.map((project) => project.id === projectId ? { ...project, icon: updated.icon } : project),
            error: null,
          });
        }
        return true;
      } catch (e) {
        set({ error: String(e) });
        return false;
      }
    },

    createProject: async (label, colorAccent = null) => {
      const panelId = get().activePanelId;
      if (!panelId) return null;
      const existing = get().projects.find((project) => project.panelId === panelId &&
        normalizeProjectLabel(project.label) === normalizeProjectLabel(label));
      if (existing) return existing;
      const existingIds = new Set(get().projects.map((project) => project.id));
      try {
        const state = await api.createProject(panelId, label, colorAccent);
        if (get().activePanelId === panelId) applyState(state);
        return state.projects.find((project) => !existingIds.has(project.id) && project.label === label) ?? null;
      } catch (e) {
        set({ error: String(e) });
        return null;
      }
    },

    createTask: async (input) => {
      const panelId = get().activePanelId;
      if (!panelId) return false;
      const parent = input.parentTaskId ? get().tasks.find((task) => task.id === input.parentTaskId) : null;
      if (input.parentTaskId && !parent) {
        set({ error: "No se encontró la tarea padre. Actualiza el panel antes de reintentar." });
        return false;
      }
      const projectId = parent ? parent.projectId : input.projectId;
      const existingIds = new Set(get().tasks.map((task) => task.id));
      const navigationAtSubmit = navigationRevision;
      try {
        const state = await api.createTask({ ...input, projectId, panelId });
        if (get().activePanelId === panelId) {
          applyState(state);
          const created = state.createdTaskId
            ? state.tasks.find((task) => task.id === state.createdTaskId)
            : state.tasks.find((task) => !existingIds.has(task.id) && task.projectId === projectId &&
              task.content === input.content && task.parentTaskId === input.parentTaskId);
          if (created && navigationRevision === navigationAtSubmit) {
            if (get().currentView === "history") get().setView("all");
            if (get().currentView === "project") set({ projectFilter: created.projectId });
            set({ lastCreatedTaskId: created.id });
          }
        }
        return true;
      } catch (e) {
        set({ error: String(e) });
        return false;
      }
    },

    updateTask: async (taskId, content) => {
      try {
        const state = await api.updateTask(taskId, content);
        applyState(state);
      } catch (e) {
        set({ error: String(e) });
      }
    },

    setTaskClassifier: async (taskId, classifier) => {
      try {
        const state = await api.setTaskClassifier(taskId, classifier);
        applyState(state);
        return true;
      } catch (e) {
        set({ error: String(e) });
        return false;
      }
    },

    deleteTask: async (taskId) => {
      try {
        const state = await api.deleteTask(taskId);
        applyState(state);
        return true;
      } catch (e) {
        set({ error: String(e) });
        return false;
      }
    },

    completeTask: async (taskId) => {
      if (get().tasks.some((task) => task.parentTaskId === taskId)) return false;
      const panelId = get().activePanelId;
      try {
        const state = await api.completeTask(taskId);
        if (get().activePanelId === panelId) {
          applyState(state);
          await refreshHistory(state.activePanelId);
        }
        return true;
      } catch (e) {
        set({ error: String(e) });
        return false;
      }
    },

    setTaskParent: async (taskId, parentTaskId) => {
      try {
        const state = await api.setTaskParent(taskId, parentTaskId);
        applyState(state);
      } catch (e) {
        set({ error: String(e) });
      }
    },

    moveTask: async (taskId, projectId) => {
      try {
        const state = await api.moveTask(taskId, projectId);
        applyState(state);
      } catch (e) {
        set({ error: String(e) });
      }
    },

    reorderProjectTasks: async (projectId, orderedIds) => {
      try {
        const state = await api.reorderProjectTasks(projectId, orderedIds);
        applyState(state);
      } catch (e) {
        set({ error: String(e) });
      }
    },

    reorderProjects: async (orderedIds) => {
      const panelId = get().activePanelId;
      if (!panelId) return;
      try {
        const state = await api.reorderProjects(panelId, orderedIds);
        applyState(state);
      } catch (e) {
        set({ error: String(e) });
      }
    },

    importMarkdown: async (markdown) => {
      const panelId = get().activePanelId;
      if (!panelId) return;
      try {
        const state = await api.importMarkdown(panelId, markdown);
        applyState(state);
        await refreshHistory(panelId);
      } catch (e) {
        set({ error: String(e) });
      }
    },

    archivePanel: async (panelId, archived) => {
      try {
        const state = await api.setPanelArchived(panelId, archived);
        applyState(state);
        await refreshHistory(state.activePanelId);
      } catch (e) {
        set({ error: String(e) });
      }
    },

    restoreTask: async (historyId) => {
      try {
        const state = await api.restoreTask(historyId);
        applyState(state);
        await refreshHistory(state.activePanelId);
      } catch (e) {
        set({ error: String(e) });
      }
    },

    createClassifier: async (name) => {
      try {
        const classifiers = await api.createClassifier(name);
        set({ classifiers, error: null });
        return true;
      } catch (e) {
        set({ error: String(e) });
        return false;
      }
    },

    deleteClassifier: async (name) => {
      try {
        const classifiers = await api.deleteClassifier(name);
        set({ classifiers });
      } catch (e) {
        set({ error: String(e) });
      }
    },
  };
});
