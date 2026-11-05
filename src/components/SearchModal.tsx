import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";
import Dialog from "./Dialog";

export default function SearchModal() {
  const t = useT();
  const open = useAppStore((s) => s.searchOpen);
  const setOpen = useAppStore((s) => s.setSearchOpen);
  const tasks = useAppStore((s) => s.tasks);
  const history = useAppStore((s) => s.history);

  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  if (!open) return null;

  const q = query.trim().toLowerCase();

  const activeMatches = q
    ? tasks.filter((t) => t.content.toLowerCase().includes(q))
    : [];
  const historyMatches = q
    ? history.filter((h) => h.snapshotContent.toLowerCase().includes(q))
    : [];

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      label={t("search.placeholder")}
      className="w-[560px] max-w-full"
      initialFocusRef={inputRef}
    >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3">
          <Search size={15} className="shrink-0 text-[var(--text-faint)]" />
          <input
            ref={inputRef}
            type="search"
            name="search"
            aria-label={t("search.placeholder")}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            className="flex-1 bg-transparent py-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("title.close")}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-[400px] overflow-y-auto overscroll-contain p-2">
          {q === "" && (
            <div className="px-3 py-8 text-center text-sm text-[var(--text-faint)]">
              {t("search.placeholder")}
            </div>
          )}

          {q !== "" && activeMatches.length === 0 && historyMatches.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-[var(--text-faint)]">
              {t("search.empty")}
            </div>
          )}

          {activeMatches.length > 0 && (
            <>
              <div className="px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                {t("search.active")}
              </div>
              {activeMatches.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-[var(--bg-hover)]"
                >
                  <span className="mono shrink-0 text-[0.625rem] font-semibold text-[var(--accent)]">
                    {task.classifier ?? ""}
                  </span>
                  <span className="mono min-w-0 text-[0.8125rem] text-[var(--text)]">
                    {task.content}
                  </span>
                </div>
              ))}
            </>
          )}

          {historyMatches.length > 0 && (
            <>
              <div className="mt-2 px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                {t("search.history")}
              </div>
              {historyMatches.map((h) => (
                <div
                  key={h.id}
                  className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-[var(--bg-hover)]"
                >
                  <span className="mono shrink-0 text-[0.625rem] font-semibold text-[var(--accent)]">
                    {h.classifier ?? ""}
                  </span>
                  <span className="mono min-w-0 text-[0.8125rem] text-[var(--text-dim)] line-through">
                    {h.snapshotContent}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
    </Dialog>
  );
}
