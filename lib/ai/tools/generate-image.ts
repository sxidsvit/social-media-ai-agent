import "server-only";
import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import { getAgentRole } from "@/lib/agent-roles";
import { saveChatMessage } from "@/lib/agent-chats";
import { saveTaskArtifact } from "@/lib/orchestration/artifacts";
import type { WorkerContext } from "@/lib/ai/tools/context";
import { checkpointDue, setStep } from "@/lib/ai/tools/runtime";
import { editImage, generateImage as generateAnyImage, imageProviders, storeCampaignImage, type Image } from "@/lib/imagekit/service";
import { checkEdits, EDITS, EditInput, toImageEdit, type ImageEdit } from "@/lib/imagekit/transformations";
import { isFileStorageConfigured } from "@/lib/storage/files";
import { isImageKitConfigured } from "@/lib/storage/imagekit";

// The Creator Agent's image tools, on the image service the post editor uses too
// (lib/imagekit/service.ts). generate_image makes an image with Gemini, falling back to ImageKit's AI
// generation when it's set up (IMAGE_PROVIDER=imagekit tries ImageKit first; IMAGE_PROVIDER=openai
// picks OpenAI). transform_image applies the editor's ImageKit edits (lib/imagekit/transformations.ts).
// Every image is stored for a permanent URL (ImageKit, or InsForge storage without it), copied into
// the sandbox's /campaign/assets, and recorded as an artifact of the task.

// Uploads the image for a permanent URL, copies it into the sandbox and records it on the task
async function saveImage(context: WorkerContext, image: Image, name: string, metadata: Record<string, unknown>) {
  const uploaded = await storeCampaignImage(context.scope.campaignId, image, name);
  const fileName = uploaded.fileName;

  // A copy in the shared sandbox, so teammates (and the user) can open it there
  let sandboxPath: string | null = null;
  if (context.sandbox) {
    try {
      const desktop = await context.sandbox.open();
      sandboxPath = `/campaign/assets/${fileName}`;
      await desktop.files.write(sandboxPath, new Blob([new Uint8Array(image.data)], { type: image.mimeType }));
    } catch (error) {
      console.warn("Copying the image into the sandbox failed", error);
      sandboxPath = null;
    }
  }

  await saveTaskArtifact(context, {
    type: "image",
    name,
    url: uploaded.url,
    imagekitFileId: uploaded.fileId,
    sandboxPath,
    mimeType: image.mimeType,
    metadata: { ...metadata, size: uploaded.size, storage: uploaded.storage, storageKey: uploaded.storageKey },
  });
  await announceImage(context, name, uploaded.url);
  return `Image "${name}" saved: ${uploaded.url}${sandboxPath ? ` (sandbox: ${sandboxPath})` : ""}`;
}

// Posts the new image in the agent's own chat and the Master Agent's chat (which the workspace
// keeps in sync), where it shows as a small preview. A failed post never fails the tool.
async function announceImage(context: WorkerContext, name: string, url: string) {
  const { scope, task } = context;
  const where = `"${task.title}" (task #${task.id})`;
  try {
    await Promise.all([
      saveChatMessage({ ...scope, agentId: task.agentId }, { sender: "agent", text: `I made "${name}" for ${where}:\n${url}` }),
      saveChatMessage(
        { ...scope, agentId: "master" },
        { sender: "agent", text: `The ${getAgentRole(task.agentId).name} made "${name}" for ${where}:\n${url}` }
      ),
    ]);
  } catch (error) {
    console.warn("Posting the image to the chat failed", error);
  }
}

export const generateImage = tool({
  name: "generate_image",
  description:
    "Generate an image for a post from a detailed prompt (subject, style, composition, colours, any text to show or avoid). Returns its permanent URL and sandbox path; list it in report_result.",
  parameters: z.object({
    prompt: z.string().min(10).max(3000),
    name: z.string().max(80).describe('Short name, e.g. "Launch reel cover"'),
    aspect: z.enum(["square", "vertical", "portrait", "landscape"]).describe("square or vertical (4:5) for feed posts, portrait (9:16) for stories/reels/TikTok, landscape (16:9) for YouTube and banners"),
  }),
  needsApproval: checkpointDue,
  execute: async ({ prompt, name, aspect }, runContext?: RunContext<WorkerContext>) => {
    const context = runContext!.context;
    await setStep(context, `Generating "${name}"`);

    // Every image is stored for its permanent URL, so without storage nothing can be kept
    if (!isFileStorageConfigured()) {
      console.error("generate_image: set the ImageKit keys, or INSFORGE_API_KEY, to store images");
      return "Images can't be saved right now: image storage (ImageKit) isn't set up. Give the full image prompt in your result instead, and say the image couldn't be made because image storage isn't configured.";
    }
    if (!imageProviders().length) return "No image generator is set up (GEMINI_API_KEY, or ImageKit). Give the full image prompt in your result instead, so the image can be made later.";
    let image: Awaited<ReturnType<typeof generateAnyImage>>;
    try {
      image = await generateAnyImage(prompt, aspect);
    } catch (error) {
      return `${(error as Error).message} Try a simpler prompt, or continue without it.`;
    }
    try {
      return await saveImage(context, image, name, { prompt, aspect, provider: image.provider });
    } catch (error) {
      console.error("Saving the generated image failed", error);
      return `The image was generated but couldn't be saved (${(error as Error).message}). Try once more; if it fails again, continue without it and say so.`;
    }
  },
});

const AI_EDITS = Object.entries(EDITS)
  .filter(([, info]) => info.ai)
  .map(([kind]) => kind)
  .join(", ");

export const transformImage = tool({
  name: "transform_image",
  description: `Edit an image you made or uploaded (its ImageKit URL) with ImageKit, the same edits the user has in the post editor, applied in order: AI edits (${AI_EDITS}; only one per call, chain more with further calls on the result), crops to a platform's shape (smart_crop, face_crop, resize), adjustments (grayscale, contrast, sharpen, blur, rotate, flip, rounded, border, gradient) and a text overlay. Saves the result as a new image with a permanent URL; list it in report_result.`,
  parameters: z.object({
    image_url: z.string().describe("The image's ImageKit URL, from generate_image, transform_image or a file_storage upload"),
    edits: z.array(EditInput).min(1).max(8),
    name: z.string().max(80).describe('Short name for the result, e.g. "Launch cover (story)"'),
  }),
  needsApproval: checkpointDue,
  execute: async ({ image_url, edits, name }, runContext?: RunContext<WorkerContext>) => {
    const context = runContext!.context;
    const parsed = edits.map(toImageEdit);
    const invalid = parsed.find((edit): edit is string => typeof edit === "string");
    if (invalid) return invalid;
    const problem = checkEdits(parsed as ImageEdit[]);
    if (problem) return problem;
    if (!isImageKitConfigured()) return "Image editing isn't available (ImageKit isn't set up). Use generate_image with a prompt that describes the version you need instead.";

    await setStep(context, `Editing "${name}"`);
    try {
      const result = await editImage(image_url, parsed as ImageEdit[]);
      return await saveImage(context, result, name, { source: image_url, edits, transformationUrl: result.url, provider: "imagekit" });
    } catch (error) {
      console.warn("Image transformation failed", error);
      return `The image couldn't be transformed (${(error as Error).message}). Try fewer or different edits, or continue with the original.`;
    }
  },
});
