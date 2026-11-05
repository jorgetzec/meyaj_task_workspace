import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { CornerDownLeft } from "lucide-react";
import { useAppStore } from "../stores/useAppStore";
import { parseTaskEntry, prefixForClassifier } from "../utils/format";
import { knownTags } from "../utils/hashtags";
import { getInlineSuggestion } from "../utils/autocomplete";
import { matchingProjects, normalizeProjectLabel, projectQuery } from "../utils/projects";
import type { Project } from "../types";
import { useT } from "../i18n";
import CommandPalette from "./CommandPalette";

export default function TaskInput() {
  const t = useT();
  const projects = useAppStore((s) => s.projects);
  const classifiers = useAppStore((s) => s.classifiers);
  const tasks = useAppStore((s) => s.tasks);
  const activePanelId = useAppStore((s) => s.activePanelId);
  const projectFilter = useAppStore((s) => s.projectFilter);
  const loading = useAppStore((s) => s.loading);
  const createTask = useAppStore((s) => s.createTask);
  const createProject = useAppStore((s) => s.createProject);
  const createClassifier = useAppStore((s) => s.createClassifier);

  const [value, setValue] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
    const savedDraft = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    setProjectId((current) => projects.some((p) => p.id === current) ? current : projects[0]?.id ?? null);
  }, [projects]);

  useEffect(() => {
    if (projectFilter) setProjectId(projectFilter);
  }, [projectFilter, activePanelId]);

  const classifierNames = classifiers.map((c) => c.name);
  const query = projectQuery(value);
  const projectMatches = query === null ? [] : matchingProjects(projects, query);
  const canCreate = query !== null && query !== "" && !projects.some(
    (p) => normalizeProjectLabel(p.label) === normalizeProjectLabel(query),
  );
  const suggestion = query === null
    ? getInlineSuggestion(value, caret, classifierNames, knownTags(tasks)) : null;
  const suggestions = suggestion?.matches ?? [];
  const optionCount = query === null ? suggestions.length : projectMatches.length + Number(canCreate);
  const menuOpen = focused && !dismissed && optionCount > 0;
  const activeIndex = Math.min(highlighted, Math.max(0, optionCount - 1));
  const selectedProject = projects.find((p) => p.id === projectId);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, value]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const updateValue = (text: string) => {
    setValue(text);
    setCaret(text.length);
    setHighlighted(0);
    setDismissed(false);
  };

  const handleSelectClassifier = (name: string) => {
    const draft = query !== null ? savedDraft.current ?? "" : value;
    const { content } = parseTaskEntry(draft, null);
    savedDraft.current = null;
    updateValue(prefixForClassifier(name) + content);
    setPaletteOpen(false);
    inputRef.current?.focus();
  };

  const handleCreateClassifier = async (name: string) => {
    const cls = name.trim().toUpperCase();
    if (!cls) return;
    if (await createClassifier(cls)) handleSelectClassifier(cls);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    if (text === "/") {
      updateValue("");
      setPaletteOpen(true);
      return;
    }
    if (projectQuery(text) === null) savedDraft.current = null;
    updateValue(text);
    setCaret(e.target.selectionStart ?? text.length);
  };

  const selectProject = (project: Project) => {
    setProjectId(project.id);
    if (useAppStore.getState().currentView === "project") {
      useAppStore.getState().setProjectFilter(project.id);
    }
    updateValue(savedDraft.current ?? "");
    savedDraft.current = null;
    inputRef.current?.focus();
  };

  const createFromQuery = async () => {
    if (!query || busyRef.current || !activePanelId) return;
    // Recheck the current state in case the project list changed while typing.
    const existing = useAppStore.getState().projects.find(
      (p) => normalizeProjectLabel(p.label) === normalizeProjectLabel(query),
    );
    if (existing) {
      selectProject(existing);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const project = await createProject(query);
      if (project && useAppStore.getState().activePanelId === activePanelId) selectProject(project);
    } finally {
      busyRef.current = false;
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const submit = async () => {
    if (busyRef.current || !activePanelId) return;
    if (query !== null) {
      if (projectMatches.length > 0) selectProject(projectMatches[0]);
      else await createFromQuery();
      return;
    }
    const text = value.trim();
    if (!text) return;
    const { classifier, content } = parseTaskEntry(text, null);
    if (!content) return;
    busyRef.current = true;
    setBusy(true);
    let created = false;
    try {
      const success = await createTask({ projectId: selectedProject?.id ?? null, classifier, content, parentTaskId: null });
      created = success;
      if (success && useAppStore.getState().activePanelId === activePanelId) updateValue("");
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (!created) requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const accept = (index: number) => {
    if (query !== null) {
      const project = projectMatches[index];
      if (project) selectProject(project);
      else if (canCreate) void createFromQuery();
      return;
    }
    const match = suggestions[index];
    if (!suggestion || !match) return;
    const suffix = value.slice(caret);
    const text = suggestion.kind === "classifier"
      ? match + " | " + suffix
      : value.slice(0, suggestion.start) + "#" + match + " " + suffix;
    const position = text.length - suffix.length;
    updateValue(text);
    setCaret(position);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(position, position);
    });
  };

  return (
    <>
      <div className="relative flex items-center gap-2 border-t border-[var(--border)] px-3 py-2.5">
        <button
          type="button"
          title={t("task.chooseProject")}
          aria-label={`${t("task.chooseProject")}: ${selectedProject?.label ?? t("central.chooseProject")}`}
          disabled={busy || loading || !activePanelId}
          onClick={() => {
                      if (query === null) savedDraft.current = value;
                      updateValue("#");
                      inputRef.current?.focus();
                    }}
          className="max-w-[160px] shrink-0 truncate rounded bg-[var(--bg-hover)] px-2 py-1 text-[0.75rem] text-[var(--accent)] disabled:opacity-50"
        >
          # {selectedProject?.label ?? t("central.chooseProject")}
        </button>
        <span className="text-[var(--text-faint)]" aria-hidden="true"><CornerDownLeft size={14} /></span>
        <input
          ref={inputRef}
          role="combobox"
          aria-label={t("task.input")}
          aria-autocomplete="list"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? listId : undefined}
          aria-activedescendant={menuOpen ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          value={value}
          disabled={busy || loading || !activePanelId}
          onChange={handleChange}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? value.length)}
          onFocus={() => { setFocused(true); setDismissed(false); }}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (menuOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setHighlighted((activeIndex + (e.key === "ArrowDown" ? 1 : -1) + optionCount) % optionCount);
            } else if (menuOpen && (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey))) {
              e.preventDefault();
              accept(activeIndex);
            } else if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              if (savedDraft.current !== null) {
                updateValue(savedDraft.current);
                savedDraft.current = null;
              } else if (menuOpen) setDismissed(true);
              else updateValue("");
              setPaletteOpen(false);
            }
          }}
          placeholder={t("task.placeholder")}
          className="mono min-w-0 flex-1 bg-transparent text-[0.8125rem] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] disabled:opacity-50"
        />

        {menuOpen && (
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={query !== null ? t("task.chooseProject") : t("task.suggestions")}
            className="absolute bottom-full left-3 right-3 z-20 mb-1 max-h-64 overflow-y-auto rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1 shadow-xl"
          >
            {(query !== null
              ? [...projectMatches.map((p) => ({ key: p.id, label: `# ${p.label}` })), ...(canCreate ? [{ key: "__create__", label: `${t("task.createProject")} «${query}»` }] : [])]
              : suggestions.map((match) => ({ key: match, label: suggestion?.kind === "hashtag" ? `#${match}` : match }))
            ).map((option, index) => (
              <button
                key={option.key}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => accept(index)}
                onMouseEnter={() => setHighlighted(index)}
                className={`mono flex w-full items-center rounded px-2.5 py-1.5 text-left text-[0.75rem] text-[var(--accent)] ${index === activeIndex ? "bg-[var(--bg-active)]" : "hover:bg-[var(--bg-hover)]"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <CommandPalette
        open={paletteOpen}
        classifiers={classifierNames}
        onSelect={handleSelectClassifier}
        onCreateClassifier={handleCreateClassifier}
        onClose={() => setPaletteOpen(false)}
      />
    </>
  );
}
