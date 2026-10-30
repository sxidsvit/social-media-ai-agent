import { Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCampaignIcon } from "@/lib/campaign-icons";

type Props = {
  icon?: string | null;
  iconUrl?: string | null;
  className?: string;
};

// Renders a campaign's preset icon or its uploaded custom image.
export function CampaignIcon({ icon, iconUrl, className }: Props) {
  if (iconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote storage URL / blob preview
      <img
        src={iconUrl}
        alt=""
        className={cn("size-10 shrink-0 rounded-xl border bg-background object-cover", className)}
      />
    );
  }

  const preset = getCampaignIcon(icon);
  const Icon = preset?.Icon ?? Megaphone;
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-1/2",
        preset?.tone ?? "bg-muted text-muted-foreground",
        className
      )}
    >
      <Icon />
    </span>
  );
}
