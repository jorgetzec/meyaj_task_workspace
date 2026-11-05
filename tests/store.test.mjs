import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as themes from "../src/utils/themes.ts";
import * as projects from "../src/utils/projects.ts";

const projectRequire = createRequire(new URL("../package.json", import.meta.url));
const ts = projectRequire("typescript");
const compiled = ts.transpileModule(
  readFileSync(new URL("../src/stores/useAppStore.ts", import.meta.url), "utf8"),
  {
    fileName: "useAppStore.ts",
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  },
);
assert.deepEqual(compiled.diagnostics, [], "The store must transpile without syntax errors");
const executeStore = new Function("require", "exports", compiled.outputText);

const defaultTabs = ["all", "project", "month", "history"].map((view) => ({ view, label: null }));
const taskInput = { content: "Nueva tarea", projectId: null, classifier: null, parentTaskId: null };

function makeProject(id, label, panelId = "a") {
  return { id, label, panelId, colorAccent: null, sortOrder: 0 };
}

function makeTask(id, overrides = {}) {
  return {
    ...taskInput, id, panelId: "a", projectId: "a-project", completed: false,
    createdAt: "2026-11-04", completedAt: null, sortOrder: 0, hashtags: [],
    ...overrides,
  };
}

function panelState(panelId = "a", overrides = {}) {
  return {
    activePanelId: panelId,
    panels: ["a", "b", "c"].map((id, sortOrder) => ({
      id, title: id.toUpperCase(), sortOrder, createdAt: "2026-11-04", archived: false,
    })),
    projects: [makeProject(`${panelId}-project`, `Proyecto ${panelId}`, panelId)],
    tasks: [],
    classifiers: [],
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function harness(t, { saved = {}, api: overrides = {} } = {}) {
  const storage = new Map(Object.entries(saved));
  const styles = new Map();
  const attributes = new Map();
  const globals = {
    document: {
      documentElement: {
        style: {
          setProperty: (key, value) => { styles.set(key, String(value)); },
          getPropertyValue: (key) => styles.get(key) ?? "",
          removeProperty: (key) => {
            const previous = styles.get(key) ?? "";
            styles.delete(key);
            return previous;
          },
        },
        setAttribute: (key, value) => { attributes.set(key, String(value)); },
      },
    },
    localStorage: {
      getItem: (key) => storage.get(String(key)) ?? null,
      setItem: (key, value) => { storage.set(String(key), String(value)); },
      removeItem: (key) => { storage.delete(String(key)); },
    },
  };

  // Each sequential scenario owns its globals, including across simulated restarts.
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    });
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }

  const unexpected = async () => { throw new Error("Unexpected API call"); };
  const implementations = {
    bootstrap: async () => panelState(),
    listHistory: async () => [],
    loadState: async (panelId) => panelState(panelId),
    createProject: unexpected,
    createTask: unexpected,
    createClassifier: unexpected,
    createPanel: unexpected,
    renamePanel: unexpected,
    deletePanel: unexpected,
    moveProject: unexpected,
    setProjectIcon: unexpected,
    completeTask: unexpected,
    ...overrides,
  };
  const api = Object.fromEntries(
    Object.entries(implementations).map(([key, implementation]) => [key, t.mock.fn(implementation)]),
  );
  const loadStore = () => {
    const exports = {};
    executeStore((specifier) => {
      if (specifier === "../api") return { api };
      if (specifier === "../utils/themes") return themes;
      if (specifier === "../utils/projects") return projects;
      return projectRequire(specifier);
    }, exports);
    return exports.useAppStore;
  };

  return { store: loadStore(), restart: loadStore, api, storage, styles, attributes };
}

