import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTree, groupTasksByProject } from "../src/utils/tasks.ts";

function task(id, overrides = {}) {
  return {
    id, content: id, panelId: "panel", projectId: "project-a", parentTaskId: null,
    classifier: null, completed: false, createdAt: "2026-11-04T00:00:00Z",
    completedAt: null, sortOrder: 0, hashtags: [], ...overrides,
  };
}

function project(id, sortOrder = 0) {
  return { id, label: id, panelId: "panel", sortOrder, colorAccent: null };
}

function structure(nodes) {
  return nodes.map((node) => ({ id: node.task.id, children: structure(node.children) }));
}

describe("task tree regressions", () => {
  it("nests descendants beneath their parent regardless of their input position", () => {
    const parent = task("parent");
    const child = task("child", { parentTaskId: parent.id });
    const grandchild = task("grandchild", { parentTaskId: child.id });
    const leaf = task("leaf", { parentTaskId: grandchild.id });
    const tasks = [leaf, grandchild, child, parent];
    const originalOrder = [...tasks];
    const tree = buildTree(tasks);
    assert.deepEqual(structure(tree), [{ id: "parent", children: [
      { id: "child", children: [{ id: "grandchild", children: [{ id: "leaf", children: [] }] }] },
    ] }]);
    assert.strictEqual(tree[0].task, parent);
    assert.strictEqual(tree[0].children[0].task, child);
    assert.deepEqual(tasks, originalOrder, "tree construction must not reorder the input array");
    assert.equal(Object.hasOwn(parent, "children"), false, "task records must not be mutated");
  });

  it("orders roots and descendants by sortOrder then creation time, preserving tied input order", () => {
    const tasks = [
      task("root-late", { sortOrder: 2, createdAt: "2026-11-05" }),
      task("child-late", { parentTaskId: "root-first", sortOrder: 1, createdAt: "2026-11-05" }),
      task("grandchild-second", { parentTaskId: "child-first", sortOrder: 2 }),
      task("root-first", { sortOrder: 1 }),
      task("child-tied-a", { parentTaskId: "root-first", sortOrder: 2 }),
      task("root-early", { sortOrder: 2, createdAt: "2026-11-03" }),
      task("child-first", { parentTaskId: "root-first", sortOrder: 0 }),
      task("grandchild-first", { parentTaskId: "child-first", sortOrder: 0 }),
      task("child-early", { parentTaskId: "root-first", sortOrder: 1, createdAt: "2026-11-03" }),
      task("child-tied-b", { parentTaskId: "root-first", sortOrder: 2 }),
    ];
    const original = structuredClone(tasks);
    const tree = buildTree(tasks);
    assert.deepEqual(tree.map((node) => node.task.id), ["root-first", "root-early", "root-late"]);
    assert.deepEqual(tree[0].children.map((node) => node.task.id), [
      "child-first", "child-early", "child-late", "child-tied-a", "child-tied-b",
    ]);
    assert.deepEqual(tree[0].children[0].children.map((node) => node.task.id), ["grandchild-first", "grandchild-second"]);
    assert.deepEqual(tasks, original);
  });

  it("keeps nested tasks in their own project and preserves project and sibling ordering", () => {
    const projects = [project("project-b", 2), project("project-a", 1)];
    const tasks = [
      task("a-child-second", { parentTaskId: "a-parent", sortOrder: 2 }),
      task("b-child", { projectId: "project-b", parentTaskId: "b-parent" }),
      task("a-grandchild", { parentTaskId: "a-child-first" }),
      task("a-parent"),
      task("b-parent", { projectId: "project-b" }),
      task("a-child-first", { parentTaskId: "a-parent", sortOrder: 1 }),
    ];
    const originalTasks = structuredClone(tasks);
    const originalProjects = structuredClone(projects);
    const groups = groupTasksByProject(tasks, projects);
    assert.deepEqual(groups.map((group) => group.project.id), ["project-a", "project-b"]);
    assert.deepEqual(structure(groups[0].roots), [{ id: "a-parent", children: [
      { id: "a-child-first", children: [{ id: "a-grandchild", children: [] }] },
      { id: "a-child-second", children: [] },
    ] }]);
    assert.deepEqual(structure(groups[1].roots), [{ id: "b-parent", children: [{ id: "b-child", children: [] }] }]);
    const checkProject = (nodes, projectId) => {
      for (const node of nodes) {
        assert.equal(node.task.projectId, projectId);
        checkProject(node.children, projectId);
      }
    };
    for (const group of groups) checkProject(group.roots, group.project.id);
    assert.deepEqual(tasks, originalTasks);
    assert.deepEqual(projects, originalProjects);
  });

  it("does not attach tasks to parents from another project when grouping", () => {
    const groups = groupTasksByProject([
      task("parent-a"),
      task("orphan-b", { projectId: "project-b", parentTaskId: "parent-a" }),
      task("child-b", { projectId: "project-b", parentTaskId: "orphan-b" }),
    ], [project("project-a"), project("project-b")]);
    assert.deepEqual(structure(groups[0].roots), [{ id: "parent-a", children: [] }]);
    assert.deepEqual(structure(groups[1].roots), [{ id: "orphan-b", children: [{ id: "child-b", children: [] }] }]);
  });

  it("handles an empty tree and filters empty projects only when requested", () => {
    assert.deepEqual(buildTree([]), []);
    const projects = [project("project-a"), project("project-b")];
    const tasks = [task("parent"), task("child", { parentTaskId: "parent" })];
    assert.equal(groupTasksByProject(tasks, projects).length, 2);
    const nonEmpty = groupTasksByProject(tasks, projects, { onlyNonEmpty: true });
    assert.deepEqual(nonEmpty.map((group) => group.project.id), ["project-a"]);
    assert.deepEqual(structure(nonEmpty[0].roots), [{ id: "parent", children: [{ id: "child", children: [] }] }]);
    assert.deepEqual(groupTasksByProject([], projects, { onlyNonEmpty: true }), []);
  });
});
