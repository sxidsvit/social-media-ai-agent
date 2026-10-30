import { z } from "zod";

// ImageKit image transformations (https://imagekit.io/docs/image-transformation), shared by the
// post editor (browser previews + /api/media/edit) and the Creator Agent's transform_image tool, so
// both offer the same edits with the same validation. Not server-only: building a URL needs no key.
//
// Edits are applied in order, one per chain step (joined with ":"). AI edits run on ImageKit's
// servers on the first request and cost extension units; ImageKit allows one per chain.

export const ASPECTS = {
  square: { label: "Square 1:1", size: "w-1080,h-1080", ratio: 1 },
  vertical: { label: "Feed 4:5", size: "w-1080,h-1350", ratio: 4 / 5 },
  portrait: { label: "Story 9:16", size: "w-1080,h-1920", ratio: 9 / 16 },
  landscape: { label: "Wide 16:9", size: "w-1920,h-1080", ratio: 16 / 9 },
} as const;
export type Aspect = keyof typeof ASPECTS;
export const ASPECT_IDS = Object.keys(ASPECTS) as [Aspect, ...Aspect[]];

export const TEXT_POSITIONS = ["top", "center", "bottom"] as const;
export type TextPosition = (typeof TEXT_POSITIONS)[number];

export const FLIPS = ["horizontal", "vertical"] as const;

export type ImageEdit =
  // AI
  | { kind: "remove_background" | "upscale" | "retouch" | "variation" }
  | { kind: "drop_shadow" }
  | { kind: "edit" | "change_background"; prompt: string }
  | { kind: "extend"; aspect: Aspect; prompt?: string | null }
  | { kind: "smart_crop" | "face_crop"; aspect: Aspect }
  // Crop and adjust
  | { kind: "resize"; aspect: Aspect }
  | { kind: "grayscale" | "contrast" }
  | { kind: "sharpen" | "blur"; amount: number }
  | { kind: "rotate"; degrees: number }
  | { kind: "flip"; direction: (typeof FLIPS)[number] }
  | { kind: "rounded"; radius: number }
  | { kind: "border"; width: number; color: string }
  | { kind: "gradient"; color: string }
  | { kind: "text"; text: string; position: TextPosition; color: string; size: number; background?: string | null; bold?: boolean | null };

export type EditKind = ImageEdit["kind"];

type EditInfo = { label: string; description: string; ai: boolean };

// What each edit does, for the editor's buttons and the agent's tool description
export const EDITS: Record<EditKind, EditInfo> = {
  remove_background: { label: "Remove background", description: "Cut the subject out on a transparent background", ai: true },
  change_background: { label: "Change background", description: "Replace the background with one described in the prompt", ai: true },
  edit: { label: "Edit with prompt", description: "Change the image as the prompt describes", ai: true },
  extend: { label: "Generative fill", description: "Extend the canvas to a new shape and have AI paint the added area (optional prompt)", ai: true },
  upscale: { label: "Upscale", description: "Sharper, higher resolution (input under 16MP)", ai: true },
  retouch: { label: "Retouch", description: "Clean up and improve the photo's quality", ai: true },
  variation: { label: "Variation", description: "A new take that keeps the composition but varies colour and texture", ai: true },
  drop_shadow: { label: "AI drop shadow", description: "Realistic shadow under the subject; only after remove_background", ai: false },
  smart_crop: { label: "Smart crop", description: "Crop to the shape around the main subject", ai: false },
  face_crop: { label: "Face crop", description: "Crop to the shape around a face", ai: false },
  resize: { label: "Resize", description: "Crop to the shape from the centre", ai: false },
  grayscale: { label: "Grayscale", description: "Black and white", ai: false },
  contrast: { label: "Auto contrast", description: "Stretch the contrast", ai: false },
  sharpen: { label: "Sharpen", description: "Sharpen details (amount 1-100)", ai: false },
  blur: { label: "Blur", description: "Blur the image (amount 1-100)", ai: false },
  rotate: { label: "Rotate", description: "Rotate clockwise by degrees", ai: false },
  flip: { label: "Flip", description: "Mirror horizontally or vertically", ai: false },
  rounded: { label: "Rounded corners", description: "Round the corners (radius in px)", ai: false },
  border: { label: "Border", description: "Solid border (width in px, hex colour)", ai: false },
  gradient: { label: "Gradient fade", description: "Fade to a colour at the bottom, so overlaid text reads well", ai: false },
  text: { label: "Text overlay", description: "Write text on the image (top, center or bottom)", ai: false },
};

