import { useId } from "react";

interface Option<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

interface SegmentedProps<T extends string | number> {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
}

/** A radio group drawn as a segmented control: arrow keys move between options. */
export function Segmented<T extends string | number>({ label, value, options, onChange }: SegmentedProps<T>) {
  const name = useId();
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={String(option.value)} title={option.title}>
          <input
            type="radio"
            name={name}
            value={String(option.value)}
            checked={option.value === value}
            disabled={option.disabled}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
