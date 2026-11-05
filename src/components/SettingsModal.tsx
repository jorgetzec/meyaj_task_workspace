import { X } from "lucide-react";
import { useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";
import type { Lang, Theme } from "../types";
import { parseTheme } from "../utils/themes";
import ThemedSelect from "./ThemedSelect";
import Dialog from "./Dialog";
import { author, version } from "../../package.json";
import licenseText from "../../LICENSE?raw";
import noticeText from "../../NOTICE?raw";

const THEME_OPTIONS: { value: Theme; labelKey: string }[] = [
  { value: "dark", labelKey: "settings.themeDark" },
  { value: "light", labelKey: "settings.themeLight" },
  { value: "dracula", labelKey: "settings.themeDracula" },
  { value: "nord", labelKey: "settings.themeNord" },
];

const LANG_OPTIONS: { value: Lang; labelKey: string }[] = [
  { value: "es", labelKey: "settings.langEs" },
  { value: "en", labelKey: "settings.langEn" },
];

const MONO_FONTS: { value: string; label: string }[] = [
  { value: "", label: "Por defecto" },
  { value: '"JetBrains Mono", Consolas, monospace', label: "JetBrains Mono" },
  { value: '"Fira Code", Consolas, monospace', label: "Fira Code" },
  { value: '"Cascadia Code", Consolas, monospace', label: "Cascadia Code" },
  { value: '"IBM Plex Mono", Consolas, monospace', label: "IBM Plex Mono" },
  { value: "Consolas, monospace", label: "Consolas" },
  { value: "ui-monospace, monospace", label: "System Mono" },
  { value: '"Inter", system-ui, sans-serif', label: "Inter (sans)" },
  { value: '"Segoe UI", system-ui, sans-serif', label: "Segoe UI (sans)" },
  { value: "system-ui, sans-serif", label: "System (sans)" },
  { value: "Georgia, serif", label: "Georgia (serif)" },
];

const SANS_FONTS: { value: string; label: string }[] = [
  { value: "", label: "Por defecto" },
  { value: '"Inter", system-ui, sans-serif', label: "Inter" },
  { value: '"Segoe UI", system-ui, sans-serif', label: "Segoe UI" },
  { value: '"Roboto", system-ui, sans-serif', label: "Roboto" },
  { value: 'system-ui, sans-serif', label: "System" },
];

function inlineText(line: string): string {
  return line
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^<(.+)>$/, "$1");
}

