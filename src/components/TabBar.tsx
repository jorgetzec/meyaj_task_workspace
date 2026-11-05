import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";
import type { ViewKind } from "../types";

function SortableTab({ view, label, active, children }: {
  view: ViewKind;
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: view });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative flex min-w-0 shrink-0 items-center rounded text-[0.8125rem] ${
        active
          ? "bg-[var(--bg-active)] text-[var(--text)]"
          : "text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
      } ${isDragging ? "z-10 opacity-60" : ""}`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`${t("tabs.reorder")}: ${label}`}
        title={t("tabs.reorderHint")}
        className="ml-1 touch-none rounded p-0.5 text-[var(--text-faint)] cursor-grab focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 active:cursor-grabbing"
      >
        <GripVertical size={12} aria-hidden="true" />
      </button>
      {children}
    </div>
  );
}

export default function TabBar() {
  const t = useT();
  const currentView = useAppStore((s) => s.currentView);
  const setView = useAppStore((s) => s.setView);
  const tabs = useAppStore((s) => s.tabs);
  const closeTab = useAppStore((s) => s.closeTab);
  const renameTab = useAppStore((s) => s.renameTab);
  const addTab = useAppStore((s) => s.addTab);
  const reorderTabs = useAppStore((s) => s.reorderTabs);
  const [editingView, setEditingView] = useState<ViewKind | null>(null);
  const editingViewRef = useRef<ViewKind | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const addMenuId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (editingView) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [editingView]);

  useEffect(() => {
    if (!addMenuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !addMenuRef.current?.contains(event.target)) {
        setAddMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setAddMenuOpen(false);
        addButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [addMenuOpen]);

  const startRenaming = (view: ViewKind) => {
    editingViewRef.current = view;
    setEditingView(view);
    setAddMenuOpen(false);
  };

  const finishRenaming = (view: ViewKind, value: string | null) => {
    if (editingViewRef.current !== view) return;
    // Clear synchronously so a subsequent blur cannot commit a cancelled edit.
    editingViewRef.current = null;
    setEditingView(null);
    if (value !== null) renameTab(view, value.trim() || null);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const views = tabs.map((tab) => tab.view);
    const from = views.findIndex((view) => view === active.id);
    const to = views.findIndex((view) => view === over.id);
    if (from < 0 || to < 0) return;
    reorderTabs(arrayMove(views, from, to));
  };

  const viewOptions: ViewKind[] = ["all", "project", "month", "history"];
  const closedViews = viewOptions.filter((view) => !tabs.some((tab) => tab.view === view));

  return (
    <div className="flex min-w-0 items-center gap-1">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{ screenReaderInstructions: { draggable: t("tabs.reorderHint") } }}
      >
        <SortableContext items={tabs.map((tab) => tab.view)} strategy={horizontalListSortingStrategy}>
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => {
              const label = tab.label ?? t(`tabs.${tab.view}`);
              return (
                <SortableTab key={tab.view} view={tab.view} label={label} active={currentView === tab.view}>
                  {editingView === tab.view ? (
                    <input
                      ref={renameInputRef}
                      defaultValue={label}
                      aria-label={t("tabs.rename")}
                      className="w-28 min-w-0 rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                      onBlur={(event) => finishRenaming(tab.view, event.currentTarget.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.nativeEvent.isComposing) return;
                        if (event.key === "Enter" || event.key === "Escape") {
                          event.preventDefault();
                          finishRenaming(tab.view, event.key === "Enter" ? event.currentTarget.value : null);
                          requestAnimationFrame(() => {
                            document.getElementById(`${addMenuId}-${tab.view}`)?.focus();
                          });
                        }
                      }}
                    />
                  ) : (
                    <button
                      id={`${addMenuId}-${tab.view}`}
                      type="button"
                      aria-pressed={currentView === tab.view}
                      title={t("tabs.rename")}
                      onClick={() => setView(tab.view)}
                      onDoubleClick={() => startRenaming(tab.view)}
                      onKeyDown={(event) => {
                        if (event.key === "F2") {
                          event.preventDefault();
                          startRenaming(tab.view);
                        }
                      }}
                      className="min-w-0 truncate rounded px-2.5 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                    >
                      {label}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`${t("tabs.close")}: ${label}`}
                    title={t("tabs.close")}
                    disabled={tabs.length <= 1}
                    onClick={() => {
                      if (useAppStore.getState().tabs.length > 1) closeTab(tab.view);
                    }}
                    className="mr-1 rounded p-0.5 hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </SortableTab>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      <div ref={addMenuRef} className="relative shrink-0">
        <button
          ref={addButtonRef}
          type="button"
          aria-label={t("tabs.add")}
          title={t("tabs.add")}
          aria-expanded={addMenuOpen}
          aria-controls={addMenuOpen ? addMenuId : undefined}
          onClick={() => setAddMenuOpen((open) => !open)}
          className="rounded p-1 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
        >
          <Plus size={14} aria-hidden="true" />
        </button>
        {addMenuOpen && (
          <div
            id={addMenuId}
            role="group"
            aria-label={t("tabs.add")}
            className="absolute left-0 top-full z-50 mt-1 min-w-36 rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1 shadow-lg"
          >
            {closedViews.length === 0 ? (
              <p role="status" className="px-2 py-1 text-xs text-[var(--text-dim)]">{t("tabs.allOpen")}</p>
            ) : closedViews.map((view, index) => (
              <button
                key={view}
                type="button"
                autoFocus={index === 0}
                onClick={() => {
                  addTab(view);
                  setAddMenuOpen(false);
                  addButtonRef.current?.focus();
                }}
                className="block w-full rounded px-2 py-1 text-left text-[0.8125rem] text-[var(--text)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
              >
                {t(`tabs.${view}`)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
