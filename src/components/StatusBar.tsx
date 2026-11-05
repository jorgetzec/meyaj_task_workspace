import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";

export default function StatusBar() {
  const t = useT();
  const tasks = useAppStore((s) => s.tasks);
  const history = useAppStore((s) => s.history);
  const panels = useAppStore((s) => s.panels);
  const activePanelId = useAppStore((s) => s.activePanelId);
  const error = useAppStore((s) => s.error);

  const panelTitle =
    panels.find((p) => p.id === activePanelId)?.title ?? "—";

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--bg-elevated)] px-4 text-[0.6875rem] text-[var(--text-faint)]">
      <span>
        {tasks.length} {t("status.active")} | {history.length} {t("status.completed")} |{" "}
        {t("status.panel")}: {panelTitle}
      </span>
      <span role="status" aria-live="polite" className="min-w-0 truncate text-[var(--danger)]">
        {error}
      </span>
    </footer>
  );
}
