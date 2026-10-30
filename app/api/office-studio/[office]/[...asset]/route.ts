import { getOfficeAsset } from "@/lib/office-studio";

// Serves an office background or agent animation frame decoded from its scene bundle.
// URLs carry a ?v=<scene version>, so the response can be cached forever.
export async function GET(_request: Request, { params }: { params: Promise<{ office: string; asset: string[] }> }) {
  const { office, asset } = await params;
  const image = await getOfficeAsset(office, asset);
  if (!image) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(image.body), {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
