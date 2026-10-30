"use client";

import { useEffect, useMemo, useOptimistic, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, Globe, Info, LayoutGrid, X } from "lucide-react";
import { reschedulePost, unschedulePost } from "@/app/dashboard/posts/actions";
import {
  addDays,
  addMonths,
  type CalendarView,
  formatDay,
  minutesToTime,
  monthGrid,
  placePost,
  rangeLabel,
  sameMonth,
  todayKey,
  weekDays,
  zoneOffsetLabel,
} from "@/lib/calendar";
import { formatInZone, isEditable, isTimeZone, listTimeZones, POST_PLATFORMS, type PostPlatform, type PostStatus, type PostView, utcToZonedParts, zonedTimeToUtc } from "@/lib/posts/shared";
import { platformName } from "@/lib/social-platforms";
import { cn } from "@/lib/utils";
import { CALENDAR_STATUS } from "@/components/calendar/calendar-post";
import { MonthView, type PlacedPost, WeekView } from "@/components/calendar/calendar-views";
import { PostDetails } from "@/components/calendar/post-details";
import { OverviewEmptyState } from "@/components/dashboard/overview/overview-panel";
import { CreatePostMenu } from "@/components/posts/create-post-menu";
import { PlatformTile } from "@/components/posts/platform-icon";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

// The campaign's content calendar: every post with a time, by month or week, in a time zone of the
// user's choosing (their browser's by default). Posts that haven't gone out can be dragged to another
// day or time, which reschedules them (in Blotato too). Picking a post opens its details on the
// right: inline on wide screens, in a sheet on smaller ones.

type Props = { posts: PostView[]; account: string; initials: string };
type Notice = { tone: "success" | "error"; text: string };

const PREFS_KEY = "calendar-prefs";

function readPrefs(): { view?: CalendarView; zone?: string } {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writePrefs(prefs: { view: CalendarView; zone: string }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private windows can refuse storage; the defaults are fine
  }
}

const WIDE_QUERY = "(min-width: 1280px)";
function useWide() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false
  );
}

const SUMMARY: { label: string; statuses: PostStatus[] }[] = [
  { label: "Scheduled", statuses: ["scheduled", "publishing"] },
  { label: "Published", statuses: ["published"] },
  { label: "Failed", statuses: ["failed"] },
  { label: "Drafts", statuses: ["draft", "cancelled"] },
];

