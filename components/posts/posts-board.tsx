"use client";

/* eslint-disable @next/next/no-img-element -- post images are remote ImageKit URLs of any size */
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, CalendarX2, Clock, ExternalLink, FileText, ImageIcon, Layers, MoreHorizontal, Newspaper, PenLine, Sparkles } from "lucide-react";
import { unschedulePost } from "@/app/dashboard/posts/actions";
import { imageKitThumbnail } from "@/lib/imagekit/transformations";
import type { ContentDraftView } from "@/lib/orchestration/types";
import { formatInZone, isEditable, isVideo, POST_PLATFORMS, type PostPlatform, type PostStatus, type PostView } from "@/lib/posts/shared";
import { platformName } from "@/lib/social-platforms";
import { cn } from "@/lib/utils";
import { OverviewEmptyState, OverviewPanel } from "@/components/dashboard/overview/overview-panel";
import { CreatePostMenu } from "@/components/posts/create-post-menu";
import { PlatformTile } from "@/components/posts/platform-icon";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// Every post in the campaign (written by hand or scheduled from an AI draft), filterable by status,
// plus the AI team's drafts that are ready to be scheduled

type Filter = "all" | "scheduled" | "draft" | "published";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "scheduled", label: "Scheduled" },
  { id: "draft", label: "Drafts" },
  { id: "published", label: "Published" },
];

const STATUS: Record<PostStatus, { label: string; tone: string; dot: string }> = {
  draft: { label: "Draft", tone: "bg-slate-900/70 text-white", dot: "bg-slate-300" },
  scheduled: { label: "Scheduled", tone: "bg-blue-600/90 text-white", dot: "bg-sky-300 animate-pulse" },
  publishing: { label: "Publishing", tone: "bg-amber-500/90 text-white", dot: "bg-amber-200 animate-pulse" },
  published: { label: "Published", tone: "bg-emerald-600/90 text-white", dot: "bg-emerald-200" },
  failed: { label: "Failed", tone: "bg-red-600/90 text-white", dot: "bg-red-200" },
  cancelled: { label: "Cancelled", tone: "bg-slate-900/70 text-white", dot: "bg-slate-400" },
};

function matches(post: PostView, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "draft") return post.status === "draft" || post.status === "cancelled";
  if (filter === "published") return post.status === "published" || post.status === "publishing";
  return post.status === "scheduled";
}

export function PostsBoard({ posts, drafts }: { posts: PostView[]; drafts: ContentDraftView[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [platform, setPlatform] = useState<PostPlatform | null>(null);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map(({ id }) => [id, posts.filter((post) => matches(post, id)).length])) as Record<Filter, number>,
    [posts]
  );
  // Scheduled posts soonest first; the rest newest first
  const visible = posts
    .filter((post) => matches(post, filter) && (!platform || post.platforms.includes(platform)))
    .sort((a, b) => {
      if (a.status === "scheduled" && b.status === "scheduled") return Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!);
      if (a.status === "scheduled") return -1;
      if (b.status === "scheduled") return 1;
      return b.id - a.id;
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Filter posts" className="inline-flex w-fit rounded-2xl bg-card p-1 ring-1 ring-border/60">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                filter === id ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
              <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", filter === id ? "bg-background/20" : "bg-muted")}>{counts[id]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5" aria-label="Filter by platform">
          <span className="sr-only">Platforms</span>
          {POST_PLATFORMS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={platform === id}
              title={platformName(id)}
              onClick={() => setPlatform(platform === id ? null : id)}
              className={cn(
                "rounded-xl p-1 ring-1 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                platform === id ? "bg-card ring-foreground/40" : "ring-transparent opacity-60 grayscale hover:opacity-100 hover:grayscale-0",
                platform === null && "opacity-100 grayscale-0"
              )}
            >
              <PlatformTile platform={id} className="size-7" />
            </button>
          ))}
          <CreatePostMenu className="ml-2" />
        </div>
      </div>

      {visible.length === 0 ? (
        <OverviewPanel>
          <OverviewEmptyState
            Icon={Newspaper}
            tone="bg-linear-to-br from-pink-500 to-rose-600 text-white"
            glow="shadow-pink-500/30"
            title={posts.length === 0 ? "No posts yet" : "Nothing matches these filters"}
            description={
              posts.length === 0
                ? "Write your first post, or ask your AI team to draft one for you."
                : "Try another status or platform."
            }
          >
            {posts.length === 0 && <CreatePostMenu align="start" />}
          </OverviewEmptyState>
        </OverviewPanel>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((post, index) => (
            <li key={post.id} className="animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-both" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
              <PostCard post={post} />
            </li>
          ))}
        </ul>
      )}

      {drafts.length > 0 && (
        <OverviewPanel
          title="Drafted by your AI team"
          action={<span className="text-xs text-muted-foreground">{drafts.length} ready to schedule</span>}
        >
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {drafts.map((draft) => (
              <li key={draft.id}>
                <DraftCard draft={draft} />
              </li>
            ))}
          </ul>
        </OverviewPanel>
      )}
    </div>
  );
}

