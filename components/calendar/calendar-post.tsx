"use client";

/* eslint-disable @next/next/no-img-element -- post images are remote ImageKit URLs of any size */
import { ImageIcon, Play } from "lucide-react";
import { formatTime, postMoment } from "@/lib/calendar";
import { imageKitThumbnail } from "@/lib/imagekit/transformations";
import { isEditable, isVideo, type PostMedia, type PostStatus, type PostView } from "@/lib/posts/shared";
import { cn } from "@/lib/utils";
import { PlatformTile } from "@/components/posts/platform-icon";

// A post as it sits on the calendar: a compact chip in the month grid, a timed card in the week grid.
// Both are drag handles for rescheduling (posts that haven't gone out yet) and open the details panel.

export const CALENDAR_STATUS: Record<PostStatus, { label: string; accent: string; badge: string; dot: string }> = {
  scheduled: { label: "Scheduled", accent: "before:bg-blue-500", badge: "bg-blue-500/10 text-blue-700 dark:text-blue-300", dot: "bg-blue-500" },
  publishing: { label: "Publishing", accent: "before:bg-amber-500", badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300", dot: "bg-amber-500 animate-pulse" },
  published: { label: "Published", accent: "before:bg-emerald-500", badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  failed: { label: "Failed", accent: "before:bg-red-500", badge: "bg-red-500/10 text-red-700 dark:text-red-300", dot: "bg-red-500" },
  draft: { label: "Draft", accent: "before:bg-slate-400", badge: "bg-slate-500/10 text-slate-700 dark:text-slate-300", dot: "bg-slate-400" },
  cancelled: { label: "Cancelled", accent: "before:bg-slate-300", badge: "bg-slate-500/10 text-slate-600 dark:text-slate-400", dot: "bg-slate-300" },
};

// The id of the post being dragged, in the drag's data
export const DRAG_TYPE = "application/x-calendar-post";

export function PostThumb({ media, className }: { media: PostMedia | undefined; className?: string }) {
  return (
    <span className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground", className)}>
      {media && isVideo(media) ? (
        <>
          <video src={media.url} muted playsInline preload="metadata" className="size-full object-cover" />
          <Play className="absolute size-3 fill-white text-white drop-shadow" />
        </>
      ) : media ? (
        <img src={imageKitThumbnail(media.url, 160)} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <ImageIcon className="size-3.5" />
      )}
    </span>
  );
}

function PlatformStack({ post, size }: { post: PostView; size: string }) {
  return (
    <span className="flex shrink-0 -space-x-1">
      {post.platforms.map((platform) => (
        <PlatformTile key={platform} platform={platform} className={cn("rounded-[5px] ring-1 ring-card [&_svg]:size-2.5", size)} />
      ))}
    </span>
  );
}

type PostItemProps = {
  post: PostView;
  timeZone: string;
  selected: boolean;
  pending: boolean;
  onSelect: (id: number) => void;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
};

function dragProps({ post, pending, onDragStart, onDragEnd }: PostItemProps) {
  const draggable = isEditable(post.status) && !pending;
  return {
    draggable,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.setData(DRAG_TYPE, String(post.id));
      event.dataTransfer.effectAllowed = "move";
      onDragStart(post.id);
    },
    onDragEnd,
    "aria-roledescription": draggable ? "Draggable post" : undefined,
  };
}

const BASE =
  "group/post relative w-full overflow-hidden bg-card text-left ring-1 ring-border/70 outline-none transition-[box-shadow,translate,opacity] before:absolute before:inset-y-0 before:left-0 before:w-[3px] hover:-translate-y-px hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/60";

// Month grid: thumbnail, title, time and platforms on one line
export function PostChip(props: PostItemProps) {
  const { post, timeZone, selected, pending, onSelect } = props;
  const moment = postMoment(post);
  return (
    <button
      type="button"
      {...dragProps(props)}
      onClick={() => onSelect(post.id)}
      title={post.title}
      className={cn(
        BASE,
        "flex items-center gap-1.5 rounded-lg py-1 pr-1 pl-2 shadow-[0_1px_2px_rgb(15_23_42/0.05)]",
        CALENDAR_STATUS[post.status].accent,
        isEditable(post.status) && "cursor-grab active:cursor-grabbing",
        (post.status === "draft" || post.status === "cancelled") && "bg-muted/50",
        selected && "ring-2 ring-primary",
        pending && "animate-pulse opacity-60"
      )}
    >
      <PostThumb media={post.media[0]} className="hidden size-7 sm:flex" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] leading-tight font-semibold">{post.title}</span>
        {moment && <span className="block truncate text-[10px] leading-tight text-muted-foreground tabular-nums">{formatTime(moment, timeZone)}</span>}
      </span>
      <span className="hidden lg:flex">
        <PlatformStack post={post} size="size-4" />
      </span>
    </button>
  );
}

// Week grid: a taller card placed at the post's time
export function PostBlock(props: PostItemProps & { style?: React.CSSProperties }) {
  const { post, timeZone, selected, pending, onSelect, style } = props;
  const moment = postMoment(post);
  return (
    <button
      type="button"
      {...dragProps(props)}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(post.id);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      title={post.title}
      style={style}
      className={cn(
        BASE,
        "absolute flex items-start gap-2 rounded-xl p-1.5 pl-2.5 shadow-[0_1px_2px_rgb(15_23_42/0.06),0_8px_20px_-14px_rgb(15_23_42/0.35)]",
        CALENDAR_STATUS[post.status].accent,
        isEditable(post.status) && "cursor-grab active:cursor-grabbing",
        (post.status === "draft" || post.status === "cancelled") && "bg-muted/80",
        selected && "z-10 ring-2 ring-primary",
        pending && "animate-pulse opacity-60"
      )}
    >
      <PostThumb media={post.media[0]} className="hidden size-9 rounded-lg xl:flex" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs leading-tight font-semibold">{post.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5">
          {moment && <span className="truncate text-[10px] text-muted-foreground tabular-nums">{formatTime(moment, timeZone)}</span>}
          <span className="ml-auto hidden sm:flex">
            <PlatformStack post={post} size="size-3.5" />
          </span>
        </span>
      </span>
    </button>
  );
}
