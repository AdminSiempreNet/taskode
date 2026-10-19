"use client";

import { MINE_FILTER } from "@/lib/task-filters";
import type { TaskFilterOption } from "@/lib/task-filter-options";
import { SearchCombobox } from "./search-combobox";
import styles from "./task-filter-controls.module.css";

function FilterCombobox({
  id,
  label,
  options,
  values,
  change,
  summary,
}: {
  id: string;
  label: string;
  options: TaskFilterOption[];
  values: string[];
  change: (values: string[]) => void;
  summary?: string;
}) {
  return (
    <div className={styles.filter} data-active={values.length > 0 || undefined}>
      <SearchCombobox
        id={id}
        label={label}
        multiple
        preserveOrder
        options={options}
        values={values}
        onChange={change}
        placeholder={summary ?? `${label}${values.length ? ` · ${values.length}` : ""}`}
        searchPlaceholder={`Buscar ${label.toLocaleLowerCase("es")}…`}
        clearLabel="Limpiar selección"
      />
    </div>
  );
}

export function TaskFilterControls({
  idPrefix,
  options,
  userIds,
  stateIds,
  classificationIds,
  changeUsers,
  changeState,
  changeClassification,
  compact = false,
  className = "",
}: {
  idPrefix: string;
  options: { userOptions: TaskFilterOption[]; stateOptions: TaskFilterOption[]; classificationOptions: TaskFilterOption[] };
  userIds: string[];
  stateIds: string[];
  classificationIds: string[];
  changeUsers: (ids: string[]) => void;
  changeState: (ids: string[]) => void;
  changeClassification: (ids: string[]) => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={`${styles.filters} ${compact ? styles.compact : ""} ${className}`} role="group" aria-label="Filtros de tareas">
      <FilterCombobox
        id={`${idPrefix}-user-filter`}
        label="Usuarios"
        options={options.userOptions}
        values={userIds}
        change={changeUsers}
        summary={userIds.length === 1 && userIds[0] === MINE_FILTER ? "Mías" : undefined}
      />
      <FilterCombobox id={`${idPrefix}-state-filter`} label="Estados y etiquetas" options={options.stateOptions} values={stateIds} change={changeState} />
      <FilterCombobox id={`${idPrefix}-classification-filter`} label="Clasificación" options={options.classificationOptions} values={classificationIds} change={changeClassification} />
    </div>
  );
}