describe("store", { concurrency: false }, () => {
  describe("tabs and restored preferences", () => {
    it("renames tabs, trims labels, resets empty labels, and persists changes", (t) => {
      const { store, storage } = harness(t);
      store.getState().renameTab("project", "  Mi proyecto  ");
      assert.deepEqual(store.getState().tabs[1], { view: "project", label: "Mi proyecto" });
      assert.deepEqual(JSON.parse(storage.get("meyaj-tabs")), {
        tabs: store.getState().tabs, currentView: "all",
      });
      store.getState().renameTab("project", "   ");
      assert.equal(store.getState().tabs[1].label, null);
      store.getState().renameTab("all", "Todos");
      store.getState().renameTab("all", null);
      assert.deepEqual(store.getState().tabs, defaultTabs);
      assert.deepEqual(JSON.parse(storage.get("meyaj-tabs")).tabs, defaultTabs);
    });

    it("closes active and inactive tabs but protects the last remaining tab", (t) => {
      const { store, storage } = harness(t);
      store.getState().setView("month");
      store.getState().closeTab("month");
      assert.equal(store.getState().currentView, "project");
      store.getState().closeTab("history");
      assert.equal(store.getState().currentView, "project");
      store.getState().closeTab("all");
      const previous = store.getState();
      const persisted = storage.get("meyaj-tabs");
      store.getState().closeTab("project");
      assert.strictEqual(store.getState(), previous);
      assert.deepEqual(store.getState().tabs, [{ view: "project", label: null }]);
      assert.equal(storage.get("meyaj-tabs"), persisted);
    });

    it("selects the first remaining tab when closing the first active tab", (t) => {
      const { store } = harness(t);
      store.getState().closeTab("all");
      assert.equal(store.getState().currentView, "project");
      assert.deepEqual(store.getState().tabs, defaultTabs.slice(1));
    });

    it("reopens closed tabs through setView/addTab without duplicates", (t) => {
      const { store, storage } = harness(t);
      store.getState().renameTab("history", "Archivo");
      store.getState().closeTab("history");
      store.getState().setView("history");
      assert.deepEqual(store.getState().tabs.at(-1), { view: "history", label: null });
      store.getState().addTab("history");
      assert.equal(store.getState().tabs.length, 4);
      store.getState().closeTab("month");
      store.getState().addTab("month");
      assert.equal(store.getState().currentView, "month");
      assert.deepEqual(JSON.parse(storage.get("meyaj-tabs")), {
        tabs: store.getState().tabs, currentView: "month",
      });
    });

    it("setProjectFilter reopens and selects the project tab, including for null", (t) => {
      const { store, storage } = harness(t);
      store.getState().closeTab("project");
      store.getState().setProjectFilter("a-project");
      assert.equal(store.getState().projectFilter, "a-project");
      assert.equal(store.getState().currentView, "project");
      assert.deepEqual(store.getState().tabs.at(-1), { view: "project", label: null });
      store.getState().closeTab("project");
      store.getState().setProjectFilter(null);
      assert.equal(store.getState().projectFilter, null);
      assert.equal(store.getState().tabs.filter((tab) => tab.view === "project").length, 1);
      assert.equal(JSON.parse(storage.get("meyaj-tabs")).currentView, "project");
    });

    it("init tolerates corrupt JSON for both tabs and the saved custom theme", async (t) => {
      const { store, attributes } = harness(t, { saved: {
        "meyaj-tabs": "{broken", "meyaj-custom-theme": "{broken", "meyaj-theme": "custom",
      } });
      await store.getState().init();
      assert.deepEqual(store.getState().tabs, defaultTabs);
      assert.equal(store.getState().currentView, "all");
      assert.equal(store.getState().customTheme, null);
      assert.equal(store.getState().theme, "dark");
      assert.equal(attributes.get("data-theme"), "dark");
      assert.equal(store.getState().activePanelId, "a");
      assert.equal(store.getState().loading, false);
      assert.equal(store.getState().error, null);
    });

    it("init restores valid tabs, sanitizes labels, and removes invalid or duplicate views", async (t) => {
      const { store } = harness(t, { saved: { "meyaj-tabs": JSON.stringify({
        tabs: [null, { view: "unknown" }, { view: "history", label: "  Archivo  " },
          { view: "history", label: "Duplicado" }, { view: "project", label: 42 },
          { view: "all", label: "  " }],
        currentView: "project",
      }) } });
      await store.getState().init();
      assert.deepEqual(store.getState().tabs, [
        { view: "history", label: "Archivo" }, { view: "project", label: null },
        { view: "all", label: null },
      ]);
      assert.equal(store.getState().currentView, "project");
    });

    it("init falls back to the first restored tab when the saved active view is absent", async (t) => {
      const { store } = harness(t, { saved: { "meyaj-tabs": JSON.stringify({
        tabs: [{ view: "month", label: null }], currentView: "all",
      }) } });
      await store.getState().init();
      assert.equal(store.getState().currentView, "month");
      assert.deepEqual(store.getState().tabs, [{ view: "month", label: null }]);
    });

    it("init falls back to default tabs when valid JSON contains no usable tabs", async (t) => {
      const { store } = harness(t, { saved: { "meyaj-tabs": JSON.stringify({
        tabs: [{ view: "unknown" }, null], currentView: "unknown",
      }) } });
      await store.getState().init();
      assert.deepEqual(store.getState().tabs, defaultTabs);
      assert.equal(store.getState().currentView, "all");
    });
  });

  describe("custom themes", () => {
    it("imports a partial theme after light, using the custom base attribute and only supplied tokens", (t) => {
      const { store, styles, attributes, storage } = harness(t);
      store.getState().setTheme("light");
      assert.equal(attributes.get("data-theme"), "light");
      store.getState().importTheme(" Parcial ", { bg: " #123 ", unknown: "url(evil)" });
      assert.equal(store.getState().theme, "custom");
      assert.equal(attributes.get("data-theme"), "custom");
      assert.equal(storage.get("meyaj-theme"), "custom");
      assert.deepEqual([...styles], [["--bg", "#123"]]);
      assert.deepEqual(store.getState().customTheme, { name: "Parcial", vars: { bg: "#123" } });
      assert.deepEqual(JSON.parse(storage.get("meyaj-custom-theme")), store.getState().customTheme);
      store.getState().importTheme("Otro parcial", { accent: "#abc" });
      assert.deepEqual([...styles], [["--accent", "#abc"]]);
    });

    it("invalid imports preserve the previous state, DOM, and persisted theme", (t) => {
      const { store, styles, attributes, storage } = harness(t);
      store.getState().importTheme("Seguro", { bg: "#abc", text: "#def" });
      const previous = store.getState();
      const saved = new Map(storage);
      const inline = new Map(styles);
      const attrs = new Map(attributes);
      assert.throws(() => store.getState().importTheme("Malo", { bg: "#123", text: "var(--text)" }), {
        message: "THEME_INVALID_COLOR:text",
      });
      assert.throws(() => store.getState().importTheme("Vacío", { unknown: "#123" }), {
        message: "THEME_NO_COLORS",
      });
      assert.strictEqual(store.getState(), previous);
      assert.deepEqual(styles, inline);
      assert.deepEqual(attributes, attrs);
      assert.deepEqual(storage, saved);
    });

    it("built-in themes keep the custom definition for reactivation and restart", async (t) => {
      const { store, restart, styles, storage, attributes } = harness(t);
      const custom = { name: "Guardado", vars: { bg: "#abc", accent: "#123" } };
      store.getState().importTheme(custom.name, custom.vars);
      store.getState().setTheme("light");
      assert.deepEqual(store.getState().customTheme, custom);
      assert.equal(styles.size, 0);
      assert.equal(attributes.get("data-theme"), "light");
      assert.equal(storage.get("meyaj-theme"), "light");
      assert.deepEqual(JSON.parse(storage.get("meyaj-custom-theme")), custom);

      const inactive = restart();
      await inactive.getState().init();
      assert.equal(inactive.getState().theme, "light");
      assert.deepEqual(inactive.getState().customTheme, custom);
      assert.equal(styles.has("--bg"), false);
      inactive.getState().setTheme("custom");
      assert.equal(attributes.get("data-theme"), "custom");
      assert.equal(styles.get("--bg"), "#abc");
      assert.equal(styles.get("--accent"), "#123");

      const active = restart();
      await active.getState().init();
      assert.equal(active.getState().theme, "custom");
      assert.deepEqual(active.getState().customTheme, custom);
      assert.equal(attributes.get("data-theme"), "custom");
      assert.equal(styles.get("--bg"), "#abc");
    });

    it("init restores a valid colors theme when no base theme was saved", async (t) => {
      const { store, styles, attributes } = harness(t, { saved: {
        "meyaj-custom-theme": JSON.stringify({ name: "Restaurado", colors: { bg: "#123" } }),
      } });
      await store.getState().init();
      assert.equal(store.getState().theme, "custom");
      assert.deepEqual(store.getState().customTheme, { name: "Restaurado", vars: { bg: "#123" } });
      assert.equal(styles.get("--bg"), "#123");
      assert.equal(attributes.get("data-theme"), "custom");
    });

    it("init rejects a structurally valid saved theme with unsafe colors", async (t) => {
      const { store, styles, attributes } = harness(t, { saved: {
        "meyaj-theme": "custom",
        "meyaj-custom-theme": JSON.stringify({ name: "Inseguro", vars: { bg: "url(evil)" } }),
      } });
      await store.getState().init();
      assert.equal(store.getState().customTheme, null);
      assert.equal(store.getState().theme, "dark");
      assert.equal(styles.has("--bg"), false);
      assert.equal(attributes.get("data-theme"), "dark");
    });
  });

  describe("creation contracts", () => {
    it("returns null/false without an active panel and never calls the API", async (t) => {
      const { store, api } = harness(t);
      assert.equal(await store.getState().createProject("Nuevo"), null);
      assert.equal(await store.getState().createTask(taskInput), false);
      assert.equal(api.createProject.mock.callCount(), 0);
      assert.equal(api.createTask.mock.callCount(), 0);
      assert.equal(store.getState().error, null);
    });

    it("returns the new project, applies the response, and reuses normalized duplicates", async (t) => {
      const created = makeProject("new", "Árbol nuevo");
      const response = panelState("a", { projects: [...panelState().projects, created] });
      const { store, api } = harness(t, { api: { createProject: async () => response } });
      await store.getState().init();
      assert.strictEqual(await store.getState().createProject("Árbol nuevo", "#abc"), created);
      assert.deepEqual(api.createProject.mock.calls[0].arguments, ["a", "Árbol nuevo", "#abc"]);
      assert.strictEqual(store.getState().projects, response.projects);
      assert.strictEqual(await store.getState().createProject("  ARBOL   NUEVO  "), created);
      assert.equal(api.createProject.mock.callCount(), 1);
    });

    it("returns null when the API response contains no newly created matching project", async (t) => {
      const { store } = harness(t, { api: { createProject: async () => panelState() } });
      await store.getState().init();
      assert.equal(await store.getState().createProject("Ausente"), null);
      assert.equal(store.getState().error, null);
    });

    it("returns true for task creation, adds panelId, and applies the response", async (t) => {
      const task = {
        id: "task-new", ...taskInput, completed: false, createdAt: "2026-11-04",
        completedAt: null, sortOrder: 0, hashtags: [],
      };
      const response = panelState("a", { tasks: [task] });
      const { store, api } = harness(t, { api: { createTask: async () => response } });
      await store.getState().init();
      store.getState().setError("Old error");
      assert.equal(await store.getState().createTask(taskInput), true);
      assert.deepEqual(api.createTask.mock.calls[0].arguments, [{ ...taskInput, panelId: "a" }]);
      assert.strictEqual(store.getState().tasks, response.tasks);
      assert.equal(store.getState().error, null);
    });

    it("returns true for classifier creation and clears an earlier error", async (t) => {
      const classifiers = [{ id: "classifier-new", name: "TRABAJO" }];
      const { store, api } = harness(t, { api: { createClassifier: async () => classifiers } });
      store.getState().setError("Old error");
      assert.equal(await store.getState().createClassifier("TRABAJO"), true);
      assert.deepEqual(api.createClassifier.mock.calls[0].arguments, ["TRABAJO"]);
      assert.strictEqual(store.getState().classifiers, classifiers);
      assert.equal(store.getState().error, null);
    });

    it("returns null/false and records errors without replacing existing data on API failures", async (t) => {
      const fail = async () => { throw new Error("Creation failed"); };
      const { store } = harness(t, { api: {
        createProject: fail, createTask: fail, createClassifier: fail,
      } });
      await store.getState().init();
      const previous = store.getState();
      assert.equal(await store.getState().createProject("Nuevo"), null);
      assert.equal(store.getState().error, "Error: Creation failed");
      assert.equal(await store.getState().createTask(taskInput), false);
      assert.equal(store.getState().error, "Error: Creation failed");
      assert.equal(await store.getState().createClassifier("NUEVO"), false);
      assert.equal(store.getState().error, "Error: Creation failed");
      assert.strictEqual(store.getState().projects, previous.projects);
      assert.strictEqual(store.getState().tasks, previous.tasks);
      assert.strictEqual(store.getState().classifiers, previous.classifiers);
      assert.equal(store.getState().activePanelId, "a");
    });
  });

  describe("tab ordering regressions", () => {
    it("reorders a valid permutation without changing labels or the selected view, and restores it on init", async (t) => {
      const { store, storage, restart } = harness(t);
      await store.getState().init();
      store.getState().renameTab("project", "Mis proyectos");
      store.getState().renameTab("history", "Archivo");
      store.getState().setView("project");
      const previous = store.getState().tabs;
      const order = ["history", "month", "all", "project"];
      store.getState().reorderTabs(order);
      const expected = order.map((view) => previous.find((tab) => tab.view === view));
      assert.deepEqual(store.getState().tabs, expected);
      expected.forEach((tab, index) => assert.strictEqual(store.getState().tabs[index], tab));
      assert.equal(store.getState().currentView, "project");
      assert.deepEqual(JSON.parse(storage.get("meyaj-tabs")), { tabs: expected, currentView: "project" });
      const restored = restart();
      await restored.getState().init();
      assert.deepEqual(restored.getState().tabs, expected);
      assert.equal(restored.getState().currentView, "project");
    });

    for (const [name, order] of [
      ["missing view", ["all", "project", "month"]],
      ["extra view", ["all", "project", "month", "history", "unknown"]],
      ["duplicate view", ["all", "project", "month", "month"]],
      ["unknown view", ["all", "project", "month", "unknown"]],
      ["empty permutation", []],
    ]) {
      it(`ignores an invalid tab permutation: ${name}`, (t) => {
        const { store, storage } = harness(t);
        store.getState().renameTab("project", "Proyectos");
        store.getState().setView("month");
        const previous = store.getState();
        const persisted = storage.get("meyaj-tabs");
        store.getState().reorderTabs(order);
        assert.strictEqual(store.getState(), previous);
        assert.equal(storage.get("meyaj-tabs"), persisted);
      });
    }
  });

  describe("panel and project mutation regressions", () => {
    it("renamePanel trims the title, returns true, and replaces only the panel list", async (t) => {
      const panels = panelState().panels.map((panel) => panel.id === "a" ? { ...panel, title: "Trabajo" } : panel);
      const { store, api } = harness(t, { api: { renamePanel: async () => panels } });
      await store.getState().init();
      store.getState().setError("Old error");
      const previous = store.getState();
      assert.equal(await store.getState().renamePanel("a", " \tTrabajo\n "), true);
      assert.deepEqual(api.renamePanel.mock.calls[0].arguments, ["a", "Trabajo"]);
      assert.strictEqual(store.getState().panels, panels);
      assert.strictEqual(store.getState().projects, previous.projects);
      assert.strictEqual(store.getState().tasks, previous.tasks);
      assert.equal(store.getState().activePanelId, "a");
      assert.equal(store.getState().error, null);
    });

    it("renamePanel rejects a blank title without IPC or state changes", async (t) => {
      const { store, api } = harness(t);
      await store.getState().init();
      const previous = store.getState();
      assert.equal(await store.getState().renamePanel("a", " \t\n "), false);
      assert.equal(api.renamePanel.mock.callCount(), 0);
      assert.strictEqual(store.getState(), previous);
    });

    it("renamePanel returns false and preserves data on API failure", async (t) => {
      const { store } = harness(t, { api: {
        renamePanel: async () => { throw new Error("Rename failed"); },
      } });
      await store.getState().init();
      const previous = store.getState();
      assert.equal(await store.getState().renamePanel("a", "Trabajo"), false);
      assert.strictEqual(store.getState().panels, previous.panels);
      assert.strictEqual(store.getState().projects, previous.projects);
      assert.strictEqual(store.getState().tasks, previous.tasks);
      assert.equal(store.getState().activePanelId, "a");
      assert.equal(store.getState().error, "Error: Rename failed");
    });

    it("deletePanel removes an inactive panel and preserves the active workspace", async (t) => {
      const response = panelState("a", {
        panels: panelState().panels.filter((panel) => panel.id !== "b"),
      });
      const { store, api } = harness(t, { api: { deletePanel: async () => response } });
      await store.getState().init();
      const previous = store.getState();
      assert.equal(await store.getState().deletePanel("b"), true);
      assert.deepEqual(api.deletePanel.mock.calls[0].arguments, ["b"]);
      assert.equal(store.getState().activePanelId, "a");
      assert.strictEqual(store.getState().panels, response.panels);
      assert.strictEqual(store.getState().projects, previous.projects);
      assert.strictEqual(store.getState().tasks, previous.tasks);
      assert.strictEqual(store.getState().history, previous.history);
      assert.equal(store.getState().error, null);
    });

    it("deletePanel applies the fallback workspace and history when deleting the active panel", async (t) => {
      const response = panelState("b", {
        panels: panelState().panels.filter((panel) => panel.id !== "a"),
      });
      const history = [{ id: "fallback-history" }];
      const { store, api } = harness(t, { api: {
        deletePanel: async () => response,
        listHistory: async (panelId) => panelId === "b" ? history : [],
      } });
      await store.getState().init();
      assert.equal(await store.getState().deletePanel("a"), true);
      assert.deepEqual(api.deletePanel.mock.calls[0].arguments, ["a"]);
      assert.equal(store.getState().activePanelId, "b");
      assert.strictEqual(store.getState().projects, response.projects);
      assert.strictEqual(store.getState().tasks, response.tasks);
      assert.strictEqual(store.getState().panels, response.panels);
      assert.strictEqual(store.getState().history, history);
      assert.equal(store.getState().loading, false);
      assert.equal(store.getState().lastCreatedTaskId, null);
    });

    it("deletePanel refuses to remove the only panel without IPC", async (t) => {
      const only = panelState("a", { panels: [panelState().panels[0]] });
      const { store, api } = harness(t, { api: { bootstrap: async () => only } });
      await store.getState().init();
      const previous = store.getState();
      assert.equal(await store.getState().deletePanel("a"), false);
      assert.equal(api.deletePanel.mock.callCount(), 0);
      assert.strictEqual(store.getState(), previous);
    });

    it("deletePanel returns false and preserves the workspace on API failure", async (t) => {
      const { store } = harness(t, { api: {
        deletePanel: async () => { throw new Error("Delete failed"); },
      } });
      await store.getState().init();
      const previous = store.getState();
      assert.equal(await store.getState().deletePanel("b"), false);
      assert.strictEqual(store.getState().panels, previous.panels);
      assert.strictEqual(store.getState().projects, previous.projects);
      assert.strictEqual(store.getState().tasks, previous.tasks);
      assert.equal(store.getState().activePanelId, "a");
      assert.equal(store.getState().error, "Error: Delete failed");
    });

    it("moveProject applies the source snapshot and clears the moved project's filter", async (t) => {
      const remaining = makeProject("remaining", "Permanece");
      const response = panelState("a", { projects: [remaining], tasks: [makeTask("remaining-task", { projectId: remaining.id })] });
      const { store, api } = harness(t, { api: { moveProject: async () => response } });
      await store.getState().init();
      store.getState().setProjectFilter("a-project");
      store.getState().setError("Old error");
      assert.equal(await store.getState().moveProject("a-project", "b"), true);
      assert.deepEqual(api.moveProject.mock.calls[0].arguments, ["a-project", "b"]);
      assert.equal(store.getState().activePanelId, "a");
      assert.strictEqual(store.getState().projects, response.projects);
      assert.strictEqual(store.getState().tasks, response.tasks);
      assert.strictEqual(store.getState().panels, response.panels);
      assert.equal(store.getState().projectFilter, "remaining");
      assert.equal(store.getState().error, null);
    });

    it("moveProject does not hijack a panel selected while awaiting the source snapshot", async (t) => {
      const pending = deferred();
      const { store, api } = harness(t, { api: { moveProject: () => pending.promise } });
      await store.getState().init();
      const request = store.getState().moveProject("a-project", "b");
      await store.getState().setActivePanel("c");
      store.getState().setProjectFilter("c-project");
      const accepted = store.getState();
      pending.resolve(panelState("a", { projects: [], tasks: [] }));
      assert.equal(await request, true);
      assert.strictEqual(store.getState(), accepted);
      assert.equal(store.getState().activePanelId, "c");
      assert.deepEqual(api.moveProject.mock.calls[0].arguments, ["a-project", "b"]);
    });

    it("moveProject reloads an active destination after its pre-move snapshot was already loaded", async (t) => {
      const pendingMove = deferred();
      const before = panelState("b");
      const moved = { ...makeProject("a-project", "Movido", "b"), sortOrder: 1 };
      const after = panelState("b", { projects: [...before.projects, moved], tasks: [makeTask("moved-task", { panelId: "b" })] });
      let destinationLoads = 0;
      const { store, api } = harness(t, { api: {
        moveProject: () => pendingMove.promise,
        loadState: async (id) => {
          assert.equal(id, "b");
          return ++destinationLoads === 1 ? before : after;
        },
      } });
      await store.getState().init();
      const request = store.getState().moveProject("a-project", "b");
      await store.getState().setActivePanel("b");
      assert.strictEqual(store.getState().projects, before.projects);
      pendingMove.resolve(panelState("a", { projects: [], tasks: [] }));
      assert.equal(await request, true);
      assert.deepEqual(api.loadState.mock.calls.map((call) => call.arguments), [["b"], ["b"]]);
      assert.equal(store.getState().activePanelId, "b");
      assert.strictEqual(store.getState().projects, after.projects);
      assert.strictEqual(store.getState().tasks, after.tasks);
      assert.deepEqual(api.listHistory.mock.calls.map((call) => call.arguments), [["a"], ["b"], ["b"]]);
      assert.equal(store.getState().loading, false);
    });

    it("moveProject refreshes a pending destination and ignores its late pre-move snapshot", async (t) => {
      const pendingMove = deferred();
      const oldLoad = deferred();
      const freshLoad = deferred();
      const refreshStarted = deferred();
      const before = panelState("b");
      const after = panelState("b", { projects: [...before.projects, makeProject("a-project", "Movido", "b")] });
      let destinationLoads = 0;
      const { store, api } = harness(t, { api: {
        moveProject: () => pendingMove.promise,
        loadState: (id) => {
          assert.equal(id, "b");
          if (++destinationLoads === 1) return oldLoad.promise;
          refreshStarted.resolve();
          return freshLoad.promise;
        },
      } });
      await store.getState().init();
      const move = store.getState().moveProject("a-project", "b");
      const navigation = store.getState().setActivePanel("b");
      assert.equal(store.getState().activePanelId, "a");
      assert.equal(store.getState().loading, true);
      pendingMove.resolve(panelState("a", { projects: [] }));
      await refreshStarted.promise;
      assert.deepEqual(api.loadState.mock.calls.map((call) => call.arguments), [["b"], ["b"]]);
      freshLoad.resolve(after);
      assert.equal(await move, true);
      const accepted = store.getState();
      assert.equal(accepted.activePanelId, "b");
      assert.strictEqual(accepted.projects, after.projects);
      oldLoad.resolve(before);
      await navigation;
      assert.strictEqual(store.getState(), accepted);
      assert.equal(store.getState().loading, false);
      assert.deepEqual(api.listHistory.mock.calls.map((call) => call.arguments), [["a"], ["b"]]);
    });

    it("a move-triggered destination refresh does not hijack navigation to C when its response arrives late", async (t) => {
      const pendingMove = deferred();
      const freshLoad = deferred();
      const refreshStarted = deferred();
      let destinationLoads = 0;
      const { store, api } = harness(t, { api: {
        moveProject: () => pendingMove.promise,
        loadState: (id) => {
          if (id === "b" && ++destinationLoads === 2) {
            refreshStarted.resolve();
            return freshLoad.promise;
          }
          return Promise.resolve(panelState(id));
        },
      } });
      await store.getState().init();
      const move = store.getState().moveProject("a-project", "b");
      await store.getState().setActivePanel("b");
      pendingMove.resolve(panelState("a", { projects: [] }));
      await refreshStarted.promise;
      await store.getState().setActivePanel("c");
      store.getState().setProjectFilter("c-project");
      const accepted = store.getState();
      freshLoad.resolve(panelState("b", { projects: [makeProject("a-project", "Movido", "b")] }));
      assert.equal(await move, true);
      assert.strictEqual(store.getState(), accepted);
      assert.equal(store.getState().activePanelId, "c");
      assert.deepEqual(api.loadState.mock.calls.map((call) => call.arguments), [["b"], ["b"], ["c"]]);
      assert.deepEqual(api.listHistory.mock.calls.map((call) => call.arguments), [["a"], ["b"], ["c"]]);
    });

    it("does not refresh B when navigation to C completes before the move", async (t) => {
      const pendingMove = deferred();
      const { store, api } = harness(t, { api: { moveProject: () => pendingMove.promise } });
      await store.getState().init();
      const move = store.getState().moveProject("a-project", "b");
      await store.getState().setActivePanel("b");
      await store.getState().setActivePanel("c");
      const accepted = store.getState();
      pendingMove.resolve(panelState("a", { projects: [] }));
      assert.equal(await move, true);
      assert.strictEqual(store.getState(), accepted);
      assert.deepEqual(api.loadState.mock.calls.map((call) => call.arguments), [["b"], ["c"]]);
    });

    it("does not reload active B or cancel pending navigation to C when the move finishes", async (t) => {
      const pendingMove = deferred();
      const pendingNavigation = deferred();
      const destination = panelState("c");
      const { store, api } = harness(t, { api: {
        moveProject: () => pendingMove.promise,
        loadState: (id) => id === "c" ? pendingNavigation.promise : Promise.resolve(panelState(id)),
      } });
      await store.getState().init();
      const move = store.getState().moveProject("a-project", "b");
      await store.getState().setActivePanel("b");
      const navigation = store.getState().setActivePanel("c");
      const waitingForC = store.getState();
      assert.equal(waitingForC.activePanelId, "b");
      assert.equal(waitingForC.loading, true);
      pendingMove.resolve(panelState("a", { projects: [], tasks: [] }));
      assert.equal(await move, true);
      assert.strictEqual(store.getState(), waitingForC);
      assert.deepEqual(api.moveProject.mock.calls[0].arguments, ["a-project", "b"]);
      assert.deepEqual(api.loadState.mock.calls.map((call) => call.arguments), [["b"], ["c"]]);
      assert.deepEqual(api.listHistory.mock.calls.map((call) => call.arguments), [["a"], ["b"]]);
      pendingNavigation.resolve(destination);
      await navigation;
      assert.equal(store.getState().activePanelId, "c");
      assert.strictEqual(store.getState().projects, destination.projects);
      assert.strictEqual(store.getState().tasks, destination.tasks);
      assert.equal(store.getState().projectFilter, "c-project");
      assert.equal(store.getState().loading, false);
      assert.equal(store.getState().error, null);
      assert.deepEqual(api.loadState.mock.calls.map((call) => call.arguments), [["b"], ["c"]]);
      assert.deepEqual(api.listHistory.mock.calls.map((call) => call.arguments), [["a"], ["b"], ["c"]]);
    });

    it("moveProject returns false and preserves the source data on failure", async (t) => {
      const { store } = harness(t, { api: {
        moveProject: async () => { throw new Error("Move failed"); },
      } });
      await store.getState().init();
      const previous = store.getState();
      assert.equal(await store.getState().moveProject("a-project", "b"), false);
      assert.strictEqual(store.getState().projects, previous.projects);
      assert.strictEqual(store.getState().tasks, previous.tasks);
      assert.equal(store.getState().activePanelId, "a");
      assert.equal(store.getState().error, "Error: Move failed");
    });

    for (const icon of ["flask", null]) {
      it(`setProjectIcon merges only the icon and returns true for ${JSON.stringify(icon)}`, async (t) => {
        const response = panelState("a", { projects: [{ ...makeProject("a-project", "Proyecto a"), icon }] });
        const { store, api } = harness(t, { api: { setProjectIcon: async () => response } });
        await store.getState().init();
        store.getState().setError("Old error");
        const previous = store.getState();
        assert.equal(await store.getState().setProjectIcon("a-project", icon), true);
        assert.deepEqual(api.setProjectIcon.mock.calls[0].arguments, ["a-project", icon]);
        assert.deepEqual(store.getState().projects, previous.projects.map((project) => ({ ...project, icon })));
        assert.notStrictEqual(store.getState().projects, response.projects);
        assert.strictEqual(store.getState().tasks, previous.tasks);
        assert.strictEqual(store.getState().panels, previous.panels);
        assert.strictEqual(store.getState().classifiers, previous.classifiers);
        assert.equal(store.getState().projects[0].icon, icon);
        assert.equal(store.getState().error, null);
      });
    }

    it("setProjectIcon does not resurrect a completed child or revert project ordering and edits from a stale snapshot", async (t) => {
      const pending = deferred();
      const initial = makeProject("a-project", "Original");
      const other = makeProject("other", "Otro");
      const child = makeTask("child", { parentTaskId: "completed-parent" });
      const stale = panelState("a", {
        projects: [{ ...initial, icon: "rocket" }, other], tasks: [child],
      });
      const { store } = harness(t, { api: {
        bootstrap: async () => panelState("a", { projects: [initial, other], tasks: [child] }),
        setProjectIcon: () => pending.promise,
      } });
      await store.getState().init();
      const request = store.getState().setProjectIcon(initial.id, "rocket");
      const reordered = [
        { ...other, sortOrder: 0 },
        { ...initial, label: "Renombrado", colorAccent: "#abc", sortOrder: 1 },
      ];
      store.setState({ tasks: [], projects: reordered, history: [{ id: "completed-child" }] });
      store.getState().setProjectFilter(other.id);
      const current = store.getState();
      pending.resolve(stale);
      assert.equal(await request, true);
      assert.strictEqual(store.getState().tasks, current.tasks);
      assert.deepEqual(store.getState().tasks, []);
      assert.strictEqual(store.getState().history, current.history);
      assert.strictEqual(store.getState().panels, current.panels);
      assert.strictEqual(store.getState().classifiers, current.classifiers);
      assert.equal(store.getState().projectFilter, other.id);
      assert.deepEqual(store.getState().projects, [reordered[0], { ...reordered[1], icon: "rocket" }]);
      assert.strictEqual(store.getState().projects[0], reordered[0]);
      assert.equal(store.getState().activePanelId, "a");
    });

    it("setProjectIcon returns false and preserves the snapshot on failure", async (t) => {
      const { store } = harness(t, { api: {
        setProjectIcon: async () => { throw new Error("Icon failed"); },
      } });
      await store.getState().init();
      const previous = store.getState();
      assert.equal(await store.getState().setProjectIcon("a-project", "rocket"), false);
      assert.strictEqual(store.getState().projects, previous.projects);
      assert.strictEqual(store.getState().tasks, previous.tasks);
      assert.equal(store.getState().error, "Error: Icon failed");
    });

    it("setProjectIcon ignores its old snapshot after navigating to another panel", async (t) => {
      const pending = deferred();
      const { store } = harness(t, { api: { setProjectIcon: () => pending.promise } });
      await store.getState().init();
      const request = store.getState().setProjectIcon("a-project", "leaf");
      await store.getState().setActivePanel("b");
      const accepted = store.getState();
      pending.resolve(panelState("a"));
      assert.equal(await request, true);
      assert.strictEqual(store.getState(), accepted);
    });

    it("createPanel returns true, applies the new panel, and refreshes its history", async (t) => {
      const response = panelState("new");
      const history = [{ id: "new-history" }];
      const { store, api } = harness(t, { api: {
        createPanel: async () => response,
        listHistory: async (id) => id === "new" ? history : [],
      } });
      await store.getState().init();
      store.getState().setError("Old error");
      assert.equal(await store.getState().createPanel("Nuevo panel"), true);
      assert.deepEqual(api.createPanel.mock.calls[0].arguments, ["Nuevo panel"]);
      assert.equal(store.getState().activePanelId, "new");
      assert.strictEqual(store.getState().projects, response.projects);
      assert.strictEqual(store.getState().panels, response.panels);
      assert.strictEqual(store.getState().history, history);
      assert.equal(store.getState().loading, false);
      assert.equal(store.getState().error, null);
    });

    it("createPanel returns false and preserves existing data on failure", async (t) => {
      const { store } = harness(t, { api: {
        createPanel: async () => { throw new Error("Panel creation failed"); },
      } });
      await store.getState().init();
      const previous = store.getState();
      assert.equal(await store.getState().createPanel("Nuevo"), false);
      assert.strictEqual(store.getState().panels, previous.panels);
      assert.strictEqual(store.getState().projects, previous.projects);
      assert.strictEqual(store.getState().tasks, previous.tasks);
      assert.equal(store.getState().activePanelId, "a");
      assert.equal(store.getState().error, "Error: Panel creation failed");
    });
  });

  describe("task creation and completion regressions", () => {
    it("derives the child's project from its parent even when input requests a different project", async (t) => {
      const parent = makeTask("parent");
      const child = makeTask("child", { parentTaskId: parent.id });
      const response = panelState("a", { tasks: [parent, child] });
      const { store, api } = harness(t, { api: {
        bootstrap: async () => panelState("a", { tasks: [parent] }),
        createTask: async () => response,
      } });
      await store.getState().init();
      const input = { ...taskInput, projectId: "another-project", parentTaskId: parent.id };
      assert.equal(await store.getState().createTask(input), true);
      assert.deepEqual(api.createTask.mock.calls[0].arguments, [{ ...input, panelId: "a", projectId: parent.projectId }]);
      assert.equal(input.projectId, "another-project", "caller input must not be mutated");
      assert.strictEqual(store.getState().tasks, response.tasks);
      assert.equal(store.getState().lastCreatedTaskId, child.id);
    });

    it("rejects an unknown parent before IPC and preserves tasks and the existing highlight", async (t) => {
      const { store, api } = harness(t);
      await store.getState().init();
      store.setState({ lastCreatedTaskId: "previous" });
      const previous = store.getState();
      assert.equal(await store.getState().createTask({ ...taskInput, parentTaskId: "missing" }), false);
      assert.equal(api.createTask.mock.callCount(), 0);
      assert.strictEqual(store.getState().tasks, previous.tasks);
      assert.equal(store.getState().lastCreatedTaskId, "previous");
      assert.match(store.getState().error, /tarea padre/);
    });

    it("falls back without createdTaskId to a new task matching project, content, and parent", async (t) => {
      const parent = makeTask("parent", { content: "Padre" });
      const existing = makeTask("existing", { parentTaskId: parent.id });
      const correct = makeTask("correct", { parentTaskId: parent.id });
      const response = panelState("a", { tasks: [
        parent, existing,
        makeTask("wrong-content", { content: "Otra", parentTaskId: parent.id }),
        makeTask("wrong-parent"),
        makeTask("wrong-project", { projectId: "another-project", parentTaskId: parent.id }), correct,
      ] });
      const { store } = harness(t, { api: {
        bootstrap: async () => panelState("a", { tasks: [parent, existing] }),
        createTask: async () => response,
      } });
      await store.getState().init();
      assert.equal(store.getState().lastCreatedTaskId, null);
      assert.equal(await store.getState().createTask({ ...taskInput, parentTaskId: parent.id }), true);
      assert.equal(store.getState().lastCreatedTaskId, correct.id);
    });

    it("uses the exact backend createdTaskId when two new tasks have identical content and parent", async (t) => {
      const parent = makeTask("parent", { content: "Padre" });
      const first = makeTask("00000000-0000-4000-8000-000000000001", { parentTaskId: parent.id });
      const second = makeTask("00000000-0000-4000-8000-000000000002", { parentTaskId: parent.id });
      const response = panelState("a", { tasks: [parent, first, second], createdTaskId: second.id });
      const { store, api } = harness(t, { api: {
        bootstrap: async () => panelState("a", { tasks: [parent] }),
        createTask: async () => response,
      } });
      await store.getState().init();
      assert.equal(await store.getState().createTask({ ...taskInput, projectId: parent.projectId, parentTaskId: parent.id }), true);
      assert.equal(api.createTask.mock.callCount(), 1);
      assert.strictEqual(store.getState().tasks, response.tasks);
      assert.equal(store.getState().lastCreatedTaskId, second.id);
    });

    it("does not use the heuristic fallback when the backend supplied an ID absent from the snapshot", async (t) => {
      const candidate = makeTask("candidate");
      const { store } = harness(t, { api: {
        createTask: async () => panelState("a", { tasks: [candidate], createdTaskId: "missing" }),
      } });
      await store.getState().init();
      store.getState().setView("history");
      store.setState({ lastCreatedTaskId: "previous" });
      assert.equal(await store.getState().createTask({ ...taskInput, projectId: candidate.projectId }), true);
      assert.equal(store.getState().lastCreatedTaskId, "previous");
      assert.equal(store.getState().currentView, "history");
    });

    it("does not use a same-content task from a different project in a mock snapshot without createdTaskId", async (t) => {
      const { store } = harness(t, { api: {
        createTask: async () => panelState("a", { tasks: [makeTask("wrong-project", { projectId: "other" })] }),
      } });
      await store.getState().init();
      store.getState().setView("history");
      assert.equal(await store.getState().createTask({ ...taskInput, projectId: "a-project" }), true);
      assert.equal(store.getState().lastCreatedTaskId, null);
      assert.equal(store.getState().currentView, "history");
    });

    it("does not invent a highlight or reveal a task when the response has no matching new task", async (t) => {
      const existing = makeTask("existing", { projectId: null });
      const response = panelState("a", { tasks: [existing, makeTask("unrelated", { content: "Otra" })] });
      const { store } = harness(t, { api: {
        bootstrap: async () => panelState("a", { tasks: [existing] }),
        createTask: async () => response,
      } });
      await store.getState().init();
      store.getState().setView("history");
      store.setState({ lastCreatedTaskId: existing.id });
      assert.equal(await store.getState().createTask(taskInput), true);
      assert.equal(store.getState().lastCreatedTaskId, existing.id);
      assert.equal(store.getState().currentView, "history");
    });

    it("preserves tasks, highlight, and history view when task creation fails", async (t) => {
      const { store } = harness(t, { api: {
        createTask: async () => { throw new Error("Task creation failed"); },
      } });
      await store.getState().init();
      store.getState().setView("history");
      store.setState({ lastCreatedTaskId: "previous" });
      const previous = store.getState();
      assert.equal(await store.getState().createTask(taskInput), false);
      assert.strictEqual(store.getState().tasks, previous.tasks);
      assert.equal(store.getState().lastCreatedTaskId, "previous");
      assert.equal(store.getState().currentView, "history");
      assert.equal(store.getState().error, "Error: Task creation failed");
    });

    it("switches history to all and reopens the all tab to reveal the newly created task", async (t) => {
      const created = makeTask("created");
      const { store, storage } = harness(t, { api: {
        createTask: async () => panelState("a", { tasks: [created] }),
      } });
      await store.getState().init();
      store.getState().closeTab("all");
      store.getState().setView("history");
      assert.equal(await store.getState().createTask({ ...taskInput, projectId: created.projectId }), true);
      assert.equal(store.getState().lastCreatedTaskId, created.id);
      assert.equal(store.getState().currentView, "all");
      assert.equal(store.getState().tabs.filter((tab) => tab.view === "all").length, 1);
      assert.equal(JSON.parse(storage.get("meyaj-tabs")).currentView, "all");
    });

    it("points the project filter at the new task's project instead of the previously selected project", async (t) => {
      const target = makeProject("target", "Destino");
      const allProjects = [...panelState().projects, target];
      const created = makeTask("created", { projectId: target.id });
      const { store } = harness(t, { api: {
        bootstrap: async () => panelState("a", { projects: allProjects }),
        createTask: async () => panelState("a", { projects: allProjects, tasks: [created] }),
      } });
      await store.getState().init();
      store.getState().setProjectFilter("a-project");
      assert.equal(await store.getState().createTask({ ...taskInput, projectId: target.id }), true);
      assert.equal(store.getState().currentView, "project");
      assert.equal(store.getState().projectFilter, target.id);
      assert.equal(store.getState().lastCreatedTaskId, created.id);
    });

    it("keeps a newly selected project filter and existing highlight when creation finishes in the same panel", async (t) => {
      const pending = deferred();
      const other = makeProject("other", "Otro");
      const projects = [...panelState().projects, other];
      const created = makeTask("created");
      const response = panelState("a", { projects, tasks: [created], createdTaskId: created.id });
      const { store } = harness(t, { api: {
        bootstrap: async () => panelState("a", { projects }),
        createTask: () => pending.promise,
      } });
      await store.getState().init();
      store.getState().setProjectFilter("a-project");
      store.setState({ lastCreatedTaskId: "previous" });
      const request = store.getState().createTask({ ...taskInput, projectId: created.projectId });
      store.getState().setProjectFilter(other.id);
      pending.resolve(response);
      assert.equal(await request, true);
      assert.strictEqual(store.getState().tasks, response.tasks, "snapshot still updates data");
      assert.equal(store.getState().projectFilter, other.id);
      assert.equal(store.getState().lastCreatedTaskId, "previous");
      assert.equal(store.getState().currentView, "project");
    });

    it("preserves P2's filter and the highlight when closing all activates project during creation for P1", async (t) => {
      const pending = deferred();
      const p1 = makeProject("p1", "P1");
      const p2 = makeProject("p2", "P2");
      const projects = [p1, p2];
      const created = makeTask("created-p1", { projectId: p1.id });
      const response = panelState("a", { projects, tasks: [created], createdTaskId: created.id });
      const { store, storage } = harness(t, { api: {
        bootstrap: async () => panelState("a", { projects }),
        createTask: () => pending.promise,
      } });
      await store.getState().init();
      store.getState().setProjectFilter(p2.id);
      store.getState().setView("all");
      store.setState({ lastCreatedTaskId: "previous" });
      const request = store.getState().createTask({ ...taskInput, projectId: p1.id });
      store.getState().closeTab("all");
      assert.equal(store.getState().currentView, "project");
      assert.equal(store.getState().projectFilter, p2.id);
      const savedTabs = storage.get("meyaj-tabs");
      pending.resolve(response);
      assert.equal(await request, true);
      assert.strictEqual(store.getState().tasks, response.tasks);
      assert.equal(store.getState().currentView, "project");
      assert.equal(store.getState().projectFilter, p2.id);
      assert.equal(store.getState().lastCreatedTaskId, "previous");
      assert.equal(store.getState().tabs.some((tab) => tab.view === "all"), false);
      assert.equal(storage.get("meyaj-tabs"), savedTabs);
    });

    it("closing an inactive tab does not suppress the new task's reveal", async (t) => {
      const pending = deferred();
      const p1 = makeProject("p1", "P1");
      const p2 = makeProject("p2", "P2");
      const projects = [p1, p2];
      const created = makeTask("created-p1", { projectId: p1.id });
      const { store } = harness(t, { api: {
        bootstrap: async () => panelState("a", { projects }),
        createTask: () => pending.promise,
      } });
      await store.getState().init();
      store.getState().setProjectFilter(p2.id);
      const request = store.getState().createTask({ ...taskInput, projectId: p1.id });
      store.getState().closeTab("all");
      assert.equal(store.getState().currentView, "project");
      pending.resolve(panelState("a", { projects, tasks: [created], createdTaskId: created.id }));
      assert.equal(await request, true);
      assert.equal(store.getState().currentView, "project");
      assert.equal(store.getState().projectFilter, p1.id);
      assert.equal(store.getState().lastCreatedTaskId, created.id);
      assert.equal(store.getState().tabs.some((tab) => tab.view === "all"), false);
    });

    it("does not switch away from history selected after task submission", async (t) => {
      const pending = deferred();
      const created = makeTask("created");
      const { store, storage } = harness(t, { api: { createTask: () => pending.promise } });
      await store.getState().init();
      store.getState().setProjectFilter("a-project");
      const request = store.getState().createTask({ ...taskInput, projectId: created.projectId });
      store.getState().setView("history");
      const savedTabs = storage.get("meyaj-tabs");
      pending.resolve(panelState("a", { tasks: [created], createdTaskId: created.id }));
      assert.equal(await request, true);
      assert.equal(store.getState().currentView, "history");
      assert.equal(store.getState().projectFilter, "a-project");
      assert.equal(store.getState().lastCreatedTaskId, null);
      assert.equal(storage.get("meyaj-tabs"), savedTabs);
    });

    it("does not highlight or change filters after leaving and returning to the submitting panel", async (t) => {
      const pending = deferred();
      const other = makeProject("other", "Otro");
      const projects = [...panelState().projects, other];
      const created = makeTask("created");
      const { store } = harness(t, { api: {
        bootstrap: async () => panelState("a", { projects }),
        loadState: async (id) => panelState(id, id === "a" ? { projects } : {}),
        createTask: () => pending.promise,
      } });
      await store.getState().init();
      store.getState().setProjectFilter("a-project");
      store.setState({ lastCreatedTaskId: "previous" });
      const request = store.getState().createTask({ ...taskInput, projectId: created.projectId });
      await store.getState().setActivePanel("b");
      await store.getState().setActivePanel("a");
      store.getState().setProjectFilter(other.id);
      pending.resolve(panelState("a", { projects, tasks: [created], createdTaskId: created.id }));
      assert.equal(await request, true);
      assert.equal(store.getState().activePanelId, "a");
      assert.equal(store.getState().projectFilter, other.id);
      assert.equal(store.getState().lastCreatedTaskId, "previous");
    });

    it("suppresses reveal as soon as panel navigation starts, even before the new panel loads", async (t) => {
      const pendingCreation = deferred();
      const pendingNavigation = deferred();
      const created = makeTask("created");
      const { store } = harness(t, { api: {
        createTask: () => pendingCreation.promise,
        loadState: () => pendingNavigation.promise,
      } });
      await store.getState().init();
      store.getState().setView("history");
      const filter = store.getState().projectFilter;
      const request = store.getState().createTask({ ...taskInput, projectId: created.projectId });
      const navigation = store.getState().setActivePanel("b");
      pendingCreation.resolve(panelState("a", { tasks: [created], createdTaskId: created.id }));
      assert.equal(await request, true);
      assert.equal(store.getState().activePanelId, "a");
      assert.equal(store.getState().loading, true);
      assert.equal(store.getState().currentView, "history");
      assert.equal(store.getState().projectFilter, filter);
      assert.equal(store.getState().lastCreatedTaskId, null);
      pendingNavigation.resolve(panelState("b"));
      await navigation;
      assert.equal(store.getState().activePanelId, "b");
      assert.equal(store.getState().lastCreatedTaskId, null);
    });

    it("does not reveal or highlight a task in another panel after navigating during creation", async (t) => {
      const pending = deferred();
      const { store } = harness(t, { api: { createTask: () => pending.promise } });
      await store.getState().init();
      const request = store.getState().createTask(taskInput);
      await store.getState().setActivePanel("b");
      store.getState().setView("history");
      const accepted = store.getState();
      pending.resolve(panelState("a", { tasks: [makeTask("created", { projectId: null })] }));
      assert.equal(await request, true);
      assert.strictEqual(store.getState(), accepted);
      assert.equal(store.getState().lastCreatedTaskId, null);
    });

    it("blocks completing a parent with children before IPC without changing state", async (t) => {
      const parent = makeTask("parent");
      const child = makeTask("child", { parentTaskId: parent.id });
      const { store, api } = harness(t, { api: {
        bootstrap: async () => panelState("a", { tasks: [parent, child] }),
      } });
      await store.getState().init();
      const previous = store.getState();
      assert.equal(await store.getState().completeTask(parent.id), false);
      assert.equal(api.completeTask.mock.callCount(), 0);
      assert.equal(api.listHistory.mock.callCount(), 1);
      assert.strictEqual(store.getState(), previous);
    });

    it("completeTask returns false on IPC failure and preserves the visible task", async (t) => {
      const task = makeTask("task");
      const { store, api } = harness(t, { api: {
        bootstrap: async () => panelState("a", { tasks: [task] }),
        completeTask: async () => { throw new Error("Completion failed"); },
      } });
      await store.getState().init();
      const previous = store.getState();
      assert.equal(await store.getState().completeTask(task.id), false);
      assert.deepEqual(api.completeTask.mock.calls[0].arguments, [task.id]);
      assert.strictEqual(store.getState().tasks, previous.tasks);
      assert.strictEqual(store.getState().history, previous.history);
      assert.equal(api.listHistory.mock.callCount(), 1);
      assert.equal(store.getState().error, "Error: Completion failed");
    });

    it("completes only the child, leaving its parent visible until explicitly completed", async (t) => {
      const parent = makeTask("parent", { content: "Padre" });
      const child = makeTask("child", { parentTaskId: parent.id });
      const history = [{ id: "completed-child", taskId: child.id }];
      const { store, api } = harness(t, { api: {
        bootstrap: async () => panelState("a", { tasks: [parent, child] }),
        completeTask: async (id) => panelState("a", { tasks: id === child.id ? [parent] : [] }),
        listHistory: async () => history,
      } });
      await store.getState().init();
      assert.equal(await store.getState().completeTask(child.id), true);
      assert.deepEqual(api.completeTask.mock.calls.map((call) => call.arguments), [[child.id]]);
      assert.deepEqual(store.getState().tasks, [parent]);
      assert.equal(store.getState().tasks[0].completed, false);
      assert.strictEqual(store.getState().history, history);
      assert.equal(api.listHistory.mock.callCount(), 2);
      assert.equal(await store.getState().completeTask(parent.id), true);
      assert.deepEqual(api.completeTask.mock.calls.map((call) => call.arguments), [[child.id], [parent.id]]);
      assert.deepEqual(store.getState().tasks, []);
    });
  });

  describe("panel switching and request ordering", () => {
    it("keeps the active panel and selected filter when a panel switch fails", async (t) => {
      const pending = deferred();
      const selected = makeProject("selected", "Seleccionado");
      const { store, api } = harness(t, { api: {
        bootstrap: async () => panelState("a", { projects: [...panelState().projects, selected] }),
        loadState: () => pending.promise,
      } });
      await store.getState().init();
      store.getState().setProjectFilter("selected");
      const previous = store.getState();
      const request = store.getState().setActivePanel("b");
      assert.equal(store.getState().loading, true);
      assert.equal(store.getState().activePanelId, "a");
      assert.equal(store.getState().projectFilter, "selected");
      pending.reject(new Error("Panel unavailable"));
      await request;
      assert.equal(store.getState().activePanelId, "a");
      assert.equal(store.getState().projectFilter, "selected");
      assert.strictEqual(store.getState().projects, previous.projects);
      assert.strictEqual(store.getState().history, previous.history);
      assert.equal(store.getState().loading, false);
      assert.equal(store.getState().error, "Error: Panel unavailable");
      assert.deepEqual(api.loadState.mock.calls[0].arguments, ["b"]);
      assert.equal(api.listHistory.mock.callCount(), 1);
    });

    it("ignores an older successful response arriving after the newest response", async (t) => {
      const older = deferred();
      const latest = deferred();
      const history = [{ id: "history-c" }];
      const { store, api } = harness(t, { api: {
        loadState: (id) => id === "b" ? older.promise : latest.promise,
        listHistory: async (id) => id === "c" ? history : [],
      } });
      await store.getState().init();
      const oldRequest = store.getState().setActivePanel("b");
      const newRequest = store.getState().setActivePanel("c");
      latest.resolve(panelState("c"));
      await newRequest;
      const accepted = store.getState();
      assert.equal(accepted.activePanelId, "c");
      assert.equal(accepted.projectFilter, "c-project");
      assert.strictEqual(accepted.history, history);
      older.resolve(panelState("b"));
      await oldRequest;
      assert.strictEqual(store.getState(), accepted);
      assert.deepEqual(api.listHistory.mock.calls.map((call) => call.arguments), [["a"], ["c"]]);
      assert.equal(store.getState().loading, false);
    });

    it("ignores an older response while the latest request is still loading", async (t) => {
      const older = deferred();
      const latest = deferred();
      const { store } = harness(t, { api: {
        loadState: (id) => id === "b" ? older.promise : latest.promise,
      } });
      await store.getState().init();
      const oldRequest = store.getState().setActivePanel("b");
      const newRequest = store.getState().setActivePanel("c");
      older.resolve(panelState("b"));
      await oldRequest;
      assert.equal(store.getState().activePanelId, "a");
      assert.equal(store.getState().projectFilter, "a-project");
      assert.equal(store.getState().loading, true);
      latest.resolve(panelState("c"));
      await newRequest;
      assert.equal(store.getState().activePanelId, "c");
      assert.equal(store.getState().loading, false);
    });

    it("ignores stale failures without replacing the newest successful state or error", async (t) => {
      const older = deferred();
      const { store } = harness(t, { api: {
        loadState: (id) => id === "b" ? older.promise : Promise.resolve(panelState(id)),
      } });
      await store.getState().init();
      const oldRequest = store.getState().setActivePanel("b");
      await store.getState().setActivePanel("c");
      const accepted = store.getState();
      older.reject(new Error("Stale failure"));
      await oldRequest;
      assert.strictEqual(store.getState(), accepted);
      assert.equal(store.getState().error, null);
      assert.equal(store.getState().loading, false);
    });

    it("does not accept an older success after the latest switch has failed", async (t) => {
      const older = deferred();
      const { store } = harness(t, { api: {
        loadState: (id) => {
          if (id === "b") return older.promise;
          return Promise.reject(new Error("Latest failure"));
        },
      } });
      await store.getState().init();
      const oldRequest = store.getState().setActivePanel("b");
      await store.getState().setActivePanel("c");
      const failed = store.getState();
      older.resolve(panelState("b"));
      await oldRequest;
      assert.strictEqual(store.getState(), failed);
      assert.equal(store.getState().activePanelId, "a");
      assert.equal(store.getState().projectFilter, "a-project");
      assert.equal(store.getState().error, "Error: Latest failure");
      assert.equal(store.getState().loading, false);
    });
  });
});
