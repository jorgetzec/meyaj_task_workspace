import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

interface Props {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}

/** A themed listbox rendered outside scrolling dialogs so its options never get clipped. */
export default function ThemedSelect({ value, options, onChange, label, disabled = false }: Props) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 180, maxHeight: 256 });
  const selectedIndex = options.findIndex((option) => option.value === value);
  const active = Math.min(highlighted, Math.max(0, options.length - 1));

  const show = () => {
    if (disabled || options.length === 0) return;
    setHighlighted(Math.max(0, selectedIndex));
    setOpen(true);
  };
  const choose = (index: number) => {
    if (options[index]) onChange(options[index].value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const bounds = triggerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(Math.max(bounds.width, 180), window.innerWidth - 16);
      const below = window.innerHeight - bounds.bottom - 12;
      const above = bounds.top - 12;
      const downward = below >= Math.min(256, options.length * 34 + 8) || below >= above;
      const maxHeight = Math.max(32, Math.min(256, downward ? below : above));
      const height = Math.min(maxHeight, options.length * 34 + 8);
      setPosition({
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
        top: downward ? bounds.bottom + 4 : Math.max(8, bounds.top - height - 4),
        width,
        maxHeight,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: "nearest" });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !triggerRef.current?.contains(event.target) && !listRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open, active]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open && options.length ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => open ? setOpen(false) : show()}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) show();
            else setHighlighted((active + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) choose(active);
            else show();
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            if (!open) show();
            setHighlighted(event.key === "Home" ? 0 : options.length - 1);
          } else if (event.key === "Tab") {
            setOpen(false);
          } else if (event.key.length === 1) {
            const now = Date.now();
            const text = (now - searchRef.current.time < 600 ? searchRef.current.text : "") + event.key.toLocaleLowerCase();
            searchRef.current = { text, time: now };
            const index = options.findIndex((option) => option.label.toLocaleLowerCase().startsWith(text));
            if (!open) show();
            if (index >= 0) setHighlighted(index);
          }
        }}
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1.5 text-left text-[0.8125rem] text-[var(--text)] outline-none hover:bg-[var(--bg-hover)] focus-visible:border-[var(--accent)] disabled:opacity-50"
      >
        <span className="truncate">{options[selectedIndex]?.label ?? label}</span>
        <ChevronDown size={13} className="shrink-0 text-[var(--text-dim)]" aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={listRef}
          id={id}
          role="listbox"
          aria-label={label}
          style={position}
          onMouseDown={(event) => event.stopPropagation()}
          className="fixed z-[100] overflow-y-auto rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1 text-[var(--text)] shadow-xl"
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              id={`${id}-${index}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              data-highlighted={index === active}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => choose(index)}
              className={`flex min-h-[34px] w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[0.8125rem] ${index === active ? "bg-[var(--bg-active)]" : "hover:bg-[var(--bg-hover)]"}`}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.value === value && <Check size={13} className="shrink-0 text-[var(--accent)]" aria-hidden="true" />}
            </button>
          ))}
        </div>, document.body,
      )}
    </>
  );
}
