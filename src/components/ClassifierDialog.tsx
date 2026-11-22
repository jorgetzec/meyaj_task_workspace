import { useState } from "react";
import { X } from "lucide-react";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";
import { classifierColor } from "../utils/colors";
import ColorPicker from "./ColorPicker";
import Dialog from "./Dialog";

/** Manages global classifiers (task types) from the main UI. */
export default function ClassifierDialog() {
  const t = useT();
  const open = useAppStore((s) => s.classifiersOpen);
  const setOpen = useAppStore((s) => s.setClassifiersOpen);
  const classifiers = useAppStore((s) => s.classifiers);
  const createClassifier = useAppStore((s) => s.createClassifier);
  const deleteClassifier = useAppStore((s) => s.deleteClassifier);
  const setClassifierColor = useAppStore((s) => s.setClassifierColor);

  const [draft, setDraft] = useState("");
  const [colorEditor, setColorEditor] = useState<string | null>(null);

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
          <ul className="space-y-1">
            {classifiers.map((classifier) => {
              const editingColor = colorEditor === classifier.id;
              const color = classifierColor(classifier.name, classifier.colorAccent);
              return (
                <li key={classifier.id} className="rounded border border-[var(--border)] bg-[var(--bg)]">
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="mono min-w-0 flex-1 truncate text-[0.75rem] text-[var(--text)]">
                      {classifier.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setColorEditor(editingColor ? null : classifier.id)}
                      title={t("classifier.color")}
                      aria-label={`${t("classifier.color")}: ${classifier.name}`}
                      aria-expanded={editingColor}
                      className="mono rounded px-1.5 py-0.5 text-[0.625rem] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                    >
                      {classifier.colorAccent ?? t("color.auto")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteClassifier(classifier.name)}
                      title={t("task.delete")}
                      aria-label={`${t("task.delete")}: ${classifier.name}`}
                      className="text-[var(--text-faint)] hover:text-[var(--danger)]"
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </div>
                  {editingColor && (
                    <div className="border-t border-[var(--border)] px-2 py-2">
                      <ColorPicker
                        value={classifier.colorAccent}
                        onChange={(value) => void setClassifierColor(classifier.name, value)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
