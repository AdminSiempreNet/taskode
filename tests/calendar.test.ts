import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dateKey,
  layoutTimedTasks,
  monthDates,
  shiftCalendar,
  slotTime,
  weekDates,
  taskDaySegment,
  taskOccursOnDay,
} from "../src/lib/calendar";
import type { Task } from "../src/lib/types";

test("los meses ocupan semanas completas de lunes a domingo, incluidos los años bisiestos", () => {
  for (const [year, month, length, days] of [
    [2021, 1, 28, 28],
    [2024, 1, 35, 29],
    [2026, 7, 42, 31],
    [2026, 9, 35, 31],
  ]) {
    const cells = monthDates(new Date(year, month, 15));
    assert.equal(cells.length, length);
    assert.equal(cells[0].getDay(), 1);
    assert.equal(cells.at(-1)?.getDay(), 0);
    assert.equal(
      cells.filter((date) => date.getMonth() === month).length,
      days,
    );
    assert.equal(new Set(cells.map(dateKey)).size, length);
  }
});

test("las semanas y la navegación cruzan correctamente meses y años", () => {
  const sunday = new Date(2027, 0, 3);
  assert.deepEqual(weekDates(sunday).map(dateKey), [
    "2026-12-28",
    "2026-12-29",
    "2026-12-30",
    "2026-12-31",
    "2027-01-01",
    "2027-01-02",
    "2027-01-03",
  ]);
  assert.equal(dateKey(shiftCalendar(sunday, "week", -1)), "2026-12-27");
  assert.equal(
    dateKey(shiftCalendar(new Date(2026, 11, 31), "month", 1)),
    "2027-01-01",
  );
  assert.equal(
    dateKey(shiftCalendar(new Date(2026, 2, 31), "month", -1)),
    "2026-02-01",
  );
});

test("las 48 celdas horarias representan medias horas locales desde 00:00 hasta 23:30", () => {
  const times = Array.from({ length: 48 }, (_, slot) => slotTime(slot));
  assert.equal(times[0], "00:00");
  assert.equal(times[19], "09:30");
  assert.equal(times.at(-1), "23:30");
  assert.equal(new Set(times).size, 48);
});

function task(id: string, dueTime: string | null, position = 0): Task {
  return {
    id,
    dueTime,
    position,
    projectId: "p",
    featureId: "f",
    statusId: "s",
    title: id,
    description: "",
    priority: "medium",
    typeId: null,
    impactId: null,
    ticketIds: [],
    dueDate: "2026-10-15",
    startDate: null,
    startTime: null,
    checklists: [],
    comments: [],
    statusHistory: [],
    archived: false,
    labels: [],
    clientIds: [],
    createdAt: "",
    updatedAt: "",
  };
}

test("los horarios coincidentes se reparten el ancho sin ocultarse y los consecutivos recuperan su espacio", () => {
  const tasks = [
    task("c", "09:30"),
    task("b", "09:15"),
    task("a", "09:00"),
    task("all-day", null),
    task("d", "10:00"),
    task("late", "23:59"),
  ];
  const layout = layoutTimedTasks(tasks);
  assert.deepEqual(
    layout.map((item) => [item.task.id, item.start, item.column, item.columns]),
    [
      ["a", 540, 0, 2],
      ["b", 555, 1, 2],
      ["c", 570, 0, 2],
      ["d", 600, 0, 1],
      ["late", 1439, 0, 1],
    ],
  );
  assert.deepEqual(
    layoutTimedTasks([task("a", "09:00"), task("b", "09:30")]).map(
      (item) => item.columns,
    ),
    [1, 1],
  );
  assert.equal(tasks[0].id, "c");
});

test("los intervalos ocupan su duración real y comparten espacio con todas las tareas solapadas", () => {
  const long = {
    ...task("long", "12:00"),
    startDate: "2026-10-15",
    startTime: "09:00",
  };
  const short = {
    ...task("short", "10:15"),
    startDate: "2026-10-15",
    startTime: "10:00",
  };
  const later = {
    ...task("later", "12:30"),
    startDate: "2026-10-15",
    startTime: "12:00",
  };
  assert.deepEqual(
    layoutTimedTasks([later, short, long], "2026-10-15").map(
      ({ task, start, end, columns }) => [task.id, start, end, columns],
    ),
    [
      ["long", 540, 720, 2],
      ["short", 600, 615, 2],
      ["later", 720, 750, 1],
    ],
  );
});

test("los intervalos de varios días se recortan por día y una entrega a medianoche no ocupa el día siguiente", () => {
  const range = {
    ...task("range", "02:00"),
    startDate: "2026-10-14",
    startTime: "22:30",
  };
  assert.deepEqual(taskDaySegment(range, "2026-10-14"), {
    start: 1350,
    end: 1440,
    timed: true,
  });
  assert.deepEqual(taskDaySegment(range, "2026-10-15"), {
    start: 0,
    end: 120,
    timed: true,
  });
  assert.equal(taskOccursOnDay(range, "2026-10-16"), false);
  assert.equal(
    taskOccursOnDay({ ...range, dueTime: "00:00" }, "2026-10-15"),
    false,
  );
  const allDay = {
    ...range,
    startTime: null,
    dueTime: null,
    dueDate: "2026-10-16",
  };
  for (const day of ["2026-10-14", "2026-10-15", "2026-10-16"])
    assert.deepEqual(taskDaySegment(allDay, day), {
      start: 0,
      end: 1440,
      timed: false,
    });
});

test("un inicio sin entrega se muestra en su día y admite hora opcional", () => {
  const startOnly = {
    ...task("start", null),
    dueDate: null,
    startDate: "2026-10-20",
    startTime: "11:15",
  };
  assert.deepEqual(taskDaySegment(startOnly, "2026-10-20"), {
    start: 675,
    end: 705,
    timed: true,
  });
  assert.deepEqual(
    taskDaySegment({ ...startOnly, startTime: null }, "2026-10-20"),
    { start: 0, end: 1440, timed: false },
  );
  assert.equal(taskDaySegment(startOnly, "2026-10-19"), null);
});
