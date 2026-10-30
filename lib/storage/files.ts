import "server-only";
import { isImageKitConfigured, uploadToImageKit } from "@/lib/storage/imagekit";

// Where the agents' files get their permanent public URL: ImageKit when it's set up (it also does the
// AI image transformations), otherwise the project's public InsForge "agent-files" bucket. Uploads
// run in background jobs with no signed-in user, so InsForge is reached with the server-only admin key.

const BUCKET = "agent-files";

export type StoredFile = { url: string; provider: "imagekit" | "insforge"; fileId: string | null; key: string; size: number };

function insforgeConfig() {
  const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const accessToken = process.env.INSFORGE_API_KEY;
  return baseUrl && accessToken ? { baseUrl, accessToken } : null;
}

export function isFileStorageConfigured() {
  return isImageKitConfigured() || !!insforgeConfig();
}

// folder: e.g. /campaigns/12/assets (see campaignFolder)
export async function storeFile(data: Uint8Array | Blob, { fileName, folder, mimeType }: { fileName: string; folder: string; mimeType: string }): Promise<StoredFile> {
  if (isImageKitConfigured()) {
    const uploaded = await uploadToImageKit(data, { fileName, folder, mimeType });
    return { url: uploaded.url, provider: "imagekit", fileId: uploaded.fileId, key: uploaded.filePath, size: uploaded.size };
  }

  const config = insforgeConfig();
  if (!config) throw new Error("No file storage is set up: add the ImageKit keys, or INSFORGE_API_KEY for InsForge storage.");
  const blob = data instanceof Blob ? data : new Blob([new Uint8Array(data)], { type: mimeType });
  const key = `${folder.replace(/^\/+/, "")}/${fileName}`;
  // Loaded as ESM: the SDK's CommonJS build can't load its ESM-only shared-schemas outside a bundler
  const { createClient } = await import("@insforge/sdk");
  const { data: stored, error } = await createClient(config).storage.from(BUCKET).upload(key, blob);
  if (error || !stored?.url) throw new Error(`InsForge upload failed: ${error?.message ?? "no URL returned"}`);
  return { url: stored.url, provider: "insforge", fileId: null, key: stored.key, size: stored.size ?? blob.size };
}
