import { notFound, redirect } from "next/navigation";
import { getPublishingAccounts } from "@/lib/blotato/store";
import { getActiveCampaign } from "@/lib/campaigns";
import { getCurrentUser } from "@/lib/insforge/server";
import { mediaCapabilities } from "@/lib/posts/media";
import { isEditable, utcToZonedParts } from "@/lib/posts/shared";
import { getPost } from "@/lib/posts/store";
import { PostComposer, type ComposerInitial } from "@/components/posts/post-composer";

export const metadata = { title: "Edit post" };

type Props = { params: Promise<{ id: string }> };

// The post editor for a post that hasn't gone out yet: change it, reschedule it, or move it back to drafts
export default async function EditPostPage({ params }: Props) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const campaign = await getActiveCampaign(user.id);
  if (!campaign) redirect("/create-campaign");

  const postId = Number((await params).id);
  if (!Number.isInteger(postId) || postId <= 0) notFound();
  const post = await getPost({ userId: user.id, campaignId: campaign.id }, postId);
  if (!post) notFound();
  // Published (or publishing) posts can't be changed
  if (!isEditable(post.status)) redirect("/dashboard/posts");

  const initial: ComposerInitial = {
    postId: post.id,
    draftId: post.draftId,
    title: post.title,
    caption: post.caption,
    hashtags: post.hashtags,
    platforms: post.platforms.length ? post.platforms : ["instagram"],
    media: post.media,
    accountIds: post.accountIds,
    schedule: post.scheduledAt ? { ...utcToZonedParts(new Date(post.scheduledAt), post.timeZone), timeZone: post.timeZone } : null,
  };

  const publishing = await getPublishingAccounts(user.id);
  const name = user.profile?.name ?? user.email;
  const initials = campaign.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <PostComposer
      key={post.id}
      initial={initial}
      account={campaign.name || name}
      initials={initials || "AI"}
      imageKit={mediaCapabilities().imageKit}
      publishing={{ platforms: publishing.platforms, accounts: publishing.byPlatform }}
    />
  );
}
