import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { PROJECT_PRESET_COLORS, normalizeHex } from "../utils/colors";

interface Props {
  value: string | null;
  onChange: (color: string | null) => void;
  disabled?: boolean;
  allowNone?: boolean;
}

/**
 * Preset swatches plus a hex input for custom project colors.
 *
 * The hex input commits on Enter or blur; Escape restores the current value.
 */
export default function ColorPicker({
  value,
  onChange,
  disabled = false,
  allowNone = true,
}: Props) {
  const t = useT();
  const [draft, setDraft] = useState(value ?? "");
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(value ?? "");
    setInvalid(false);
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      if (allowNone) onChange(null);
      setInvalid(false);
      return;
    }
    const hex = normalizeHex(trimmed);
    if (hex) {
      onChange(hex);
      setInvalid(false);
      setDraft(hex);
    } else {
      setInvalid(true);
    }
  };

  return (
    <div>
      <div role="group" aria-label={t("color.presets")} className="flex flex-wrap gap-1.5">
        {PROJECT_PRESET_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            disabled={disabled}
            aria-pressed={value?.toLowerCase() === color}
            aria-label={color}
            title={color}
            onClick={() => onChange(color)}
            className={`h-6 w-6 rounded-full border transition hover:scale-110 disabled:opacity-50 ${
              value?.toLowerCase() === color
                ? "border-[var(--text)] ring-2 ring-[var(--border-strong)]"
                : "border-transparent"
            }`}
            style={{ background: color }}
          />
        ))}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <label className="flex min-w-0 flex-1 items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg)] px-2 focus-within:border-[var(--accent)]">
          <span className="text-[0.625rem] text-[var(--text-faint)]">#</span>
          <input
            value={draft.replace(/^#/, "")}
            disabled={disabled}
            onChange={(event) => {
              setDraft(`#${event.target.value.replace(/^#/, "")}`);
              setInvalid(false);
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
              if (event.key === "Escape") {
                setDraft(value ?? "");
                setInvalid(false);
              }
            }}
            placeholder="7b9bff"
            spellCheck={false}
            aria-label={t("color.hex")}
            aria-invalid={invalid}
            className="h-7 min-w-0 flex-1 bg-transparent font-mono text-[0.75rem] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />
        </label>
        {allowNone && (
          <button
            type="button"
            disabled={disabled}
            aria-pressed={value === null}
            onClick={() => onChange(null)}
            className="rounded px-1.5 py-1 text-[0.625rem] text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-50"
          >
            {t("color.none")}
          </button>
        )}
      </div>

      {invalid && <p className="mt-1 text-[0.625rem] text-[var(--danger)]">{t("color.invalid")}</p>}
    </div>
  );
}
