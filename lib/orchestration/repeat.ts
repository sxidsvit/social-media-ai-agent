import { z } from "zod";
import type { RepeatRule, Weekday } from "@/lib/orchestration/types";

// Repeat rules for scheduled tasks. Shared by the server and the browser: no Node-only APIs. Times
// are worked out in the rule's time zone, so a 9:00 report stays at 9:00 local time across DST.

export const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY_NAMES: Record<Weekday, string> = { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" };

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const RepeatRuleSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]),
  interval: z.number().int().min(1).max(12),
  weekdays: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).nullish(),
  monthDay: z.number().int().min(1).max(31).nullish(),
  timeZone: z.string().refine(isValidTimeZone, "Unknown time zone"),
  until: z.string().nullish(),
  count: z.number().int().min(1).max(366).nullish(),
});

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function localParts(date: Date, timeZone: string): LocalParts {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

// The UTC instant of a local wall-clock time in timeZone. Corrects the offset twice so times next to
// a DST change land on the right side of it.
function zonedTimeToUtc(local: Omit<LocalParts, "weekday">, timeZone: string) {
  const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  let utc = wall;
  for (let i = 0; i < 2; i++) {
    const seen = localParts(new Date(utc), timeZone);
    const offset = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second) - utc;
    utc = wall - offset;
  }
  return new Date(utc);
}

// Calendar date `days` after a local date, as plain numbers
function addDays(local: LocalParts, days: number) {
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay() };
}

// Days since the start (Sunday) of the week, for counting weeks between two dates
function weekStartDay(year: number, month: number, day: number, weekday: number) {
  return Math.round(Date.UTC(year, month - 1, day - weekday) / 86_400_000);
}

// The run after `from` (the run that just happened, or the first run), or null when the rule has
// run out. `runsSoFar` counts runs including the one at `from`.
export function nextOccurrence(rule: RepeatRule, from: Date, runsSoFar: number): Date | null {
  if (rule.count && runsSoFar >= rule.count) return null;

  const local = localParts(from, rule.timeZone);
  const time = { hour: local.hour, minute: local.minute, second: local.second };
  let next: Date;

  if (rule.frequency === "daily") {
    next = zonedTimeToUtc({ ...addDays(local, rule.interval), ...time }, rule.timeZone);
  } else if (rule.frequency === "monthly") {
    const target = new Date(Date.UTC(local.year, local.month - 1 + rule.interval, 1));
    const year = target.getUTCFullYear();
    const month = target.getUTCMonth() + 1;
    // The 31st becomes the last day of shorter months
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    next = zonedTimeToUtc({ year, month, day: Math.min(rule.monthDay ?? local.day, lastDay), ...time }, rule.timeZone);
  } else {
    const days = new Set((rule.weekdays?.length ? rule.weekdays : [WEEKDAYS[local.weekday]]).map((day) => WEEKDAYS.indexOf(day)));
    const startWeek = weekStartDay(local.year, local.month, local.day, local.weekday);
    let found: ReturnType<typeof addDays> | null = null;
    for (let offset = 1; offset <= 7 * rule.interval + 7 && !found; offset++) {
      const candidate = addDays(local, offset);
      const weeks = (weekStartDay(candidate.year, candidate.month, candidate.day, candidate.weekday) - startWeek) / 7;
      if (days.has(candidate.weekday) && weeks % rule.interval === 0) found = candidate;
    }
    if (!found) return null;
    next = zonedTimeToUtc({ ...found, ...time }, rule.timeZone);
  }

  if (rule.until && next.getTime() > new Date(rule.until).getTime()) return null;
  return next;
}

// Pins the parts of a rule that are taken from the first run, so later runs don't drift
export function anchorRepeat(rule: RepeatRule, firstRun: Date): RepeatRule {
  const local = localParts(firstRun, rule.timeZone);
  if (rule.frequency === "monthly") return { ...rule, monthDay: rule.monthDay ?? local.day };
  if (rule.frequency === "weekly" && !rule.weekdays?.length) return { ...rule, weekdays: [WEEKDAYS[local.weekday]] };
  return rule;
}

// "Every week on Mon, Thu (Asia/Kolkata)"
export function describeRepeat(rule: RepeatRule) {
  const unit = { daily: "day", weekly: "week", monthly: "month" }[rule.frequency];
  let text = rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;
  if (rule.frequency === "weekly" && rule.weekdays?.length) text += ` on ${rule.weekdays.map((day) => WEEKDAY_NAMES[day]).join(", ")}`;
  if (rule.count) text += `, ${rule.count} times`;
  if (rule.until) text += `, until ${new Date(rule.until).toISOString().slice(0, 10)}`;
  return `${text} (${rule.timeZone})`;
}