/** Renders the shipped LICENSE and NOTICE without their Markdown markers. */
function LegalText({ text }: { text: string }) {
  return (
    <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg)] p-3 text-[0.6875rem] leading-relaxed text-[var(--text-dim)]">
      {text.split(/\r?\n/).map((raw, index) => {
        const line = inlineText(raw).trim();
        if (!line) return null;
        if (/^#{1,6}\s/.test(line)) {
          return (
            <p key={index} className="pt-1 text-[0.75rem] font-semibold text-[var(--text)]">
              {line.replace(/^#{1,6}\s*/, "")}
            </p>
          );
        }
        if (/^-{3,}$/.test(line)) {
          return <hr key={index} className="border-[var(--border)]" />;
        }
        if (line.startsWith(">")) {
          return (
            <p key={index} className="border-l-2 border-[var(--border-strong)] pl-2 italic">
              {line.replace(/^>\s?/, "")}
            </p>
          );
        }
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}

export default function SettingsModal() {
  const t = useT();
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const monoFont = useAppStore((s) => s.monoFont);
  const setMonoFont = useAppStore((s) => s.setMonoFont);
  const sansFont = useAppStore((s) => s.sansFont);
  const setSansFont = useAppStore((s) => s.setSansFont);
  const classifiers = useAppStore((s) => s.classifiers);
  const createClassifier = useAppStore((s) => s.createClassifier);
  const deleteClassifier = useAppStore((s) => s.deleteClassifier);
  const customTheme = useAppStore((s) => s.customTheme);
  const importTheme = useAppStore((s) => s.importTheme);
  const clearCustomTheme = useAppStore((s) => s.clearCustomTheme);
  const setError = useAppStore((s) => s.setError);
  const setFilePicker = useAppStore((s) => s.setFilePicker);

  const [newClassifier, setNewClassifier] = useState("");
  const themeFileInput = useRef<HTMLInputElement>(null);
  const firstThemeRef = useRef<HTMLButtonElement>(null);

  if (!open) return null;

  const addClassifier = async () => {
    const name = newClassifier.trim().toUpperCase();
    if (!name) return;
    await createClassifier(name);
    setNewClassifier("");
  };

  const importThemeContent = (content: string) => {
    const parsed = parseTheme(JSON.parse(content));
    importTheme(parsed.name || t("settings.customThemeName"), parsed.vars);
  };

  const handleImportTheme = () => {
    if (!isTauri()) {
      themeFileInput.current?.click();
      return;
    }
    setFilePicker({ mode: "theme", extensions: ["json"] });
  };

  const handleThemeFile = async (file: File) => {
    try {
      importThemeContent(await file.text());
    } catch {
      setError(t("settings.invalidTheme"));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      label={t("settings.title")}
      className="flex w-[460px] max-w-full flex-col"
      initialFocusRef={firstThemeRef}
    >
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <span className="text-sm font-semibold text-[var(--text)]">{t("settings.title")}</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("title.close")}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 space-y-5 overflow-y-auto px-4 py-4">
          <div>
            <div className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              {t("settings.theme")}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {THEME_OPTIONS.map((opt, index) => (
                <button
                  key={opt.value}
                  ref={index === 0 ? firstThemeRef : undefined}
                  type="button"
                  onClick={() => setTheme(opt.value)}
                  className={`rounded border px-3 py-2.5 text-sm transition ${
                    theme === opt.value
                      ? "border-[var(--accent)] bg-[var(--bg-active)] text-[var(--text)]"
                      : "border-[var(--border-strong)] text-[var(--text-dim)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
              {customTheme && (
                <button
                  type="button"
                  onClick={() => importTheme(customTheme.name, customTheme.vars)}
                  className={`rounded border px-3 py-2.5 text-sm transition ${
                    theme === "custom"
                      ? "border-[var(--accent)] bg-[var(--bg-active)] text-[var(--text)]"
                      : "border-[var(--border-strong)] text-[var(--text-dim)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  {customTheme.name}
                </button>
              )}
            </div>
            <input
              ref={themeFileInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void handleThemeFile(file);
              }}
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={handleImportTheme}
                className="rounded border border-[var(--border-strong)] px-3 py-1.5 text-[0.75rem] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
              >
                {t("settings.importTheme")}
              </button>
              {customTheme && (
                <button
                  type="button"
                  onClick={clearCustomTheme}
                  className="rounded border border-[var(--border-strong)] px-3 py-1.5 text-[0.75rem] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                >
                  {t("settings.clearTheme")}
                </button>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              {t("settings.typography")}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[0.6875rem] text-[var(--text-dim)]">
                  {t("settings.monoFont")}
                </span>
                <ThemedSelect
                  value={monoFont}
                  onChange={setMonoFont}
                  options={MONO_FONTS.map((font) => ({ ...font, label: font.value ? font.label : t("settings.default") }))}
                  label={t("settings.monoFont")}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[0.6875rem] text-[var(--text-dim)]">
                  {t("settings.sansFont")}
                </span>
                <ThemedSelect
                  value={sansFont}
                  onChange={setSansFont}
                  options={SANS_FONTS.map((font) => ({ ...font, label: font.value ? font.label : t("settings.default") }))}
                  label={t("settings.sansFont")}
                />
              </label>
            </div>
          </div>

          <div>
            <div className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              {t("settings.language")}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {LANG_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setLanguage(opt.value)}
                  className={`rounded border px-3 py-2.5 text-sm transition ${
                    language === opt.value
                      ? "border-[var(--accent)] bg-[var(--bg-active)] text-[var(--text)]"
                      : "border-[var(--border-strong)] text-[var(--text-dim)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              {t("settings.classifiers")}
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {classifiers.map((c) => (
                <span
                  key={c.id}
                  className="mono inline-flex items-center gap-1 rounded bg-[var(--bg-active)] px-2 py-1 text-[0.75rem] text-[var(--accent)]"
                >
                  {c.name}
                  <button
                    type="button"
                    onClick={() => deleteClassifier(c.name)}
                    title={t("task.delete")}
                    aria-label={`${t("task.delete")}: ${c.name}`}
                    className="text-[var(--text-faint)] hover:text-[var(--danger)]"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newClassifier}
                onChange={(e) => setNewClassifier(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && addClassifier()}
                aria-label={t("settings.classifierPlaceholder")}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("settings.classifierPlaceholder")}
                className="mono flex-1 rounded border border-[var(--border-strong)] bg-[var(--bg)] px-2.5 py-1.5 text-[0.75rem] uppercase text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                onClick={addClassifier}
                aria-label={t("settings.addClassifier")}
                className="rounded bg-[var(--accent)] px-3 py-1.5 text-[0.75rem] font-medium text-white"
              >
                +
              </button>
            </div>
          </div>

          <p className="text-[0.6875rem] leading-relaxed text-[var(--text-faint)]">
            {t("settings.themeFormat")}
          </p>

          <section aria-label={t("settings.about")} className="space-y-2 border-t border-[var(--border)] pt-4 text-xs text-[var(--text-dim)]">
            <h2 className="font-semibold text-[var(--text)]">Meyaj {version}</h2>
            <p>{t("settings.createdBy")} {author} · © 2026</p>
            <p className="font-medium text-[var(--text)]">PolyForm Noncommercial 1.0.0</p>
            <p>{t("settings.licenseSummary")}</p>
            <details>
              <summary className="cursor-pointer text-[var(--accent)]">{t("settings.licenseTerms")}</summary>
              <LegalText text={noticeText + "\n" + licenseText} />
            </details>
          </section>
        </div>
    </Dialog>
  );
}
