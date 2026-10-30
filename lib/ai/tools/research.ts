import "server-only";
import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import { openPage } from "@/lib/ai/tools/computer-action";
import { wasVisited, recordVisit, type WorkerContext } from "@/lib/ai/tools/context";
import { checkpointDue, clipText, holdForUserOrCheckpoint, screenshotForModel, setStep, useSandbox } from "@/lib/ai/tools/runtime";
import { getTaskResearch, saveResearch } from "@/lib/orchestration/deliverables";
import { normalizeHashtags } from "@/lib/social-platforms";
import { looksLikeLogin } from "@/lib/sandbox/browser";
import type { Desktop } from "@/lib/sandbox/e2b";

// The Research Agent's tools (the Creator Agent has the browsing ones too):
// - web_search opens a search on Google, YouTube, Instagram, TikTok and other platforms in the
//   agent's own browser, so logins carry over and the user can watch
// - read_page copies the open page's text, so notes quote what the page says instead of what a
//   screenshot seemed to show
// - save_research stores the findings and their sources in the database for teammates and later

const SEARCH_SITES = {
  google: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en`,
  youtube: (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  instagram: (q: string) => {
    // A single hashtag has its own page; anything else uses keyword search
    const tag = q.trim().match(/^#?([\p{L}\p{N}_]+)$/u)?.[1];
    return tag ? `https://www.instagram.com/explore/tags/${encodeURIComponent(tag.toLowerCase())}/` : `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(q)}`;
  },
  tiktok: (q: string) => `https://www.tiktok.com/search?q=${encodeURIComponent(q)}`,
  x: (q: string) => `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=top`,
  reddit: (q: string) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}`,
  linkedin: (q: string) => `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(q)}`,
  pinterest: (q: string) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}`,
  facebook: (q: string) => `https://www.facebook.com/search/top/?q=${encodeURIComponent(q)}`,
  google_trends: (q: string) => `https://trends.google.com/trends/explore?q=${encodeURIComponent(q)}`,
  duckduckgo: (q: string) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
} as const;

type SearchSite = keyof typeof SEARCH_SITES;

// Google often answers sandboxes with a consent page or a robot check instead of results
const GOOGLE_CHECK = /before you continue|unusual traffic|sorry|captcha|not a robot/i;

export const webSearch = tool({
  name: "web_search",
  description:
    "Search the web or a social platform in your computer's browser and see the results page (a screenshot). Platforms: google, youtube, instagram (a single #hashtag opens its tag page), tiktok, x, reddit, linkedin, pinterest, facebook, google_trends, duckduckgo. Then click into results with computer_action, and use read_page to capture what a page says. Only for what you can't answer from your own knowledge.",
  parameters: z.object({
    platform: z.enum(Object.keys(SEARCH_SITES) as [SearchSite, ...SearchSite[]]),
    query: z.string().min(1).max(300).describe("What to search for, e.g. \"vegan meal prep reels\" or \"#plantbased\""),
  }),
  needsApproval: holdForUserOrCheckpoint,
  timeoutMs: 75_000,
  timeoutBehavior: "error_as_result",
  timeoutErrorFunction: () => "The search took longer than 75 seconds and was stopped. Take a screenshot to see where things are, then try again or use another platform.",
  execute: async ({ platform, query }, runContext?: RunContext<WorkerContext>) => {
    const context = runContext!.context;
    const desktop = await useSandbox(context);
    await setStep(context, `Searching ${platform.replace("_", " ")} for "${query}"`);

    const page = await openPage(context, desktop, new URL(SEARCH_SITES[platform](query)));
    let note = page.note;
    if (platform === "google" && GOOGLE_CHECK.test(page.title)) {
      note += ` Google is showing a check instead of results. If it's a "Before you continue" consent page, click "Accept all" or "Reject all" and carry on. If it's a robot check or captcha, don't solve it yourself: search with duckduckgo instead, or call request_user_action (kind "action") if you really need Google.`;
    }
    return [{ type: "text" as const, text: note }, await screenshotForModel(desktop)];
  },
});