// Hex colours without "#", 6 or 8 digits (8: with alpha)
const HEX = /^[0-9a-f]{6}([0-9a-f]{2})?$/i;
const clamp = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, value)));

function hex(color: string) {
  const clean = color.trim().replace(/^#/, "");
  if (!HEX.test(clean)) throw new Error(`"${color}" isn't a hex colour like #FFFFFF.`);
  return clean.toUpperCase();
}

// Text goes into the URL base64-encoded (ImageKit's "prompte-"/"ie-" forms), so any character is safe
function encoded(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, max);
  if (!clean) throw new Error("The text is empty.");
  const bytes = new TextEncoder().encode(clean);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return encodeURIComponent(btoa(binary));
}

// The layer is 86% of the image's width with its text centred in it, so a 7% left offset centres it;
// top and bottom keep a margin from the edge (ImageKit doesn't allow an offset with lfo)
const TEXT_POSITION: Record<TextPosition, string> = {
  top: "lx-bw_mul_0.07,ly-60",
  center: "lfo-center",
  bottom: "lx-bw_mul_0.07,ly-N60",
};

function step(edit: ImageEdit): string {
  switch (edit.kind) {
    case "remove_background":
      return "e-bgremove";
    case "upscale":
      return "e-upscale";
    case "retouch":
      return "e-retouch";
    case "variation":
      return "e-genvar";
    case "drop_shadow":
      return "e-dropshadow";
    case "edit":
      return `e-edit-prompte-${encoded(edit.prompt, 500)}`;
    case "change_background":
      return `e-changebg-prompte-${encoded(edit.prompt, 500)}`;
    case "extend":
      // Pads to the new shape and has AI fill the added area
      return `${ASPECTS[edit.aspect].size},cm-pad_resize,${edit.prompt?.trim() ? `bg-genfill-prompte-${encoded(edit.prompt, 500)}` : "bg-genfill"}`;
    case "smart_crop":
      return `${ASPECTS[edit.aspect].size},fo-auto`;
    case "face_crop":
      return `${ASPECTS[edit.aspect].size},fo-face`;
    case "resize":
      return `${ASPECTS[edit.aspect].size},fo-center`;
    case "grayscale":
      return "e-grayscale";
    case "contrast":
      return "e-contrast";
    case "sharpen":
      return `e-sharpen-${clamp(edit.amount, 1, 100)}`;
    case "blur":
      return `bl-${clamp(edit.amount, 1, 100)}`;
    case "rotate": {
      const degrees = clamp(edit.degrees, -359, 359);
      return degrees < 0 ? `rt-N${-degrees}` : `rt-${degrees}`;
    }
    case "flip":
      return edit.direction === "vertical" ? "fl-v" : "fl-h";
    case "rounded":
      return `r-${clamp(edit.radius, 1, 500)}`;
    case "border":
      return `b-${clamp(edit.width, 1, 100)}_${hex(edit.color)}`;
    case "gradient": {
      // Darkest at the bottom edge, clear by the middle
      const color = hex(edit.color).slice(0, 6);
      return `e-gradient-ld-top_from-${color}DD_to-${color}00_sp-0.5`;
    }
    case "text": {
      const parts = [
        "l-text",
        `ie-${encoded(edit.text, 200)}`,
        `fs-${clamp(edit.size, 12, 200)}`,
        `co-${hex(edit.color)}`,
        "w-bw_mul_0.86",
        "ia-center",
        edit.bold ? "tg-b" : "",
        edit.background ? `bg-${hex(edit.background)},pa-16_28,r-18` : "",
        TEXT_POSITION[edit.position],
        "l-end",
      ];
      return parts.filter(Boolean).join(",");
    }
  }
}

export function isAiEdit(edit: ImageEdit) {
  return EDITS[edit.kind].ai;
}

