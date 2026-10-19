"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Check, SmilePlus } from "lucide-react";
import { Popover } from "radix-ui";

const EmojiPickerPanel = dynamic(() => import("./emoji-picker-panel"), {
  ssr: false,
  loading: () => (
    <p className="emoji-picker-loading" role="status">
      Cargando emojis…
    </p>
  ),
});

type EmojiPickerProps = {
  id?: string;
  value: string;
  onChange: (emoji: string) => void;
  emojis?: readonly string[];
  disabled?: boolean;
};

export function EmojiPicker({
  id,
  value,
  onChange,
  emojis = [],
  disabled = false,
}: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const choices = [...new Set([...emojis, ...(value ? [value] : [])])];

  function select(emoji: string) {
    if (disabled) return;
    onChange(emoji);
    setOpen(false);
  }

  return (
    <div
      className="emoji-picker-choices"
      role="group"
      aria-label="Selector de emojis"
    >
      {choices.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`Icono ${emoji}`}
          aria-pressed={emoji === value}
          title={emoji === value ? `Icono seleccionado: ${emoji}` : `Usar ${emoji}`}
          disabled={disabled}
          onClick={() => select(emoji)}
        >
          {emoji}
          {emoji === value && (
            <span className="emoji-picker-selected" aria-hidden="true">
              <Check size={10} />
            </span>
          )}
        </button>
      ))}
      <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            aria-label="Más emojis"
            title="Más emojis"
            disabled={disabled}
          >
            <SmilePlus size={21} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="emoji-picker-popover"
            aria-label="Seleccionar emoji"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            updatePositionStrategy="always"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <EmojiPickerPanel onSelect={select} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
