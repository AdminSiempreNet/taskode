import { Temporal } from "@js-temporal/polyfill";

export const DEFAULT_TIME_ZONE = "America/Bogota";
export function validTimeZone(value: string) {
  if (!value || value.length > 100 || /^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
export function projectClock(now: Date, timeZone = DEFAULT_TIME_ZONE) {
  const local = Temporal.Instant.fromEpochMilliseconds(
    now.getTime(),
  ).toZonedDateTimeISO(timeZone);
  return {
    day: local.toPlainDate().toString(),
    time: local.toPlainTime().toString({ smallestUnit: "second" }),
  };
}
export function taskOverdue(
  task: { dueDate: string | null; dueTime: string | null },
  now: Date,
  timeZone = DEFAULT_TIME_ZONE,
) {
  if (!task.dueDate) return false;
  if (task.dueTime)
    return (
      projectInstant(task.dueDate, task.dueTime, timeZone).epochMilliseconds <
      now.getTime()
    );
  return task.dueDate < projectClock(now, timeZone).day;
}
// Existing task fields remain wall-clock values in their project's zone.
// Temporal's compatible policy advances nonexistent times and chooses the first
// occurrence of ambiguous times, consistently for all users.
export function projectInstant(
  date: string,
  time: string,
  timeZone = DEFAULT_TIME_ZONE,
) {
  return Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(
    timeZone,
    { disambiguation: "compatible" },
  );
}
export function reminderTimes(
  date: string,
  time: string | null,
  timeZone: string,
  offset: number,
  dateOnlyTime: string,
) {
  if (!time && offset < 1440) return null;
  const deadline = time
    ? projectInstant(date, time, timeZone)
    : projectInstant(date, "00:00", timeZone).add({ days: 1 });
  const scheduled = time
    ? deadline.subtract({ minutes: offset })
    : projectInstant(date, dateOnlyTime, timeZone).subtract({
        days: offset / 1440,
      });
  return {
    scheduledFor: new Date(scheduled.epochMilliseconds),
    expiresAt: new Date(deadline.epochMilliseconds),
  };
}
