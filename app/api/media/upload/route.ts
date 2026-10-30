import { storeCampaignImage } from "@/lib/imagekit/service";
import { jsonError } from "@/lib/posts/media";
import { IMAGE_TYPES, MAX_UPLOAD_BYTES, MAX_VIDEO_BYTES, VIDEO_TYPES, type PostMedia } from "@/lib/posts/shared";
import { getRequestScope } from "@/lib/request-scope";
import { isFileStorageConfigured } from "@/lib/storage/files";

export const runtime = "nodejs";
// Videos can take a while to reach storage
export const maxDuration = 120;

// Uploads an image or video for a post (multipart "file") to the campaign's assets folder
export async function POST(request: Request) {
  const scope = await getRequestScope();
  if (!scope) return jsonError("Please sign in again.", 401);
  if (!isFileStorageConfigured()) return jsonError("Image storage isn't set up: add the ImageKit keys to .env.local.", 503);

  const file = (await request.formData().catch(() => null))?.get("file");
  if (!(file instanceof File) || file.size === 0) return jsonError("Choose an image or video to upload.", 400);
  const video = VIDEO_TYPES.includes(file.type);
  if (!video && !IMAGE_TYPES.includes(file.type)) return jsonError("Upload a PNG, JPG, WEBP or GIF image, or an MP4, MOV or WEBM video.", 400);
  if (!video && file.size > MAX_UPLOAD_BYTES) return jsonError("Images must be 10MB or smaller.", 400);
  if (video && file.size > MAX_VIDEO_BYTES) return jsonError("Videos must be 100MB or smaller.", 400);

  try {
    const name = file.name.replace(/\.[^.]+$/, "") || "upload";
    const stored = await storeCampaignImage(scope.campaignId, file, name);
    const media: PostMedia = { url: stored.url, fileId: stored.fileId, name, mimeType: stored.mimeType, origin: "upload" };
    return Response.json({ media });
  } catch (error) {
    console.error("Uploading post media failed", error);
    return jsonError("The upload failed. Please try again.", 502);
  }
}
