import { useEffect, useRef, useState } from "react";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, GripVertical, ChevronRight, Ellipsis } from "lucide-react";
import type { Project } from "../types";
import type { TaskNode } from "../utils/tasks";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";
import { parseTaskEntry } from "../utils/format";
import { knownTags } from "../utils/hashtags";
import { getInlineSuggestion } from "../utils/autocomplete";
import { SortableTaskItem } from "./TaskItem";
import ProjectIcon, { PROJECT_ICON_IDS } from "./ProjectIcon";

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
  const lastCreatedTaskId = useAppStore((s) => s.lastCreatedTaskId);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
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
            <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-2 shadow-xl" aria-busy={pendingAction}>
              <div className="px-1 py-1 text-xs font-semibold text-[var(--text-dim)]">
                {pendingAction ? t("section.moving") : t("section.movePanel")}
              </div>
              <div role="group" aria-label={t("section.choosePanel")} className="max-h-48 overflow-y-auto">
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
              <div role="group" aria-label={t("section.icon")} className="grid grid-cols-5 gap-1">
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
    </section>
  );
}
