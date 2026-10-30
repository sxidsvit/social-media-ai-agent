import Link from "next/link";
import { format } from "date-fns";
import { ArrowRight, CalendarDays, ChevronRight, Plus } from "lucide-react";
import type { SocialPlatform, UpcomingPost } from "@/lib/overview";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OverviewEmptyState, OverviewPanel } from "@/components/dashboard/overview/overview-panel";

const PLATFORMS: Record<SocialPlatform, { label: string; tone: string }> = {
  instagram: { label: "Instagram", tone: "bg-pink-500/10 text-pink-700 dark:text-pink-300" },
  facebook: { label: "Facebook", tone: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  x: { label: "X", tone: "bg-slate-500/10 text-slate-700 dark:text-slate-300" },
  linkedin: { label: "LinkedIn", tone: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  tiktok: { label: "TikTok", tone: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300" },
  youtube: { label: "YouTube", tone: "bg-red-500/10 text-red-700 dark:text-red-300" },
};

export function UpcomingPostsCard({ posts }: { posts: UpcomingPost[] }) {
  return (
    <OverviewPanel
      title="Upcoming posts"
      action={
        <Link
          href="/dashboard/calendar"
          className="group/link inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          View calendar
          <ArrowRight className="size-3.5 transition-transform group-hover/link:translate-x-0.5" />
        </Link>
      }
    >
      {posts.length === 0 ? (
        <OverviewEmptyState
          Icon={CalendarDays}
          tone="bg-linear-to-br from-blue-500 to-indigo-600 text-white"
          glow="shadow-blue-500/30"
          title="No posts scheduled yet"
          description="Schedule your first post and it will show up here."
        >
          <Button
            size="lg"
            className="h-10 rounded-xl px-5 shadow-lg shadow-primary/25 transition-[translate,box-shadow] hover:-translate-y-px hover:shadow-primary/35"
            nativeButton={false}
            render={<Link href="/dashboard/posts" />}
          >
            <Plus data-icon="inline-start" />
            Create post
          </Button>
        </OverviewEmptyState>
      ) : (
        <ul className="mt-3 flex flex-col gap-1">
          {posts.map((post) => {
            const platform = PLATFORMS[post.platform];
            return (
              <li key={post.id}>
                <Link
                  href="/dashboard/posts"
                  className="group/row flex items-center gap-3.5 rounded-2xl p-2 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="flex size-12 shrink-0 flex-col items-center justify-center rounded-xl bg-muted/80 leading-none">
                    <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                      {format(post.scheduledAt, "MMM")}
                    </span>
                    <span className="mt-0.5 text-lg font-bold tabular-nums">{format(post.scheduledAt, "d")}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{post.title}</span>
                    <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className={cn("rounded-full px-1.5 py-px font-medium", platform.tone)}>
                        {platform.label}
                      </span>
                      {format(post.scheduledAt, "EEE · h:mm a")}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/row:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </OverviewPanel>
  );
}
