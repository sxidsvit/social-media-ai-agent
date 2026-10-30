import { formatDistanceToNow } from "date-fns";
import { BarChart3, CalendarClock, FileText, PenLine, Search, Send, type LucideIcon } from "lucide-react";
import type { ActivityItem, ActivityKind } from "@/lib/overview";
import { cn } from "@/lib/utils";
import { OverviewEmptyState, OverviewPanel } from "@/components/dashboard/overview/overview-panel";

const KINDS: Record<ActivityKind, { Icon: LucideIcon; tone: string }> = {
  research: { Icon: Search, tone: "bg-violet-500/10 text-violet-600 dark:text-violet-300" },
  content: { Icon: PenLine, tone: "bg-pink-500/10 text-pink-600 dark:text-pink-300" },
  schedule: { Icon: CalendarClock, tone: "bg-orange-500/10 text-orange-600 dark:text-orange-300" },
  publish: { Icon: Send, tone: "bg-blue-500/10 text-blue-600 dark:text-blue-300" },
  analytics: { Icon: BarChart3, tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" },
};

export function RecentActivityCard({ items }: { items: ActivityItem[] }) {
  return (
    <OverviewPanel title="Recent activity">
      {items.length === 0 ? (
        <OverviewEmptyState
          Icon={FileText}
          tone="bg-linear-to-br from-sky-400 to-blue-600 text-white"
          glow="shadow-sky-500/30"
          title="No recent activity"
          description="As your AI agents research, write and publish, their updates will appear here."
        />
      ) : (
        <ol className="relative mt-4 flex flex-col gap-4">
          {/* Timeline rail behind the icons */}
          <span aria-hidden className="absolute top-4 bottom-4 left-4 w-px bg-border" />
          {items.map((item) => {
            const { Icon, tone } = KINDS[item.kind];
            return (
              <li key={item.id} className="relative flex items-start gap-3">
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl ring-4 ring-card", tone)}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <p className="text-sm">{item.message}</p>
                  <time dateTime={item.createdAt.toISOString()} className="mt-0.5 block text-xs text-muted-foreground">
                    {formatDistanceToNow(item.createdAt, { addSuffix: true })}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </OverviewPanel>
  );
}
