import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";
import { api } from "../api";
import type { PanelState, Project, Task } from "../types";
import { formatDate } from "../utils/format";
import ThemedSelect from "./ThemedSelect";

const DAY_MS = 86_400_000;

interface Bar {
  task: Task;
  project: Project;
  start: number;
  end: number;
}

const UNASSIGNED: Project = {
  id: "",
  label: "",
  colorAccent: null,
  icon: null,
  sortOrder: 0,
  panelId: "",
};

function tickLabel(ms: number): string {
  const date = new Date(ms);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

/**
 * Activity timeline: one bar per task from its creation date to its completion
 * date (or today while open), grouped by project and colored by project.
 */
export default function GanttView() {
  const t = useT();
  const panels = useAppStore((s) => s.panels);
  const activePanelId = useAppStore((s) => s.activePanelId);
  const activeTasks = useAppStore((s) => s.tasks);
  const activeProjects = useAppStore((s) => s.projects);
  const [panelId, setPanelId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<PanelState | null>(null);

  const effectivePanelId =
    panelId ?? activePanelId ?? panels.find((panel) => !panel.archived)?.id ?? null;
  const isActive = effectivePanelId === activePanelId;
  const tasks = isActive ? activeTasks : loaded?.tasks ?? [];
  const projects = isActive ? activeProjects : loaded?.projects ?? [];

  useEffect(() => {
    if (!panelId && activePanelId) setPanelId(activePanelId);
  }, [activePanelId, panelId]);

  useEffect(() => {
    if (effectivePanelId && !isActive) {
      let cancelled = false;
      api
        .loadState(effectivePanelId)
        .then((state) => {
          if (!cancelled) setLoaded(state);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
  }, [effectivePanelId, isActive]);

  const { min, max, bars } = useMemo(() => {
    const now = Date.now();
    let domainMin = now;
    let domainMax = now;
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const list: Bar[] = [];

    for (const task of tasks) {
      const start = task.createdAt ? new Date(task.createdAt).getTime() : NaN;
      if (Number.isNaN(start)) continue;
      const end = task.completedAt ? new Date(task.completedAt).getTime() : now;
      const project = task.projectId ? projectById.get(task.projectId) : undefined;
      list.push({
        task,
        project: project ?? UNASSIGNED,
        start,
        end: Math.max(end, start + DAY_MS),
      });
      domainMin = Math.min(domainMin, start);
      domainMax = Math.max(domainMax, end);
    }

    const minDay = Math.floor(domainMin / DAY_MS) * DAY_MS;
    const maxDay = Math.ceil(domainMax / DAY_MS) * DAY_MS;
    return { min: minDay, max: maxDay, bars: list };
  }, [tasks, projects]);

  const rows = useMemo(() => {
    const byProject = new Map<string, Bar[]>();
    for (const bar of bars) {
      const key = bar.project.id || "__unassigned__";
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(bar);
    }

    const ordered = [...projects].sort((a, b) => a.sortOrder - b.sortOrder);
    const result = ordered
      .filter((project) => byProject.has(project.id))
      .map((project) => ({ project, bars: byProject.get(project.id)! }));

    if (byProject.has("__unassigned__")) {
      result.push({
        project: { ...UNASSIGNED, label: t("gantt.unassigned") },
        bars: byProject.get("__unassigned__")!,
      });
    }
    return result;
  }, [bars, projects, t]);

  const span = Math.max(max - min, DAY_MS);
  const x = (value: number) => ((value - min) / span) * 100;

  const ticks = useMemo(() => {
    const dayCount = span / DAY_MS;
    const step =
      dayCount <= 14 ? DAY_MS : dayCount <= 62 ? 7 * DAY_MS : dayCount <= 366 ? 30 * DAY_MS : 90 * DAY_MS;
    const start = Math.floor(min / step) * step;
    const list: number[] = [];
    for (let value = start; value <= max; value += step) list.push(value);
    return list;
  }, [min, max, span]);

  const panelOptions = panels
    .filter((panel) => !panel.archived)
    .map((panel) => ({ value: panel.id, label: panel.title }));

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <span className="text-xs text-[var(--text-dim)]">{t("gantt.panel")}</span>
        <ThemedSelect
          value={effectivePanelId ?? ""}
          options={panelOptions}
          onChange={(value) => setPanelId(value || null)}
          label={t("gantt.panel")}
        />
      </div>

      {bars.length === 0 ? (
        <p className="px-3 py-8 text-sm text-[var(--text-faint)]">{t("gantt.empty")}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="min-w-[640px]">
            <div className="flex border-b border-[var(--border)]">
              <div className="w-44 shrink-0" />
              <div className="relative h-6 flex-1">
                {ticks.map((tick) => (
                  <span
                    key={tick}
                    className="absolute top-0 -translate-x-1/2 text-[0.625rem] text-[var(--text-faint)]"
                    style={{ left: `${x(tick)}%` }}
                  >
                    {tickLabel(tick)}
                  </span>
                ))}
              </div>
            </div>

            {rows.map((row) => (
              <div key={row.project.id || "__unassigned__"} className="flex border-b border-[var(--border)]">
                <div className="flex w-44 shrink-0 items-center gap-2 px-2 py-1">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: row.project.colorAccent ?? "var(--text-faint)" }}
                  />
                  <span className="truncate text-xs text-[var(--text-dim)]">
                    {row.project.label}
                  </span>
                </div>
                <div className="relative h-8 flex-1">
                  {row.bars.map((bar) => (
                    <div
                      key={bar.task.id}
                      title={`${row.project.label} — ${bar.task.content} (${formatDate(bar.task.createdAt)} → ${
                        bar.task.completedAt ? formatDate(bar.task.completedAt) : t("gantt.today")
                      })`}
                      className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-sm ${
                        bar.task.completedAt ? "" : "border border-[var(--border-strong)] opacity-70"
                      }`}
                      style={{
                        left: `${x(bar.start)}%`,
                        width: `${Math.max(((bar.end - bar.start) / span) * 100, 0.6)}%`,
                        background: row.project.colorAccent ?? "var(--accent)",
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
