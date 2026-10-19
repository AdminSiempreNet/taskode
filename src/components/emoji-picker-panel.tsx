"use client";

import Picker from "emoji-picker-react";
import spanishEmojis from "emoji-picker-react/data/emojis-es";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";

export default function EmojiPickerPanel({
  onSelect,
}: {
  onSelect: (emoji: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => root.current?.querySelector("input")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div ref={root} style={{ width: "100%", height: "100%" }}><Picker
      className="emoji-picker-catalog"
      aria-label="Catálogo de emojis"
      lang="es"
      emojiData={spanishEmojis}
      emojiStyle="native"
      colorScheme={resolvedTheme === "dark" ? "dark" : "light"}
      width="100%"
      height="100%"
      autoFocusSearch={false}
      previewConfig={{ showPreview: false }}
      labels={{
        searchPlaceholder: "Buscar emojis…",
        searchLabel: "Buscar emojis",
        searchClear: "Limpiar búsqueda",
        searchResultsNone: "No se encontraron emojis.",
        searchResultsOne: "1 emoji encontrado",
        searchResultsMany: "%n emojis encontrados",
        categoryNavigation: "Categorías de emojis",
        reactions: "Reacciones",
        expandReactions: "Ver todos los emojis",
        loading: "Cargando emojis…",
        loadingError: "No se pudieron cargar los emojis.",
        retryLoading: "Reintentar",
        skinToneNeutral: "Tono de piel neutro",
        skinToneLight: "Tono de piel claro",
        skinToneMediumLight: "Tono de piel medio claro",
        skinToneMedium: "Tono de piel medio",
        skinToneMediumDark: "Tono de piel medio oscuro",
        skinToneDark: "Tono de piel oscuro",
      }}
      onEmojiClick={({ emoji }) => onSelect(emoji)}
    /></div>
  );
}
