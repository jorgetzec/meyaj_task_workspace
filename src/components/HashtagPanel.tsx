import { useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";
import type { HashtagItem } from "../types";

const MIN_W = 180;
const MAX_W = 560;

export default function HashtagPanel() {
  const t = useT();
  const hashtagGroups = useAppStore((s) => s.hashtagGroups);
  const setActivePanel = useAppStore((s) => s.setActivePanel);
  const revealTask = useAppStore((s) => s.revealTask);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [width, setWidth] = useState<number>(() => {
    const saved = localStorage.getItem("meyaj-hashtag-width");
    const n = saved ? Number(saved) : 240;
    return Number.isFinite(n) && n >= MIN_W && n <= MAX_W ? n : 240;
  });
  const widthRef = useRef(width);
  widthRef.current = width;

  const persistWidth = (next: number) => {
    const clamped = Math.min(MAX_W, Math.max(MIN_W, next));
    setWidth(clamped);
    localStorage.setItem("meyaj-hashtag-width", String(clamped));
    return clamped;
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    const onMove = (ev: PointerEvent) => {
      setWidth(Math.min(MAX_W, Math.max(MIN_W, startWidth + (startX - ev.clientX))));
    };
    const onUp = () => {
      localStorage.setItem("meyaj-hashtag-width", String(widthRef.current));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onResizeKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      persistWidth(width + (event.key === "ArrowLeft" ? 16 : -16));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      persistWidth(event.key === "Home" ? MIN_W : MAX_W);
    }
  };

  const toggle = (tag: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const openItem = async (item: HashtagItem) => {
    await setActivePanel(item.panelId);
    revealTask(item.taskId);
  };

  return (
    <aside
      className="relative flex shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-elevated)]"
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("hashtag.resize")}
        aria-valuemin={MIN_W}
        aria-valuemax={MAX_W}
        aria-valuenow={width}
        tabIndex={0}
        title={t("hashtag.resize")}
        onPointerDown={startResize}
        onKeyDown={onResizeKeyDown}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize rounded hover:bg-[var(--accent)]"
      />

      <div className="border-b border-[var(--border)] px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
            {t("hashtag.title")}
          </span>
          {hashtagGroups.length > 0 && (
            <span className="tabular-nums text-[0.625rem] text-[var(--text-faint)]">
              {hashtagGroups.length} · {hashtagGroups.reduce((total, group) => total + group.count, 0)}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-3">
        {hashtagGroups.length === 0 && (
          <p className="px-1 py-6 text-[0.6875rem] leading-relaxed text-[var(--text-faint)]">
            {t("hashtag.hint")}
          </p>
        )}

        {hashtagGroups.map((group) => {
          const isCollapsed = collapsed.has(group.tag);
          return (
            <section
              key={group.tag}
              className="mb-2 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg)] transition hover:border-[var(--border-strong)]"
            >
              <button
                onClick={() => toggle(group.tag)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-[var(--bg-hover)]"
              >
                <ChevronRight
                  size={12}
                  className={`shrink-0 text-[var(--text-faint)] transition-transform ${
                    isCollapsed ? "" : "rotate-90"
                  }`}
                />
                <span className="mono truncate text-[0.75rem] font-semibold text-[var(--accent)]">
                  #{group.tag}
                </span>
                <span className="ml-auto shrink-0 rounded-full bg-[var(--bg-active)] px-1.5 py-px tabular-nums text-[0.625rem] text-[var(--text-dim)]">
                  {group.count}
                </span>
              </button>

              {!isCollapsed && (
                <ul className="border-t border-[var(--border)] px-2.5 py-1.5">
                  {group.items.map((item) => (
                    <li key={item.taskId}>
                      <button
                        type="button"
                        onClick={() => void openItem(item)}
                        className="flex w-full items-start gap-1.5 rounded px-1 py-1 text-left text-[0.75rem] leading-snug text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                      >
                        <span aria-hidden="true" className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-[var(--text-faint)]" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            {item.classifier && (
                              <span className="mono text-[0.625rem] uppercase tracking-wide text-[var(--text-faint)]">
                                {item.classifier}
                              </span>
                            )}
                            <span className="rounded bg-[var(--bg-active)] px-1 py-px text-[0.5625rem] text-[var(--text-faint)]">
                              {item.panelTitle}
                            </span>
                          </span>
                          <span className="mt-0.5 block line-clamp-2">
                            {item.content.replace(/#[\p{L}\p{N}_/-]+/gu, "").trim()}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
