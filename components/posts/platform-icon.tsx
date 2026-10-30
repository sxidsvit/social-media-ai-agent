import type { PostPlatform } from "@/lib/posts/shared";
import { cn } from "@/lib/utils";

// Simple brand marks and colours for the platforms a post can go to

export const PLATFORM_STYLES: Record<PostPlatform, { name: string; tile: string; tint: string; ring: string }> = {
  instagram: {
    name: "Instagram",
    tile: "bg-linear-to-tr from-amber-400 via-pink-500 to-purple-600 text-white",
    tint: "bg-pink-500/10 text-pink-700 dark:text-pink-300",
    ring: "ring-pink-500/50",
  },
  tiktok: {
    name: "TikTok",
    tile: "bg-neutral-950 text-white dark:bg-neutral-800",
    tint: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
    ring: "ring-fuchsia-500/50",
  },
  youtube: {
    name: "YouTube",
    tile: "bg-red-600 text-white",
    tint: "bg-red-500/10 text-red-700 dark:text-red-300",
    ring: "ring-red-500/50",
  },
};

export function PlatformIcon({ platform, className }: { platform: PostPlatform; className?: string }) {
  const props = { className: cn("size-4", className), viewBox: "0 0 24 24", "aria-hidden": true } as const;
  if (platform === "instagram") {
    return (
      <svg {...props} fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (platform === "youtube") {
    return (
      <svg {...props} fill="currentColor">
        <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8ZM10 15V9l5.2 3L10 15Z" />
      </svg>
    );
  }
  return (
    <svg {...props} fill="currentColor">
      <path d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.7a5.7 5.7 0 1 0 4.9 5.7V9.1a7.4 7.4 0 0 0 4.3 1.4V7.4a4.3 4.3 0 0 1-3.2-1.6Z" />
    </svg>
  );
}

// A small rounded tile with the platform's mark
export function PlatformTile({ platform, className }: { platform: PostPlatform; className?: string }) {
  return (
    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-lg shadow-sm", PLATFORM_STYLES[platform].tile, className)} title={PLATFORM_STYLES[platform].name}>
      <PlatformIcon platform={platform} className="size-3.5" />
    </span>
  );
}
