import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2, CornerUpLeft, FolderInput } from "lucide-react";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";
import type { TaskNode } from "../utils/tasks";
import { yyyymmdd } from "../utils/format";
import Dialog from "./Dialog";

const TASK_INDENT = 32;

interface DragProps {
  setNodeRef: (el: HTMLElement | null) => void;
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown> | undefined;
  style: CSSProperties;
  isDragging: boolean;
}

interface RowProps {
  node: TaskNode;
  depth: number;
  dragProps?: DragProps;
}

function HighlightedContent({ text }: { text: string }) {
  const parts = text.split(/(#[\p{L}\p{N}_/-]+)/gu);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("#") ? (
          <span key={i} className="text-[var(--accent)]">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function TaskRow({ node, depth, dragProps }: RowProps) {
  const t = useT();
  const task = node.task;
  const completeTask = useAppStore((s) => s.completeTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const updateTask = useAppStore((s) => s.updateTask);
  const createTask = useAppStore((s) => s.createTask);
  const setTaskParent = useAppStore((s) => s.setTaskParent);
  const moveTask = useAppStore((s) => s.moveTask);
  const projects = useAppStore((s) => s.projects);
  const lastCreatedTaskId = useAppStore((s) => s.lastCreatedTaskId);
  const rowRef = useRef<HTMLDivElement>(null);
  const completingRef = useRef(false);
  const childSubmitting = useRef(false);
  const childCancelled = useRef(false);
  const [savingChild, setSavingChild] = useState(false);
  const hasChildren = node.children.length > 0;

  useEffect(() => {
    if (task.id !== lastCreatedTaskId) return;
    const frame = window.requestAnimationFrame(() => {
      rowRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
      rowRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [task.id, lastCreatedTaskId]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.content);
  const [addingChild, setAddingChild] = useState(false);
  const [childDraft, setChildDraft] = useState("");
  const [completing, setCompleting] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);

  const handleComplete = async () => {
    if (hasChildren || completingRef.current) return;
    completingRef.current = true;
    setCompleting(true);
    try {
      const completed = await completeTask(task.id);
      if (!completed) setCompleting(false);
    } catch {
      setCompleting(false);
    } finally {
      completingRef.current = false;
    }
  };

  const confirmDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const deleted = await deleteTask(task.id);
    setDeleting(false);
    if (deleted) setDeleteOpen(false);
    else setDeleteError(t("task.deleteError"));
  };

  const saveEdit = () => {
    const next = draft.trim();
    if (next && next !== task.content) {
      updateTask(task.id, next);
    }
    setEditing(false);
  };

  const submitChild = async () => {
    if (childSubmitting.current || childCancelled.current) return;
    const content = childDraft.trim();
    if (!content) {
      childCancelled.current = true;
      setChildDraft("");
      setAddingChild(false);
      return;
    }
    childSubmitting.current = true;
    setSavingChild(true);
    try {
      const created = await createTask({
        projectId: task.projectId,
        classifier: task.classifier,
        parentTaskId: task.id,
        content,
      });
      if (created) {
        childCancelled.current = true;
        setChildDraft("");
        setAddingChild(false);
      }
    } catch {
      // Preserve the draft for retry.
    } finally {
      childSubmitting.current = false;
      setSavingChild(false);
    }
  };

  return (
    <div
      className={`${completing ? "pointer-events-none" : ""} transition-opacity duration-200 ${
        completing ? "opacity-0" : "opacity-100"
      }`}
    >
      <div
        ref={(element) => {
          rowRef.current = element;
          dragProps?.setNodeRef(element);
        }}
        data-task-id={task.id}
        tabIndex={-1}
        style={{
          ...dragProps?.style,
          marginLeft: depth * TASK_INDENT,
          ...(depth > 0
            ? {
                borderLeft: "2px solid var(--border-strong)",
                paddingLeft: 10,
              }
            : {}),
        }}
        className={`group flex items-start gap-2 px-2 py-[3px] hover:bg-[var(--bg-hover)] ${
          depth > 0 ? "rounded-r" : "rounded"
        } ${task.id === lastCreatedTaskId ? "task-new" : ""} ${
          dragProps?.isDragging ? "opacity-40" : ""
        }`}
      >
        {dragProps ? (
          <button
            type="button"
            {...dragProps.attributes}
            {...dragProps.listeners}
            aria-label={t("task.move")}
            className="mt-[5px] touch-none cursor-grab text-[var(--text-faint)] opacity-0 transition group-hover:opacity-100 focus:opacity-100"
          >
            <GripVertical size={13} />
          </button>
        ) : (
          // Reserve the root row's drag-handle width so the first child's
          // checkbox is visibly indented, not just its row container.
          <span aria-hidden="true" className="mt-[5px] w-[13px] shrink-0" />
        )}

        <button
          onClick={handleComplete}
          disabled={hasChildren || completing}
          className={`checkbox mt-[5px] ${hasChildren ? "opacity-40" : ""}`}
          title={hasChildren ? t("task.completeSubtasks") : t("task.complete")}
          aria-label={t("task.complete")}
        >
          <span className="dot" />
        </button>

        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              aria-label={t("task.edit")}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={saveEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") setEditing(false);
              }}
              className="mono w-full bg-transparent text-[0.8125rem] text-[var(--text)] outline-none"
            />
          ) : (
            <button
              onClick={() => {
                setDraft(task.content);
                setEditing(true);
              }}
              className="mono w-full cursor-text text-left text-[0.8125rem] leading-[1.6] text-[var(--text)]"
            >
              <span className="inline-flex items-center gap-1 align-middle">
                <span className="rounded bg-[var(--bg-active)] px-1.5 py-px text-[0.625rem] font-medium text-[var(--text-dim)]">
                  {yyyymmdd(task.createdAt)}
                </span>
                <span className="rounded bg-[var(--accent-dim)] px-1.5 py-px text-[0.625rem] font-semibold text-[var(--accent)]">
                  {task.classifier ?? ""}
                </span>
              </span>
              <span className="ml-2">
                <HighlightedContent text={task.content} />
              </span>
            </button>
          )}
        </div>

        <div
          className={`relative mt-[2px] flex items-center gap-0.5 transition ${
            moveOpen ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"
          }`}
        >
          {depth > 0 && (
            <button
              type="button"
              onClick={() => setTaskParent(task.id, null)}
              title={t("task.outdent")}
              aria-label={t("task.outdent")}
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--bg-active)] hover:text-[var(--text)]"
            >
              <CornerUpLeft size={13} />
            </button>
          )}
          <button
            type="button"
            disabled={savingChild}
            onClick={() => {
              if (childSubmitting.current) return;
              childCancelled.current = addingChild;
              setAddingChild((v) => !v);
            }}
            title={t("task.addSubtask")}
            aria-label={t("task.addSubtask")}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--bg-active)] hover:text-[var(--text)]"
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            onClick={() => setMoveOpen((v) => !v)}
            title={t("task.move")}
            aria-label={t("task.move")}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--bg-active)] hover:text-[var(--text)]"
          >
            <FolderInput size={13} />
          </button>
          <button
            type="button"
            onClick={() => { setDeleteError(null); setDeleteOpen(true); }}
            title={t("task.delete")}
            aria-label={t("task.delete")}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--bg-active)] hover:text-[var(--danger)]"
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>

          {moveOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-xl">
              {projects
                .filter((p) => p.id !== task.projectId)
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      moveTask(task.id, p.id);
                      setMoveOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.75rem] text-[var(--text)] hover:bg-[var(--bg-hover)]"
                  >
                    <span className="truncate text-[var(--text-dim)]">{p.label}</span>
                  </button>
                ))}
              {projects.filter((p) => p.id !== task.projectId).length === 0 && (
                <div className="px-2.5 py-1.5 text-[0.75rem] text-[var(--text-faint)]">
                  {t("task.noOtherProjects")}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {addingChild && (
        <div
          className="flex items-center gap-2 border-l-2 border-[var(--border-strong)] py-[3px]"
          style={{ marginLeft: (depth + 1) * TASK_INDENT, paddingLeft: 10 }}
        >
          <input
            autoFocus
            aria-label={t("task.subtaskPlaceholder")}
            value={childDraft}
            readOnly={savingChild}
            onChange={(e) => setChildDraft(e.target.value)}
            onBlur={submitChild}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || childSubmitting.current) return;
              if (e.key === "Enter") {
                e.preventDefault();
                void submitChild();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                childCancelled.current = true;
                setChildDraft("");
                setAddingChild(false);
              }
            }}
            placeholder={t("task.subtaskPlaceholder")}
            className="mono flex-1 bg-transparent text-[0.8125rem] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />
        </div>
      )}

      {deleteOpen && (
        <Dialog
          open
          onClose={() => { if (!deleting) setDeleteOpen(false); }}
          label={t("task.deleteTitle")}
          className="w-[380px] max-w-full p-4"
          initialFocusRef={deleteCancelRef}
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--danger)]/15 text-[var(--danger)]">
              <Trash2 size={16} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[var(--text)]">{t("task.deleteTitle")}</h2>
              <p className="mt-1 truncate text-[0.8125rem] font-medium text-[var(--accent)]">{task.content}</p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[var(--text-dim)]">
            {hasChildren ? t("task.deleteWarningChildren") : t("task.deleteWarning")}
          </p>
          {deleteError && <p role="alert" className="mt-2 text-xs text-[var(--danger)]">{deleteError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button
              ref={deleteCancelRef}
              type="button"
              disabled={deleting}
              onClick={() => setDeleteOpen(false)}
              className="rounded px-3 py-1.5 text-[0.8125rem] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-50"
            >
              {t("task.deleteCancel")}
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => { void confirmDelete(); }}
              className="rounded bg-[var(--danger)] px-3 py-1.5 text-[0.8125rem] font-medium text-white disabled:opacity-50"
            >
              {deleting ? t("task.deleting") : t("task.deleteConfirm")}
            </button>
          </div>
        </Dialog>
      )}

      {node.children.map((child) => (
        <TaskItem
          key={child.task.id}
          node={child}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

export function TaskItem({ node, depth }: Omit<RowProps, "dragProps">) {
  return <TaskRow node={node} depth={depth} />;
}

export function SortableTaskItem({ node }: { node: TaskNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.task.id });

  const dragProps: DragProps = {
    setNodeRef,
    attributes: attributes as unknown as Record<string, unknown>,
    listeners: listeners as unknown as Record<string, unknown>,
    style: { transform: CSS.Transform.toString(transform), transition },
    isDragging,
  };

  return <TaskRow node={node} depth={0} dragProps={dragProps} />;
}
