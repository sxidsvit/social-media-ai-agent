import "server-only";
import { checkEdits, transformationUrl, type Aspect, type ImageEdit } from "@/lib/imagekit/transformations";

// ImageKit: permanent public URLs for what the agents make, and its text-to-image generation.
// Uploads use the private key, which never leaves the server.

const UPLOAD_URL = "https://upload.imagekit.io/api/v1/files/upload";

export type UploadedFile = { url: string; fileId: string; filePath: string; size: number; mimeType: string };

function privateKey() {
  const key = process.env.IMAGEKIT_PRIVATE_KEY;
  if (!key) throw new Error("IMAGEKIT_PRIVATE_KEY is not set");
  return key;
}

export function imageKitEndpoint() {
  const endpoint = process.env.IMAGEKIT_URL_ENDPOINT?.replace(/\/+$/, "");
  if (!endpoint) throw new Error("IMAGEKIT_URL_ENDPOINT is not set");
  return endpoint;
}

export function isImageKitConfigured() {
  return !!process.env.IMAGEKIT_PRIVATE_KEY && !!process.env.IMAGEKIT_URL_ENDPOINT;
}

// Campaign files go under /campaigns/<id>/<folder>
export function campaignFolder(campaignId: number, folder: "assets" | "output" | "research" | "exports") {
  return `/campaigns/${campaignId}/${folder}`;
}

export async function uploadToImageKit(
  data: Uint8Array | Blob,
  { fileName, folder, mimeType }: { fileName: string; folder: string; mimeType: string }
): Promise<UploadedFile> {
  const form = new FormData();
  const blob = data instanceof Blob ? data : new Blob([new Uint8Array(data)], { type: mimeType });
  form.append("file", blob, fileName);
  form.append("fileName", fileName);
  form.append("folder", folder);
  form.append("useUniqueFileName", "true");

  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${privateKey()}:`).toString("base64")}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await response.json().catch(() => null)) as { url?: string; fileId?: string; filePath?: string; size?: number; message?: string } | null;
  if (!response.ok || !body?.url || !body.fileId) throw new Error(`ImageKit upload failed: ${body?.message ?? response.statusText}`);
  return { url: body.url, fileId: body.fileId, filePath: body.filePath ?? fileName, size: body.size ?? blob.size, mimeType };
}

// ImageKit answers a slow AI request with a placeholder until the result is ready: a 202, or a 200
// marked is-intermediate-response. Only a finished image counts.
async function fetchFinishedImage(url: string, attempts: number, what: string) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    const type = response.headers.get("content-type") ?? "";
    const intermediate = response.status === 202 || response.headers.get("is-intermediate-response") === "true";
    if (response.ok && !intermediate && type.startsWith("image/")) {
      return { data: new Uint8Array(await response.arrayBuffer()), mimeType: type.split(";")[0] };
    }
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new Error(`ImageKit couldn't ${what} (${response.status}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
  }
  throw new Error(`ImageKit didn't ${what} in time. Try again in a minute.`);
}

const GENERATE_SIZES: Record<Aspect, string> = { square: "w-1024,h-1024", vertical: "w-1024,h-1280", portrait: "w-1024,h-1536", landscape: "w-1536,h-1024" };

// Generates an image from a prompt with ImageKit's text-to-image URL transformation. The first
// request runs the generation, so it can take a while.
export async function generateImageKitImage(prompt: string, aspect: Aspect) {
  const url = `${imageKitEndpoint()}/ik-genimg-prompt-${encodeURIComponent(prompt.slice(0, 900))}/generated.jpg?tr=${GENERATE_SIZES[aspect]}`;
  return fetchFinishedImage(url, 4, "generate the image");
}

// Applies edits (lib/imagekit/transformations.ts) to an image stored on this ImageKit account and
// fetches the result
export async function transformImageKitImage(sourceUrl: string, edits: ImageEdit[]) {
  const endpoint = imageKitEndpoint();
  const source = new URL(sourceUrl);
  if (`${source.origin}${source.pathname}`.indexOf(`${endpoint}/`) !== 0) {
    throw new Error("Only images stored in this ImageKit account can be transformed.");
  }
  const problem = checkEdits(edits);
  if (problem) throw new Error(problem);
  const url = transformationUrl(sourceUrl, edits);
  return { url, ...(await fetchFinishedImage(url, 6, "apply the transformation")) };
}
