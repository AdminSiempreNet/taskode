"use client";

import type { ProjectApplication } from "@/lib/types";
import { SearchCombobox } from "./search-combobox";
import { colorStyle } from "./project-catalog";

export function ApplicationPicker({ id, options, values, onChange, disabled = false }: {
  id: string;
  options: ProjectApplication[];
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
}) {
  return <div className="form-stack">
    <SearchCombobox id={id} label="Aplicaciones" multiple preserveOrder
      options={options.map(option => ({ ...option, secondary: option.isDefault ? "Predeterminada para tareas nuevas" : undefined }))}
      values={values} onChange={onChange} disabled={disabled}
      placeholder="Seleccionar aplicaciones" searchPlaceholder="Buscar aplicaciones…" clearLabel="Quitar todas las aplicaciones" />
    <div className="application-chips" aria-label="Aplicaciones seleccionadas">
      {values.map(value => {
        const option = options.find(item => item.id === value);
        return option ? <span key={value} className="label-chip colored-chip" style={colorStyle(option.color)}><i />{option.name}</span> : null;
      })}
      {!values.length && <span className="field-hint">Sin aplicación</span>}
    </div>
  </div>;
}
