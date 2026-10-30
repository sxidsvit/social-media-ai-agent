"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CalendarX2, CheckCircle2, Clock, ExternalLink, Globe, Hash, Layers, PenLine, Sparkles, Type, X, XCircle } from "lucide-react";
import { placePost, postMoment } from "@/lib/calendar";
import { checkPost, formatInZone, isEditable, isVideo, mediaForPlatform, postCaption, type PostPlatform, type PostView, zonedTimeToUtc } from "@/lib/posts/shared";
import { PLATFORM_RULES } from "@/lib/social-platforms";
import { cn } from "@/lib/utils";
import { CALENDAR_STATUS } from "@/components/calendar/calendar-post";
import { PLATFORM_STYLES, PlatformTile } from "@/components/posts/platform-icon";
import { PlatformPreview } from "@/components/posts/platform-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

// The post picked on the calendar: when it goes out, how it looks and what's checked on each of its
// platforms, and ways to edit, reschedule or unschedule it.

type Props = {
  post: PostView;
  timeZone: string;
  account: string;
  initials: string;
  pending: boolean;
  onClose: () => void;
  onMove: (postId: number, at: Date) => void;
  onUnschedule: (postId: number) => void;
};

function relative(iso: string) {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  const abs = Math.abs(minutes);
  const text = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} days`;
  return minutes >= 0 ? `in ${text}` : `${text} ago`;
}

export function PostDetails({ post, timeZone, account, initials, pending, onClose, onMove, onUnschedule }: Props) {
  const [platform, setPlatform] = useState<PostPlatform>(post.platforms[0] ?? "instagram");
  const shown = post.platforms.includes(platform) ? platform : (post.platforms[0] ?? "instagram");
  const status = CALENDAR_STATUS[post.status];
  const moment = postMoment(post);
  const editable = isEditable(post.status);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start gap-3 border-b border-border/60 p-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className={cn("flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", status.badge)}>
              <span className={cn("size-1.5 rounded-full", status.dot)} />
              {status.label}
            </span>
            <span
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                post.source === "ai" ? "bg-violet-500/10 text-violet-700 dark:text-violet-300" : "bg-muted text-muted-foreground"
              )}
            >
              {post.source === "ai" ? <Sparkles className="size-3" /> : <PenLine className="size-3" />}
              {post.source === "ai" ? "AI" : "Manual"}
            </span>
          </div>
          <h2 className="text-base leading-snug font-semibold tracking-tight break-words">{post.title}</h2>
        </div>
        <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1 rounded-lg text-muted-foreground" onClick={onClose} aria-label="Close details">
          <X />
        </Button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {moment && (
          <div className="rounded-2xl bg-muted/50 p-3 ring-1 ring-border/60">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="size-4 text-muted-foreground" />
              {formatInZone(moment, timeZone)}
            </p>
            <p className="mt-0.5 pl-6 text-xs text-muted-foreground">
              {post.status === "published" ? "Went out" : post.status === "scheduled" ? "Goes live" : "Planned"} {relative(moment)}
            </p>
            {post.timeZone !== timeZone && (
              <p className="mt-2 flex items-center gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                <Globe className="size-3.5" />
                {formatInZone(moment, post.timeZone)} in {post.timeZone.replace(/_/g, " ")}
              </p>
            )}
          </div>
        )}

        {editable && <Actions post={post} timeZone={timeZone} pending={pending} onMove={onMove} onUnschedule={onUnschedule} />}
        {post.error && <p className="rounded-xl bg-destructive/10 p-2.5 text-xs text-destructive">{post.error}</p>}

        {post.platforms.length > 0 && (
          <section>
            <div role="tablist" aria-label="Platform" className="flex gap-1 rounded-2xl bg-muted/60 p-1">
              {post.platforms.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={shown === id}
                  onClick={() => setPlatform(id)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-xs font-semibold transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    shown === id ? "bg-card shadow-sm ring-1 ring-border/60" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <PlatformTile platform={id} className="size-5 rounded-md [&_svg]:size-3" />
                  {PLATFORM_STYLES[id].name}
                </button>
              ))}
            </div>
            <PlatformDetails key={shown} post={post} platform={shown} />
            <div className="mx-auto mt-4 max-w-[20rem]">
              <PlatformPreview platform={shown} post={{ title: post.title, caption: post.caption, hashtags: post.hashtags, media: post.media, account, initials }} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// What this platform gets: the format, its limits, any problems, and where it stands in Blotato
function PlatformDetails({ post, platform }: { post: PostView; platform: PostPlatform }) {
  const rules = PLATFORM_RULES[platform];
  const media = mediaForPlatform(platform, post.media);
  const video = media.find((item) => isVideo(item));
  const length = postCaption(post).length;
  const { errors, warnings } = checkPost({ ...post, platforms: [platform] });
  const result = post.results[platform];

  const format =
    platform === "youtube"
      ? video ? "Video / Short" : "Needs a video"
      : video ? (platform === "instagram" ? "Reel" : "Video")
      : media.length > 1 ? `${platform === "instagram" ? "Carousel" : "Photo post"} · ${media.length}`
      : media.length === 1 ? "Photo post" : "No media";
  const [low, high] = rules.bestHashtags;

  return (
    <div className="mt-3 space-y-3">
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <Stat Icon={Layers} label="Format" value={format} warn={media.length === 0} />
        <Stat Icon={Type} label="Caption" value={rules.maxChars ? `${length.toLocaleString()} / ${rules.maxChars.toLocaleString()}` : length.toLocaleString()} warn={!!rules.maxChars && length > rules.maxChars} />
        <Stat Icon={Hash} label="Hashtags" value={`${post.hashtags.length} · best ${low}–${high}`} warn={post.hashtags.length > high * 2} />
        {rules.maxTitle ? (
          <Stat Icon={Type} label="Title" value={`${post.title.length} / ${rules.maxTitle}`} warn={post.title.length > rules.maxTitle} />
        ) : (
          <Stat Icon={Globe} label="Account" value={post.accountIds[platform] ? "Chosen account" : "Default account"} />
        )}
      </dl>

      {result && (
        <div className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs ring-1 ring-border/60">
          {result.status === "published" ? (
            <>
              <CheckCircle2 className="size-4 text-emerald-600" />
              <span className="font-medium text-emerald-700 dark:text-emerald-300">Published</span>
              {result.url && (
                <a href={result.url} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 font-semibold text-primary hover:underline">
                  View live <ExternalLink className="size-3" />
                </a>
              )}
            </>
          ) : result.status === "failed" ? (
            <>
              <XCircle className="size-4 shrink-0 text-destructive" />
              <span className="line-clamp-2 text-destructive">{result.error ?? "Failed"}</span>
            </>
          ) : (
            <>
              <CalendarClock className="size-4 text-blue-600" />
              <span className="text-muted-foreground">{result.status === "scheduled" ? "Scheduled in Blotato" : "Processing in Blotato…"}</span>
            </>
          )}
        </div>
      )}

      {[...errors.map((text) => ({ text, error: true })), ...warnings.map((text) => ({ text, error: false }))].map(({ text, error }) => (
        <p key={text} className={cn("flex gap-2 rounded-xl px-3 py-2 text-xs", error ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-800 dark:text-amber-200")}>
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {text}
        </p>
      ))}
      {rules.tips && <p className="text-xs leading-relaxed text-muted-foreground">{rules.tips}</p>}
    </div>
  );
}

function Stat({ Icon, label, value, warn }: { Icon: typeof Hash; label: string; value: string; warn?: boolean }) {
  return (
    <div className={cn("rounded-xl px-2.5 py-2 ring-1", warn ? "bg-amber-500/5 ring-amber-500/40" : "bg-card ring-border/60")}>
      <dt className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3" />
        {label}
      </dt>
      <dd className="mt-0.5 truncate font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

// Edit, quick reschedule (in the calendar's zone) and unschedule
function Actions({ post, timeZone, pending, onMove, onUnschedule }: Pick<Props, "post" | "timeZone" | "pending" | "onMove" | "onUnschedule">) {
  const placed = placePost(post, timeZone);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(placed?.date ?? "");
  const [time, setTime] = useState(placed?.time ?? "09:00");
  const at = date && time ? zonedTimeToUtc(date, time, timeZone) : null;
  const invalid = !at ? "Pick a date and time." : at.getTime() < Date.now() + 60_000 ? "Pick a time at least a minute from now." : null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-9 rounded-xl" nativeButton={false} render={<Link href={`/dashboard/posts/${post.id}/edit`} />}>
          <PenLine data-icon="inline-start" />
          Edit post
        </Button>
        <Button variant={open ? "secondary" : "outline"} className="h-9 rounded-xl" onClick={() => setOpen(!open)} disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : <CalendarClock data-icon="inline-start" />}
          Reschedule
        </Button>
      </div>
      {open && (
        <form
          className="animate-in fade-in-0 slide-in-from-top-1 space-y-2 rounded-2xl bg-muted/50 p-3 ring-1 ring-border/60"
          onSubmit={(event) => {
            event.preventDefault();
            if (!at || invalid) return;
            onMove(post.id, at);
            setOpen(false);
          }}
        >
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input type="date" aria-label="Date" value={date} onChange={(event) => setDate(event.target.value)} className="h-9 rounded-xl bg-card" />
            <Input type="time" aria-label="Time" value={time} onChange={(event) => setTime(event.target.value)} className="h-9 rounded-xl bg-card" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className={cn("text-[11px]", invalid ? "text-destructive" : "text-muted-foreground")}>{invalid ?? `In ${timeZone.replace(/_/g, " ")}`}</span>
            <Button type="submit" size="sm" className="rounded-lg" disabled={!!invalid}>
              Move post
            </Button>
          </div>
        </form>
      )}
      {post.status === "scheduled" && (
        <Button variant="ghost" className="h-9 w-full rounded-xl text-muted-foreground hover:text-destructive" onClick={() => onUnschedule(post.id)} disabled={pending}>
          <CalendarX2 data-icon="inline-start" />
          Unschedule (keep as draft)
        </Button>
      )}
    </div>
  );
}
