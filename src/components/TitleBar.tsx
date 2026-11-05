import { useEffect, useState } from "react";
import {
  Moon,
  Sun,
  FileDown,
  FileUp,
  Search,
  Settings,
  Minus,
  Square,
  Copy,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";
import { api } from "../api";

const appWindow = getCurrentWindow();

function parentDir(path: string): string | null {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return cut > 2 ? path.slice(0, cut) : null;
}

function rememberDir(path: string) {
  const dir = parentDir(path);
  if (!dir) return;
  try {
    localStorage.setItem("meyaj-last-dir", dir);
  } catch {
    // Storage disabled: the picker simply opens at its default folder.
  }
}

export default function TitleBar() {
  const t = useT();
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const importMarkdown = useAppStore((s) => s.importMarkdown);
  const setError = useAppStore((s) => s.setError);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const setFilePicker = useAppStore((s) => s.setFilePicker);
  const activePanelId = useAppStore((s) => s.activePanelId);

  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    appWindow.isMaximized().then(setMaximized).catch(() => {});
  }, []);

  const importFromPath = async (path: string) => {
    if (!useAppStore.getState().activePanelId) {
      setError(t("title.importNoPanel"));
      return;
    }
    const content = await api.readTextFile(path);
    await importMarkdown(content);
    rememberDir(path);
  };

  // Dropping a file bypasses the native picker, which is the reliable path when
  // the Windows file dialog is slow on a machine with a busy search index.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const [path] = event.payload.paths;
        if (!path) return;
        importFromPath(path).catch((e) => setError(String(e)));
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const handleImport = () => {
    if (!activePanelId) {
      setError(t("title.importNoPanel"));
      return;
    }
    setFilePicker({ mode: "open", extensions: ["md", "markdown", "txt"] });
  };

  const handleExport = () => {
    if (!activePanelId) {
      setError(t("export.noPanel"));
      return;
    }
    setFilePicker({ mode: "save", extensions: ["md"], defaultName: "meyaj.md" });
  };

  const toggleMaximize = async () => {
    await appWindow.toggleMaximize();
    setMaximized(await appWindow.isMaximized());
  };

  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 select-none items-center justify-between border-b border-[var(--border)] bg-[var(--bg-elevated)] pl-3"
    >
      <div className="flex items-center gap-2.5" data-tauri-drag-region>
        <span className="meyaj-logo" role="img" aria-label="Meyaj" data-tauri-drag-region />
        <span className="text-[0.875rem] font-semibold tracking-tight">Meyaj</span>
        <span className="text-[0.6875rem] text-[var(--text-faint)]">
          {t("app.subtitle")}
        </span>
      </div>

      <div className="flex h-full items-center">
        <button
          onClick={handleImport}
          title={t("title.importTooltip")}
          className="flex h-7 items-center gap-1.5 rounded px-2 text-xs text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          <FileDown size={14} />
          {t("title.import")}
        </button>
        <button
          onClick={handleExport}
          title={t("title.exportTooltip")}
          className="flex h-7 items-center gap-1.5 rounded px-2 text-xs text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          <FileUp size={14} />
          {t("title.export")}
        </button>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          title={t("title.searchTooltip")}
          aria-label={t("title.search")}
          className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          <Search size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title={t("title.theme")}
          aria-label={t("title.theme")}
          className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          {theme === "dark" ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title={t("title.settings")}
          aria-label={t("title.settings")}
          className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          <Settings size={14} aria-hidden="true" />
        </button>

        <div className="ml-2 flex h-full items-stretch">
          <button
            type="button"
            onClick={() => appWindow.minimize()}
            title={t("title.minimize")}
            aria-label={t("title.minimize")}
            className="flex w-10 items-center justify-center text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            <Minus size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={toggleMaximize}
            title={maximized ? t("title.restore") : t("title.maximize")}
            aria-label={maximized ? t("title.restore") : t("title.maximize")}
            className="flex w-10 items-center justify-center text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            {maximized ? <Copy size={13} aria-hidden="true" /> : <Square size={13} aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={() => appWindow.close()}
            title={t("title.close")}
            aria-label={t("title.close")}
            className="flex w-10 items-center justify-center text-[var(--text-dim)] transition hover:bg-[var(--danger)] hover:text-white"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