// Reads the clipboard with xclip or xsel, installing xclip the first time if neither is there
async function readClipboard(desktop: Desktop) {
  const read = "if command -v xclip >/dev/null 2>&1; then xclip -o -selection clipboard; elif command -v xsel >/dev/null 2>&1; then xsel -ob; else exit 127; fi";
  try {
    return (await desktop.commands.run(read, { timeoutMs: 10_000 })).stdout;
  } catch (error) {
    if ((error as { exitCode?: number }).exitCode !== 127) return "";
  }
  await desktop.commands.run("sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xclip >/dev/null 2>&1 || (sudo apt-get update -qq >/dev/null 2>&1 && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xclip >/dev/null 2>&1)", { timeoutMs: 90_000 });
  return (await desktop.commands.run(read, { timeoutMs: 10_000 }).catch(() => null))?.stdout ?? "";
}

const MAX_PAGE_TEXT = 15_000;

export const readPage = tool({
  name: "read_page",
  description:
    "Copy the text of the page open in your browser (and its address), to take accurate notes and quote sources. Use it after a page has loaded and you've scrolled to what matters; it reads the whole page, not just what's on screen. Doesn't return a screenshot.",
  parameters: z.object({}),
  needsApproval: holdForUserOrCheckpoint,
  timeoutMs: 120_000,
  timeoutBehavior: "error_as_result",
  timeoutErrorFunction: () => "Reading the page took too long and was stopped. Take a screenshot and work from that instead.",
  execute: async (_input, runContext?: RunContext<WorkerContext>) => {
    const context = runContext!.context;
    const desktop = await useSandbox(context);
    await setStep(context, "Reading the page");

    // The address first: focus the address bar and copy it
    await desktop.press(["ctrl", "l"]);
    await desktop.wait(200);
    await desktop.press(["ctrl", "c"]);
    await desktop.wait(300);
    const url = (await readClipboard(desktop)).trim();
    // Back to the page itself (F6 moves focus from the address bar to the page), then copy all of it
    await desktop.press("escape");
    await desktop.press("f6");
    await desktop.wait(200);
    await desktop.press(["ctrl", "a"]);
    await desktop.press(["ctrl", "c"]);
    await desktop.wait(400);
    const text = (await readClipboard(desktop)).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    // Clear the selection so the page looks normal on the screen again
    await desktop.press("escape");

    const isUrl = /^https?:\/\/\S+$/.test(url);
    if (isUrl) recordVisit(context, url);
    if (!text || text === url) {
      return "Couldn't copy the page's text (the focus may be in a text box). Click on an empty part of the page and call read_page again, or work from a screenshot.";
    }
    const hint = looksLikeLogin(text.slice(0, 300)) && text.length < 1500
      ? "\n\nThis page looks like a login or verification page. If it blocks what you need, call request_user_action (kind \"login\")."
      : "";
    return `${isUrl ? `Address: ${url}\n` : ""}Page text:\n${clipText(text, MAX_PAGE_TEXT)}${hint}`;
  },
});

const Source = z.object({
  title: z.string().max(200).describe("What the source is, e.g. \"Instagram #plantbased top posts\""),
  url: z.string().nullable().describe("The page's address; null for your own knowledge"),
  platform: z.string().max(40).nullable().describe("e.g. instagram, youtube, google, news"),
  checked_live: z.boolean().describe("True only if you opened this page in your browser during this task"),
  note: z.string().max(300).nullable().describe("What it showed, or when it's from"),
});

