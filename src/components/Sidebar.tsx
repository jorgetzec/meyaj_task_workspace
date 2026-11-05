import { useId, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  PanelLeft,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";
import type { Panel } from "../types";
import Dialog from "./Dialog";

type Editor = {
  kind: "create" | "rename";
  panelId?: string;
  originalTitle: string;
  draft: string;
  pending: boolean;
  error: string | null;
};

export default function Sidebar() {
  const t = useT();
  const panels = useAppStore((s) => s.panels);
  const activePanelId = useAppStore((s) => s.activePanelId);
  const setActivePanel = useAppStore((s) => s.setActivePanel);
  const createPanel = useAppStore((s) => s.createPanel);
  const archivePanel = useAppStore((s) => s.archivePanel);
  const renamePanel = useAppStore((s) => s.renamePanel);
  const deletePanel = useAppStore((s) => s.deletePanel);

  const [collapsed, setCollapsed] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Panel | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const archivedId = useId();
  const errorId = useId();
  const activePanels = panels.filter((p) => !p.archived);
  const archivedPanels = panels.filter((p) => p.archived);


  const askToDelete = (panel: Panel) => {
    if (panels.length <= 1) return;
    setDeleteError(null);
    setDeleting(false);
    setDeleteTarget(panel);
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    const panelId = deleteTarget.id;
    setDeleting(true);
    setDeleteError(null);
    const deleted = await deletePanel(panelId);
    setDeleting(false);
    if (!deleted) {
      setDeleteError(t("sidebar.deleteError"));
      return;
    }
    if (editorRef.current?.panelId === panelId) updateEditor(null);
    setDeleteTarget(null);
  };

  const updateEditor = (next: Editor | null) => {
    // Blur can follow Enter/Escape before React renders the new state.
    editorRef.current = next;
    setEditor(next);
  };

  const beginEditing = (kind: Editor["kind"], panelId?: string, title = "") => {
    if (editorRef.current) return;
    updateEditor({ kind, panelId, originalTitle: title, draft: title, pending: false, error: null });
  };

  const submit = async () => {
    const current = editorRef.current;
    if (!current || current.pending) return;
    const name = current.draft.trim();
    if (!name) {
      if (current.kind === "create") updateEditor(null);
      else updateEditor({ ...current, error: t("sidebar.renameEmpty") });
      return;
    }
    if (current.kind === "rename" && name === current.originalTitle) {
      updateEditor(null);
      return;
    }

    const pending = { ...current, pending: true, error: null };
    updateEditor(pending);
    try {
      if (current.kind === "rename") {
        const renamed = await renamePanel(current.panelId!, name);
        if (!renamed) {
          updateEditor({ ...current, error: t("sidebar.renameError") });
          return;
        }
      } else {
        if (!await createPanel(name)) {
          updateEditor({ ...current, error: t("sidebar.createError") });
          return;
        }
      }
      updateEditor(null);
    } catch (error) {
      updateEditor({ ...current, error: String(error) });
    }
  };

  const renderInput = () => editor && (
    <div className="min-w-0 flex-1">
      <input
        autoFocus
        aria-label={t(editor.kind === "rename" ? "sidebar.rename" : "sidebar.panelName")}
        aria-invalid={!!editor.error}
        aria-describedby={editor.error ? errorId : undefined}
        aria-busy={editor.pending}
        readOnly={editor.pending}
        value={editor.draft}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const current = editorRef.current;
          if (current && !current.pending) {
            updateEditor({ ...current, draft: e.target.value, error: null });
          }
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            void submit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (!editorRef.current?.pending) updateEditor(null);
          }
        }}
        onBlur={() => { void submit(); }}
        placeholder={t("sidebar.panelName")}
        className="w-full rounded border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1.5 text-[0.8125rem] outline-none focus:border-[var(--accent)]"
      />
      {editor.error && (
        <p id={errorId} role="alert" className="px-2 py-1 text-xs text-[var(--text-dim)]">
          {editor.error}
        </p>
      )}
    </div>
  );

  const renderPanel = (p: (typeof panels)[number]) => {
    const active = p.id === activePanelId;
    const renaming = editor?.kind === "rename" && editor.panelId === p.id;
    const archiveLabel = t(p.archived ? "sidebar.unarchive" : "sidebar.archive");
    return (
      <div
        key={p.id}
        draggable={false}
        className={`group flex items-center gap-1 rounded transition ${
          active ? "bg-[var(--bg-active)]" : "hover:bg-[var(--bg-hover)]"
        }`}
      >
        {renaming ? renderInput() : (
          <>
            <button
              type="button"
              draggable={false}
              aria-current={active ? "true" : undefined}
              title={t("sidebar.renameHint")}
              onClick={() => setActivePanel(p.id)}
              onDoubleClick={() => beginEditing("rename", p.id, p.title)}
              onKeyDown={(e) => {
                if (e.key === "F2") {
                  e.preventDefault();
                  beginEditing("rename", p.id, p.title);
                }
              }}
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[0.8125rem]"
            >
              <span
                aria-hidden="true"
                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                  active ? "bg-[var(--accent)]" : "bg-[var(--text-faint)]"
                }`}
              />
              <span className={`truncate ${active ? "text-[var(--text)]" : "text-[var(--text-dim)]"}`}>
                {p.title}
              </span>
            </button>
            <button
              type="button"
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              onClick={() => beginEditing("rename", p.id, p.title)}
              title={t("sidebar.rename")}
              aria-label={`${t("sidebar.rename")}: ${p.title}`}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-faint)] opacity-0 transition hover:bg-[var(--bg-active)] hover:text-[var(--text)] focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <Pencil size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              onClick={() => { void archivePanel(p.id, !p.archived); }}
              title={archiveLabel}
              aria-label={`${archiveLabel}: ${p.title}`}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-faint)] opacity-0 transition hover:bg-[var(--bg-active)] hover:text-[var(--text)] focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              {p.archived ? <ArchiveRestore size={13} aria-hidden="true" /> : <Archive size={13} aria-hidden="true" />}
            </button>
            <button
              type="button"
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              disabled={panels.length <= 1}
              onClick={() => askToDelete(p)}
              title={panels.length <= 1 ? t("sidebar.deleteLast") : t("sidebar.delete")}
              aria-label={`${t("sidebar.delete")}: ${p.title}`}
              className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-faint)] opacity-0 transition hover:bg-[var(--bg-active)] hover:text-[var(--danger)] focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 disabled:cursor-not-allowed disabled:opacity-0"
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    );
  };

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-r border-[var(--border)] bg-[var(--bg-elevated)] py-2">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title={t("sidebar.expand")}
          aria-label={t("sidebar.expand")}
          className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          <PanelLeft size={15} aria-hidden="true" />
        </button>
      </aside>
    );
  }

  return (
    <>
    <aside className="flex w-52 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-elevated)]">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
          {t("sidebar.panels")}
        </h2>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title={t("sidebar.collapse")}
          aria-label={t("sidebar.collapse")}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          <PanelLeft size={13} aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {activePanels.length ? activePanels.map(renderPanel) : (
          <p className="px-2 py-2 text-xs text-[var(--text-faint)]">{t("sidebar.noActive")}</p>
        )}
        <section className="mt-3 border-t border-[var(--border)] pt-2">
          <h2>
            <button
              type="button"
              aria-expanded={showArchived}
              aria-controls={archivedId}
              title={t(showArchived ? "sidebar.hideArchived" : "sidebar.showArchived")}
              onClick={() => setShowArchived((shown) => !shown)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[var(--text-dim)] hover:bg-[var(--bg-hover)]"
            >
              {showArchived ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
              <span className="flex-1">{t("sidebar.archived")}</span>
              <span className="tabular-nums">{archivedPanels.length}</span>
            </button>
          </h2>
          <div id={archivedId} hidden={!showArchived}>
            {archivedPanels.map(renderPanel)}
          </div>
        </section>
      </div>

      <div className="border-t border-[var(--border)] p-2">
        {editor?.kind === "create" ? renderInput() : (
          <button
            type="button"
            onClick={() => beginEditing("create")}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[0.8125rem] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            <Plus size={14} aria-hidden="true" />
            {t("sidebar.newPanel")}
          </button>
        )}
      </div>
    </aside>

    {deleteTarget && (
      <Dialog
        open
        onClose={() => { if (!deleting) { setDeleteTarget(null); setDeleteError(null); } }}
        label={t("sidebar.deleteTitle")}
        className="w-[380px] max-w-full p-4"
        initialFocusRef={deleteCancelRef}
      >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--danger)]/15 text-[var(--danger)]">
              <AlertTriangle size={17} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[var(--text)]">
                {t("sidebar.deleteTitle")}
              </h2>
              <p className="mt-1 truncate text-[0.8125rem] font-medium text-[var(--accent)]">
                {deleteTarget.title}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[var(--text-dim)]">
            {t("sidebar.deleteWarning")}
          </p>
          {deleteError && (
            <p role="alert" className="mt-2 text-xs text-[var(--danger)]">
              {deleteError}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              ref={deleteCancelRef}
              type="button"
              disabled={deleting}
              onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
              className="rounded px-3 py-1.5 text-[0.8125rem] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-50"
            >
              {t("sidebar.deleteCancel")}
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => { void confirmDelete(); }}
              className="rounded bg-[var(--danger)] px-3 py-1.5 text-[0.8125rem] font-medium text-white disabled:opacity-50"
            >
              {deleting ? t("sidebar.deleteWorking") : t("sidebar.deleteConfirm")}
            </button>
          </div>
      </Dialog>
    )}
    </>
  );
}