// Where a post is scheduled in Blotato, where it went live (with links), and what went wrong where it didn't
function PublishResults({ post }: { post: PostView }) {
  const results = post.platforms.flatMap((platform) => (post.results[platform] ? [[platform, post.results[platform]!] as const] : []));
  if (results.length === 0) return post.error ? <p className="mb-3 line-clamp-2 text-xs text-destructive">{post.error}</p> : null;
  return (
    <ul className="mb-3 space-y-1 text-xs">
      {results.map(([platform, result]) => (
        <li key={platform} className="flex min-w-0 items-center gap-1.5">
          <PlatformTile platform={platform} className="size-4 rounded-md [&_svg]:size-2.5" />
          {result.status === "published" ? (
            result.url ? (
              <a href={result.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium text-emerald-700 hover:underline dark:text-emerald-300">
                Live <ExternalLink className="size-3" />
              </a>
            ) : (
              <span className="font-medium text-emerald-700 dark:text-emerald-300">Published</span>
            )
          ) : result.status === "failed" ? (
            <span className="truncate text-destructive" title={result.error ?? undefined}>
              {result.error ?? "Failed"}
            </span>
          ) : result.status === "scheduled" ? (
            <span className="text-muted-foreground">Scheduled in Blotato</span>
          ) : (
            <span className="text-muted-foreground">Processing in Blotato…</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function PostCard({ post }: { post: PostView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const cover = post.media[0];
  const status = STATUS[post.status];

  return (
    <article
      className={cn(
        "group/card flex h-full flex-col overflow-hidden rounded-3xl bg-card shadow-[0_1px_2px_rgb(15_23_42/0.04),0_12px_32px_-18px_rgb(15_23_42/0.18)] ring-1 ring-border/60 transition-[translate,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgb(15_23_42/0.04),0_20px_40px_-18px_rgb(15_23_42/0.25)]",
        pending && "opacity-60"
      )}
    >
      <div className="relative aspect-4/3 overflow-hidden bg-muted">
        {cover && isVideo(cover) ? (
          <video src={cover.url} muted playsInline preload="metadata" className="size-full object-cover" />
        ) : cover ? (
          <img
            src={imageKitThumbnail(cover.url, 640)}
            alt={cover.name}
            loading="lazy"
            className="size-full object-cover transition-transform duration-500 group-hover/card:scale-[1.03]"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 bg-linear-to-br from-muted to-muted/40 text-muted-foreground">
            <ImageIcon className="size-6" />
            <span className="text-xs">No image</span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-linear-to-b from-black/35 to-transparent" />
        <span className={cn("absolute top-3 left-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md", status.tone)}>
          <span className={cn("size-1.5 rounded-full", status.dot)} />
          {status.label}
        </span>
        <span className="absolute top-3 right-3 flex -space-x-1.5">
          {post.platforms.map((platform) => (
            <PlatformTile key={platform} platform={platform} className="ring-2 ring-white/90" />
          ))}
        </span>
        {post.media.length > 1 && (
          <span className="absolute right-3 bottom-3 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-md">
            <Layers className="size-3" />
            {post.media.length}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">
            {isEditable(post.status) ? (
              <Link href={`/dashboard/posts/${post.id}/edit`} className="outline-none hover:underline focus-visible:underline">
                {post.title}
              </Link>
            ) : (
              post.title
            )}
          </h3>
          {isEditable(post.status) && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1 rounded-lg text-muted-foreground" aria-label="Post actions" />}
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 rounded-xl p-1">
                <DropdownMenuItem className="gap-2 rounded-lg" onClick={() => router.push(`/dashboard/posts/${post.id}/edit`)}>
                  {post.status === "scheduled" ? <CalendarClock /> : <PenLine />}
                  {post.status === "scheduled" ? "Edit & reschedule" : "Edit & schedule"}
                </DropdownMenuItem>
                {post.status === "scheduled" && (
                  <DropdownMenuItem
                    className="gap-2 rounded-lg"
                    onClick={() =>
                      startTransition(async () => {
                        const result = await unschedulePost(post.id);
                        setActionError(result.error ?? null);
                        router.refresh();
                      })
                    }
                  >
                    <CalendarX2 />
                    Unschedule
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">
          {post.caption || <span className="italic">No caption</span>}
          {post.hashtags.length > 0 && <span className="text-primary"> {post.hashtags.slice(0, 4).join(" ")}</span>}
        </p>
        {(post.status === "scheduled" || post.status === "published" || post.status === "failed") && <PublishResults post={post} />}
        {actionError && <p className="mb-3 line-clamp-3 text-xs text-destructive">{actionError}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs">
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <Clock className="size-3.5 shrink-0" />
            <span className="truncate">{post.scheduledAt ? formatInZone(post.scheduledAt, post.timeZone) : "Not scheduled"}</span>
          </span>
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium",
              post.source === "ai" ? "bg-violet-500/10 text-violet-700 dark:text-violet-300" : "bg-muted text-muted-foreground"
            )}
          >
            {post.source === "ai" ? <Sparkles className="size-3" /> : <PenLine className="size-3" />}
            {post.source === "ai" ? "AI" : "Manual"}
          </span>
        </div>
      </div>
    </article>
  );
}

function DraftCard({ draft }: { draft: ContentDraftView }) {
  const image = draft.media.find((item) => !item.mimeType?.startsWith("video/"));
  const schedulable = (POST_PLATFORMS as readonly string[]).includes(draft.platform);
  return (
    <article className="group/draft flex h-full gap-3 rounded-2xl bg-muted/40 p-2.5 ring-1 ring-border/60 transition-colors hover:bg-muted/70">
      <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-border/60">
        {image ? (
          <img src={imageKitThumbnail(image.url, 200)} alt={image.name} loading="lazy" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground">
            <FileText className="size-5" />
          </span>
        )}
        {schedulable && <PlatformTile platform={draft.platform as PostPlatform} className="absolute bottom-1 left-1 size-5 rounded-md" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold">{draft.title}</span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{draft.hook || draft.body}</span>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1.5">
          <span className="truncate text-[11px] text-muted-foreground">
            {platformName(draft.platform)} · Draft #{draft.id}
          </span>
          <Button
            size="xs"
            variant="secondary"
            className="rounded-lg"
            nativeButton={false}
            render={<Link href={`/dashboard/posts/create?draft=${draft.id}`} />}
          >
            <CalendarClock data-icon="inline-start" />
            Schedule
          </Button>
        </div>
      </div>
    </article>
  );
}
