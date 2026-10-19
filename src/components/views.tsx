"use client";
import styles from "./task-list.module.css";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDndContext,
  closestCenter,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  CircleCheck,
  Layers3,
  Plus,
  Ticket,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownContent } from "./markdown-content";
import { TaskPeopleSummary } from "./task-people";
import type { Feature, Status, Task } from "@/lib/types";
import {
  LabelChip,
  TaskCategoryChip,
  ApplicationChips,
  colorStyle,
  useProjectCatalog,
} from "./project-catalog";
import type { Mutate } from "./forms";
import { dateKey, taskScheduleLabel } from "@/lib/calendar";
import { taskOverdue } from "@/lib/project-time";
import { boardDropTarget, type BoardDropTarget } from "@/lib/board-drop";
export { dateKey } from "@/lib/calendar";

export function shortDate(value: string) {
  return new Date(value + "T12:00:00")
    .toLocaleDateString("es-CO", { day: "numeric", month: "short" })
    .replace(" de ", " ");
}
export function Priority({ priority }: { priority: Task["priority"] }) {
  const { priorities } = useProjectCatalog();
  const option = priorities.find((p) => p.id === priority);
  const Icon =
    priority === "high" ? ArrowUp : priority === "low" ? ArrowDown : ArrowRight;
  return (
    <span className="priority colored-chip" style={colorStyle(option?.color)}>
      <Icon size={12} />
      {option?.name ?? priority}
    </span>
  );
}
export function StatusPill({ status }: { status?: Status }) {
  return status ? (
    <span className="status-pill">
      <i style={{ background: status.color }} />
      {status.name}
    </span>
  ) : null;
}
function CardContent({
  task,
  feature,
  status,
}: {
  task: Task;
  feature?: Feature;
  status?: Status;
}) {
  const { timeZone } = useProjectCatalog();
  const late = taskOverdue(task, new Date(), timeZone) && !status?.isDone && !task.archived;
  const relations = [
    { count: task.clientIds.length, Icon: Users, singular: "cliente", plural: "clientes" },
    { count: task.ticketIds.length, Icon: Ticket, singular: "ticket", plural: "tickets" },
  ].filter(({ count }) => count > 0);
  return (
    <>
      <div className="card-header">
        <div className="card-labels">
          <Priority priority={task.priority} />
          <TaskCategoryChip kind="type" id={task.typeId} />
          <TaskCategoryChip kind="impact" id={task.impactId} />
          <ApplicationChips ids={task.applicationIds ?? []} />
        </div>
        {relations.length > 0 && (
          <div className="card-relations">
            {relations.map(({ count, Icon, singular, plural }) => {
              const label = `${count} ${count === 1 ? singular : plural}`;
              return (
                <span className="card-relation" key={plural} role="img" aria-label={label} title={label}>
                  <Icon size={16} aria-hidden="true" />
                  <span className="card-relation-count" aria-hidden="true">{Math.min(count, 9)}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
      <h3>{task.title}</h3>
      <TaskPeopleSummary leader={task.leader} teamMembers={task.teamMembers} />
      {task.description && (
        <div className="card-description">
          <MarkdownContent compact>{task.description}</MarkdownContent>
        </div>
      )}
      {task.labels.length > 0 && (
        <div className="card-labels">
          {task.labels.slice(0, 2).map((l, i) => (
            <LabelChip name={l} key={i} />
          ))}
          {task.labels.length > 2 && (
            <span className="label-chip">+{task.labels.length - 2}</span>
          )}
        </div>
      )}
      <div className="card-footer">
        <span className="card-feature">
          <Layers3 size={12} />
          {feature?.name}
        </span>
        {(task.dueDate || task.startDate) && (
          <span
            className={late ? "card-date overdue" : "card-date"}
            title={taskScheduleLabel(task)}
          >
            {status?.isDone ? (
              <CircleCheck size={13} />
            ) : (
              <CalendarDays size={13} />
            )}
            {shortDate((task.dueDate || task.startDate)!)}
            {(task.dueTime || (!task.dueDate && task.startTime)) &&
              ` · ${task.dueTime || task.startTime}`}
          </span>
        )}
      </div>
    </>
  );
}
function TaskCard({
  task,
  feature,
  status,
  open,
  busy,
  readOnly = false,
}: {
  task: Task;
  feature?: Feature;
  status?: Status;
  open: (t: Task) => void;
  busy: boolean;
  readOnly?: boolean;
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
    id: task.id,
    disabled: busy || readOnly,
    data: { type: "task", statusId: task.statusId },
  });
  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
      className={`task-card ${readOnly ? "archived-card" : ""}`}
      onClick={() => {
        if (!isDragging && !busy) open(task);
      }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="card-open"
        {...(!readOnly ? attributes : {})}
        {...(!readOnly ? listeners : {})}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          if (!isDragging && !busy) open(task);
        }}
        aria-label={`Abrir tarea: ${task.title}`}
        title={
          readOnly
            ? "Abrir tarea archivada"
            : "Arrastra para mover · Clic o Enter para abrir · Espacio para mover con el teclado"
        }
      >
        <span className="sr-only">Abrir {task.title}</span>
      </button>
      <CardContent task={task} feature={feature} status={status} />
    </article>
  );
}
function Column({
  status,
  tasks,
  features,
  open,
  add,
  busy,
  archived,
}: {
  status: Status;
  tasks: Task[];
  features: Feature[];
  open: (t: Task) => void;
  add: (statusId: string) => void;
  busy: boolean;
  archived: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${status.id}`,
    disabled: busy || archived,
    data: { type: "column", statusId: status.id },
  });
  const { over } = useDndContext();
  const targeted = isOver || over?.data.current?.statusId === status.id;
  return (
    <section
      className={`board-column ${targeted ? "drag-over" : ""}`}
      ref={setNodeRef}
      aria-label={`Columna ${status.name}`}
    >
      <div className="column-header">
        <i style={{ background: status.color }} />
        <h2>{status.name}</h2>
        <span className="column-count">{tasks.length}</span>
        {!archived && (
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={() => add(status.id)}
            aria-label={`Añadir tarea en ${status.name}`}
          >
            <Plus size={16} />
          </Button>
        )}
      </div>
      <SortableContext
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          className="column-cards"
          role="region"
          aria-label={`Tareas en ${status.name}`}
          tabIndex={0}
        >
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              feature={features.find((f) => f.id === t.featureId)}
              status={status}
              open={open}
              busy={busy}
              readOnly={archived}
            />
          ))}
          {!tasks.length && (
            <div className="column-empty">
              {archived
                ? "Sin tareas archivadas en este estado"
                : "Un espacio para el siguiente paso"}
            </div>
          )}
        </div>
      </SortableContext>
    </section>
  );
}
export function Board({
  tasks,
  statuses,
  features,
  open,
  add,
  mutate,
  busy,
  archived,
}: {
  tasks: Task[];
  statuses: Status[];
  features: Feature[];
  open: (t: Task) => void;
  add: (s: string) => void;
  mutate: Mutate;
  busy: boolean;
  archived: boolean;
}) {
  const [dragged, setDragged] = useState<Task | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const pointerDrop = useRef<BoardDropTarget | null>(null);
  const preciseCollision = useCallback<CollisionDetection>((args) => {
    const columns = args.droppableContainers.filter(
      (container) => container.data.current?.type === "column",
    );
    if (args.pointerCoordinates) {
      const viewport = boardRef.current?.getBoundingClientRect();
      if (!viewport) return [];
      const columnRects = columns.flatMap((container) => {
        const rect = args.droppableRects.get(container.id);
        const listRect = container.node.current
          ?.querySelector(".column-cards")
          ?.getBoundingClientRect();
        return rect && listRect
          ? [{ id: String(container.data.current!.statusId), rect, listRect }]
          : [];
      });
      const cards = args.droppableContainers.flatMap((container) => {
        const rect = args.droppableRects.get(container.id);
        return rect && container.data.current?.type === "task"
          ? [
              {
                id: String(container.id),
                columnId: String(container.data.current.statusId),
                rect,
              },
            ]
          : [];
      });
      pointerDrop.current = boardDropTarget(
        args.pointerCoordinates,
        columnRects,
        cards,
        viewport,
      );
      if (!pointerDrop.current) return [];
      const id =
        pointerDrop.current.taskId ?? `column:${pointerDrop.current.columnId}`;
      const container = args.droppableContainers.find(
        (entry) => entry.id === id,
      );
      return container
        ? [{ id, data: { droppableContainer: container, value: 1 } }]
        : [];
    }
    pointerDrop.current = null;
    // Keyboard navigation has no pointer. Choose a column first, then a card
    // inside it, so neighboring cards cannot hijack the destination.
    const column = closestCenter({ ...args, droppableContainers: columns })[0];
    if (!column) return [];
    const statusId = columns.find((entry) => entry.id === column.id)?.data
      .current?.statusId;
    const cards = args.droppableContainers.filter(
      (container) =>
        container.data.current?.type === "task" &&
        container.data.current.statusId === statusId,
    );
    return cards.length
      ? closestCenter({ ...args, droppableContainers: cards })
      : [column];
  }, []);
  const scrollHelpId = useId();
  const snapToColumn = useCallback(() => {
    const board = boardRef.current;
    if (!board || board.dataset.dragging === "true") return;
    const column = board.querySelector<HTMLElement>(".board-column");
    if (!column) return;
    const step = column.getBoundingClientRect().width + 12;
    const target = Math.round(board.scrollLeft / step) * step;
    if (Math.abs(board.scrollLeft - target) > 1)
      board.scrollTo({ left: target, behavior: "instant" });
  }, []);
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(snapToColumn, 140);
    };
    board.addEventListener("scroll", onScroll, { passive: true });
    board.addEventListener("scrollend", snapToColumn);
    return () => {
      clearTimeout(timer);
      board.removeEventListener("scroll", onScroll);
      board.removeEventListener("scrollend", snapToColumn);
    };
  }, [snapToColumn]);
  useEffect(() => {
    if (dragged) return;
    const frame = requestAnimationFrame(snapToColumn);
    return () => cancelAnimationFrame(frame);
  }, [dragged, snapToColumn]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const resize = () => {
      const style = getComputedStyle(board);
      const gap = Number.parseFloat(style.columnGap) || 12;
      const minimum =
        Number.parseFloat(style.getPropertyValue("--board-column-min-width")) ||
        280;
      const count = Math.max(
        1,
        Math.min(
          statuses.length || 1,
          Math.floor((board.clientWidth + gap) / (minimum + gap)),
        ),
      );
      const width = (board.clientWidth - gap * (count - 1)) / count;
      const previousWidth =
        Number.parseFloat(style.getPropertyValue("--board-column-width")) ||
        width;
      const index = Math.round(board.scrollLeft / (previousWidth + gap));
      board.style.setProperty("--board-column-width", `${width}px`);
      board.scrollTo({ left: index * (width + gap), behavior: "instant" });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(board);
    resize();
    return () => observer.disconnect();
  }, [statuses.length]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    let lastAdvance = 0;
    function scrollHorizontally(event: WheelEvent) {
      if (!event.ctrlKey || event.defaultPrevented) return;
      // A non-passive native listener is needed to prevent Ctrl + wheel zoom.
      event.preventDefault();
      const delta =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX)
          ? event.deltaY
          : event.deltaX;
      if (!delta || Date.now() - lastAdvance < 180) return;
      lastAdvance = Date.now();
      const column = board!.querySelector<HTMLElement>(".board-column");
      const step = (column?.getBoundingClientRect().width ?? 280) + 12;
      board!.scrollTo({
        left: (Math.round(board!.scrollLeft / step) + Math.sign(delta)) * step,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    }

    board.addEventListener("wheel", scrollHorizontally, { passive: false });
    return () => board.removeEventListener("wheel", scrollHorizontally);
  }, []);
  const keyboardCoordinates = useCallback<KeyboardCoordinateGetter>(
    (event, { context }) => {
      const {
        collisionRect,
        over,
        active,
        droppableRects,
        droppableContainers,
      } = context;
      if (
        !collisionRect ||
        !active ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          event.code,
        )
      )
        return;
      event.preventDefault();
      const enabled = droppableContainers.getEnabled();
      const statusId =
        over?.data.current?.statusId ?? active.data.current?.statusId;
      if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
        const columns = enabled
          .filter((container) => container.data.current?.type === "column")
          .sort(
            (a, b) =>
              (droppableRects.get(a.id)?.left ?? 0) -
              (droppableRects.get(b.id)?.left ?? 0),
          );
        const index = columns.findIndex(
          (column) => column.data.current?.statusId === statusId,
        );
        const next = columns[index + (event.code === "ArrowRight" ? 1 : -1)];
        const rect = next && droppableRects.get(next.id);
        if (rect)
          return {
            x: rect.left + (rect.width - collisionRect.width) / 2,
            y: collisionRect.top,
          };
        return;
      }
      const cards = enabled
        .filter(
          (container) =>
            container.data.current?.type === "task" &&
            container.data.current.statusId === statusId,
        )
        .sort(
          (a, b) =>
            (droppableRects.get(a.id)?.top ?? 0) -
            (droppableRects.get(b.id)?.top ?? 0),
        );
      const index = cards.findIndex(
        (card) => card.id === (over?.id ?? active.id),
      );
      const next = cards[index + (event.code === "ArrowDown" ? 1 : -1)];
      const rect = next && droppableRects.get(next.id);
      if (rect)
        return {
          x: rect.left + (rect.width - collisionRect.width) / 2,
          y: rect.top + (rect.height - collisionRect.height) / 2,
        };
    },
    [],
  );
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinates,
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space", "Enter"],
      },
    }),
  );
  async function end(e: DragEndEvent) {
    setDragged(null);
    const pointerTarget = pointerDrop.current;
    pointerDrop.current = null;
    if (archived) return;
    if (!e.over || e.active.id === e.over.id) return;
    const targetTask = tasks.find((t) => t.id === e.over!.id);
    const statusId =
      pointerTarget?.columnId ??
      targetTask?.statusId ??
      String(e.over.id).replace("column:", "");
    if (!statuses.some((s) => s.id === statusId)) return;
    let beforeId = targetTask?.id ?? null;
    if (targetTask) {
      const columnTasks = tasks.filter(
        (t) => t.statusId === statusId && t.id !== e.active.id,
      );
      const targetIndex = columnTasks.findIndex((t) => t.id === targetTask.id);
      const originalTasks = tasks.filter((t) => t.statusId === statusId);
      const sourceIndex = originalTasks.findIndex((t) => t.id === e.active.id);
      const translated = e.active.rect.current.translated;
      const movingAfter = pointerTarget
        ? pointerTarget.after
        : sourceIndex >= 0
          ? sourceIndex < originalTasks.findIndex((t) => t.id === targetTask.id)
          : translated &&
            translated.top + translated.height / 2 >
              e.over.rect.top + e.over.rect.height / 2;
      if (movingAfter) beforeId = columnTasks[targetIndex + 1]?.id ?? null;
    }
    await mutate({
      type: "task.move",
      id: String(e.active.id),
      statusId,
      beforeId,
    });
  }
  return (
    <DndContext
      id={`board-${statuses[0]?.projectId ?? "empty"}`}
      sensors={sensors}
      collisionDetection={preciseCollision}
      onDragStart={(e) => {
        pointerDrop.current = null;
        setDragged(tasks.find((t) => t.id === e.active.id) ?? null);
      }}
      onDragCancel={() => {
        pointerDrop.current = null;
        setDragged(null);
      }}
      onDragEnd={end}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "Para mover una tarea, pulsa Espacio. Usa las flechas para moverla y pulsa Espacio para soltarla. Escape cancela el movimiento.",
        },
      }}
    >
      <p id={scrollHelpId} className="sr-only">
        Control más rueda desplaza el tablero horizontalmente. Con el tablero
        enfocado, usa las flechas izquierda y derecha. Cada lista tiene su
        propio desplazamiento vertical.
      </p>
      <div
        ref={boardRef}
        className="board"
        data-dragging={!!dragged}
        role="region"
        aria-label="Tablero de tareas"
        aria-describedby={scrollHelpId}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const board = event.currentTarget;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const column = board.querySelector<HTMLElement>(".board-column");
            const step = (column?.getBoundingClientRect().width ?? 280) + 12;
            board.scrollTo({
              left:
                (Math.round(board.scrollLeft / step) +
                  (event.key === "ArrowRight" ? 1 : -1)) *
                step,
              behavior: "smooth",
            });
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            board.scrollLeft = event.key === "Home" ? 0 : board.scrollWidth;
          }
        }}
      >
        {statuses.map((s) => (
          <Column
            key={s.id}
            status={s}
            tasks={tasks.filter((t) => t.statusId === s.id)}
            features={features}
            open={open}
            add={add}
            busy={busy}
            archived={archived}
          />
        ))}
      </div>
      <DragOverlay>
        {dragged && (
          <article className="task-card overlay-card">
            <CardContent
              task={dragged}
              feature={features.find((f) => f.id === dragged.featureId)}
              status={statuses.find((s) => s.id === dragged.statusId)}
            />
          </article>
        )}
      </DragOverlay>
    </DndContext>
  );
}
export function ListView({
  tasks,
  features,
  statuses,
  open,
  add,
  archived,
}: {
  tasks: Task[];
  features: Feature[];
  statuses: Status[];
  open: (t: Task) => void;
  add: () => void;
  archived: boolean;
}) {
  const { timeZone } = useProjectCatalog();
  if (!tasks.length)
    return (
      <Empty
        icon={<Layers3 />}
        title={
          archived ? "El archivo está vacío" : "Todavía no hay tareas aquí"
        }
        description={
          archived
            ? "Las tareas que archives aparecerán aquí. Puedes restaurarlas cuando quieras."
            : "Crea una tarea o ajusta los filtros para ver más resultados."
        }
        action={
          !archived && (
            <Button onClick={add}>
              <Plus />
              Nueva tarea
            </Button>
          )
        }
      />
    );
  return (
    <div className={`list-view ${styles.list}`}>
      {features.map((f) => {
        const rows = tasks.filter((t) => t.featureId === f.id);
        if (!rows.length) return null;
        return (
          <section key={f.id} className={styles.group} aria-label={f.name}>
            <header className={styles.groupHeader}>
              <Layers3 size={16} aria-hidden="true" />
              <h2>{f.name}</h2>
              <span className={styles.count}>
                {rows.length} {rows.length === 1 ? "tarea" : "tareas"}
              </span>
            </header>
            <ul className={styles.rows} aria-label={`Tareas de ${f.name}`}>
              {rows.map((task) => {
                const status = statuses.find((s) => s.id === task.statusId);
                const overdue = taskOverdue(task, new Date(), timeZone) && !status?.isDone && !archived;
                return (
                  <li key={task.id} className={styles.row} onClick={() => open(task)}>
                    <div className={styles.heading}>
                      <button
                        type="button"
                        className={styles.title}
                        aria-label={`Abrir tarea: ${task.title}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          open(task);
                        }}
                      >
                        {status?.isDone ? (
                          <CircleCheck size={17} className={styles.completed} aria-hidden="true" />
                        ) : (
                          <span className="task-circle" aria-hidden="true" />
                        )}
                        <span>{task.title}</span>
                      </button>
                      <div className={styles.status}>
                        <StatusPill status={status} />
                      </div>
                    </div>
                    {(task.leader || task.labels.length > 0) && (
                      <div className={styles.context}>
                        <TaskPeopleSummary leader={task.leader} teamMembers={task.teamMembers} />
                        {task.labels.length > 0 && (
                          <div className={styles.labels} aria-label="Etiquetas">
                            {task.labels.map((label) => <LabelChip name={label} key={label} />)}
                          </div>
                        )}
                      </div>
                    )}
                    <div className={styles.details}>
                      <dl className={styles.properties}>
                        <div>
                          <dt>Prioridad</dt>
                          <dd><Priority priority={task.priority} /></dd>
                        </div>
                        <div>
                          <dt>Tipo</dt>
                          <dd>
                            <TaskCategoryChip kind="type" id={task.typeId} />
                            {!task.typeId && <span className={styles.unset}>Sin tipo</span>}
                          </dd>
                        </div>
                        <div>
                          <dt>Impacto</dt>
                          <dd>
                            <TaskCategoryChip kind="impact" id={task.impactId} />
                            {!task.impactId && <span className={styles.unset}>Sin impacto</span>}
                          </dd>
                        </div>
                      </dl>
                      {(task.applicationIds ?? []).length > 0 && <div className="application-chips"><ApplicationChips ids={task.applicationIds} /></div>}
                      <dl className={styles.schedule} title={taskScheduleLabel(task)}>
                        {task.startDate && (
                          <div>
                            <dt>Inicio</dt>
                            <dd>
                              <time dateTime={`${task.startDate}${task.startTime ? `T${task.startTime}` : ""}`}>
                                {shortDate(task.startDate)}
                                {task.startTime && ` · ${task.startTime}`}
                              </time>
                            </dd>
                          </div>
                        )}
                        <div className={overdue ? styles.overdue : undefined}>
                          <dt>Entrega{overdue && <span> · Vencida</span>}</dt>
                          <dd>
                            {task.dueDate ? (
                              <time dateTime={`${task.dueDate}${task.dueTime ? `T${task.dueTime}` : ""}`}>
                                {shortDate(task.dueDate)}
                                {task.dueTime && ` · ${task.dueTime}`}
                              </time>
                            ) : <span className={styles.unset}>Sin fecha</span>}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
export function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
