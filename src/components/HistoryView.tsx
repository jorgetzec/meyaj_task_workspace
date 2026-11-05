import { useMemo, useState } from "react";
import { Check, Undo2 } from "lucide-react";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";
import { formatDate } from "../utils/format";

type SortKey = "completedAt" | "createdAt" | "project";

export default function HistoryView() {
  const t = useT();
  const history = useAppStore((s) => s.history);
  const restoreTask = useAppStore((s) => s.restoreTask);
  const [sortKey, setSortKey] = useState<SortKey>("completedAt");

  const sorted = useMemo(() => {
    const arr = [...history];
    arr.sort((a, b) => {
      if (sortKey === "project") {
        return (a.classifier ?? "").localeCompare(b.classifier ?? "");
      }
      const av = sortKey === "completedAt" ? a.completedAt : a.createdAt;
      const bv = sortKey === "completedAt" ? b.completedAt : b.createdAt;
      return bv.localeCompare(av);
    });
    return arr;
  }, [history, sortKey]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-[var(--text-dim)]">
          {history.length} {t("history.completed")}
        </span>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-2 py-1 text-[0.75rem] text-[var(--text)] outline-none"
        >
          <option value="completedAt">{t("history.sortCompleted")}</option>
          <option value="createdAt">{t("history.sortCreated")}</option>
          <option value="project">{t("history.sortProject")}</option>
        </select>
      </div>

      {sorted.length === 0 && (
        <p className="py-12 text-center text-sm text-[var(--text-faint)]">
          {t("history.empty")}
        </p>
      )}

      <ul className="space-y-0.5">
        {sorted.map((h) => (
          <li
            key={h.id}
            className="group flex items-start gap-2.5 rounded px-2 py-1.5 hover:bg-[var(--bg-hover)]"
          >
            <span className="checkbox done mt-[4px] cursor-default">
              <span className="dot" style={{ transform: "scale(1)" }} />
            </span>
            <div className="min-w-0 flex-1">
              <span className="mono text-[0.8125rem] leading-[1.5] text-[var(--text-dim)]">
                {h.snapshotContent.replace(/#[\p{L}\p{N}_/-]+/gu, "").trim()}
              </span>
              <span className="ml-2 mono rounded bg-[var(--bg-active)] px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase text-[var(--accent)]">
                {h.classifier ?? ""}
              </span>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-[0.6875rem] text-[var(--text-faint)]">
              <Check size={11} />
              {formatDate(h.completedAt)}
            </span>
            <button
              onClick={() => restoreTask(h.id)}
              title={t("history.restore")}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-faint)] opacity-0 transition hover:bg-[var(--bg-active)] hover:text-[var(--text)] group-hover:opacity-100"
            >
              <Undo2 size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
