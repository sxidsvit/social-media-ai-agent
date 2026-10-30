import { z } from "zod";
import { editImage, storeCampaignImage } from "@/lib/imagekit/service";
import { checkEdits, EditInput, toImageEdit, type ImageEdit } from "@/lib/imagekit/transformations";
import { isCampaignMediaUrl, jsonError } from "@/lib/posts/media";
import type { PostMedia } from "@/lib/posts/shared";
import { getRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";
// AI edits run on ImageKit's first request and can take a minute or more
export const maxDuration = 300;

const Body = z.object({
  url: z.string().max(2000),
  name: z.string().max(200),
  edits: z.array(EditInput).min(1).max(8),
});

// Applies ImageKit edits (lib/imagekit/transformations.ts, the same ones the Creator Agent's
// transform_image has) to one of the campaign's images and stores the result as a new image, so the
// edit has a permanent URL and the original stays as it was
export async function POST(request: Request) {
  const scope = await getRequestScope();
  if (!scope) return jsonError("Please sign in again.", 401);
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(body.error.issues[0]?.message ?? "Invalid request.", 400);

  const { url, name, edits } = body.data;
  if (!isCampaignMediaUrl(url, scope.campaignId)) return jsonError("Only this campaign's images can be edited.", 400);
  const parsed = edits.map(toImageEdit);
  const invalid = parsed.find((edit): edit is string => typeof edit === "string");
  if (invalid) return jsonError(invalid, 400);
  const problem = checkEdits(parsed as ImageEdit[]);
  if (problem) return jsonError(problem, 400);

  try {
    const result = await editImage(url, parsed as ImageEdit[]);
    const baseName = name.replace(/\s*\(edited\)$/, "");
    const stored = await storeCampaignImage(scope.campaignId, result, `${baseName} edited`);
    const media: PostMedia = {
      url: stored.url,
      fileId: stored.fileId,
      name: `${baseName} (edited)`,
      mimeType: stored.mimeType,
      origin: "edited",
      sourceUrl: url,
      edits: parsed,
    };
    return Response.json({ media, transformationUrl: result.url });
  } catch (error) {
    console.warn("Editing a post image failed", error);
    return jsonError((error as Error).message, 502);
  }
}
