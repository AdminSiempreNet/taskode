"use client";

import { Archive, ListFilter, Plus, SearchX, X } from "lucide-react";
import type { Task, Workspace } from "@/lib/types";
import { UNASSIGNED_FILTER, matchesTaskFilters } from "@/lib/task-filters";
import { filterGroupValues, taskFilterOptions } from "@/lib/task-filter-options";
import { Button } from "./ui/button";
import { TaskFilterControls } from "./task-filter-controls";
import { useProjectFilter } from "./status-filter";
import { Empty, ListView } from "./views";
import styles from "./feature-task-list.module.css";

export function FeatureTaskList({
  projectId,
  featureId,
  workspace,
  tasks,
  archived,
  changeArchived,
  open,
  add,
}: {
  projectId: string;
  featureId: string;
  workspace: Workspace;
  tasks: Task[];
  archived: boolean;
  changeArchived: (archived: boolean) => void;
  open: (task: Task) => void;
  add: () => void;
}) {
  const statuses = workspace.statuses.filter((option) => option.projectId === projectId);
  const labels = workspace.labels.filter((option) => option.projectId === projectId);
  const options = taskFilterOptions(workspace, projectId);
  const preferenceScope = `${workspace.currentUser.id}.${projectId}.${featureId}`;
  const [userIds, setUserIds] = useProjectFilter(preferenceScope, "feature-users", options.userOptions);
  const [stateIds, setStateIds] = useProjectFilter(preferenceScope, "feature-state-labels", options.stateOptions);
  const [classificationIds, setClassificationIds] = useProjectFilter(preferenceScope, "feature-classification", options.classificationOptions);
  const labelIds = filterGroupValues(stateIds, "label");
  const filters = {
    userIds,
    currentUserId: workspace.currentUser.id,
    statusIds: filterGroupValues(stateIds, "status"),
    labelNames: labels.filter((label) => labelIds.includes(label.id)).map((label) => label.name),
    includeUnlabeled: labelIds.includes(UNASSIGNED_FILTER),
    priorityIds: filterGroupValues(classificationIds, "priority"),
    typeIds: filterGroupValues(classificationIds, "type"),
    impactIds: filterGroupValues(classificationIds, "impact"),
  };
  const available = tasks.filter((task) => task.archived === archived);
  const filtered = available.filter((task) => matchesTaskFilters(task, filters));
  const hasFilters = userIds.length + stateIds.length + classificationIds.length > 0;
  function clearFilters() {
    setUserIds([]);
    setStateIds([]);
    setClassificationIds([]);
  }
  return (
    <div className={styles.section}>
      <div className={styles.toolbar}>
        <TaskFilterControls
          idPrefix="feature" compact className={styles.filters} options={options}
          userIds={userIds} stateIds={stateIds} classificationIds={classificationIds}
          changeUsers={setUserIds} changeState={setStateIds} changeClassification={setClassificationIds}
        />
        <div className={styles.actions}>
          <Button type="button" size="sm" variant="outline" aria-pressed={archived} onClick={() => changeArchived(!archived)}>
            <Archive size={15} />
            {archived ? "Ver activas" : "Ver archivadas"}
          </Button>
          {!archived && (
            <Button type="button" size="sm" onClick={add}>
              <Plus size={15} />
              Nueva tarea
            </Button>
          )}
        </div>
      </div>
      {hasFilters && (
        <div className={styles.results}>
          <span role="status">
            <ListFilter size={14} aria-hidden="true" />
            {filtered.length} de {available.length} {available.length === 1 ? "tarea" : "tareas"}
          </span>
          <button type="button" onClick={clearFilters}>
            Limpiar filtros <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}
      {hasFilters && !filtered.length ? (
        <Empty
          icon={<SearchX />}
          title="No hay tareas con estos filtros"
          description="Cambia la selección o limpia los filtros para ver las tareas disponibles."
          action={<Button type="button" variant="outline" onClick={clearFilters}>Limpiar filtros</Button>}
        />
      ) : (
        <ListView tasks={filtered} features={workspace.features.filter((feature) => feature.id === featureId)} statuses={statuses} open={open} add={add} archived={archived} />
      )}
    </div>
  );
}
