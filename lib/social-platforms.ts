// The platforms the Creator Agent writes for, and the limits a draft is checked against. Shared by
// the server (save_draft, generate_copy) and the browser (draft cards).

export const PLATFORMS = ["instagram", "tiktok", "youtube", "x", "linkedin", "facebook", "threads", "pinterest", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];

type PlatformRules = {
  name: string;
  // Most characters the post text (body, CTA and hashtags together) may have
  maxChars: number | null;
  // Most characters a title may have, for platforms with titles
  maxTitle?: number;
  // Hashtags the platform allows, and how many usually work best
  maxHashtags: number | null;
  bestHashtags: [number, number];
  // What the copywriter should keep in mind
  tips: string;
};

export const PLATFORM_RULES: Record<Platform, PlatformRules> = {
  instagram: {
    name: "Instagram",
    maxChars: 2200,
    maxHashtags: 30,
    bestHashtags: [3, 5],
    tips: "Only the first ~125 characters show before \"more\", so the hook goes first. Line breaks help; hashtags at the end.",
  },
  tiktok: {
    name: "TikTok",
    maxChars: 4000,
    maxHashtags: null,
    bestHashtags: [3, 5],
    tips: "Short, punchy caption that adds to the video; searchable keywords help discovery.",
  },
  youtube: {
    name: "YouTube",
    maxChars: 5000,
    maxTitle: 100,
    maxHashtags: 15,
    bestHashtags: [2, 3],
    tips: "The title carries the click (under ~70 characters shows in full); the description's first two lines show in search. More than 15 hashtags and YouTube ignores them all.",
  },
  x: {
    name: "X",
    maxChars: 280,
    maxHashtags: null,
    bestHashtags: [0, 2],
    tips: "280 characters including hashtags; one clear idea per post. Longer content works as a thread.",
  },
  linkedin: {
    name: "LinkedIn",
    maxChars: 3000,
    maxHashtags: null,
    bestHashtags: [3, 5],
    tips: "About 210 characters show before \"see more\". Professional but human; short paragraphs.",
  },
  facebook: {
    name: "Facebook",
    maxChars: 63206,
    maxHashtags: null,
    bestHashtags: [0, 3],
    tips: "Shorter posts (under ~80 characters) tend to get more engagement; hashtags matter little.",
  },
  threads: {
    name: "Threads",
    maxChars: 500,
    maxHashtags: 1,
    bestHashtags: [0, 1],
    tips: "500 characters; one topic tag per post. Conversational.",
  },
  pinterest: {
    name: "Pinterest",
    maxChars: 500,
    maxTitle: 100,
    maxHashtags: null,
    bestHashtags: [0, 5],
    tips: "Keyword-rich title and description; it works like a search engine.",
  },
  other: { name: "Other", maxChars: null, maxHashtags: null, bestHashtags: [0, 5], tips: "" },
};

export function platformName(platform: string) {
  return PLATFORM_RULES[platform as Platform]?.name ?? platform;
}

// "#Summer Vibes", "summervibes" → "#summervibes"; drops empties and repeats
export function normalizeHashtags(tags: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const clean = tag.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]+/gu, "");
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    result.push(`#${clean}`);
  }
  return result;
}

// The text as it would be posted: body, then the call to action, then the hashtags
export function postText(draft: { body: string; cta?: string | null; hashtags: string[] }) {
  return [draft.body.trim(), draft.cta?.trim(), draft.hashtags.join(" ")].filter(Boolean).join("\n\n");
}

// What breaks a platform's limits or best practice, in words the agent (and the user) can act on
export function checkDraft(platform: string, draft: { kind: string; title: string; body: string; cta?: string | null; hashtags: string[] }) {
  const rules = PLATFORM_RULES[platform as Platform];
  if (!rules || draft.kind === "idea" || draft.kind === "script") return [];
  const warnings: string[] = [];
  const length = postText(draft).length;
  // A thread is several posts, so its total can be longer than one post
  if (rules.maxChars && draft.kind !== "thread" && length > rules.maxChars) {
    warnings.push(`${rules.name} allows ${rules.maxChars} characters; this is ${length}.`);
  }
  if (rules.maxTitle && draft.title.length > rules.maxTitle) warnings.push(`${rules.name} titles allow ${rules.maxTitle} characters; this is ${draft.title.length}.`);
  const tags = draft.hashtags.length;
  if (rules.maxHashtags !== null && tags > rules.maxHashtags) warnings.push(`${rules.name} allows ${rules.maxHashtags} hashtags; this has ${tags}.`);
  else if (draft.kind !== "hashtags" && tags > rules.bestHashtags[1] * 2) warnings.push(`${tags} hashtags is a lot for ${rules.name}; ${rules.bestHashtags[0]}–${rules.bestHashtags[1]} usually works best.`);
  return warnings;
}
