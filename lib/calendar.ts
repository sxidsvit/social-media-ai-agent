import { utcToZonedParts, type PostView } from "@/lib/posts/shared";

// Date maths for the content calendar. Days are "YYYY-MM-DD" keys in the calendar's time zone, so the
// grid never depends on the browser's own zone; a key is turned into a Date only at UTC midnight.

export type CalendarView = "month" | "week";

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function keyToUtc(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function utcToKey(at: Date) {
  return at.toISOString().slice(0, 10);
}

export function addDays(key: string, days: number) {
  const at = keyToUtc(key);
  at.setUTCDate(at.getUTCDate() + days);
  return utcToKey(at);
}

export function addMonths(key: string, months: number) {
  const at = keyToUtc(key);
  // Day 1, so Jan 31 + 1 month doesn't skip February
  return utcToKey(new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + months, 1)));
}

// Weeks start on Monday
export function startOfWeek(key: string) {
  return addDays(key, -((keyToUtc(key).getUTCDay() + 6) % 7));
}

export function weekDays(key: string) {
  const start = startOfWeek(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// The weeks covering a month, Monday to Sunday (5 or 6 rows)
export function monthGrid(key: string) {
  const first = `${key.slice(0, 7)}-01`;
  const last = addDays(addMonths(first, 1), -1);
  const days: string[] = [];
  for (let day = startOfWeek(first); day <= last || days.length % 7 !== 0; day = addDays(day, 1)) days.push(day);
  return days;
}

export function sameMonth(a: string, b: string) {
  return a.slice(0, 7) === b.slice(0, 7);
}

export function todayKey(timeZone: string) {
  return utcToZonedParts(new Date(), timeZone).date;
}

// Labels for a day key; formatted in UTC because the key's UTC midnight is that day
export function formatDay(key: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(keyToUtc(key));
}

// "October 2026" or "Oct 12 – 18, 2026"
export function rangeLabel(view: CalendarView, key: string) {
  if (view === "month") return formatDay(key, { month: "long", year: "numeric" });
  const days = weekDays(key);
  const [first, last] = [days[0], days[6]];
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  if (sameMonth(first, last)) return `${formatDay(first, { month: "short", day: "numeric" })} – ${formatDay(last, { day: "numeric", year: "numeric" })}`;
  return `${formatDay(first, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" })} – ${formatDay(last, { month: "short", day: "numeric", year: "numeric" })}`;
}

// When a post sits on the calendar: its scheduled time, or when it went out
export function postMoment(post: Pick<PostView, "scheduledAt" | "publishedAt">) {
  return post.scheduledAt ?? post.publishedAt;
}

// A post's day and minutes after midnight in the calendar's zone
export function placePost(post: Pick<PostView, "scheduledAt" | "publishedAt">, timeZone: string) {
  const moment = postMoment(post);
  if (!moment) return null;
  const { date, time } = utcToZonedParts(new Date(moment), timeZone);
  const [hour, minute] = time.split(":").map(Number);
  return { date, time, minutes: hour * 60 + minute };
}

// "9:30 AM" in a zone
export function formatTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function hourLabel(hour: number) {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export function minutesToTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// "GMT+5:30" for a zone right now
export function zoneOffsetLabel(timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value ?? "";
}
