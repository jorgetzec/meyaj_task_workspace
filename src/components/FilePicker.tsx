import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUp, FileText, Folder, Loader2, X } from "lucide-react";
import { api } from "../api";
import { useT } from "../i18n";
import { useAppStore } from "../stores/useAppStore";
import { parseTheme } from "../utils/themes";
import Dialog from "./Dialog";

interface Entry {
  name: string;
  path: string;
  isDir: boolean;
}

interface Place {
  kind: string;
  path: string;
}

const LAST_DIR_KEY = "meyaj-last-dir";

function parentOf(path: string): string | null {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (cut <= 0) return null;
  const parent = path.slice(0, cut);
  if (!parent) return null;
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}

function joinPath(dir: string, name: string): string {
  const separator = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(separator) ? `${dir}${name}` : `${dir}${separator}${name}`;
}

function matchesExtension(name: string, extensions?: string[]): boolean {
  if (!extensions || extensions.length === 0) return true;
  const lower = name.toLowerCase();
  return extensions.some((extension) => lower.endsWith(`.${extension.toLowerCase()}`));
}

/**
 * File picker implemented with plain directory reads.
 *
 * The Windows shell dialog can block for a long time while browsing folders
 * that depend on cloud providers or the search index, which froze the window.
 * Reading directories in Rust keeps the picker responsive.
 */
export default function FilePicker() {
  const t = useT();
  const request = useAppStore((s) => s.filePicker);
  const setFilePicker = useAppStore((s) => s.setFilePicker);
  const importMarkdown = useAppStore((s) => s.importMarkdown);
  const importTheme = useAppStore((s) => s.importTheme);

  const [places, setPlaces] = useState<Place[]>([]);
  const [dir, setDir] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => setFilePicker(null), [setFilePicker]);

  const navigate = useCallback(async (target: string, select?: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const list = await api.listDir(target);
      setEntries(list);
      setDir(target);
      setPathInput(target);
      setSelected(select ?? null);
      try {
        localStorage.setItem(LAST_DIR_KEY, target);
      } catch {
        // Storage disabled: the picker opens at the default folder.
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!request) return;
    let cancelled = false;

    setSelected(null);
    setError(null);
    setFileName(request.defaultName ?? "");
    setEntries([]);

    (async () => {
      let shortcuts: Place[] = [];
      try {
        shortcuts = await api.userPlaces();
      } catch {
        shortcuts = [];
      }
      if (cancelled) return;
      setPlaces(shortcuts);

      let start = "";
      try {
        start = localStorage.getItem(LAST_DIR_KEY) ?? "";
      } catch {
        start = "";
      }
      if (!start) start = shortcuts[0]?.path ?? "";
      if (start) await navigate(start);
    })();

    return () => {
      cancelled = true;
    };
  }, [request, navigate]);

  const filtered = useMemo(
    () =>
      entries.filter(
        (entry) => entry.isDir || matchesExtension(entry.name, request?.extensions),
      ),
    [entries, request?.extensions],
  );

  if (!request) return null;

  const isSave = request.mode === "save";

  const confirm = async () => {
    setError(null);
    try {
      if (isSave) {
        const name = fileName.trim();
        if (!name) {
          setError(t("picker.needName"));
          return;
        }
        const extension = request.extensions?.[0];
        const target =
          extension && !name.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
            ? `${name}.${extension}`
            : name;
        const panelId = useAppStore.getState().activePanelId;
        if (!panelId) {
          setError(t("title.importNoPanel"));
          return;
        }
        setBusy(true);
        const markdown = await api.exportMarkdown(panelId);
        await api.writeTextFile(joinPath(dir, target), markdown);
        close();
        return;
      }

      if (!selected) return;
      setBusy(true);
      const content = await api.readTextFile(selected);
      if (request.mode === "theme") {
        const parsed = parseTheme(JSON.parse(content));
        importTheme(parsed.name || t("settings.customThemeName"), parsed.vars);
      } else {
        await importMarkdown(content);
      }
      close();
    } catch (e) {
      setError(request.mode === "theme" ? t("settings.invalidTheme") : String(e));
    } finally {
      setBusy(false);
    }
  };

  const title = isSave
    ? t("picker.saveTitle")
    : request.mode === "theme"
      ? t("picker.themeTitle")
      : t("picker.openTitle");

  const up = parentOf(dir);

  return (
    <Dialog open onClose={close} label={title} className="flex w-[620px] max-w-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <span className="text-sm font-semibold text-[var(--text)]">{title}</span>
        <button
          type="button"
          onClick={close}
          aria-label={t("title.close")}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav aria-label={t("picker.places")} className="w-36 shrink-0 border-r border-[var(--border)] p-2">
          {places.map((place) => (
            <button
              key={`${place.kind}-${place.path}`}
              type="button"
              onClick={() => void navigate(place.path)}
              className={`mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition hover:bg-[var(--bg-hover)] ${
                place.path === dir ? "bg-[var(--bg-active)] text-[var(--text)]" : "text-[var(--text-dim)]"
              }`}
            >
              <Folder size={13} aria-hidden="true" />
              <span className="truncate">{t(`picker.place.${place.kind}`)}</span>
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <form
            className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border)] px-3 py-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (pathInput.trim()) void navigate(pathInput.trim());
            }}
          >
            <button
              type="button"
              onClick={() => up && void navigate(up)}
              disabled={!up}
              title={t("picker.up")}
              aria-label={t("picker.up")}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40"
            >
              <ArrowUp size={14} aria-hidden="true" />
            </button>
            <input
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              aria-label={t("picker.path")}
              spellCheck={false}
              className="h-7 min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-[0.6875rem] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </form>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {busy && entries.length === 0 && (
              <p className="flex items-center gap-2 px-2 py-3 text-xs text-[var(--text-faint)]">
                <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                {t("picker.loading")}
              </p>
            )}
            {!busy && filtered.length === 0 && (
              <p className="px-2 py-3 text-xs text-[var(--text-faint)]">{t("picker.empty")}</p>
            )}
            {filtered.map((entry) => {
              const active = entry.path === selected;
              return (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => {
                    if (entry.isDir) void navigate(entry.path);
                    else setSelected(entry.path);
                  }}
                  onDoubleClick={() => {
                    if (entry.isDir) void navigate(entry.path);
                    else void confirm();
                  }}
                  aria-current={active ? "true" : undefined}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition hover:bg-[var(--bg-hover)] ${
                    active ? "bg-[var(--bg-active)] text-[var(--text)]" : "text-[var(--text-dim)]"
                  }`}
                >
                  {entry.isDir ? (
                    <Folder size={13} className="shrink-0 text-[var(--accent)]" aria-hidden="true" />
                  ) : (
                    <FileText size={13} className="shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">{entry.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <footer className="shrink-0 border-t border-[var(--border)] px-4 py-3">
        {error && <p className="mb-2 text-xs text-[var(--danger)]">{error}</p>}
        <div className="flex items-center gap-2">
          {isSave && (
            <input
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              aria-label={t("picker.name")}
              placeholder={t("picker.name")}
              spellCheck={false}
              className="h-8 min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          )}
          {!isSave && (
            <p className="min-w-0 flex-1 truncate text-[0.6875rem] text-[var(--text-faint)]">
              {selected ? selected.split(/[\\/]/).pop() : dir}
            </p>
          )}
          <button
            type="button"
            onClick={close}
            className="rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            {t("picker.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy || (!isSave && !selected)}
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--accent-dim)] disabled:opacity-40"
          >
            {isSave ? t("picker.save") : t("picker.open")}
          </button>
        </div>
      </footer>
    </Dialog>
  );
}
