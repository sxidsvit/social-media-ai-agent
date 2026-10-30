import "server-only";
import type { Aspect } from "@/lib/imagekit/transformations";

// Gemini image generation over the REST API (no SDK needed). The key never leaves the server.
// GEMINI_IMAGE_MODEL picks the model; it must be one that can answer with images.

const API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash-image";

export function isGeminiConfigured() {
  return !!process.env.GEMINI_API_KEY;
}

type GeminiPart = { text?: string; inlineData?: { mimeType?: string; data?: string } };
type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

export async function generateGeminiImage(prompt: string, aspect: Aspect) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_IMAGE_MODEL || DEFAULT_MODEL;
  const aspectRatio = ({ square: "1:1", vertical: "4:5", portrait: "9:16", landscape: "16:9" } as const)[aspect];

  const response = await fetch(`${API_URL}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio } },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await response.json().catch(() => null)) as GeminiResponse | null;
  if (!response.ok) throw new Error(`Gemini request failed: ${body?.error?.message ?? response.statusText}`);
  if (body?.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt (${body.promptFeedback.blockReason}).`);

  const candidate = body?.candidates?.[0];
  const image = candidate?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
  if (!image?.data) {
    const text = candidate?.content?.parts?.map((part) => part.text ?? "").join(" ").trim();
    throw new Error(`Gemini returned no image${candidate?.finishReason ? ` (${candidate.finishReason})` : ""}${text ? `: ${text.slice(0, 200)}` : ""}.`);
  }
  return { data: new Uint8Array(Buffer.from(image.data, "base64")), mimeType: image.mimeType || "image/png" };
}
