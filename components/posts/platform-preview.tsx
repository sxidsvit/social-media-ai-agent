"use client";

/* eslint-disable @next/next/no-img-element -- previews show remote ImageKit URLs as they'll be posted */
import { useState } from "react";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Heart,
  ImageIcon,
  MessageCircle,
  MoreHorizontal,
  MoreVertical,
  Music2,
  Plus,
  Send,
  Share2,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { isVideo, mediaForPlatform, type PostMedia, type PostPlatform } from "@/lib/posts/shared";
import { cn } from "@/lib/utils";

// How the post will look on each platform, updated as the user types. These are close mockups of
// each app's feed, not pixel-perfect copies.

export type PreviewPost = {
  title: string;
  caption: string;
  hashtags: string[];
  media: PostMedia[];
  account: string;
  initials: string;
};

export function PlatformPreview({ platform, post }: { platform: PostPlatform; post: PreviewPost }) {
  if (platform === "instagram") return <InstagramPreview post={post} />;
  if (platform === "tiktok") return <TikTokPreview post={post} />;
  return <YouTubePreview post={post} />;
}

function handle(account: string) {
  return account.toLowerCase().replace(/[^a-z0-9._]+/g, "").slice(0, 24) || "yourbrand";
}

// Caption text with hashtags coloured like links
function RichText({ text, hashtags, tagClass }: { text: string; hashtags: string[]; tagClass: string }) {
  const parts = text.split(/(#[\p{L}\p{N}_]+)/u);
  return (
    <>
      {parts.map((part, i) => (part.startsWith("#") ? <span key={i} className={tagClass}>{part}</span> : <span key={i}>{part}</span>))}
      {hashtags.length > 0 && (
        <>
          {text ? " " : ""}
          <span className={tagClass}>{hashtags.join(" ")}</span>
        </>
      )}
    </>
  );
}

function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-indigo-500 to-violet-600 font-semibold text-white", className)}>
      {initials}
    </span>
  );
}

function EmptyMedia({ dark }: { dark?: boolean }) {
  return (
    <div className={cn("flex size-full flex-col items-center justify-center gap-2 text-xs", dark ? "bg-neutral-900 text-neutral-500" : "bg-neutral-100 text-neutral-400")}>
      <ImageIcon className="size-7" />
      Add an image to preview it
    </div>
  );
}

// An image, or a muted looping video, filling its box
function MediaItem({ item, className }: { item: PostMedia; className?: string }) {
  if (isVideo(item)) return <video src={item.url} muted loop autoPlay playsInline className={cn("size-full object-cover", className)} />;
  return <img src={item.url} alt={item.name} className={cn("size-full object-cover", className)} />;
}

