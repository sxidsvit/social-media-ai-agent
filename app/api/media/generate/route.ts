import { z } from "zod";
import { generateImage, storeCampaignImage } from "@/lib/imagekit/service";
import { ASPECT_IDS } from "@/lib/imagekit/transformations";
import { jsonError } from "@/lib/posts/media";
import type { PostMedia } from "@/lib/posts/shared";
import { getRequestScope } from "@/lib/request-scope";
import { isFileStorageConfigured } from "@/lib/storage/files";

export const runtime = "nodejs";
// AI generation runs on ImageKit's first request and can take a minute or more
export const maxDuration = 300;

const Body = z.object({
  prompt: z.string().trim().min(5, "Describe the image in a few more words.").max(900),
  aspect: z.enum(ASPECT_IDS),
});

// Generates an image from a prompt (ImageKit's AI generation first, then the other set-up
// providers) and stores it in the campaign's assets folder
export async function POST(request: Request) {
  const scope = await getRequestScope();
  if (!scope) return jsonError("Please sign in again.", 401);
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(body.error.issues[0]?.message ?? "Invalid request.", 400);
  if (!isFileStorageConfigured()) return jsonError("Image storage isn't set up: add the ImageKit keys to .env.local.", 503);

  const { prompt, aspect } = body.data;
  try {
    const image = await generateImage(prompt, aspect, "imagekit");
    const name = prompt.slice(0, 60);
    const stored = await storeCampaignImage(scope.campaignId, image, name);
    const media: PostMedia = { url: stored.url, fileId: stored.fileId, name, mimeType: stored.mimeType, origin: "generated", prompt };
    return Response.json({ media });
  } catch (error) {
    console.warn("Generating a post image failed", error);
    return jsonError((error as Error).message, 502);
  }
}
