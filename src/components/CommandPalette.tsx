import { useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import { Hash, FolderPlus } from "lucide-react";
import { useT } from "../i18n";

interface Props {
  open: boolean;
  classifiers: string[];
  onSelect: (name: string) => void;
  onCreateClassifier: (name: string) => void;
  onClose: () => void;
}

export default function CommandPalette({
  open,
  classifiers,
  onSelect,
  onCreateClassifier,
  onClose,
}: Props) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  if (!open) return null;

  const exact = classifiers.some(
    (c) => c.toLowerCase() === query.trim().toLowerCase(),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[16vh]"
      onMouseDown={onClose}
    >
      <div
        className="w-[520px] overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={false}>
          <Command.Input
            ref={inputRef}
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={t("palette.placeholder")}
            className="w-full border-b border-[var(--border)] bg-transparent px-4 py-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />
          <Command.List className="max-h-[320px] overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-6 text-center text-sm text-[var(--text-dim)]">
              {t("palette.empty")}
            </Command.Empty>

            {classifiers
              .filter((c) => c.toLowerCase().includes(query.trim().toLowerCase()))
              .map((c) => (
                <Command.Item
                  key={c}
                  value={c}
                  onSelect={() => onSelect(c)}
                  className="flex cursor-pointer items-center gap-2.5 rounded px-2.5 py-2 text-sm text-[var(--text)] data-[selected=true]:bg-[var(--bg-hover)]"
                >
                  <Hash size={14} className="text-[var(--text-faint)]" />
                  <span className="mono text-[0.8125rem] font-semibold text-[var(--accent)]">
                    {c}
                  </span>
                </Command.Item>
              ))}

            {query.trim() !== "" && !exact && (
              <Command.Item
                value="__create__"
                onSelect={() => onCreateClassifier(query.trim())}
                className="flex cursor-pointer items-center gap-2.5 rounded px-2.5 py-2 text-sm text-[var(--text)] data-[selected=true]:bg-[var(--bg-hover)]"
              >
                <FolderPlus size={14} className="text-[var(--text-faint)]" />
                <span>
                  {t("palette.create")} «<span className="mono">{query.trim()}</span>»
                </span>
              </Command.Item>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
