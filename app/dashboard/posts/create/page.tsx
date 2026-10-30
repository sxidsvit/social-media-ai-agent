import { redirect } from "next/navigation";
import { getPublishingAccounts } from "@/lib/blotato/store";
import { getActiveCampaign } from "@/lib/campaigns";
import { getCurrentUser } from "@/lib/insforge/server";
import { mediaCapabilities } from "@/lib/posts/media";
import { isTimeZone, POST_PLATFORMS, type PostPlatform } from "@/lib/posts/shared";
import { getDraft } from "@/lib/posts/store";
import { PostComposer, type ComposerInitial } from "@/components/posts/post-composer";

export const metadata = { title: "Create post" };

type Props = { searchParams: Promise<{ draft?: string; date?: string; time?: string; tz?: string }> };

const EMPTY: ComposerInitial = { draftId: null, title: "", caption: "", hashtags: [], platforms: ["instagram"], media: [] };

// A slot picked on the calendar: ?date=2026-10-20&time=09:30&tz=Asia/Kolkata
function slotFromParams(params: { date?: string; time?: string; tz?: string }): ComposerInitial["schedule"] {
  if (!params.date || !/^\d{4}-\d{2}-\d{2}$/.test(params.date)) return null;
  const time = params.time && /^\d{2}:\d{2}$/.test(params.time) ? params.time : "09:00";
  return { date: params.date, time, timeZone: params.tz && isTimeZone(params.tz) ? params.tz : "UTC" };
}

// The post editor. ?draft=<id> starts from one of the AI team's drafts; ?date (and time, tz) from a
// calendar slot.
export default async function CreatePostPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const campaign = await getActiveCampaign(user.id);
  if (!campaign) redirect("/create-campaign");

  const params = await searchParams;
  const draftId = Number(params.draft);
  const draft = Number.isInteger(draftId) && draftId > 0 ? await getDraft({ userId: user.id, campaignId: campaign.id }, draftId) : null;

  const publishing = await getPublishingAccounts(user.id);
  const initial: ComposerInitial = draft
    ? {
        draftId: draft.id,
        title: draft.title,
        caption: [draft.hook, draft.body, draft.cta].filter((part) => part?.trim()).join("\n\n"),
        hashtags: draft.hashtags,
        platforms: (POST_PLATFORMS as readonly string[]).includes(draft.platform) ? [draft.platform as PostPlatform] : ["instagram"],
        media: draft.media.map((item) => ({ url: item.url, fileId: null, name: item.name, mimeType: item.mimeType, origin: "agent" as const })),
      }
    : // A new post starts on the first connected platform (the composer drops ones that aren't connected)
      { ...EMPTY, platforms: publishing.platforms.length ? [publishing.platforms[0]] : EMPTY.platforms };
  initial.schedule = slotFromParams(params);

  const name = user.profile?.name ?? user.email;
  const initials = campaign.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <PostComposer
      key={`${initial.draftId ?? "new"}-${params.date ?? ""}-${params.time ?? ""}`}
      initial={initial}
      account={campaign.name || name}
      initials={initials || "AI"}
      imageKit={mediaCapabilities().imageKit}
      publishing={{ platforms: publishing.platforms, accounts: publishing.byPlatform }}
    />
  );
}
