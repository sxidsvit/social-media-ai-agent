import "server-only";
import { isImageKitConfigured } from "@/lib/storage/imagekit";

// Media on a post must be a file this app stored for the campaign (campaignFolder in
// lib/storage/imagekit.ts), on ImageKit or the InsForge bucket: never an arbitrary URL.
export function isCampaignMediaUrl(url: string, campaignId: number) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const hosts = [process.env.IMAGEKIT_URL_ENDPOINT, process.env.NEXT_PUBLIC_INSFORGE_URL]
    .filter((value): value is string => !!value)
    .map((value) => new URL(value).origin);
  // InsForge encodes the object key in the path (objects/campaigns%2F12%2Fassets%2F...)
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return false;
  }
  return hosts.includes(parsed.origin) && pathname.includes(`/campaigns/${campaignId}/`);
}

// What the post editor can offer: uploads need storage; generation and edits need ImageKit
export function mediaCapabilities() {
  return { imageKit: isImageKitConfigured() };
}

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}
