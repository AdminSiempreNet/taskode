"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  dateKey,
  HOUR_HEIGHT,
  layoutTimedTasks,
  monthDates,
  shiftCalendar,
  SLOT_MINUTES,
  slotTime,
  WEEKDAYS,
  weekDates,
  taskDaySegment,
  taskOccursOnDay,
  taskScheduleLabel,
  type CalendarMode,
} from "@/lib/calendar";
import type { Status, Task } from "@/lib/types";

type Props = {
  tasks: Task[];
  statuses: Status[];
  open: (task: Task) => void;
  add: (date: string, time?: string) => void;
  archived: boolean;
  busy: boolean;
};

function fullDate(date: Date) {
  return date.toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function ordered(tasks: Task[]) {
  return [...tasks].sort(
    (a, b) =>
      (a.startTime ?? a.dueTime ?? "").localeCompare(
        b.startTime ?? b.dueTime ?? "",
      ) || a.position - b.position,
  );
}

export function CalendarView({
  tasks,
  statuses,
  open,
  add,
  archived,
  busy,
}: Props) {
  const [mode, setMode] = useState<CalendarMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [agenda, setAgenda] = useState<string | null>(null);
  const openingTask = useRef(false);
  const monthGrid = useRef<HTMLDivElement>(null);
  const weekScroll = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(2);
  const month = monthDates(anchor);
  const week = weekDates(anchor);
  const weeks = month.length / 7;
  const today = dateKey(new Date());
  const undated = tasks.filter((task) => !task.dueDate && !task.startDate);
  const agendaTasks = ordered(
    agenda === "undated"
      ? undated
      : tasks.filter((task) => !!agenda && taskOccursOnDay(task, agenda)),
  );
  const color = (task: Task) =>
    statuses.find((status) => status.id === task.statusId)?.color ?? "#64748b";

  useEffect(() => {
    const grid = monthGrid.current;
    if (!grid || mode !== "month") return;
    const observer = new ResizeObserver(() => {
      setCapacity(
        Math.max(0, Math.floor((grid.clientHeight / weeks - 32) / 24)),
      );
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [mode, weeks]);

  useEffect(() => {
    if (mode === "week" && weekScroll.current)
      weekScroll.current.scrollTop = 8 * HOUR_HEIGHT;
  }, [mode]);

  const title =
    mode === "month"
      ? anchor.toLocaleDateString("es-CO", { month: "long", year: "numeric" })
      : `${week[0].toLocaleDateString("es-CO", { day: "numeric", month: "short", ...(week[0].getFullYear() !== week[6].getFullYear() ? { year: "numeric" } : {}) })} – ${week[6].toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })}`;

  function taskButton(task: Task) {
    return (
      <button
        key={task.id}
        type="button"
        className="calendar-task"
        style={{ borderLeftColor: color(task) }}
        onClick={() => open(task)}
        title={`${taskScheduleLabel(task)} · ${task.title}`}
        disabled={busy}
      >
        {(task.startTime || task.dueTime) && (
          <strong>{task.startTime || task.dueTime} </strong>
        )}
        {task.startDate && task.dueDate && task.startDate !== task.dueDate && (
          <span aria-label="Varios días">↔ </span>
        )}
        {task.title}
      </button>
    );
  }

  return (
    <section
      className="calendar-view"
      data-calendar-mode={mode}
      aria-label={
        archived ? "Calendario de tareas archivadas" : "Calendario de tareas"
      }
    >
      <div className="calendar-heading">
        <h2 aria-live="polite">{title}</h2>
        <div className="calendar-controls">
          <div
            className="calendar-mode"
            role="group"
            aria-label="Periodo del calendario"
          >
            <button
              type="button"
              aria-pressed={mode === "month"}
              onClick={() => setMode("month")}
            >
              Mes
            </button>
            <button
              type="button"
              aria-pressed={mode === "week"}
              onClick={() => setMode("week")}
            >
              Semana
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAnchor(new Date())}
          >
            Hoy
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={mode === "month" ? "Mes anterior" : "Semana anterior"}
            onClick={() => setAnchor(shiftCalendar(anchor, mode, -1))}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={mode === "month" ? "Mes siguiente" : "Semana siguiente"}
            onClick={() => setAnchor(shiftCalendar(anchor, mode, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      {mode === "month" ? (
        <div className="calendar-month">
          <div className="calendar-weekdays">
            {WEEKDAYS.map((day) => (
              <div key={day} className="calendar-weekday">
                {day}
              </div>
            ))}
          </div>
          <div
            ref={monthGrid}
            className="calendar-grid"
            style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
          >
            {month.map((date) => {
              const key = dateKey(date);
              const items = ordered(
                tasks.filter((task) => taskOccursOnDay(task, key)),
              );
              const visible =
                items.length <= capacity
                  ? items.length
                  : Math.max(0, capacity - 1);
              return (
                <div
                  key={key}
                  className={`calendar-cell ${date.getMonth() !== anchor.getMonth() ? "outside-month" : ""} ${key === today ? "today" : ""}`}
                >
                  {!archived && (
                    <button
                      type="button"
                      className="calendar-cell-create"
                      disabled={busy}
                      onClick={() => add(key)}
                      aria-label={`Añadir tarea el ${fullDate(date)}`}
                    />
                  )}
                  <div className="day-heading">
                    <span
                      className="day-number"
                      aria-current={key === today ? "date" : undefined}
                    >
                      {date.getDate()}
                    </span>
                    {!archived && (
                      <Plus size={13} className="day-add" aria-hidden="true" />
                    )}
                  </div>
                  <div className="calendar-day-tasks">
                    {items.slice(0, visible).map(taskButton)}
                    {items.length > visible && (
                      <button
                        type="button"
                        className="calendar-more"
                        onClick={() => setAgenda(key)}
                        aria-label={`Ver las ${items.length} tareas del ${fullDate(date)}`}
                      >
                        +{items.length - visible} más
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div
          ref={weekScroll}
          className="calendar-week-scroll"
          tabIndex={0}
          role="region"
          aria-label="Agenda semanal por horas. Desplázate para ver las 24 horas."
        >
          <div className="calendar-week-content">
            <div className="week-fixed-heading">
              <div className="week-days">
                <div className="week-time-zone" title="Horas locales">
                  Hora
                </div>
                {week.map((date, i) => (
                  <div
                    key={dateKey(date)}
                    className={`week-date ${dateKey(date) === today ? "today" : ""}`}
                  >
                    <span>{WEEKDAYS[i]}</span>
                    <span
                      className="day-number"
                      aria-current={
                        dateKey(date) === today ? "date" : undefined
                      }
                    >
                      {date.getDate()}
                    </span>
                  </div>
                ))}
              </div>
              <div className="week-all-day">
                <span className="week-all-day-label">Todo el día</span>
                {week.map((date) => {
                  const key = dateKey(date);
                  const items = tasks.filter(
                    (task) => taskDaySegment(task, key)?.timed === false,
                  );
                  return (
                    <div
                      key={key}
                      className={`week-all-day-cell ${key === today ? "today" : ""}`}
                    >
                      {!archived && (
                        <button
                          type="button"
                          className="calendar-cell-create"
                          disabled={busy}
                          onClick={() => add(key)}
                          aria-label={`Añadir tarea de todo el día el ${fullDate(date)}`}
                        />
                      )}
                      {items.slice(0, 2).map(taskButton)}
                      {items.length > 2 && (
                        <button
                          type="button"
                          className="calendar-more"
                          onClick={() => setAgenda(key)}
                        >
                          +{items.length - 2} más
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div
              className="week-hours"
              style={{ height: 24 * HOUR_HEIGHT + SLOT_MINUTES }}
            >
              <div className="week-time-labels" aria-hidden="true">
                {Array.from({ length: 24 }, (_, hour) => (
                  <span key={hour} style={{ top: hour * HOUR_HEIGHT }}>
                    {String(hour).padStart(2, "0")}:00
                  </span>
                ))}
              </div>
              {week.map((date) => {
                const key = dateKey(date);
                const items = layoutTimedTasks(tasks, key);
                return (
                  <div
                    key={key}
                    className={`week-day-hours ${key === today ? "today" : ""}`}
                  >
                    {Array.from({ length: 48 }, (_, slot) => (
                      <button
                        key={slot}
                        type="button"
                        className="week-slot"
                        style={{
                          top: slot * SLOT_MINUTES,
                          height: SLOT_MINUTES,
                        }}
                        disabled={busy || archived}
                        onClick={() => add(key, slotTime(slot))}
                        aria-label={`Añadir tarea el ${fullDate(date)} a las ${slotTime(slot)}`}
                      />
                    ))}
                    {items.map(({ task, start, end, column, columns }) => (
                      <button
                        key={task.id}
                        type="button"
                        className="calendar-task week-task"
                        disabled={busy}
                        onClick={() => open(task)}
                        title={`${taskScheduleLabel(task)} · ${task.title}`}
                        style={{
                          top: (start * HOUR_HEIGHT) / 60,
                          height: Math.max(
                            16,
                            ((end - start) * HOUR_HEIGHT) / 60 - 2,
                          ),
                          left: `calc(${(column * 100) / columns}% + 2px)`,
                          width: `calc(${100 / columns}% - 4px)`,
                          borderLeftColor: color(task),
                        }}
                      >
                        <strong>
                          {slotTime(start / SLOT_MINUTES)} –{" "}
                          {end === 1440
                            ? "24:00"
                            : slotTime(end / SLOT_MINUTES)}
                        </strong>
                        <span>{task.title}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="calendar-footer">
        <button
          type="button"
          className="undated-toggle"
          onClick={() => setAgenda("undated")}
        >
          <CalendarDays size={14} />
          {undated.length}{" "}
          {undated.length === 1 ? "tarea sin fecha" : "tareas sin fecha"}
          <ChevronRight size={13} />
        </button>
        <span>
          <i className="today-dot" />
          Hoy
        </span>
      </div>

      <Dialog
        open={agenda !== null}
        onOpenChange={(value) => {
          if (!value) setAgenda(null);
        }}
      >
        <DialogContent
          className="calendar-agenda"
          onCloseAutoFocus={(event) => {
            if (openingTask.current) {
              event.preventDefault();
              openingTask.current = false;
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {agenda === "undated"
                ? "Tareas sin fecha"
                : agenda
                  ? fullDate(new Date(`${agenda}T12:00:00`))
                  : "Tareas"}
            </DialogTitle>
            <DialogDescription>
              {archived
                ? "Tareas archivadas. Abre una para editarla o restaurarla."
                : "Abre una tarea para consultar o editar sus detalles."}
            </DialogDescription>
          </DialogHeader>
          <div className="calendar-agenda-tasks">
            {agendaTasks.length ? (
              agendaTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    openingTask.current = true;
                    setAgenda(null);
                    open(task);
                  }}
                >
                  <i style={{ background: color(task) }} />
                  <span>{task.title}</span>
                  <small>{taskScheduleLabel(task)}</small>
                </button>
              ))
            ) : (
              <p>
                {archived
                  ? "No hay tareas archivadas aquí."
                  : "Todas las tareas tienen una fecha asignada."}
              </p>
            )}
          </div>
          {agenda && agenda !== "undated" && !archived && (
            <Button
              disabled={busy}
              onClick={() => {
                openingTask.current = true;
                setAgenda(null);
                add(agenda);
              }}
            >
              <Plus size={15} />
              Añadir tarea este día
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
