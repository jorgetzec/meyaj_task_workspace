import { useEffect, useRef, useState } from "react";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, GripVertical, ChevronRight, Ellipsis, Trash2, AlertTriangle, Check } from "lucide-react";
import type { Project } from "../types";
import type { TaskNode } from "../utils/tasks";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";
import { parseTaskEntry } from "../utils/format";
import { knownTags } from "../utils/hashtags";
import { getInlineSuggestion } from "../utils/autocomplete";
import { SortableTaskItem } from "./TaskItem";
import ProjectIcon, { PROJECT_ICON_IDS } from "./ProjectIcon";
import Dialog from "./Dialog";

const PROJECT_COLORS = [
  "#7b9bff",
  "#5ec8d8",
  "#4fbf8b",
  "#d8c04f",
  "#f0a35e",
  "#e0715d",
  "#c07be0",
  "#8b93a7",
];

function countTasks(nodes: TaskNode[]): number {
  return nodes.reduce((count, node) => count + 1 + countTasks(node.children), 0);
}

function containsTask(nodes: TaskNode[], id: string): boolean {
  return nodes.some((node) => node.task.id === id || containsTask(node.children, id));
}

interface Props {
  project: Project;
  roots: TaskNode[];
}

export default function ProjectSection({ project, roots }: Props) {
  const t = useT();
  const createTask = useAppStore((s) => s.createTask);
  const classifiers = useAppStore((s) => s.classifiers);
  const tasks = useAppStore((s) => s.tasks);
  const panels = useAppStore((s) => s.panels);
  const moveProject = useAppStore((s) => s.moveProject);
  const setProjectIcon = useAppStore((s) => s.setProjectIcon);
  const renameProject = useAppStore((s) => s.renameProject);
  const setProjectColor = useAppStore((s) => s.setProjectColor);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const lastCreatedTaskId = useAppStore((s) => s.lastCreatedTaskId);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.label);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const actionPending = useRef(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const cancelled = useRef(false);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  const otherPanels = panels.filter((panel) => !panel.archived && panel.id !== project.panelId);

  useEffect(() => {
    if (lastCreatedTaskId && containsTask(roots, lastCreatedTaskId)) setCollapsed(false);
  }, [lastCreatedTaskId, roots]);

  useEffect(() => {
    if (!actionsOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) setActionsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActionsOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [actionsOpen]);

  const runAction = async (action: () => Promise<boolean>) => {
    if (actionPending.current) return;
    actionPending.current = true;
    setPendingAction(true);
    try {
      if (await action()) setActionsOpen(false);
    } catch {
      // Keep the menu available to retry; the store reports operation errors.
    } finally {
      actionPending.current = false;
      setPendingAction(false);
    }
  };

  const saveName = async () => {
    const next = nameDraft.trim();
    if (!next || next === project.label) {
      setNameDraft(project.label);
      return;
    }
    if (!(await renameProject(project.id, next))) setNameDraft(project.label);
  };

  const confirmDeleteProject = async () => {
    if (deleting) return;
    setDeleting(true);
    const deleted = await deleteProject(project.id);
    setDeleting(false);
    if (deleted) setDeleteOpen(false);
  };

  const classifierNames = classifiers.map((c) => c.name);
  const suggestion = getInlineSuggestion(
    draft,
    draft.length,
    classifierNames,
    knownTags(tasks),
  );
  const suggestions = suggestion?.matches ?? [];

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `proj-${project.id}` });

  const startAdd = () => {
    if (submitting.current) return;
    cancelled.current = false;
    setCollapsed(false);
    setAdding(true);
  };

  const accept = (match: string) => {
    if (!suggestion) return;
    if (suggestion.kind === "classifier") {
      setDraft(match + " | ");
    } else {
      setDraft(draft.slice(0, suggestion.start) + "#" + match + " ");
    }
  };

  const submit = async () => {
    if (submitting.current || cancelled.current) return;
    const { classifier, content } = parseTaskEntry(draft, null);
    if (!content.trim()) {
      cancelled.current = true;
      setDraft("");
      setAdding(false);
      return;
    }
    submitting.current = true;
    setSaving(true);
    try {
      const created = await createTask({
        projectId: project.id,
        classifier,
        parentTaskId: null,
        content: content.trim(),
      });
      if (created) {
        cancelled.current = true;
        setDraft("");
        setAdding(false);
      }
    } catch {
      // Preserve the draft for retry.
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  const topIds = roots.map((r) => r.task.id);

  return (
    <section className="py-1">
      <header
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={`group flex items-center gap-2 rounded px-2 py-1.5 ${
          isDragging ? "opacity-40" : ""
        }`}
        onClick={() => !adding && startAdd()}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(event) => event.stopPropagation()}
          aria-label={t("section.actions")}
          className="touch-none cursor-grab text-[var(--text-faint)] opacity-0 transition group-hover:opacity-100 focus:opacity-100"
        >
          <GripVertical size={13} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setCollapsed((v) => !v);
          }}
          title={collapsed ? t("section.expand") : t("section.collapse")}
          aria-label={collapsed ? t("section.expand") : t("section.collapse")}
          aria-expanded={!collapsed}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--bg-active)] hover:text-[var(--text)]"
        >
          <ChevronRight
            size={14}
            className={`transition-transform ${collapsed ? "" : "rotate-90"}`}
          />
        </button>
        {project.icon ? (
          <ProjectIcon icon={project.icon} size={15} className="shrink-0" style={{ color: project.colorAccent ?? "var(--text-dim)" }} />
        ) : project.colorAccent ? (
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: project.colorAccent }} />
        ) : null}
        <span className="text-sm font-semibold text-[var(--text)]">
          {project.label}
        </span>
        <span className="text-xs text-[var(--text-faint)]">
          {countTasks(roots)}
        </span>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            startAdd();
          }}
          title={t("section.addTask")}
          aria-label={t("section.addTask")}
          className="ml-auto flex h-5 w-5 items-center justify-center rounded text-[var(--text-faint)] opacity-0 transition hover:bg-[var(--bg-active)] hover:text-[var(--text)] focus:opacity-100 group-hover:opacity-100"
        >
          <Plus size={13} aria-hidden="true" />
        </button>
        <div ref={actionsRef} className="relative" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            aria-label={t("section.actions")}
            title={t("section.actions")}
            aria-expanded={actionsOpen}
            onClick={() => setActionsOpen((open) => !open)}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--bg-active)] hover:text-[var(--text)]"
          >
            <Ellipsis size={15} />
          </button>
          {actionsOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-2 shadow-xl" aria-busy={pendingAction}>
              <label className="block px-1 pb-1 text-xs font-semibold text-[var(--text-dim)]" htmlFor={`project-name-${project.id}`}>
                {t("section.projectName")}
              </label>
              <div className="mb-2 flex items-center gap-1">
                <input
                  id={`project-name-${project.id}`}
                  value={nameDraft}
                  disabled={pendingAction}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onBlur={() => { void saveName(); }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveName();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setNameDraft(project.label);
                    }
                  }}
                  className="h-7 min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled={pendingAction || !nameDraft.trim() || nameDraft.trim() === project.label}
                  onClick={() => { void saveName(); }}
                  title={t("section.saveName")}
                  aria-label={t("section.saveName")}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40"
                >
                  <Check size={13} aria-hidden="true" />
                </button>
              </div>

              <div className="px-1 py-1 text-xs font-semibold text-[var(--text-dim)]">{t("section.color")}</div>
              <div role="group" aria-label={t("section.color")} className="mb-2 flex flex-wrap gap-1.5 px-1">
                {PROJECT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    disabled={pendingAction}
                    aria-pressed={project.colorAccent === color}
                    aria-label={color}
                    title={color}
                    onClick={() => void runAction(() => setProjectColor(project.id, color))}
                    className={`h-6 w-6 rounded-full border transition hover:scale-110 disabled:opacity-50 ${
                      project.colorAccent === color
                        ? "border-[var(--text)] ring-2 ring-[var(--border-strong)]"
                        : "border-transparent"
                    }`}
                    style={{ background: color }}
                  />
                ))}
                <button
                  type="button"
                  disabled={pendingAction}
                  onClick={() => void runAction(() => setProjectColor(project.id, null))}
                  aria-pressed={!project.colorAccent}
                  className="ml-0.5 rounded px-1.5 text-[0.625rem] text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-50"
                >
                  {t("section.noColor")}
                </button>
              </div>

              <div className="px-1 py-1 text-xs font-semibold text-[var(--text-dim)]">
                {pendingAction ? t("section.moving") : t("section.movePanel")}
              </div>
              <div role="group" aria-label={t("section.choosePanel")} className="max-h-32 overflow-y-auto">
                {otherPanels.map((panel) => (
                  <button
                    key={panel.id}
                    type="button"
                    disabled={pendingAction}
                    onClick={() => void runAction(() => moveProject(project.id, panel.id))}
                    className="block w-full truncate rounded px-2 py-1.5 text-left text-xs text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                  >
                    {panel.title}
                  </button>
                ))}
                {otherPanels.length === 0 && <div className="px-2 py-1.5 text-xs text-[var(--text-faint)]">{t("section.noOtherPanels")}</div>}
              </div>
              <div className="mt-2 border-t border-[var(--border)] px-1 py-2 text-xs font-semibold text-[var(--text-dim)]">{t("section.icon")}</div>
              <div role="group" aria-label={t("section.icon")} className="grid max-h-36 grid-cols-6 gap-1 overflow-y-auto">
                {PROJECT_ICON_IDS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    title={t(`icons.${icon}`)}
                    aria-label={t(`icons.${icon}`)}
                    aria-pressed={project.icon === icon}
                    disabled={pendingAction}
                    onClick={() => void runAction(() => setProjectIcon(project.id, icon))}
                    className={`flex h-8 items-center justify-center rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 ${project.icon === icon ? "bg-[var(--bg-active)]" : ""}`}
                  >
                    <ProjectIcon icon={icon} size={16} style={{ color: project.colorAccent ?? "var(--text-dim)" }} />
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={pendingAction}
                aria-pressed={!project.icon}
                onClick={() => void runAction(() => setProjectIcon(project.id, null))}
                className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                {t("section.noIcon")}
              </button>

              <button
                type="button"
                disabled={pendingAction}
                onClick={() => { setActionsOpen(false); setDeleteOpen(true); }}
                className="mt-2 flex w-full items-center gap-2 rounded border-t border-[var(--border)] px-2 py-2 text-left text-xs text-[var(--danger)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                <Trash2 size={13} aria-hidden="true" />
                {t("section.deleteProject")}
              </button>
            </div>
          )}
        </div>
      </header>

      {!collapsed && (
        <>
          {adding && (
            <div className="relative flex items-center gap-2 px-6 py-1">
              <input
                autoFocus
                aria-label={t("section.newTask")}
                value={draft}
                readOnly={saving}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={submit}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || submitting.current) return;
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (suggestions.length > 0) {
                      e.preventDefault();
                      accept(suggestions[0]);
                    } else {
                      submit();
                    }
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelled.current = true;
                    setDraft("");
                    setAdding(false);
                  }
                }}
                placeholder={t("section.newTask")}
                className="mono flex-1 bg-transparent text-[0.8125rem] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
              />
              {suggestions.length > 0 && (
                <div className="absolute bottom-full left-6 z-20 mb-1 w-60 overflow-hidden rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-xl">
                  {suggestions.map((m) => (
                    <button
                      key={m}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        accept(m);
                      }}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.75rem] text-[var(--text)] hover:bg-[var(--bg-hover)]"
                    >
                      <span className="mono text-[var(--accent)]">
                        {suggestion?.kind === "hashtag" ? `#${m}` : m}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <SortableContext items={topIds} strategy={verticalListSortingStrategy}>
            {roots.map((node) => (
              <SortableTaskItem key={node.task.id} node={node} />
            ))}
          </SortableContext>
        </>
      )}

      {deleteOpen && (
        <Dialog
          open
          onClose={() => { if (!deleting) setDeleteOpen(false); }}
          label={t("section.deleteProject")}
          className="w-[400px] max-w-full p-4"
          initialFocusRef={deleteCancelRef}
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--danger)]/15 text-[var(--danger)]">
              <AlertTriangle size={16} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[var(--text)]">{t("section.deleteProject")}</h2>
              <p className="mt-1 truncate text-[0.8125rem] font-medium text-[var(--accent)]">{project.label}</p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[var(--text-dim)]">
            {t("section.deleteProjectWarning")}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              ref={deleteCancelRef}
              type="button"
              disabled={deleting}
              onClick={() => setDeleteOpen(false)}
              className="rounded px-3 py-1.5 text-[0.8125rem] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-50"
            >
              {t("section.deleteCancel")}
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => { void confirmDeleteProject(); }}
              className="rounded bg-[var(--danger)] px-3 py-1.5 text-[0.8125rem] font-medium text-white disabled:opacity-50"
            >
              {t("section.deleteConfirm")}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
