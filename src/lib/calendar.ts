import type { Task } from "./types";

export type CalendarMode = "month" | "week";
export const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export const HOUR_HEIGHT = 60;
export const SLOT_MINUTES = 30;

export function dateKey(date: Date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function weekDates(date: Date) {
  const start = addDays(date, -((date.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function monthDates(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const count = Math.ceil((offset + days) / 7) * 7;
  return Array.from({ length: count }, (_, i) => addDays(first, i - offset));
}

export function shiftCalendar(
  date: Date,
  mode: CalendarMode,
  direction: number,
) {
  return mode === "week"
    ? addDays(date, 7 * direction)
    : new Date(date.getFullYear(), date.getMonth() + direction, 1);
}

export function timeMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function slotTime(slot: number) {
  const minutes = slot * SLOT_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export type TimedTask = {
  task: Task;
  start: number;
  end: number;
  column: number;
  columns: number;
};

// Clip an interval to a local calendar day. Timed end points are exclusive;
// dates without times include the entire final day. A lone time keeps a 30 min slot.
export function taskDaySegment(
  task: Task,
  day: string,
): { start: number; end: number; timed: boolean } | null {
  const first = task.startDate || task.dueDate;
  const last = task.dueDate || task.startDate;
  if (!first || !last || day < first || day > last) return null;
  if (task.startDate && task.dueDate) {
    const timed = !!(task.startTime || task.dueTime);
    const start = day === first ? timeMinutes(task.startTime || "00:00") : 0;
    const end =
      day === last ? (task.dueTime ? timeMinutes(task.dueTime) : 1440) : 1440;
    return end > start ? { start, end, timed } : null;
  }
  const time = task.startDate ? task.startTime : task.dueTime;
  const start = time ? timeMinutes(time) : 0;
  return {
    start,
    end: time ? Math.min(1440, start + SLOT_MINUTES) : 1440,
    timed: !!time,
  };
}

export function taskOccursOnDay(task: Task, day: string): boolean {
  return taskDaySegment(task, day) !== null;
}

export function taskScheduleLabel(task: Task): string {
  if (task.startDate && task.dueDate)
    return `${task.startDate}${task.startTime ? ` ${task.startTime}` : ""} → ${task.dueDate}${task.dueTime ? ` ${task.dueTime}` : ""}`;
  const date = task.startDate || task.dueDate;
  const time = task.startDate ? task.startTime : task.dueTime;
  return date ? `${date}${time ? ` · ${time}` : ""}` : "Sin fecha";
}

// Connected overlaps share the day width, including intervals of different lengths.
export function layoutTimedTasks(tasks: Task[], day?: string): TimedTask[] {
  const sorted = tasks
    .flatMap((task) => {
      const segment = taskDaySegment(
        task,
        day ?? task.startDate ?? task.dueDate ?? "",
      );
      return segment?.timed
        ? [{ task, start: segment.start, end: segment.end }]
        : [];
    })
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.task.position - b.task.position ||
        a.task.id.localeCompare(b.task.id),
    );
  const result: TimedTask[] = [];
  let group: TimedTask[] = [];
  let ends: number[] = [];
  let groupEnd = -1;
  function finishGroup() {
    result.push(...group.map((item) => ({ ...item, columns: ends.length })));
    group = [];
    ends = [];
  }
  for (const item of sorted) {
    if (item.start >= groupEnd) finishGroup();
    let column = ends.findIndex((end) => end <= item.start);
    if (column === -1) column = ends.length;
    ends[column] = item.end;
    groupEnd = Math.max(...ends);
    group.push({ ...item, column, columns: 1 });
  }
  finishGroup();
  return result;
}
