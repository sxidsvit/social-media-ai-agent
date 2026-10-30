import "server-only";
import { generateGeminiImage, isGeminiConfigured } from "@/lib/ai/gemini";
import { getOpenAIClient } from "@/lib/ai/openai";
import { checkEdits, type Aspect, type ImageEdit } from "@/lib/imagekit/transformations";
import { storeFile } from "@/lib/storage/files";
import { campaignFolder, generateImageKitImage, isImageKitConfigured, transformImageKitImage } from "@/lib/storage/imagekit";

// The image work shared by the post editor (/api/media/*) and the Creator Agent's tools
// (lib/ai/tools/generate-image.ts): generate an image, apply ImageKit edits, and store the result
// in the campaign's assets folder for a permanent URL.

export type Provider = "gemini" | "openai" | "imagekit";
export type Image = { data: Uint8Array; mimeType: string };
export type StoredImage = { url: string; fileId: string | null; storageKey: string; size: number; mimeType: string; storage: "imagekit" | "insforge" };

// The providers to try, in order, among those that are set up. IMAGE_PROVIDER picks the agents'
// default; `prefer` puts one first (the post editor asks for ImageKit's generation).
export function imageProviders(prefer?: Provider): Provider[] {
  const env = process.env.IMAGE_PROVIDER;
  const order: Provider[] = env === "imagekit" ? ["imagekit", "gemini"] : env === "openai" ? ["openai", "gemini", "imagekit"] : ["gemini", "imagekit"];
  if (prefer) order.sort((a, b) => Number(b === prefer) - Number(a === prefer));
  const configured: Record<Provider, () => boolean> = {
    gemini: isGeminiConfigured,
    imagekit: isImageKitConfigured,
    openai: () => !!process.env.OPENAI_API_KEY,
  };
  return order.filter((provider) => configured[provider]());
}

async function generateWithOpenAI(prompt: string, aspect: Aspect): Promise<Image> {
  const size = ({ square: "1024x1024", vertical: "1024x1536", portrait: "1024x1536", landscape: "1536x1024" } as const)[aspect];
  const response = await getOpenAIClient().images.generate({
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
    prompt,
    size,
    n: 1,
  });
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image.");
  return { data: new Uint8Array(Buffer.from(b64, "base64")), mimeType: "image/png" };
}

function generateWith(provider: Provider, prompt: string, aspect: Aspect) {
  if (provider === "gemini") return generateGeminiImage(prompt, aspect);
  if (provider === "openai") return generateWithOpenAI(prompt, aspect);
  return generateImageKitImage(prompt, aspect);
}

// Tries each set-up provider in turn. Throws with every provider's error when none worked.
export async function generateImage(prompt: string, aspect: Aspect, prefer?: Provider): Promise<Image & { provider: Provider }> {
  const available = imageProviders(prefer);
  if (!available.length) throw new Error("No image generator is set up (ImageKit, or GEMINI_API_KEY).");
  const errors: string[] = [];
  for (const provider of available) {
    try {
      return { ...(await generateWith(provider, prompt, aspect)), provider };
    } catch (error) {
      console.warn(`Image generation with ${provider} failed`, error);
      errors.push(`${provider}: ${(error as Error).message}`);
    }
  }
  throw new Error(`The image couldn't be generated (${errors.join("; ")}).`);
}

// Applies ImageKit edits to an image on this account. Throws a message the user or agent can act on.
export async function editImage(sourceUrl: string, edits: ImageEdit[]) {
  if (!isImageKitConfigured()) throw new Error("Image editing isn't available: ImageKit isn't set up.");
  const problem = checkEdits(edits);
  if (problem) throw new Error(problem);
  return transformImageKitImage(sourceUrl, edits);
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "image";
}

export function imageExtension(mimeType: string) {
  return (
    { "image/jpeg": "jpg", "image/webp": "webp", "image/avif": "avif", "image/gif": "gif", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" }[mimeType] ??
    "png"
  );
}

export function imageFileName(name: string, mimeType: string) {
  return `${slug(name)}-${Date.now().toString(36)}.${imageExtension(mimeType)}`;
}

// Stores an image in the campaign's assets folder (ImageKit, or InsForge storage without it)
export async function storeCampaignImage(campaignId: number, image: Image | Blob, name: string, fileName?: string): Promise<StoredImage & { fileName: string }> {
  const mimeType = image instanceof Blob ? image.type : image.mimeType;
  const data = image instanceof Blob ? image : image.data;
  const file = fileName ?? imageFileName(name, mimeType);
  const stored = await storeFile(data, { fileName: file, folder: campaignFolder(campaignId, "assets"), mimeType });
  return { url: stored.url, fileId: stored.fileId, storageKey: stored.key, size: stored.size, mimeType, storage: stored.provider, fileName: file };
}
