import type { Campaign } from "@/db/schema";
import type { CampaignProgress } from "@/lib/overview";
import { CampaignIcon } from "@/components/campaign/campaign-icon";
import { OverviewPanel } from "@/components/dashboard/overview/overview-panel";

type Props = {
  campaign: Pick<Campaign, "name" | "icon" | "iconUrl">;
  progress: CampaignProgress;
};

export function CampaignStatusCard({ campaign, progress }: Props) {
  const done = progress.planned > 0 && progress.percent >= 100;

  return (
    <OverviewPanel>
      <div className="flex items-start gap-4">
        <CampaignIcon
          icon={campaign.icon}
          iconUrl={campaign.iconUrl}
          className="size-14 rounded-2xl shadow-md ring-4 ring-muted/60 sm:size-16"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h3 className="truncate text-base font-semibold tracking-tight">{campaign.name}</h3>
            {done ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">
                Completed
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <span className="relative flex size-1.5">
                  <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500 opacity-60" />
                  <span className="relative size-1.5 rounded-full bg-emerald-500" />
                </span>
                In progress
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            Researching trends, creating engaging content and scheduling posts to grow your brand.
          </p>
        </div>

        <div className="hidden shrink-0 text-right sm:block">
          <p className="text-3xl font-bold tracking-tight tabular-nums">{progress.percent}%</p>
          <p className="text-xs text-muted-foreground">Complete</p>
        </div>
      </div>

      <div className="mt-5">
        <div
          role="progressbar"
          aria-label="Campaign progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-linear-to-r from-blue-500 to-indigo-600 transition-[width] duration-700 ease-out"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <div className="mt-2.5 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground tabular-nums">{progress.published}</span> of{" "}
            <span className="tabular-nums">{progress.planned}</span> posts published
          </span>
          <span className="font-semibold text-foreground tabular-nums sm:hidden">{progress.percent}% complete</span>
        </div>
      </div>
    </OverviewPanel>
  );
}
