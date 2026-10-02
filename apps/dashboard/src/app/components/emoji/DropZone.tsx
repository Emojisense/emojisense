import { type DragEvent, type ReactNode, useId, useRef, useState } from "react";
import { ACCEPTED_TYPES } from "../../lib/emoji";
import { Icon } from "../../ui/Icon";

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  compact?: boolean;
  children?: ReactNode;
}

/** Drag images onto it, or press it to choose files. The file input stays the accessible control. */
export function DropZone({
  onFiles,
  multiple = true,
  disabled = false,
  compact = false,
  children,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [over, setOver] = useState(false);

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag and drop is a pointer shortcut; the file input is the keyboard path
    <div
      className="dropzone"
      data-over={over || undefined}
      data-compact={compact || undefined}
      data-disabled={disabled || undefined}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className="visually-hidden"
        accept={ACCEPTED_TYPES.join(",")}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) onFiles(files);
          event.target.value = "";
        }}
      />
      <label htmlFor={inputId} className="dropzone-label">
        {children ?? (
          <>
            <span className="dropzone-icon">
              <Icon name="upload" />
            </span>
            <span className="dropzone-title">
              Drop images here, or <span className="link">choose files</span>
            </span>
            <span className="hint">PNG, GIF, WebP or SVG · up to 256 KB · square works best</span>
          </>
        )}
      </label>
    </div>
  );
}