// Problems ImageKit would reject, in words the user or agent can act on; null when it's fine
export function checkEdits(edits: ImageEdit[]): string | null {
  if (!edits.length) return "No edits given.";
  if (edits.length > 8) return "Apply at most 8 edits at once.";
  if (edits.filter(isAiEdit).length > 1) return "Only one AI edit can run at a time: apply them one after another.";
  const shadow = edits.findIndex((edit) => edit.kind === "drop_shadow");
  if (shadow !== -1 && !edits.slice(0, shadow).some((edit) => edit.kind === "remove_background")) {
    return "The AI drop shadow needs a transparent background: remove the background first (in the same step).";
  }
  try {
    edits.forEach(step);
  } catch (error) {
    return (error as Error).message;
  }
  return null;
}

// The transformation string ("tr" value) for a list of edits
export function transformationString(edits: ImageEdit[]) {
  return edits.map(step).join(":");
}

// The source URL without any existing transformation, with these edits applied
export function transformationUrl(sourceUrl: string, edits: ImageEdit[]) {
  const source = new URL(sourceUrl);
  return `${source.origin}${source.pathname}?tr=${transformationString(edits)}`;
}

// A resized copy for previews and thumbnails (no-op for URLs that aren't ImageKit's)
export function imageKitThumbnail(url: string, width: number) {
  if (!/imagekit\.io/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}tr=w-${width}`;
}

// One edit as a tool or API input: a flat object whose unused fields are null (strict tool schemas
// need every field present). toImageEdit turns it into an ImageEdit, or a message saying what's missing.
export const EditInput = z.object({
  kind: z
    .enum(Object.keys(EDITS) as [EditKind, ...EditKind[]])
    .describe(
      Object.entries(EDITS)
        .map(([kind, info]) => `${kind}: ${info.description}`)
        .join("; ")
    ),
  prompt: z.string().max(500).nullable().describe("edit / change_background: what to change; extend: what to fill the new space with"),
  aspect: z.enum(ASPECT_IDS).nullable().describe("extend / smart_crop / face_crop / resize: square 1:1, vertical 4:5 feed, portrait 9:16 story/reel, landscape 16:9"),
  amount: z.number().nullable().describe("sharpen / blur: 1-100; rotate: degrees (negative = counter-clockwise); rounded / border: pixels"),
  text: z.string().max(200).nullable().describe("text: the words to write on the image"),
  color: z.string().max(9).nullable().describe("text / border / gradient: hex colour, e.g. #FFFFFF"),
  background: z.string().max(9).nullable().describe("text: optional hex colour of a box behind the text"),
  position: z.enum(TEXT_POSITIONS).nullable().describe("text: where to place it"),
  direction: z.enum(FLIPS).nullable().describe("flip: which way"),
});
export type EditInput = z.infer<typeof EditInput>;

export function toImageEdit(input: EditInput): ImageEdit | string {
  const needs = (field: string) => `${input.kind} needs ${field}.`;
  switch (input.kind) {
    case "edit":
    case "change_background":
      return input.prompt?.trim() ? { kind: input.kind, prompt: input.prompt } : needs("a prompt");
    case "extend":
      return input.aspect ? { kind: "extend", aspect: input.aspect, prompt: input.prompt } : needs("an aspect");
    case "smart_crop":
    case "face_crop":
    case "resize":
      return input.aspect ? { kind: input.kind, aspect: input.aspect } : needs("an aspect");
    case "sharpen":
    case "blur":
      return { kind: input.kind, amount: input.amount ?? (input.kind === "blur" ? 10 : 50) };
    case "rotate":
      return input.amount ? { kind: "rotate", degrees: input.amount } : needs("an amount in degrees");
    case "flip":
      return { kind: "flip", direction: input.direction ?? "horizontal" };
    case "rounded":
      return { kind: "rounded", radius: input.amount ?? 40 };
    case "border":
      return { kind: "border", width: input.amount ?? 12, color: input.color ?? "#FFFFFF" };
    case "gradient":
      return { kind: "gradient", color: input.color ?? "#000000" };
    case "text":
      return input.text?.trim()
        ? { kind: "text", text: input.text, position: input.position ?? "bottom", color: input.color ?? "#FFFFFF", size: input.amount ?? 64, background: input.background, bold: true }
        : needs("the text");
    default:
      return { kind: input.kind };
  }
}
