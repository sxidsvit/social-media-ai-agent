"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { formatDay, hourLabel, sameMonth, WEEKDAYS } from "@/lib/calendar";
import type { PostView } from "@/lib/posts/shared";
import { cn } from "@/lib/utils";
import { DRAG_TYPE, PostBlock, PostChip } from "@/components/calendar/calendar-post";

// The month and week grids. Both take posts already placed in the calendar's time zone and report
// drops as (day, minutes): the month grid has no times, so its drops keep the post's time (null).

export type PlacedPost = { post: PostView; minutes: number };

type Shared = {
  today: string;
  // Minutes after midnight in the calendar's zone, for the "now" line and past slots
  nowMinutes: number;
  postsByDay: Map<string, PlacedPost[]>;
  timeZone: string;
  selectedId: number | null;
  pendingIds: Set<number>;
  dragging: boolean;
  onSelect: (id: number) => void;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
  onDrop: (postId: number, day: string, minutes: number | null) => void;
  onCreate: (day: string, minutes: number | null) => void;
};

function droppedId(event: React.DragEvent) {
  const id = Number(event.dataTransfer.getData(DRAG_TYPE));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isDragOfPost(event: React.DragEvent) {
  return event.dataTransfer.types.includes(DRAG_TYPE);
}

// Month

const MAX_CHIPS = 3;

export function MonthView({ days, cursor, onShowDay, ...shared }: Shared & { days: string[]; cursor: string; onShowDay: (day: string) => void }) {
  const { today, postsByDay, dragging, onDrop, onCreate } = shared;
  const [over, setOver] = useState<string | null>(null);

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-7 border-b border-border/60 bg-muted/30">
        {WEEKDAYS.map((day, i) => (
          <span key={day} className={cn("px-2 py-2.5 text-center text-[11px] font-semibold tracking-wide text-muted-foreground uppercase sm:text-left sm:px-3", i >= 5 && "text-muted-foreground/70")}>
            <span className="sm:hidden">{day[0]}</span>
            <span className="hidden sm:inline">{day}</span>
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7" style={{ gridAutoRows: "minmax(7.5rem, 1fr)" }}>
        {days.map((day, index) => {
          const items = postsByDay.get(day) ?? [];
          const past = day < today;
          const inMonth = sameMonth(day, cursor);
          const isToday = day === today;
          const extra = items.length - MAX_CHIPS;
          return (
            <div
              key={day}
              onDragOver={(event) => {
                if (past || !isDragOfPost(event)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (over !== day) setOver(day);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver((current) => (current === day ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                setOver(null);
                const id = droppedId(event);
                if (id && !past) onDrop(id, day, null);
              }}
              className={cn(
                "group/day relative flex min-w-0 flex-col gap-1 border-border/60 p-1 transition-colors sm:p-1.5",
                index % 7 !== 6 && "border-r",
                index < days.length - 7 && "border-b",
                !inMonth && "bg-muted/25",
                past && "bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--color-muted)_6px_7px)]",
                dragging && !past && "bg-primary/[0.02]",
                over === day && "bg-primary/10 ring-2 ring-primary/50 ring-inset"
              )}
            >
              <div className="flex items-center justify-between px-0.5">
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums sm:size-7",
                    isToday ? "bg-primary text-primary-foreground shadow-md shadow-primary/30" : inMonth ? "text-foreground" : "text-muted-foreground/60"
                  )}
                >
                  {Number(day.slice(8))}
                </span>
                {!past && (
                  <button
                    type="button"
                    onClick={() => onCreate(day, null)}
                    aria-label={`Create a post on ${formatDay(day, { month: "long", day: "numeric" })}`}
                    className="hidden size-6 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-opacity outline-none group-hover/day:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 sm:flex"
                  >
                    <Plus className="size-3.5" />
                  </button>
                )}
              </div>
              {/* Phones get dots; the chips need room */}
              {items.length > 0 && (
                <button type="button" onClick={() => onShowDay(day)} className="flex flex-wrap justify-center gap-0.5 px-0.5 sm:hidden" aria-label={`${items.length} posts`}>
                  {items.slice(0, 4).map(({ post }) => (
                    <span key={post.id} className="size-1.5 rounded-full bg-primary" />
                  ))}
                </button>
              )}
              <div className="hidden min-w-0 flex-col gap-1 sm:flex">
                {items.slice(0, extra > 0 ? MAX_CHIPS - 1 : MAX_CHIPS).map(({ post }) => (
                  <PostChip
                    key={post.id}
                    post={post}
                    timeZone={shared.timeZone}
                    selected={shared.selectedId === post.id}
                    pending={shared.pendingIds.has(post.id)}
                    onSelect={shared.onSelect}
                    onDragStart={shared.onDragStart}
                    onDragEnd={shared.onDragEnd}
                  />
                ))}
                {extra > 0 && (
                  <button
                    type="button"
                    onClick={() => onShowDay(day)}
                    className="rounded-md px-1.5 py-0.5 text-left text-[11px] font-semibold text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    +{extra + 1} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Week

const HOUR_PX = 60;
const SNAP_MINUTES = 15;
// A card is about this tall; posts closer together than this sit side by side
const BLOCK_MINUTES = 52;

// Side-by-side lanes for posts whose cards would overlap
function layoutDay(items: PlacedPost[]) {
  const sorted = [...items].sort((a, b) => a.minutes - b.minutes || a.post.id - b.post.id);
  const placed: { item: PlacedPost; lane: number; lanes: number }[] = [];
  let cluster: typeof placed = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const close = () => {
    for (const entry of cluster) entry.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    if (item.minutes >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= item.minutes);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.minutes + BLOCK_MINUTES;
    clusterEnd = Math.max(clusterEnd, item.minutes + BLOCK_MINUTES);
    const entry = { item, lane, lanes: 1 };
    cluster.push(entry);
    placed.push(entry);
  }
  close();
  return placed;
}

function minutesAt(event: React.MouseEvent, element: HTMLElement, snap: number) {
  const y = event.clientY - element.getBoundingClientRect().top;
  const minutes = Math.round((y / HOUR_PX) * 60 / snap) * snap;
  return Math.min(Math.max(minutes, 0), 24 * 60 - snap);
}

export function WeekView({ days, ...shared }: Shared & { days: string[] }) {
  const { today, nowMinutes, postsByDay, dragging, onDrop, onCreate } = shared;
  const scroller = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState<{ day: string; minutes: number } | null>(null);

  // Open on the working day (or just before now, this week)
  useEffect(() => {
    const start = days.includes(today) ? Math.max(nowMinutes - 120, 0) : 7 * 60;
    scroller.current?.scrollTo({ top: (start / 60) * HOUR_PX });
    // Only when the week changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0]]);

  const isPast = (day: string, minutes: number) => day < today || (day === today && minutes < nowMinutes);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[44rem]">
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-border/60 bg-muted/30">
          <span />
          {days.map((day) => {
            const isToday = day === today;
            const count = postsByDay.get(day)?.length ?? 0;
            return (
              <div key={day} className="flex items-center gap-2 border-l border-border/60 px-2.5 py-2">
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-xl text-sm font-semibold tabular-nums",
                    isToday ? "bg-primary text-primary-foreground shadow-md shadow-primary/30" : day < today ? "text-muted-foreground" : "bg-card ring-1 ring-border/60"
                  )}
                >
                  {Number(day.slice(8))}
                </span>
                <span className="min-w-0 leading-tight">
                  <span className={cn("block text-[11px] font-semibold tracking-wide uppercase", isToday ? "text-primary" : "text-muted-foreground")}>{formatDay(day, { weekday: "short" })}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{count ? `${count} post${count === 1 ? "" : "s"}` : "—"}</span>
                </span>
              </div>
            );
          })}
        </div>

        <div ref={scroller} className="relative max-h-[min(42rem,calc(100svh-17rem))] overflow-y-auto overscroll-contain">
          <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]" style={{ height: 24 * HOUR_PX }}>
            <div className="relative">
              {Array.from({ length: 23 }, (_, i) => (
                <span key={i} className="absolute right-2 -translate-y-1/2 text-[10px] font-medium text-muted-foreground tabular-nums" style={{ top: (i + 1) * HOUR_PX }}>
                  {hourLabel(i + 1)}
                </span>
              ))}
            </div>
            {days.map((day) => {
              const items = layoutDay(postsByDay.get(day) ?? []);
              const pastHeight = day < today ? 24 * HOUR_PX : day === today ? (nowMinutes / 60) * HOUR_PX : 0;
              const target = over?.day === day ? over : null;
              return (
                <div
                  key={day}
                  className={cn("relative border-l border-border/60", dragging && "bg-primary/[0.015]")}
                  style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${HOUR_PX - 1}px, var(--color-border) ${HOUR_PX - 1}px ${HOUR_PX}px)` }}
                  onDragOver={(event) => {
                    if (!isDragOfPost(event)) return;
                    const minutes = minutesAt(event, event.currentTarget, SNAP_MINUTES);
                    if (isPast(day, minutes)) {
                      if (target) setOver(null);
                      return;
                    }
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (target?.minutes !== minutes) setOver({ day, minutes });
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver((current) => (current?.day === day ? null : current));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setOver(null);
                    const id = droppedId(event);
                    const minutes = minutesAt(event, event.currentTarget, SNAP_MINUTES);
                    if (id && !isPast(day, minutes)) onDrop(id, day, minutes);
                  }}
                  onDoubleClick={(event) => {
                    const minutes = minutesAt(event, event.currentTarget, 30);
                    if (!isPast(day, minutes)) onCreate(day, minutes);
                  }}
                >
                  {pastHeight > 0 && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 top-0 bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--color-muted)_6px_7px)] opacity-70"
                      style={{ height: pastHeight }}
                    />
                  )}
                  {day === today && (
                    <div aria-hidden className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: (nowMinutes / 60) * HOUR_PX }}>
                      <span className="-ml-1 size-2 rounded-full bg-red-500 shadow-[0_0_0_3px_rgb(239_68_68/0.2)]" />
                      <span className="h-px flex-1 bg-red-500" />
                    </div>
                  )}
                  {target && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-1 z-30 flex h-9 items-start rounded-xl border-2 border-dashed border-primary bg-primary/10 px-2 py-1"
                      style={{ top: (target.minutes / 60) * HOUR_PX }}
                    >
                      <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground tabular-nums">
                        {timeLabel(target.minutes)}
                      </span>
                    </div>
                  )}
                  {items.map(({ item, lane, lanes }) => (
                    <PostBlock
                      key={item.post.id}
                      post={item.post}
                      timeZone={shared.timeZone}
                      selected={shared.selectedId === item.post.id}
                      pending={shared.pendingIds.has(item.post.id)}
                      onSelect={shared.onSelect}
                      onDragStart={shared.onDragStart}
                      onDragEnd={shared.onDragEnd}
                      style={{
                        top: (item.minutes / 60) * HOUR_PX + 1,
                        height: (BLOCK_MINUTES / 60) * HOUR_PX - 2,
                        left: `calc(${(lane / lanes) * 100}% + 3px)`,
                        width: `calc(${100 / lanes}% - 6px)`,
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// "9:30 AM" for minutes after midnight
function timeLabel(minutes: number) {
  const [hour, minute] = [Math.floor(minutes / 60), minutes % 60];
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}