export function CalendarBoard({ posts, account, initials }: Props) {
  const router = useRouter();
  const wide = useWide();
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [zones, setZones] = useState<{ value: string; label: string }[]>([]);
  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [platform, setPlatform] = useState<PostPlatform | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<number>>(() => new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [, startTransition] = useTransition();
  // A moved post shows at its new time until the server confirms (or refuses) it
  const [shownPosts, showMove] = useOptimistic(posts, (current, move: { id: number; at: string }) =>
    current.map((post) => (post.id === move.id ? { ...post, scheduledAt: move.at } : post))
  );

  // The zone (and saved view) come from the browser, so they're read after mount
  useEffect(() => {
    const prefs = readPrefs();
    const zone = prefs.zone && isTimeZone(prefs.zone) ? prefs.zone : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setTimeZone(zone);
    setCursor(todayKey(zone));
    if (prefs.view === "month" || prefs.view === "week") setView(prefs.view);
    setZones(listTimeZones());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (timeZone) writePrefs({ view, zone: timeZone });
  }, [view, timeZone]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.tone === "error" ? 8000 : 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const today = timeZone ? utcToZonedParts(new Date(now), timeZone) : null;
  const nowMinutes = today ? Number(today.time.slice(0, 2)) * 60 + Number(today.time.slice(3)) : 0;
  const days = useMemo(() => (cursor ? (view === "month" ? monthGrid(cursor) : weekDays(cursor)) : []), [cursor, view]);
  const rangeDays = useMemo(() => (view === "month" && cursor ? days.filter((day) => sameMonth(day, cursor)) : days), [days, view, cursor]);

  // Posts on each day, in time order, in the calendar's zone
  const postsByDay = useMemo(() => {
    const map = new Map<string, PlacedPost[]>();
    if (!timeZone) return map;
    for (const post of shownPosts) {
      if (platform && !post.platforms.includes(platform)) continue;
      const placed = placePost(post, timeZone);
      if (!placed) continue;
      map.set(placed.date, [...(map.get(placed.date) ?? []), { post, minutes: placed.minutes }]);
    }
    for (const items of map.values()) items.sort((a, b) => a.minutes - b.minutes);
    return map;
  }, [shownPosts, timeZone, platform]);

  const inRange = rangeDays.flatMap((day) => postsByDay.get(day) ?? []).map(({ post }) => post);
  // The first post after this range, to jump to from an empty month or week
  const nextDay = [...postsByDay.keys()].filter((day) => day > rangeDays[rangeDays.length - 1]).sort()[0];
  const selected = shownPosts.find((post) => post.id === selectedId) ?? null;

  function step(direction: 1 | -1) {
    if (!cursor) return;
    setCursor(view === "month" ? addMonths(cursor, direction) : addDays(cursor, 7 * direction));
  }

  function goToday() {
    if (timeZone) setCursor(todayKey(timeZone));
  }

  // Keyboard: T for today, M / W to switch views, [ and ] to step, Esc to close the details
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey || target.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      const key = event.key.toLowerCase();
      if (key === "t") goToday();
      else if (key === "m") setView("month");
      else if (key === "w") setView("week");
      else if (key === "[") step(-1);
      else if (key === "]") step(1);
      else if (key === "escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function setPending(id: number, pending: boolean) {
    setPendingIds((current) => {
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function move(postId: number, at: Date) {
    const post = shownPosts.find((item) => item.id === postId);
    if (!post || !timeZone || !isEditable(post.status) || pendingIds.has(postId)) return;
    if (post.scheduledAt && Date.parse(post.scheduledAt) === at.getTime()) return;
    if (at.getTime() < Date.now() + 60_000) {
      setNotice({ tone: "error", text: "Pick a time at least a minute from now." });
      return;
    }
    const iso = at.toISOString();
    setPending(postId, true);
    startTransition(async () => {
      showMove({ id: postId, at: iso });
      const result = await reschedulePost(postId, iso);
      setPending(postId, false);
      setNotice(
        result.error
          ? { tone: "error", text: result.error }
          : { tone: "success", text: `“${post.title}” ${post.status === "scheduled" ? "rescheduled" : "moved"} to ${formatInZone(iso, timeZone)}` }
      );
    });
  }

  function drop(postId: number, day: string, minutes: number | null) {
    const post = shownPosts.find((item) => item.id === postId);
    if (!post || !timeZone) return;
    // The month grid keeps the post's time of day
    const time = minutes !== null ? minutesToTime(minutes) : (placePost(post, timeZone)?.time ?? "09:00");
    move(postId, zonedTimeToUtc(day, time, timeZone));
  }

  function unschedule(postId: number) {
    const post = shownPosts.find((item) => item.id === postId);
    if (!post) return;
    setPending(postId, true);
    startTransition(async () => {
      const result = await unschedulePost(postId);
      setPending(postId, false);
      setNotice(result.error ? { tone: "error", text: result.error } : { tone: "success", text: `“${post.title}” is off the schedule and kept as a draft.` });
    });
  }

  // A new post in the composer, starting at the picked slot (from 9 AM, or the next hour today)
  function create(day: string, minutes: number | null) {
    if (!timeZone) return;
    let time = minutes !== null ? minutesToTime(minutes) : "09:00";
    if (minutes === null && today && day === today.date) time = nowMinutes >= 23 * 60 ? "23:30" : minutesToTime((Math.floor(nowMinutes / 60) + 1) * 60);
    router.push(`/dashboard/posts/create?${new URLSearchParams({ date: day, time, tz: timeZone })}`);
  }

  if (!timeZone || !cursor || !today) return <CalendarSkeleton />;

  const shared = {
    today: today.date,
    nowMinutes,
    postsByDay,
    timeZone,
    selectedId,
    pendingIds,
    dragging: draggingId !== null,
    onSelect: (id: number) => setSelectedId((current) => (current === id ? null : id)),
    onDragStart: (id: number) => setDraggingId(id),
    onDragEnd: () => setDraggingId(null),
    onDrop: drop,
    onCreate: create,
  };

  const details = selected && (
    <PostDetails
      key={selected.id}
      post={selected}
      timeZone={timeZone}
      account={account}
      initials={initials}
      pending={pendingIds.has(selected.id)}
      onClose={() => setSelectedId(null)}
      onMove={move}
      onUnschedule={unschedule}
    />
  );

  return (
    <div className="space-y-4">
      {/* Navigation and view */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-10 rounded-xl bg-card px-3.5" onClick={goToday} title="Today (T)">
            Today
          </Button>
          <div className="flex rounded-xl bg-card ring-1 ring-border/60">
            <Button variant="ghost" size="icon-lg" className="rounded-l-xl rounded-r-none" onClick={() => step(-1)} aria-label={`Previous ${view}`} title={`Previous ${view} ([)`}>
              <ChevronLeft />
            </Button>
            <span className="w-px bg-border/60" />
            <Button variant="ghost" size="icon-lg" className="rounded-l-none rounded-r-xl" onClick={() => step(1)} aria-label={`Next ${view}`} title={`Next ${view} (])`}>
              <ChevronRight />
            </Button>
          </div>
          <h2 className="ml-1 truncate text-lg font-semibold tracking-tight sm:text-xl" aria-live="polite">
            {rangeLabel(view, cursor)}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Calendar view" className="inline-flex rounded-2xl bg-card p-1 ring-1 ring-border/60">
            {(
              [
                { id: "month", label: "Month", Icon: LayoutGrid },
                { id: "week", label: "Week", Icon: CalendarRange },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                onClick={() => setView(id)}
                title={`${label} view (${label[0]})`}
                className={cn(
                  "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  view === id ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
          <CreatePostMenu />
        </div>
      </div>

      {/* Summary, platform filter and time zone */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {SUMMARY.map(({ label, statuses }) => {
            const count = inRange.filter((post) => statuses.includes(post.status)).length;
            if (!count && label !== "Scheduled") return null;
            return (
              <span key={label} className="flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 font-medium ring-1 ring-border/60">
                <span className={cn("size-1.5 rounded-full", CALENDAR_STATUS[statuses[0]].dot)} />
                <span className="tabular-nums">{count}</span>
                <span className="text-muted-foreground">{label.toLowerCase()}</span>
              </span>
            );
          })}
          <span className="text-muted-foreground">{view === "month" ? `in ${formatDay(cursor, { month: "long" })}` : "this week"}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1" aria-label="Filter by platform">
            {POST_PLATFORMS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={platform === id}
                title={platformName(id)}
                onClick={() => setPlatform(platform === id ? null : id)}
                className={cn(
                  "rounded-xl p-1 ring-1 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  platform === id ? "bg-card ring-foreground/40" : "opacity-60 ring-transparent grayscale hover:opacity-100 hover:grayscale-0",
                  platform === null && "opacity-100 grayscale-0"
                )}
              >
                <PlatformTile platform={id} className="size-6" />
              </button>
            ))}
          </div>
          <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
            <Globe className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <NativeSelect
              aria-label="Time zone"
              value={timeZone}
              onChange={(event) => setTimeZone(event.target.value)}
              className="w-full [&_select]:h-9 [&_select]:rounded-xl [&_select]:bg-card [&_select]:pl-8 [&_select]:text-xs"
            >
              {(zones.length ? zones : [{ value: timeZone, label: `${timeZone} (${zoneOffsetLabel(timeZone)})` }]).map((zone) => (
                <NativeSelectOption key={zone.value} value={zone.value}>
                  {zone.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-4">
        <section
          className="relative min-w-0 flex-1 overflow-hidden rounded-3xl bg-card shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_32px_-16px_rgb(15_23_42/0.12)] ring-1 ring-border/60"
          aria-label="Calendar"
        >
          <div key={`${view}-${view === "month" ? cursor.slice(0, 7) : days[0]}`} className="animate-in fade-in-0 duration-300">
            {view === "month" ? (
              <MonthView
                {...shared}
                days={days}
                cursor={cursor}
                onShowDay={(day) => {
                  setCursor(day);
                  setView("week");
                }}
              />
            ) : (
              <WeekView {...shared} days={days} />
            )}
          </div>

          {inRange.length === 0 && draggingId === null && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
              <div className="pointer-events-auto w-full max-w-sm rounded-3xl bg-card/95 shadow-xl ring-1 ring-border/60 backdrop-blur-md">
                <OverviewEmptyState
                  Icon={CalendarDays}
                  tone="bg-linear-to-br from-amber-400 to-orange-500 text-white"
                  glow="shadow-orange-500/30"
                  title={
                    posts.length === 0
                      ? "Your calendar is empty"
                      : platform
                        ? `No ${platformName(platform)} posts here`
                        : `Nothing planned ${view === "month" ? `in ${formatDay(cursor, { month: "long" })}` : "this week"}`
                  }
                  description={
                    posts.length === 0
                      ? "Schedule a post, or ask your AI team to plan some, and it will show up here."
                      : view === "month"
                        ? "Pick a day's + to plan a post there."
                        : "Double-click a time slot to plan a post there."
                  }
                >
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {nextDay && (
                      <Button variant="outline" className="h-10 rounded-xl" onClick={() => setCursor(nextDay)}>
                        Next post: {formatDay(nextDay, { month: "short", day: "numeric" })}
                        <ChevronRight data-icon="inline-end" />
                      </Button>
                    )}
                    <CreatePostMenu align="start" />
                  </div>
                </OverviewEmptyState>
              </div>
            </div>
          )}

          <p className="flex items-center gap-1.5 border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground">
            <Info className="size-3.5 shrink-0" />
            <span className="truncate">
              Drag a post to {view === "month" ? "another day" : "another day or time"} to reschedule it · Times in {timeZone.replace(/_/g, " ")} ({zoneOffsetLabel(timeZone)})
            </span>
          </p>
        </section>

        {wide && selected && (
          <aside className="sticky top-24 flex max-h-[calc(100svh-7rem)] w-[24rem] shrink-0 flex-col overflow-hidden rounded-3xl bg-card shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_32px_-16px_rgb(15_23_42/0.12)] ring-1 ring-border/60 animate-in fade-in-0 slide-in-from-right-4 duration-300">
            {details}
          </aside>
        )}
      </div>

      <Sheet open={!wide && !!selected} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-md">
          <SheetTitle className="sr-only">{selected?.title ?? "Post details"}</SheetTitle>
          {details}
        </SheetContent>
      </Sheet>

      {notice && (
        <div
          role="status"
          className={cn(
            "fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md animate-in items-start gap-2.5 rounded-2xl bg-popover p-3 pr-2 text-sm shadow-xl ring-1 fade-in-0 slide-in-from-bottom-4 sm:right-6 sm:left-auto sm:mx-0",
            notice.tone === "error" ? "ring-destructive/40" : "ring-border/60"
          )}
        >
          {notice.tone === "error" ? <X className="mt-0.5 size-4 shrink-0 text-destructive" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />}
          <span className="min-w-0 flex-1">{notice.text}</span>
          <Button variant="ghost" size="icon-xs" className="rounded-lg text-muted-foreground" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X />
          </Button>
        </div>
      )}
    </div>
  );
}

function CalendarSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="flex items-center gap-2">
        <Skeleton className="h-10 w-20 rounded-xl" />
        <Skeleton className="h-10 w-24 rounded-xl" />
        <Skeleton className="h-7 w-44 rounded-lg" />
      </div>
      <Skeleton className="h-8 w-64 rounded-full" />
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-3xl bg-border/60 ring-1 ring-border/60">
        {Array.from({ length: 35 }, (_, i) => (
          <div key={i} className="h-28 bg-card p-2">
            <Skeleton className="size-6 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
