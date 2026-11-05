import {
  DndContext,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";
import { groupTasksByMonth, groupTasksByProject } from "../utils/tasks";
import { formatMonth, yyyymmdd } from "../utils/format";
import ProjectSection from "./ProjectSection";
import HistoryView from "./HistoryView";
import TaskInput from "./TaskInput";
import TabBar from "./TabBar";
import ThemedSelect from "./ThemedSelect";

export default function CentralPanel() {
  const t = useT();
  const tasks = useAppStore((s) => s.tasks);
  const projects = useAppStore((s) => s.projects);
  const currentView = useAppStore((s) => s.currentView);
  const projectFilter = useAppStore((s) => s.projectFilter);
  const setProjectFilter = useAppStore((s) => s.setProjectFilter);
  const reorderProjectTasks = useAppStore((s) => s.reorderProjectTasks);
  const moveTask = useAppStore((s) => s.moveTask);
  const setProjectFormOpen = useAppStore((s) => s.setProjectFormOpen);
  const reorderProjects = useAppStore((s) => s.reorderProjects);
  const completeTask = useAppStore((s) => s.completeTask);
  const language = useAppStore((s) => s.language);
  const lastCreatedTaskId = useAppStore((s) => s.lastCreatedTaskId);
  const clearTaskHighlight = useAppStore((s) => s.clearTaskHighlight);
  const monthListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!lastCreatedTaskId) return;
    const timer = window.setTimeout(() => clearTaskHighlight(), 2400);
    return () => window.clearTimeout(timer);
  }, [lastCreatedTaskId, clearTaskHighlight]);

  useEffect(() => {
    if (currentView !== "month" || !lastCreatedTaskId) return;
    const frame = window.requestAnimationFrame(() => {
      const row = Array.from(monthListRef.current?.querySelectorAll<HTMLElement>("[data-task-id]") ?? [])
        .find((element) => element.dataset.taskId === lastCreatedTaskId);
      row?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
      row?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentView, lastCreatedTaskId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Project reorder (dragging a project header).
    if (activeId.startsWith("proj-")) {
      const projA = activeId.slice(5);
      const projB = overId.startsWith("proj-") ? overId.slice(5) : null;
      if (!projB) return;
      const ordered = grouped.map((g) => g.project.id);
      const i = ordered.indexOf(projA);
      const j = ordered.indexOf(projB);
      if (i < 0 || j < 0) return;
      reorderProjects(arrayMove(ordered, i, j));
      return;
    }

    const activeTask = tasks.find((t) => t.id === active.id);
    const overTask = tasks.find((t) => t.id === over.id);
    if (!activeTask || !overTask) return;

    // Move to a different project by dragging onto one of its tasks.
    if (activeTask.projectId !== overTask.projectId) {
      if (activeTask.parentTaskId) return; // keep subtasks with their parent
      if (overTask.projectId) moveTask(activeTask.id, overTask.projectId);
      return;
    }

    if (activeTask.parentTaskId || overTask.parentTaskId) return;

    const topIds = tasks
      .filter((t) => t.projectId === activeTask.projectId && !t.parentTaskId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => t.id);

    const oldIndex = topIds.indexOf(active.id as string);
    const newIndex = topIds.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;

    reorderProjectTasks(activeTask.projectId!, arrayMove(topIds, oldIndex, newIndex));
  };

  const grouped = groupTasksByProject(tasks, projects);
  const filteredGroup = projectFilter
    ? grouped.filter((g) => g.project.id === projectFilter)
    : [];
  const visible = currentView === "project" ? filteredGroup : grouped;
  const monthGroups = groupTasksByMonth(tasks);

  const codeOf = (task: { classifier: string | null }) => task.classifier ?? "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--border)] px-3">
        <TabBar />

        {currentView === "project" && (
          <div className="ml-2">
            <ThemedSelect
              value={projectFilter ?? ""}
              options={[
                { value: "", label: t("central.chooseProject") },
                ...projects.map((p) => ({ value: p.id, label: p.label })),
              ]}
              onChange={(value: string) => setProjectFilter(value || null)}
              label={t("central.chooseProject")}
            />
          </div>
        )}

        <button
          onClick={() => setProjectFormOpen(true)}
          className="ml-auto flex items-center gap-1.5 rounded px-2.5 py-1 text-[0.8125rem] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          <Plus size={14} />
          {t("central.newProject")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
        {currentView === "history" ? (
          <HistoryView />
        ) : currentView === "month" ? (
          <div ref={monthListRef}>
            {monthGroups.map((g) => (
              <section key={g.month} className="py-1">
                <header className="flex items-baseline gap-2 px-2 py-1.5">
                  <span className="text-sm font-semibold text-[var(--text)]">
                    {formatMonth(g.month, language)}
                  </span>
                  <span className="text-xs text-[var(--text-faint)]">
                    {g.items.length} {t("month.tasks")}
                  </span>
                </header>
                {g.items.map((task) => {
                  const hasChildren = tasks.some((child) => child.parentTaskId === task.id);
                  return (
                    <div
                      key={task.id}
                      data-task-id={task.id}
                      tabIndex={-1}
                      className={`group flex items-start gap-2 rounded px-2 py-[3px] hover:bg-[var(--bg-hover)] ${
                        task.id === lastCreatedTaskId ? "task-new" : ""
                      }`}
                    >
                      <button
                        onClick={() => completeTask(task.id)}
                        disabled={hasChildren}
                        className={`checkbox mt-[5px] ${hasChildren ? "opacity-40" : ""}`}
                        title={hasChildren ? t("task.completeSubtasks") : t("task.complete")}
                        aria-label={t("task.complete")}
                      >
                        <span className="dot" />
                      </button>
                      <div className="mono min-w-0 flex-1 text-[0.8125rem] leading-[1.6] text-[var(--text)]">
                        <span className="text-[var(--text-faint)]">
                          {yyyymmdd(task.createdAt)}_{codeOf(task)} |{" "}
                        </span>
                        {task.content}
                      </div>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
            <SortableContext
              items={grouped.map((g) => `proj-${g.project.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {visible.map((g) => (
                <ProjectSection key={g.project.id} project={g.project} roots={g.roots} />
              ))}
            </SortableContext>

            {grouped.length === 0 && (
              <div className="px-6 py-12 text-center text-sm text-[var(--text-faint)]">
                {t("central.empty")}
                <br />
                {t("central.emptyHint")}
              </div>
            )}
          </DndContext>
        )}
      </div>

      <TaskInput />
    </div>
  );
}
