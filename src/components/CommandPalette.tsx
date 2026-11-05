import { useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import { Hash, FolderPlus } from "lucide-react";
import { useT } from "../i18n";
import Dialog from "./Dialog";

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
    <Dialog
      open={open}
      onClose={onClose}
      label={t("palette.label")}
      className="w-[520px] max-w-full"
      initialFocusRef={inputRef}
    >
        <Command shouldFilter={false}>
          <Command.Input
            ref={inputRef}
            aria-label={t("palette.label")}
            value={query}
            onValueChange={setQuery}
            placeholder={t("palette.placeholder")}
            className="w-full border-b border-[var(--border)] bg-transparent px-4 py-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />
          <Command.List className="max-h-[320px] overflow-y-auto overscroll-contain p-1.5">
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
    </Dialog>
  );
}
