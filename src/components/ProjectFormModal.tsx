import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";
import Dialog from "./Dialog";

const COLORS: (string | null)[] = [
  null,
  "#7b9bff",
  "#ff7b7b",
  "#6bd491",
  "#ffd37b",
  "#d37bff",
  "#7bffff",
  "#ff9bd3",
];

export default function ProjectFormModal() {
  const t = useT();
  const open = useAppStore((s) => s.projectFormOpen);
  const setOpen = useAppStore((s) => s.setProjectFormOpen);
  const createProject = useAppStore((s) => s.createProject);

  const [label, setLabel] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setLabel("");
      setColor(null);
    }
  }, [open]);

  if (!open) return null;

  const canSubmit = label.trim().length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    await createProject(label.trim(), color);
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      label={t("projectForm.title")}
      className="w-[400px] max-w-full"
      initialFocusRef={labelRef}
    >
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <span className="text-sm font-semibold text-[var(--text)]">{t("projectForm.title")}</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("title.close")}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-4 px-4 py-4">
          <label className="block">
            <span className="mb-1 block text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              {t("projectForm.name")}
            </span>
            <input
              ref={labelRef}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder={t("projectForm.namePlaceholder")}
              className="w-full rounded border border-[var(--border-strong)] bg-[var(--bg)] px-2.5 py-2 text-[0.8125rem] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              {t("projectForm.color")}
            </span>
            <div className="flex items-center gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c ?? "none"}
                  type="button"
                  onClick={() => setColor(c)}
                  title={c ?? t("projectForm.noColor")}
                  aria-label={c ? `${t("projectForm.color")}: ${c}` : t("projectForm.noColor")}
                  aria-pressed={color === c}
                  className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition ${
                    color === c ? "border-[var(--text)]" : "border-transparent"
                  }`}
                  style={{ background: c ?? "transparent" }}
                >
                  {c === null && (
                    <span className="text-[0.625rem] text-[var(--text-faint)]">✕</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded px-3 py-1.5 text-[0.8125rem] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            {t("projectForm.cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-[0.8125rem] font-medium text-white disabled:opacity-40"
          >
            {t("projectForm.create")}
          </button>
        </footer>
    </Dialog>
  );
}
