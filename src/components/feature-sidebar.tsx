"use client";

import { useId, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Box,
  ChevronDown,
  Layers3,
  ListTodo,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Feature, ProjectModule, ProjectTaskType } from "@/lib/types";
import { formatFeatureNumber } from "@/lib/features";
import type { Mutate } from "./forms";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

export function FeatureSidebar({
  projectId,
  features,
  modules,
  taskTypes,
  selectedId,
  counts,
  busy,
  select,
  createFeature,
  createModule,
  createTask,
  edit,
  editModule,
  mutate,
}: {
  projectId?: string;
  features: Feature[];
  modules: ProjectModule[];
  taskTypes: ProjectTaskType[];
  selectedId: string;
  counts: Record<string, number>;
  busy: boolean;
  select: (id: string) => void;
  createFeature: () => void;
  createModule: () => void;
  createTask: (typeId?: string) => void;
  edit: (feature: Feature) => void;
  editModule: (module: ProjectModule) => void;
  mutate: Mutate;
}) {
  const [query, setQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [dragged, setDragged] = useState<Feature | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const openingCreateDialog = useRef(false);
  function openCreateDialog(create: () => void) {
    openingCreateDialog.current = true;
    create();
  }
  const helpId = useId();
  const normalizedQuery = normalize(query.trim());
  const matches = (feature: Feature) =>
    normalize(
      `${formatFeatureNumber(feature.number)} ${feature.name} ${feature.description} ${modules.find((module) => module.id === feature.moduleId)?.name ?? "General"} ${modules.find((module) => module.id === feature.moduleId)?.description ?? ""}`,
    ).includes(normalizedQuery);
  const visible = features.filter(matches);
  const pinned = visible.filter((feature) => feature.pinned);
  const groups = [
    {
      id: "general",
      name: "General",
      description: "Features sin módulo",
      module: null,
      code: "00",
    },
    ...modules.map((module, index) => ({
      id: module.id,
      name: module.name,
      description: module.description,
      module,
      code: String(index + 1).padStart(2, "0"),
    })),
  ];
  const pinnedCount = features.filter((feature) => feature.pinned).length;
  const totalTasks = Object.values(counts).reduce(
    (sum, count) => sum + count,
    0,
  );
  function changeQuery(value: string) {
    setQuery(value);
    if (value.trim()) setCollapsed(new Set());
  }
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: {
        start: ["Space"],
        end: ["Space", "Enter"],
        cancel: ["Escape"],
      },
    }),
  );

  async function reorder(event: DragEndEvent) {
    setDragged(null);
    if (!event.over || event.active.id === event.over.id) return;
    const source = features.find(
      (feature) => feature.id === event.active.data.current?.featureId,
    );
    const target = features.find(
      (feature) => feature.id === event.over!.data.current?.featureId,
    );
    const groupId = event.active.data.current?.groupId;
    if (!source || !target || groupId !== event.over.data.current?.groupId)
      return;
    const inGroup = (feature: Feature) =>
      groupId === "pinned"
        ? feature.pinned
        : (feature.moduleId ?? "general") === groupId;
    const group = features.filter(inGroup);
    const shown = group.filter(matches);
    const oldIndex = shown.findIndex((feature) => feature.id === source.id);
    const newIndex = shown.findIndex((feature) => feature.id === target.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const visibleOrder = arrayMove(shown, oldIndex, newIndex).map(
      (feature) => feature.id,
    );
    // Keep hidden search results in their existing slots when reordering a filtered list.
    const groupOrder = group.map((feature) =>
      matches(feature) ? visibleOrder.shift()! : feature.id,
    );
    const ids = features.map((feature) =>
      inGroup(feature) ? groupOrder.shift()! : feature.id,
    );
    await mutate({ type: "feature.reorder", projectId, ids });
  }

  const renderRow = (feature: Feature, shortcut = false) => (
    <SortableFeature
      key={feature.id}
      shortcut={shortcut}
      feature={feature}
      selected={feature.id === selectedId}
      count={counts[feature.id] ?? 0}
      busy={busy}
      canPin={feature.pinned || pinnedCount < 5}
      select={select}
      edit={edit}
      mutate={mutate}
    />
  );

  return (
    <section className="feature-section" aria-label="Features del proyecto">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className="sidebar-new-button"
            size="sm"
            variant="outline"
            disabled={!projectId || busy}
          >
            <Plus size={15} />
            <span>Nuevo</span>
            <ChevronDown size={14} className="ml-auto" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="sidebar-new-menu"
          align="start"
          collisionPadding={12}
          onCloseAutoFocus={(event) => {
            if (openingCreateDialog.current) {
              event.preventDefault();
              openingCreateDialog.current = false;
            }
          }}
        >
          <DropdownMenuItem onSelect={() => openCreateDialog(createModule)}>
            <Box />
            Módulo
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openCreateDialog(createFeature)}>
            <Layers3 />
            Feature
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {taskTypes.length > 0 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                disabled={!features.length}
                title={!features.length ? "Crea una feature primero" : undefined}
              >
                <ListTodo />
                Tarea
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent
                  className="sidebar-task-types-menu"
                  collisionPadding={12}
                >
                  <DropdownMenuLabel>Tipo de tarea</DropdownMenuLabel>
                  {taskTypes.map((type) => (
                    <DropdownMenuItem
                      key={type.id}
                      onSelect={() =>
                        openCreateDialog(() => createTask(type.id))
                      }
                    >
                      <span
                        className="sidebar-task-type-color"
                        style={{ background: type.color }}
                        aria-hidden="true"
                      />
                      {type.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuItem
              disabled={!features.length}
              title={!features.length ? "Crea una feature primero" : undefined}
              onSelect={() => openCreateDialog(() => createTask())}
            >
              <ListTodo />
              Tarea
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="feature-search-desktop">
        <FeatureSearch
          value={query}
          change={changeQuery}
          disabled={!projectId || busy}
        />
      </div>
      <Popover.Root open={mobileSearchOpen} onOpenChange={setMobileSearchOpen}>
        <Popover.Trigger asChild>
          <button
            className="feature-search-mobile"
            disabled={!projectId || busy}
            aria-label="Buscar features"
            title="Buscar features"
          >
            <Search size={16} />
            {query && <i />}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="feature-search-popover"
            side="right"
            align="start"
            sideOffset={10}
            collisionPadding={10}
          >
            <FeatureSearch value={query} change={changeQuery} disabled={busy} />
            <div className="feature-search-results">
              {visible.map((feature) => (
                <div key={feature.id} className="feature-search-result">
                  <button
                    className="feature-result-link"
                    onClick={() => {
                      select(feature.id);
                      setMobileSearchOpen(false);
                    }}
                  >
                    <span className="feature-number">
                      {formatFeatureNumber(feature.number)}
                    </span>
                    <span>{feature.name}</span>
                    <small>{counts[feature.id] ?? 0}</small>
                  </button>
                  <button
                    className="feature-result-pin"
                    aria-label={`${feature.pinned ? "Desfijar" : "Fijar"} feature: ${feature.name}`}
                    aria-pressed={feature.pinned}
                    title={
                      feature.pinned
                        ? "Desfijar feature"
                        : pinnedCount < 5
                          ? "Fijar feature"
                          : "Máximo 5 features fijadas"
                    }
                    disabled={busy || (!feature.pinned && pinnedCount >= 5)}
                    onClick={() =>
                      mutate({
                        type: "feature.pin",
                        id: feature.id,
                        pinned: !feature.pinned,
                      })
                    }
                  >
                    {feature.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                  </button>
                </div>
              ))}
              {!visible.length && <p>No se encontraron features.</p>}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <button
        className={`feature-item ${selectedId === "all" ? "feature-active" : ""}`}
        aria-label="Ver todas las features"
        title="Todas las features"
        onClick={() => select("all")}
        disabled={!projectId}
      >
        <Layers3 size={16} />
        <span>Todas las features</span>
        <span className="feature-count">{totalTasks}</span>
      </button>
      <p className="sr-only" id={helpId}>
        Arrastra para reordenar dentro de cada módulo o en las fijadas. Con el
        teclado, pulsa Espacio, flechas y Espacio. Usa la chincheta para fijar
        hasta cinco features.
      </p>
      <DndContext
        id={`features-${projectId ?? "empty"}`}
        sensors={sensors}
        collisionDetection={(args) =>
          closestCenter({
            ...args,
            droppableContainers: args.droppableContainers.filter(
              (container) =>
                container.data.current?.groupId ===
                args.active.data.current?.groupId,
            ),
          })
        }
        onDragStart={(event) =>
          setDragged(
            features.find(
              (feature) => feature.id === event.active.data.current?.featureId,
            ) ?? null,
          )
        }
        onDragCancel={() => setDragged(null)}
        onDragEnd={reorder}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "Pulsa Espacio para reordenar una feature. Usa las flechas arriba y abajo y pulsa Espacio para soltar. Escape cancela.",
          },
        }}
      >
        <div className="feature-groups" aria-describedby={helpId}>
          {pinned.length > 0 && (
            <div className="pinned-features">
              <div className="feature-group-label">
                <Pin size={11} />
                <span>FIJADAS</span>
                <small>{pinnedCount}/5</small>
              </div>
              <SortableContext
                id="pinned-features"
                items={pinned.map((feature) => `pinned-${feature.id}`)}
                strategy={verticalListSortingStrategy}
              >
                {pinned.map((feature) => renderRow(feature, true))}
              </SortableContext>
            </div>
          )}
          {groups.map((group) => {
            const items = visible.filter(
              (feature) => (feature.moduleId ?? "general") === group.id,
            );
            const allItems = features.filter(
              (feature) => (feature.moduleId ?? "general") === group.id,
            );
            if (
              normalizedQuery &&
              !items.length &&
              !normalize(`${group.name} ${group.description}`).includes(
                normalizedQuery,
              )
            )
              return null;
            const expanded = !collapsed.has(group.id);
            const contentId = `${helpId}-${group.id}`;
            return (
              <section
                key={group.id}
                className="feature-module"
                aria-label={`Módulo ${group.name}`}
              >
                <div className="module-heading">
                  <button
                    className="module-toggle"
                    aria-expanded={expanded}
                    aria-controls={contentId}
                    aria-label={`${expanded ? "Contraer" : "Expandir"} módulo ${group.name}`}
                    title={
                      group.description
                        ? `${group.name} · ${group.description}`
                        : group.name
                    }
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        return next;
                      })
                    }
                  >
                    <ChevronDown
                      size={12}
                      className={expanded ? "" : "module-chevron-collapsed"}
                    />
                    {group.code && (
                      <span className="module-code">{group.code}</span>
                    )}
                    <span className="module-name">{group.name}</span>
                    <span className="module-mobile-general" aria-hidden="true">
                      {group.code ? "" : "G"}
                    </span>
                    <small>{allItems.length}</small>
                  </button>
                  {group.module && (
                    <button
                      className="module-edit"
                      aria-label={`Editar módulo: ${group.name}`}
                      title="Editar módulo"
                      disabled={busy}
                      onClick={() => editModule(group.module!)}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  )}
                </div>
                <div id={contentId} hidden={!expanded}>
                  <SortableContext
                    id={`module-${group.id}`}
                    items={items.map((feature) => feature.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {items.map((feature) => renderRow(feature))}
                  </SortableContext>
                  {!items.length && (
                    <p className="module-empty">Sin features.</p>
                  )}
                </div>
              </section>
            );
          })}
          {!visible.length &&
            normalizedQuery &&
            !groups.some((group) =>
              normalize(`${group.name} ${group.description}`).includes(
                normalizedQuery,
              ),
            ) && (
              <p className="feature-search-empty">
                {query
                  ? "No se encontraron features."
                  : "Añade tu primera feature."}
              </p>
            )}
        </div>
        <DragOverlay>
          {dragged && (
            <div className="feature-drag-preview">
              <Layers3 size={14} />
              <span>{dragged.name}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </section>
  );
}

function FeatureSearch({
  value,
  change,
  disabled,
}: {
  value: string;
  change: (query: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="feature-search">
      <Search size={14} />
      <Input
        aria-label="Buscar features por nombre o descripción"
        placeholder="Buscar features…"
        value={value}
        onChange={(event) => change(event.target.value)}
        disabled={disabled}
      />
      {value && (
        <button
          aria-label="Limpiar búsqueda de features"
          onClick={() => change("")}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

function SortableFeature({
  feature,
  shortcut,
  selected,
  count,
  busy,
  canPin,
  select,
  edit,
  mutate,
}: {
  feature: Feature;
  shortcut: boolean;
  selected: boolean;
  count: number;
  busy: boolean;
  canPin: boolean;
  select: (id: string) => void;
  edit: (feature: Feature) => void;
  mutate: Mutate;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: shortcut ? `pinned-${feature.id}` : feature.id,
    disabled: busy,
    data: {
      featureId: feature.id,
      groupId: shortcut ? "pinned" : (feature.moduleId ?? "general"),
    },
  });
  return (
    <div
      className={`feature-row ${feature.pinned ? "feature-pinned" : ""}`}
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
    >
      <button
        ref={setActivatorNodeRef}
        className={`feature-item ${selected ? "feature-active" : ""}`}
        {...attributes}
        {...listeners}
        aria-label={`Ver feature${shortcut ? " fijada" : ""}: ${feature.name}`}
        aria-current={selected ? "true" : undefined}
        title={`${feature.name} · Arrastra para reordenar dentro de su grupo`}
        disabled={busy}
        onClick={() => {
          if (!isDragging) select(feature.id);
        }}
      >
        <span className="feature-number">
          {formatFeatureNumber(feature.number)}
        </span>
        <span className="feature-name">{feature.name}</span>
        <span className="feature-count">{count}</span>
      </button>
      <div className="feature-row-actions">
        <button
          className={`feature-pin ${feature.pinned ? "is-pinned" : ""}`}
          aria-label={`${feature.pinned ? "Desfijar" : "Fijar"} feature: ${feature.name}`}
          aria-pressed={feature.pinned}
          title={
            feature.pinned
              ? "Desfijar feature"
              : canPin
                ? "Fijar feature"
                : "Máximo 5 features fijadas"
          }
          disabled={busy || !canPin}
          onClick={() =>
            mutate({
              type: "feature.pin",
              id: feature.id,
              pinned: !feature.pinned,
            })
          }
        >
          {feature.pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
        <button
          className="feature-edit"
          aria-label={`Editar feature: ${feature.name}`}
          title="Editar feature"
          disabled={busy}
          onClick={() => edit(feature)}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    </div>
  );
}
