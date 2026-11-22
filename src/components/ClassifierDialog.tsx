import { useState } from "react";
import { X } from "lucide-react";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";
import Dialog from "./Dialog";

/** Manages global classifiers (task types) from the main UI. */
export default function ClassifierDialog() {
  const t = useT();
  const open = useAppStore((s) => s.classifiersOpen);
  const setOpen = useAppStore((s) => s.setClassifiersOpen);
  const classifiers = useAppStore((s) => s.classifiers);
  const createClassifier = useAppStore((s) => s.createClassifier);
  const deleteClassifier = useAppStore((s) => s.deleteClassifier);

  const [draft, setDraft] = useState("");

  if (!open) return null;

  const add = async () => {
    const name = draft.trim().toUpperCase();
    if (!name) return;
    await createClassifier(name);
    setDraft("");
  };

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      label={t("settings.classifiers")}
      className="flex w-[360px] max-w-full flex-col"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <span className="text-sm font-semibold text-[var(--text)]">{t("settings.classifiers")}</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t("title.close")}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </header>

      <div className="flex gap-2 border-b border-[var(--border)] px-4 py-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          aria-label={t("settings.classifierPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          placeholder={t("settings.classifierPlaceholder")}
          className="mono flex-1 rounded border border-[var(--border-strong)] bg-[var(--bg)] px-2.5 py-1.5 text-[0.75rem] uppercase text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={() => void add()}
          aria-label={t("settings.addClassifier")}
          className="rounded bg-[var(--accent)] px-3 py-1.5 text-[0.75rem] font-medium text-white"
        >
          +
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {classifiers.length === 0 ? (
          <p className="text-xs text-[var(--text-faint)]">{t("classifiers.empty")}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {classifiers.map((classifier) => (
              <li
                key={classifier.id}
                className="mono inline-flex items-center gap-1 rounded bg-[var(--bg-active)] px-2 py-1 text-[0.75rem] text-[var(--accent)]"
              >
                {classifier.name}
                <button
                  type="button"
                  onClick={() => void deleteClassifier(classifier.name)}
                  title={t("task.delete")}
                  aria-label={`${t("task.delete")}: ${classifier.name}`}
                  className="text-[var(--text-faint)] hover:text-[var(--danger)]"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
