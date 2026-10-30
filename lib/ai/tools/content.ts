import "server-only";
import { Agent, run, tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import { FORMATTING_RULE } from "@/lib/ai/agents";
import { getOpenAIClient } from "@/lib/ai/openai";
import type { WorkerContext } from "@/lib/ai/tools/context";
import { checkpointDue, setStep } from "@/lib/ai/tools/runtime";
import { clip } from "@/lib/orchestration/coordinator";
import { findCampaignMedia, saveDraft } from "@/lib/orchestration/deliverables";
import { checkDraft, normalizeHashtags, PLATFORM_RULES, PLATFORMS, postText, type Platform } from "@/lib/social-platforms";

// The Creator Agent's writing tools:
// - generate_copy has a focused copywriter write options for a post, caption, thread, script,
//   hashtag set or content ideas, held to the platform's limits
// - save_draft stores a finished piece (with its images) as a draft in the database, where the user
//   and the Scheduler Agent find it

const KINDS = ["post", "caption", "thread", "script", "carousel", "hashtags", "idea"] as const;

const CopyOption = z.object({
  title: z.string().describe("A short working title (for YouTube and Pinterest, the actual title)"),
  hook: z.string().describe("The opening line that stops the scroll; empty for a hashtag set"),
  body: z
    .string()
    .describe("The copy itself, without the hashtags: the caption or post, the thread (posts separated by blank lines, numbered 1/, 2/…), the script (with timings), the carousel slides (one per line), the idea, or for a hashtag set what the mix is for"),
  cta: z.string().describe("The call to action; empty if it doesn't need one"),
  hashtags: z.array(z.string()).describe("Hashtags for this option, most relevant first"),
  rationale: z.string().describe("One sentence on why it should work for this audience"),
});

const CopyOutput = z.object({ options: z.array(CopyOption) });

const copywriter = new Agent({
  name: "Creator Agent (copywriter)",
  instructions: `You are an expert social media copywriter. Write exactly what's asked, for the platform given,
ready to post: no placeholders like [brand], no explanations inside the copy.
- Follow the platform's limits and norms you're given; the hook must work in the part of the text
  shown before "more".
- Match the brand voice and tone you're given; if none, choose one that fits the audience.
- Use the research and context you're given; don't invent facts, figures, prices or quotes.
- Make the options genuinely different (angle, hook, format), not rewordings.
- Hashtags: mix broad, niche and branded ones, in the number that works best for the platform.
- Ideas: each one a concrete post concept (format, angle, what's shown), not a vague theme.
${FORMATTING_RULE}`,
  outputType: CopyOutput,
});

export const generateCopy = tool({
  name: "generate_copy",
  description:
    "Have a specialist copywriter write options for a post, caption, thread, video script, carousel, hashtag set or content ideas for one platform, within its limits. Returns the options (not saved): pick or edit the best, then save each finished piece with save_draft.",
  parameters: z.object({
    kind: z.enum(KINDS),
    platform: z.enum(PLATFORMS),
    brief: z
      .string()
      .min(10)
      .max(4000)
      .describe("What it's about: the topic or product, the goal, the audience, key points and facts to include, and any research findings to use"),
    tone: z.string().max(200).nullable().describe("Brand voice and tone, e.g. \"playful, Gen Z, emoji-light\""),
    count: z.number().int().min(1).max(5).describe("How many options (ideas: how many ideas)"),
  }),
  needsApproval: checkpointDue,
  timeoutMs: 120_000,
  timeoutBehavior: "error_as_result",
  timeoutErrorFunction: () => "Writing the copy took too long. Write it yourself instead, then save it with save_draft.",
  execute: async ({ kind, platform, brief, tone, count }, runContext?: RunContext<WorkerContext>) => {
    const context = runContext!.context;
    const rules = PLATFORM_RULES[platform];
    await setStep(context, `Writing ${kind === "idea" ? "content ideas" : `${rules.name} ${kind}`}`);
    getOpenAIClient();

    const limits = [
      rules.maxChars ? `Max ${rules.maxChars} characters for the whole post text, hashtags included${kind === "thread" ? " (per post in the thread)" : ""}.` : "",
      rules.maxTitle ? `Titles max ${rules.maxTitle} characters.` : "",
      rules.maxHashtags !== null ? `At most ${rules.maxHashtags} hashtags.` : "",
      `${rules.bestHashtags[0]}–${rules.bestHashtags[1]} hashtags usually work best.`,
      rules.tips,
    ]
      .filter(Boolean)
      .join(" ");
    const prompt = [
      `Campaign: "${context.campaignName}"`,
      `Write ${count} ${kind === "idea" ? "content ideas" : `option${count === 1 ? "" : "s"} for a ${rules.name} ${kind}`}.`,
      `Platform rules: ${limits}`,
      tone ? `Tone: ${tone}` : "",
      `Brief:\n"""\n${brief}\n"""`,
      context.inputs ? `Research and work from teammates you can use:\n"""\n${clip(context.inputs, 6000)}\n"""` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const result = await run(copywriter, prompt, { maxTurns: 5 });
    const options = result.finalOutput?.options ?? [];
    if (!options.length) return "The copywriter didn't return anything. Write the copy yourself, then save it with save_draft.";

    return options
      .slice(0, count)
      .map((option, i) => {
        const hashtags = normalizeHashtags(option.hashtags);
        const draft = { kind, title: option.title, body: option.body, cta: option.cta || null, hashtags };
        const warnings = checkDraft(platform, draft);
        return [
          `Option ${i + 1}: ${option.title}`,
          option.hook ? `Hook: ${option.hook}` : "",
          `Body:\n${option.body}`,
          option.cta ? `CTA: ${option.cta}` : "",
          hashtags.length ? `Hashtags: ${hashtags.join(" ")}` : "",
          `Why: ${option.rationale}`,
          kind === "idea" ? "" : `Length: ${postText(draft).length} characters${warnings.length ? `. FIX: ${warnings.join(" ")}` : ""}`,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
  },
});

export const saveDraftTool = tool({
  name: "save_draft",
  description:
    "Save a finished piece of content as a draft in the campaign's database: a post, caption, thread, script, carousel, hashtag set or content idea, for one platform, with its images. Call it once per piece (one per platform when a post is adapted to several); to change a draft from this task, pass its draft_id. image_urls must be URLs that generate_image, transform_image or a file upload returned.",
  parameters: z.object({
    draft_id: z.number().int().nullable().describe("To update a draft you already saved in this task; null for a new one"),
    kind: z.enum(KINDS),
    platform: z.enum(PLATFORMS),
    title: z.string().min(1).max(200).describe("A short title (for YouTube and Pinterest, the actual title)"),
    hook: z.string().max(500).nullable().describe("The opening line, if it's separate from the body"),
    body: z.string().min(1).max(20_000).describe("The full copy without the hashtags (the idea, for an idea)"),
    cta: z.string().max(500).nullable().describe("The call to action, if any"),
    hashtags: z.array(z.string().max(80)).max(60),
    image_urls: z.array(z.string()).max(10).describe("Images or videos for the post, in order; [] if none"),
    notes: z.string().max(1000).nullable().describe("For the user: posting notes, alt text, assumptions"),
  }),
  needsApproval: checkpointDue,
  execute: async (input, runContext?: RunContext<WorkerContext>) => {
    const context = runContext!.context;
    await setStep(context, `Saving draft: ${input.title}`);

    // Only media the team really made: a guessed URL would show as a broken image
    const urls = [...new Set(input.image_urls.map((url) => url.trim()).filter(Boolean))];
    const found = await findCampaignMedia(context.scope.campaignId, urls);
    const missing = urls.filter((url) => !found.some((item) => item.url === url));
    if (missing.length) {
      return `These image URLs aren't images made for this campaign: ${missing.join(", ")}. Use the exact URLs generate_image or transform_image returned (or upload the file first), then save again.`;
    }
    const media = urls.map((url) => {
      const item = found.find((row) => row.url === url)!;
      return { artifactId: item.id, url, name: item.name, mimeType: item.mimeType };
    });

    const hashtags = normalizeHashtags(input.hashtags);
    const draft = {
      kind: input.kind,
      platform: input.platform as Platform,
      title: input.title.trim(),
      hook: input.hook?.trim() || null,
      body: input.body.trim(),
      cta: input.cta?.trim() || null,
      hashtags,
      media,
      notes: input.notes?.trim() || null,
    };
    const warnings = checkDraft(draft.platform, draft);
    const row = await saveDraft(context, { ...draft, metadata: { characters: postText(draft).length, warnings } }, input.draft_id);
    if (!row) return `There's no draft #${input.draft_id} from this task to update. Save it as a new draft (draft_id null).`;

    return [
      `Draft #${row.id} "${row.title}" ${input.draft_id ? "updated" : "saved"} for ${PLATFORM_RULES[draft.platform].name}${media.length ? ` with ${media.length} image${media.length === 1 ? "" : "s"}` : ""}.`,
      warnings.length ? `It breaks the platform's limits: ${warnings.join(" ")} Fix it and save again with draft_id ${row.id}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  },
});