// Swipeable-looking image stack with dots, as on Instagram carousels
function Carousel({ media, className, dark, index, setIndex }: { media: PostMedia[]; className?: string; dark?: boolean; index: number; setIndex: (index: number) => void }) {
  const current = Math.min(index, Math.max(0, media.length - 1));
  if (media.length === 0) return <div className={className}><EmptyMedia dark={dark} /></div>;
  return (
    <div className={cn("group/carousel relative overflow-hidden", className)}>
      <div className="flex size-full transition-transform duration-500 ease-out" style={{ transform: `translateX(-${current * 100}%)` }}>
        {media.map((item) => (
          <MediaItem key={item.url} item={item} className="shrink-0" />
        ))}
      </div>
      {media.length > 1 && (
        <>
          <span className="absolute top-3 right-3 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
            {current + 1}/{media.length}
          </span>
          {current > 0 && (
            <button type="button" aria-label="Previous image" onClick={() => setIndex(current - 1)} className="absolute top-1/2 left-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-neutral-800 shadow">
              <ChevronLeft className="size-4" />
            </button>
          )}
          {current < media.length - 1 && (
            <button type="button" aria-label="Next image" onClick={() => setIndex(current + 1)} className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-neutral-800 shadow">
              <ChevronRight className="size-4" />
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Dots({ count, active }: { count: number; active: number }) {
  if (count < 2) return null;
  return (
    <span className="flex justify-center gap-1">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cn("size-1.5 rounded-full", i === active ? "bg-sky-500" : "bg-neutral-300")} />
      ))}
    </span>
  );
}

// Only the first ~125 characters show before "more"
const IG_FOLD = 125;

function InstagramPreview({ post }: { post: PreviewPost }) {
  const [expanded, setExpanded] = useState(false);
  const [index, setIndex] = useState(0);
  const name = handle(post.account);
  const full = post.caption.trim();
  const folded = !expanded && full.length + post.hashtags.join(" ").length > IG_FOLD;
  const shown = folded ? full.slice(0, IG_FOLD).trimEnd() : full;

  return (
    <div className="overflow-hidden rounded-[22px] bg-white text-[13px] text-neutral-900 shadow-xl ring-1 ring-black/5">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="rounded-full bg-linear-to-tr from-amber-400 via-pink-500 to-purple-600 p-[2px]">
          <Avatar initials={post.initials} className="size-8 text-[11px] ring-2 ring-white" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{name}</span>
          <span className="block text-[11px] text-neutral-500">Original audio</span>
        </span>
        <MoreHorizontal className="size-5" />
      </div>
      <Carousel media={post.media} className="aspect-4/5 bg-neutral-100" index={index} setIndex={setIndex} />
      <div className="space-y-1.5 px-3 pt-2.5 pb-3">
        <div className="flex items-center gap-3.5">
          <Heart className="size-6" />
          <MessageCircle className="size-6 -scale-x-100" />
          <Send className="size-6" />
          <span className="flex-1"><Dots count={post.media.length} active={Math.min(index, post.media.length - 1)} /></span>
          <Bookmark className="size-6" />
        </div>
        <p className="font-semibold">Be the first to like this</p>
        <p className="leading-snug break-words whitespace-pre-line">
          <span className="mr-1 font-semibold">{name}</span>
          {folded ? (
            <>
              {shown}… <button type="button" onClick={() => setExpanded(true)} className="text-neutral-500">more</button>
            </>
          ) : (
            <RichText text={shown} hashtags={post.hashtags} tagClass="text-[#00376b]" />
          )}
        </p>
        <p className="text-[10px] tracking-wide text-neutral-400 uppercase">Just now</p>
      </div>
    </div>
  );
}

function TikTokPreview({ post }: { post: PreviewPost }) {
  const name = handle(post.account);
  const [index, setIndex] = useState(0);
  return (
    <div className="relative mx-auto aspect-9/16 max-h-[640px] overflow-hidden rounded-[28px] bg-black text-white shadow-xl ring-1 ring-black/10">
      <Carousel media={mediaForPlatform("tiktok", post.media)} className="absolute inset-0" dark index={index} setIndex={setIndex} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-b from-black/50 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-linear-to-t from-black/75 to-transparent" />

      <div className="absolute inset-x-0 top-4 flex justify-center gap-4 text-[14px] font-semibold">
        <span className="text-white/60">Following</span>
        <span className="relative">
          For You
          <span className="absolute -bottom-1.5 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-white" />
        </span>
      </div>

      <div className="absolute right-2.5 bottom-24 flex flex-col items-center gap-4 text-[11px] font-semibold">
        <span className="relative mb-2">
          <Avatar initials={post.initials} className="size-11 text-sm ring-2 ring-white" />
          <span className="absolute -bottom-2 left-1/2 flex size-5 -translate-x-1/2 items-center justify-center rounded-full bg-[#fe2c55]">
            <Plus className="size-3.5" strokeWidth={3} />
          </span>
        </span>
        <RailIcon Icon={Heart} label="0" />
        <RailIcon Icon={MessageCircle} label="0" />
        <RailIcon Icon={Bookmark} label="0" />
        <RailIcon Icon={Share2} label="Share" />
        <span className="mt-1 flex size-10 animate-[spin_6s_linear_infinite] items-center justify-center rounded-full bg-neutral-800 ring-8 ring-neutral-900">
          <Avatar initials={post.initials} className="size-5 text-[8px]" />
        </span>
      </div>

      <div className="absolute right-16 bottom-5 left-3 space-y-1.5 text-[13px]">
        <p className="font-semibold">@{name}</p>
        <p className="line-clamp-3 leading-snug break-words">
          <RichText text={post.caption.trim()} hashtags={post.hashtags} tagClass="font-semibold" />
        </p>
        <p className="flex items-center gap-1.5 text-[12px]">
          <Music2 className="size-3.5" />
          <span className="truncate">original sound - {name}</span>
        </p>
      </div>
    </div>
  );
}

function RailIcon({ Icon, label }: { Icon: typeof Heart; label: string }) {
  return (
    <span className="flex flex-col items-center gap-1 drop-shadow">
      <Icon className="size-7 fill-white/95" strokeWidth={0} />
      {label}
    </span>
  );
}

function YouTubePreview({ post }: { post: PreviewPost }) {
  const [expanded, setExpanded] = useState(false);
  const name = post.account || "Your channel";
  // YouTube only takes the video
  const cover = mediaForPlatform("youtube", post.media)[0];
  return (
    <div className="overflow-hidden rounded-[22px] bg-white text-neutral-900 shadow-xl ring-1 ring-black/5">
      <div className="relative aspect-video bg-neutral-900">
        {cover ? <MediaItem item={cover} /> : <EmptyMedia dark />}
        {!cover && <span className="absolute inset-x-0 bottom-3 text-center text-[11px] text-white/70">Add a video: YouTube takes videos and Shorts only</span>}
      </div>
      <div className="flex gap-3 p-3">
        <Avatar initials={post.initials} className="size-9 text-xs" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[15px] leading-snug font-semibold break-words">{post.title || "Your video title"}</p>
          <p className="mt-0.5 text-[12px] text-neutral-500">{name} · No views · Just now</p>
        </div>
        <MoreVertical className="size-5 shrink-0 text-neutral-600" />
      </div>
      <div className="flex items-center gap-2 px-3 pb-3">
        <span className="flex items-center rounded-full bg-neutral-100 text-[12px] font-medium">
          <span className="flex items-center gap-1.5 py-1.5 pr-3 pl-3"><ThumbsUp className="size-4" /> Like</span>
          <span className="h-5 w-px bg-neutral-300" />
          <span className="px-3 py-1.5"><ThumbsDown className="size-4" /></span>
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-[12px] font-medium"><Share2 className="size-4" /> Share</span>
      </div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="mx-3 mb-3 block w-[calc(100%-1.5rem)] rounded-xl bg-neutral-100 p-2.5 text-left text-[12px] leading-snug"
      >
        <span className="mb-0.5 block font-semibold">Description</span>
        <span className={cn("block break-words whitespace-pre-line", !expanded && "line-clamp-2")}>
          {post.caption.trim() || post.hashtags.length ? <RichText text={post.caption.trim()} hashtags={post.hashtags} tagClass="text-[#065fd4]" /> : <span className="text-neutral-500">No description</span>}
        </span>
        {!expanded && <span className="mt-0.5 block font-semibold">…more</span>}
      </button>
    </div>
  );
}
