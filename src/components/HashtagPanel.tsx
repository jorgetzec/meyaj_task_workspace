import { useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";
import { hashtagCounts } from "../utils/format";

const MIN_W = 180;
const MAX_W = 560;

export default function HashtagPanel() {
  const t = useT();
  const tasks = useAppStore((s) => s.tasks);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [width, setWidth] = useState<number>(() => {
    const saved = localStorage.getItem("meyaj-hashtag-width");
    const n = saved ? Number(saved) : 240;
    return Number.isFinite(n) && n >= MIN_W && n <= MAX_W ? n : 240;
  });
  const widthRef = useRef(width);
  widthRef.current = width;

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    const onMove = (ev: PointerEvent) => {
      const next = startWidth + (startX - ev.clientX);
      setWidth(Math.min(MAX_W, Math.max(MIN_W, next)));
    };
    const onUp = () => {
      localStorage.setItem("meyaj-hashtag-width", String(widthRef.current));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const counts = useMemo(() => hashtagCounts(tasks), [tasks]);

  const toggle = (tag: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  return (
    <aside
      className="relative flex shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-elevated)]"
      style={{ width }}
    >
      <div
        onPointerDown={startResize}
        title="Ajustar ancho"
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-[var(--accent)]"
      />

      <div className="border-b border-[var(--border)] px-3 py-2">
        <span className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
          {t("hashtag.title")}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {counts.length === 0 && (
          <p className="px-2 py-4 text-xs text-[var(--text-faint)]">
            {t("hashtag.hint")}
          </p>
        )}

        {counts.map(([tag, count]) => {
          const items = tasks.filter((t) => t.hashtags.includes(tag));
          const isCollapsed = collapsed.has(tag);
          return (
            <div key={tag} className="mb-0.5">
              <button
                onClick={() => toggle(tag)}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
              >
                <ChevronRight
                  size={13}
                  className={`shrink-0 text-[var(--text-faint)] transition-transform ${
                    isCollapsed ? "" : "rotate-90"
                  }`}
                />
                <span className="mono text-[0.75rem] font-semibold text-[var(--accent)]">
                  #{tag}
                </span>
                <span className="ml-auto text-[0.6875rem] text-[var(--text-faint)]">{count}</span>
              </button>

              {!isCollapsed && (
                <ul className="ml-5 border-l border-[var(--border)] pl-2">
                  {items.map((t) => (
                    <li key={t.id} className="py-1 text-[0.75rem] leading-snug text-[var(--text-dim)]">
                      <span className="mono text-[0.625rem] text-[var(--text-faint)]">
                        {t.classifier ? `${t.classifier} | ` : ""}
                      </span>
                      {t.content.replace(/#[\p{L}\p{N}_/-]+/gu, "").trim()}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