export const saveResearchTool = tool({
  name: "save_research",
  description:
    "Save your research findings and their sources to the campaign's database, where teammates and the user find them. Call it once your findings are ready (before report_result), one call per topic; to change a save from this task, pass its research_id. Each finding cites its sources by their number in the sources list (1 = first).",
  parameters: z.object({
    research_id: z.number().int().nullable().describe("To update research you already saved in this task; null for new research"),
    topic: z.string().min(3).max(200),
    summary: z.string().min(10).max(1500).describe("Two to four sentences: the main takeaways"),
    method: z.enum(["knowledge", "live", "mixed"]).describe("knowledge: from what you know; live: looked up in the browser; mixed: both"),
    platforms: z.array(z.string().max(40)).max(10).describe("The platforms it's about, e.g. [\"instagram\", \"tiktok\"]"),
    hashtags: z.array(z.string().max(80)).max(40).describe("Hashtags worth using or watching"),
    findings: z
      .array(
        z.object({
          insight: z.string().min(3).max(400).describe("One finding, stated plainly"),
          details: z.string().max(1500).nullable().describe("Evidence, examples, numbers, why it matters"),
          sources: z.array(z.number().int().min(1)).max(10).describe("Numbers of the sources it comes from; [] for your own knowledge"),
        })
      )
      .min(1)
      .max(25),
    sources: z.array(Source).max(30),
  }),
  needsApproval: checkpointDue,
  execute: async (input, runContext?: RunContext<WorkerContext>) => {
    const context = runContext!.context;
    await setStep(context, `Saving research: ${input.topic}`);

    // Pages confirmed by an earlier save of this research count too (a revision starts a new run)
    const earlier = input.research_id ? await getTaskResearch(input.research_id, context.task.id) : null;
    if (input.research_id && !earlier) return `There's no research #${input.research_id} from this task to update. Save it as new research (research_id null).`;
    const confirmed = new Set(earlier?.sources.filter((source) => source.visited && source.url).map((source) => source.url!) ?? []);

    const notes: string[] = [];
    const sources = input.sources.map((source) => {
      const url = source.url?.trim() || null;
      const visited = !!url && (confirmed.has(url) || wasVisited(context, url));
      if (source.checked_live && !visited) notes.push(`"${source.title}" is marked as checked live, but your browser didn't open ${url ?? "it"} in this task, so it's saved as not checked.`);
      return { title: source.title.trim(), url, platform: source.platform?.trim().toLowerCase() || null, checkedLive: source.checked_live && visited, visited, note: source.note?.trim() || null };
    });
    const findings = input.findings.map((finding) => ({
      insight: finding.insight.trim(),
      details: finding.details?.trim() || null,
      sources: [...new Set(finding.sources)].filter((n) => n <= sources.length),
    }));
    const anyLive = sources.some((source) => source.checkedLive);
    // "live" research needs at least one page that was really opened
    const method = input.method !== "knowledge" && !anyLive ? "knowledge" : input.method;
    if (method !== input.method) notes.push(`Saved as "knowledge": no source was opened in your browser in this task.`);

    const row = await saveResearch(
      context,
      {
        topic: input.topic.trim(),
        summary: input.summary.trim(),
        method,
        platforms: input.platforms.map((platform) => platform.trim().toLowerCase()).filter(Boolean),
        hashtags: normalizeHashtags(input.hashtags),
        findings,
        sources,
      },
      input.research_id
    );
    if (!row) return `There's no research #${input.research_id} from this task to update. Save it as new research (research_id null).`;

    // A readable copy on the agent's computer, when it's already open (never wakes it just for this)
    const desktop = context.sandbox?.current;
    if (desktop) {
      const slug = input.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "research";
      await desktop.files.write(`/campaign/research/${slug}-${row.id}.md`, researchMarkdown(row.topic, row.summary, row.hashtags, findings, sources)).catch((error) => console.warn("Writing the research file failed", error));
    }
    return [`Research #${row.id} "${row.topic}" ${input.research_id ? "updated" : "saved"} (${findings.length} findings, ${sources.length} sources).`, ...notes].join(" ");
  },
});

function researchMarkdown(topic: string, summary: string, hashtags: string[], findings: { insight: string; details: string | null; sources: number[] }[], sources: { title: string; url: string | null; checkedLive: boolean; note: string | null }[]) {
  return [
    `# ${topic}`,
    summary,
    hashtags.length ? `Hashtags: ${hashtags.join(" ")}` : "",
    "## Findings",
    ...findings.map((finding) => `- ${finding.insight}${finding.sources.length ? ` [${finding.sources.join(", ")}]` : ""}${finding.details ? `\n  ${finding.details}` : ""}`),
    sources.length ? "## Sources" : "",
    ...sources.map((source, i) => `${i + 1}. ${source.title}${source.url ? ` — ${source.url}` : ""}${source.checkedLive ? " (checked live)" : ""}${source.note ? ` — ${source.note}` : ""}`),
  ]
    .filter(Boolean)
    .join("\n\n");
}
